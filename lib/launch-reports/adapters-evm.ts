import type { AdapterContext, AdapterResult } from './types';
import { parseAmount } from './utils';
import {
  FLAP_BSC_ESTIMATE_CURVE_PROFILE, FLAP_TOTAL_SUPPLY, calculateFlapPriceWad,
  invertFlapExactIn, quoteFlapBuyExactIn, type FlapCurveState,
} from './amm-math/flap-curve';
import { modelFlapGraduatedPool, invertFlapGraduatedPoolBuy } from './amm-math/flap-graduated-pool';
import { FLAP_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS, FLAP_STANDARD_MAX_WALLET_SUPPLY_PCT, FLAP_PLANNER_CROSSING_HEADROOM_BPS, resolveFlapRobinhoodWalletBudget } from './amm-math/flap-launch-rules';
import {
  LETSCASH_NATIVE_CONFIG_BY_ID, LETSCASH_MAX_BUYERS, LETSCASH_MAX_SUPPLY_CONTROL_PCT,
  calculateLetsCashSpotPriceWad, planLetsCashLaunchBuys,
} from './amm-math/letscash-v4';
import {
  LUNCH_FUN_MAX_BUNDLE_WALLETS, LUNCH_FUN_MAX_SUPPLY_CONTROL_PCT,
  LUNCH_FUN_MIN_SUPPLY_WEI, buildLunchFunInitialState, calculateLunchFunSpotPriceWad,
  planLunchFunLaunchBuys, type LunchFunLaunchKind,
} from './amm-math/lunch-fun';
import {
  POOLS_TRADE_OFFICIAL_TERMS, POOLS_TRADE_TOTAL_SUPPLY_WEI,
  POOLS_TRADE_MAX_BUYERS, POOLS_TRADE_MAX_SUPPLY_CONTROL_PCT,
  calculatePoolsTradeSpotPriceWad, planPoolsTradeLaunchBuys,
} from './amm-math/pools-trade-instant';
import {
  SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI, SUSHI_LAUNCHPAD_MAX_BUNDLE_WALLETS,
  SUSHI_LAUNCHPAD_MAX_SUPPLY_CONTROL_PCT, SUSHI_LAUNCHPAD_FEE_TIER,
  SUSHI_LAUNCHPAD_MIN_SLIPPAGE_BPS, deriveSushiBuysFromAllocations,
  quoteSushiLaunchBuys, projectSushiSupplyForAmounts,
} from './amm-math/sushi-launch-quote';
import {
  UNISWAP_V3_Q96, getUniswapV3SqrtRatioAtTick,
  getUniswapV3LiquidityForAmounts, quoteUniswapV3ExactInput,
} from './amm-math/uniswap-v3';
import {
  FOURMEME_MIGRATION_FEE_BPS, FOURMEME_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS,
  FOURMEME_MAX_GRADUATION_BUNDLE_TARGET_PCT,
  FOURMEME_PLANNER_CROSSING_HEADROOM_BPS,
} from './amm-math/fourmeme-launch-rules';
import { invertV2GraduatedPoolBuy, type V2GraduatedPoolState } from './amm-math/v2-graduated-pool';
import { fourCurveCost, fourCurveFdv, fourProtocolFee } from './four-curve';

const WAD = 10n ** 18n;
type Terms = Record<string, unknown>;

function recordedSnapshot(ctx: AdapterContext): Record<string, unknown> | null {
  const value = ctx.request.terms._snapshot;
  return ctx.request.termsSource?.kind === 'snapshot' && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function numberTerm(terms: Terms, key: string, fallback?: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const value = terms[key] ?? fallback;
  if (value === undefined || value === '' || !['string', 'number'].includes(typeof value)) {
    throw new Error(`Enter ${key} in the launch terms.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} must be between ${min} and ${max}.`);
  return n;
}

function integerTerm(terms: Terms, key: string, fallback?: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = numberTerm(terms, key, fallback, min, max);
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer.`);
  return n;
}

function rawTerm(terms: Terms, key: string, fallback?: bigint): bigint {
  const v = terms[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !/^\d{1,78}$/.test(v)) throw new Error(`${key} must be a nonnegative atomic-unit integer string within uint256.`);
  const result = BigInt(v);
  if (result >= 2n ** 256n) throw new Error(`${key} exceeds uint256.`);
  return result;
}

function amountTerm(terms: Terms, key: string, decimals: number): bigint {
  const v = terms[key];
  if (typeof v !== 'string') throw new Error(`Enter ${key} as a decimal amount.`);
  return parseAmount(v, decimals);
}

function splits(amount: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < 1 || count > 255 || amount < BigInt(count)) {
    throw new Error('The token target must cover 1–255 positive buyer allocations.');
  }
  return Array.from({ length: count }, (_, i) => amount / BigInt(count) + (i < Number(amount % BigInt(count)) ? 1n : 0n));
}

function allocations(amount: bigint, count: number) {
  return splits(amount, count).map((targetTokensOutWei, i) => ({
    role: 'bundle' as const, walletId: `buyer-${i + 1}`, targetTokensOutWei,
  }));
}

function total(values: bigint[]): bigint { return values.reduce((a, b) => a + b, 0n); }
function units(value: bigint, decimals: number): number { return Number(value) / 10 ** decimals; }
function fdv(ctx: AdapterContext, priceWad: bigint): number {
  return units(ctx.supplyRaw * priceWad / WAD, ctx.request.quote.decimals);
}
function requireNoRetention(ctx: AdapterContext): void {
  if (ctx.retainedRaw !== 0n) throw new Error('This launch model seeds or sells the prescribed supply; retained allocations must be zero.');
}
function require18Decimals(ctx: AdapterContext): void {
  if (ctx.request.base.decimals !== 18) throw new Error('This launch model uses an 18-decimal token.');
}
function enforcePolicy(ctx: AdapterContext, maxBuyers: number, maxTarget: number): void {
  if (ctx.buyerCount < 1 || ctx.buyerCount > maxBuyers) throw new Error(`This model supports 1–${maxBuyers} buyers.`);
  if (ctx.targetPct > maxTarget) throw new Error(`This model's supplied launch policy caps supply control at ${maxTarget}%.`);
}
function fixedSupply(ctx: AdapterContext, supply: bigint): void {
  require18Decimals(ctx);
  if (ctx.supplyRaw !== supply) throw new Error(`This model requires ${units(supply, 18).toLocaleString('en-US')} tokens with 18 decimals.`);
}
function quoteClass(terms: Terms): 'native' | 'stable' | 'rwa' {
  const value = terms.quoteClass ?? 'native';
  if (value !== 'native' && value !== 'stable' && value !== 'rwa') throw new Error('quoteClass must be native, stable, or rwa.');
  return value;
}

function calculateLetsCash(ctx: AdapterContext): AdapterResult {
  requireNoRetention(ctx);
  require18Decimals(ctx);
  if (ctx.request.quote.decimals !== 18) throw new Error('LetsCash native quote uses 18 decimals.');
  enforcePolicy(ctx, LETSCASH_MAX_BUYERS, LETSCASH_MAX_SUPPLY_CONTROL_PCT);
  const terms = ctx.request.terms;
  const configId = integerTerm(terms, 'configId', 1000);
  const config = LETSCASH_NATIVE_CONFIG_BY_ID.get(configId);
  const custom = terms.customTerms === true;
  const snapshot = recordedSnapshot(ctx);
  if (!config && !custom) throw new Error('Choose a supplied LetsCash config or enable customTerms and enter every curve field.');
  if (!custom && ctx.supplyRaw !== config!.supplyWei) throw new Error(`LetsCash config ${configId} fixes supply at ${units(config!.supplyWei, 18)} tokens.`);
  const resolved = {
    supplyWei: ctx.supplyRaw,
    feeRatePips: integerTerm(terms, 'feeRatePips', custom ? undefined : config!.feeRatePips, 1, 999_999),
    startTick: integerTerm(terms, 'startTick', custom ? undefined : config!.startTick, -887_271, 887_271),
    tickSpacing: integerTerm(terms, 'tickSpacing', custom ? undefined : config!.tickSpacing, 1, 32_767),
  };
  if (!custom && (resolved.feeRatePips !== config!.feeRatePips || resolved.startTick !== config!.startTick || resolved.tickSpacing !== config!.tickSpacing)) {
    throw new Error('Enable customTerms to override a supplied LetsCash config.');
  }
  const plan = planLetsCashLaunchBuys({ terms: resolved, allocations: allocations(ctx.targetRaw, ctx.buyerCount), slippageBps: integerTerm(terms, 'slippageBps', 50, 0, 5000) });
  return {
    buyRaw: plan.totalQuoteInWei, actualBaseRaw: plan.totalTokensOutWei,
    fdvQuote: fdv(ctx, calculateLetsCashSpotPriceWad(plan.finalState)), phase: 'V4 opening pool',
    details: { configId: custom && !snapshot ? null : configId, selfBurn: typeof snapshot?.selfBurn === 'boolean' ? snapshot.selfBurn : config?.selfBurn ?? null, terms: resolved, ...plan },
    warnings: snapshot ? [] : [custom ? 'Custom LetsCash curve terms are scenario inputs.' : 'Factory presets come from the supplied code snapshot; refresh the selected config for a new client quote.'],
  };
}

function calculatePools(ctx: AdapterContext): AdapterResult {
  requireNoRetention(ctx);
  fixedSupply(ctx, POOLS_TRADE_TOTAL_SUPPLY_WEI);
  if (ctx.request.quote.decimals !== 18) throw new Error('Pools native quote uses 18 decimals.');
  enforcePolicy(ctx, POOLS_TRADE_MAX_BUYERS, POOLS_TRADE_MAX_SUPPLY_CONTROL_PCT);
  const terms = ctx.request.terms;
  const resolved = {
    initialTick: integerTerm(terms, 'initialTick', POOLS_TRADE_OFFICIAL_TERMS.initialTick, -887_271, 887_271),
    initialSqrtPriceX96: rawTerm(terms, 'initialSqrtPriceX96', POOLS_TRADE_OFFICIAL_TERMS.initialSqrtPriceX96),
    positionLiquidity: rawTerm(terms, 'positionLiquidity', POOLS_TRADE_OFFICIAL_TERMS.positionLiquidity),
  };
  const plan = planPoolsTradeLaunchBuys({ terms: resolved, allocations: allocations(ctx.targetRaw, ctx.buyerCount), slippageBps: integerTerm(terms, 'slippageBps', 50, 0, 5000) });
  return {
    buyRaw: plan.totalQuoteInWei, actualBaseRaw: plan.totalTokensOutWei,
    fdvQuote: fdv(ctx, calculatePoolsTradeSpotPriceWad(plan.finalState)), phase: 'V4 opening pool',
    details: { terms: resolved, ...plan },
    warnings: recordedSnapshot(ctx) ? [] : ['Strategy immutables are from the supplied code snapshot; refresh them for a new client quote.'],
  };
}

function calculateLunch(ctx: AdapterContext): AdapterResult {
  requireNoRetention(ctx);
  require18Decimals(ctx);
  enforcePolicy(ctx, LUNCH_FUN_MAX_BUNDLE_WALLETS, LUNCH_FUN_MAX_SUPPLY_CONTROL_PCT);
  if (ctx.supplyRaw < LUNCH_FUN_MIN_SUPPLY_WEI) throw new Error('lunch.fun requires at least 1,000,000 tokens.');
  const t = ctx.request.terms;
  const kind: LunchFunLaunchKind = ctx.request.modelId === 'lunch-v3' ? 'v3' : ctx.request.modelId === 'lunch-v4-rewards' ? 'v4_rewards' : 'v4_tax';
  const magnitude = integerTerm(t, 'magnitude', undefined, 1, 887_199);
  const tokenOrdering = t.tokenOrdering ?? 'both';
  if (!['both', 'token0', 'token1'].includes(String(tokenOrdering))) throw new Error('tokenOrdering must be both, token0, or token1.');
  const orderings = tokenOrdering === 'both' ? [true, false] : [tokenOrdering === 'token0'];
  const terms = { kind, buyTaxBps: integerTerm(t, 'buyTaxBps', kind === 'v3' ? 0 : undefined, 0, 500) };
  const plan = planLunchFunLaunchBuys({
    poolStates: orderings.map((tokenIsToken0) => buildLunchFunInitialState({ supplyWei: ctx.supplyRaw, magnitude, tokenIsToken0, terms })),
    allocations: allocations(ctx.targetRaw, ctx.buyerCount), slippageBps: integerTerm(t, 'slippageBps', 50, 0, 5000),
  });
  const fdvs = plan.finalStates.map((s) => fdv(ctx, calculateLunchFunSpotPriceWad(s)));
  return {
    buyRaw: plan.totalQuoteInWei, actualBaseRaw: plan.totalExpectedTokensOutWei,
    fdvQuote: Math.min(...fdvs), phase: kind === 'v3' ? 'V3 opening pool' : 'V4 opening pool',
    details: { terms, magnitude, tokenOrdering, fdvQuoteRange: [Math.min(...fdvs), Math.max(...fdvs)], ...plan },
    warnings: tokenOrdering === 'both' ? ['Funding covers both token orderings. The displayed FDV is the lower modeled result; the full range is in the calculation details.'] : [],
  };
}

function calculateSushi(ctx: AdapterContext): AdapterResult {
  requireNoRetention(ctx);
  fixedSupply(ctx, SUSHI_LAUNCHPAD_TOTAL_SUPPLY_WEI);
  if (ctx.request.quote.decimals !== 18) throw new Error('Sushi Launchpad native quote uses 18 decimals.');
  enforcePolicy(ctx, SUSHI_LAUNCHPAD_MAX_BUNDLE_WALLETS, SUSHI_LAUNCHPAD_MAX_SUPPLY_CONTROL_PCT);
  const t = ctx.request.terms;
  const plannedStartTick = integerTerm(t, 'plannedStartTick', undefined, -886_800, 886_800);
  const reserveBps = integerTerm(t, 'reserveBps', undefined, 0, 9999);
  const tickRangeSpacings = integerTerm(t, 'tickRangeSpacings', 1, 0, 1);
  const slippageBps = integerTerm(t, 'slippageBps', 50, SUSHI_LAUNCHPAD_MIN_SLIPPAGE_BPS, 5000);
  if (plannedStartTick % 200 !== 0) throw new Error('Sushi plannedStartTick must be a multiple of 200.');
  const positionTokens = ctx.supplyRaw * BigInt(10000 - reserveBps) / 10000n;
  if (ctx.targetRaw >= positionTokens) throw new Error('The target exhausts the Sushi launch position after protocol reserves.');
  const buys = deriveSushiBuysFromAllocations({ allocations: splits(ctx.targetRaw, ctx.buyerCount), bundleWalletIds: Array.from({ length: ctx.buyerCount }, (_, i) => `buyer-${i + 1}`), plannedStartTick, reserveBps, tickRangeSpacings });
  const quote = quoteSushiLaunchBuys({ buys, plannedStartTick, reserveBps, tickRangeSpacings, slippageBps });
  const projection = projectSushiSupplyForAmounts({ buys, plannedStartTick, reserveBps, tickRangeSpacings });
  const states = quote.evaluations.map(({ startTick, tokenIsToken0 }) => {
    const sqrtStart = getUniswapV3SqrtRatioAtTick(tokenIsToken0 ? startTick : -startTick);
    const sqrtPriceLowerX96 = tokenIsToken0 ? sqrtStart : getUniswapV3SqrtRatioAtTick(-887_200);
    const sqrtPriceUpperX96 = tokenIsToken0 ? getUniswapV3SqrtRatioAtTick(887_200) : sqrtStart;
    let state = {
      liquidity: getUniswapV3LiquidityForAmounts(sqrtStart, sqrtPriceLowerX96, sqrtPriceUpperX96, tokenIsToken0 ? positionTokens : 0n, tokenIsToken0 ? 0n : positionTokens),
      sqrtPriceLowerX96, sqrtPriceUpperX96, sqrtPriceX96: tokenIsToken0 ? sqrtStart + 1n : sqrtStart - 1n,
    };
    for (const buy of buys) state = quoteUniswapV3ExactInput(state, buy.quoteInWei, SUSHI_LAUNCHPAD_FEE_TIER, !tokenIsToken0).nextState;
    const sqrtSquared = state.sqrtPriceX96 ** 2n;
    const priceWad = tokenIsToken0 ? sqrtSquared * WAD / (UNISWAP_V3_Q96 ** 2n) : UNISWAP_V3_Q96 ** 2n * WAD / sqrtSquared;
    return { startTick, tokenIsToken0, state, fdvQuote: fdv(ctx, priceWad) };
  });
  const fdvs = states.map((s) => s.fdvQuote);
  return {
    buyRaw: total(buys.map((b) => b.quoteInWei)), actualBaseRaw: total(projection.buys.map((b) => b.tokensOut)),
    fdvQuote: Math.min(...fdvs), phase: 'V3 opening pool',
    details: { plannedStartTick, reserveBps, tickRangeSpacings, slippageBps, buys, quote, projection, finalStates: states, fdvQuoteRange: [Math.min(...fdvs), Math.max(...fdvs)] },
    warnings: ['Funding and supply delivery are evaluated across both token orderings and every accepted start tick. Displayed FDV is the lower modeled result. Protocol reserves are not counted as client-controlled supply.'],
  };
}

function calculateFlap(ctx: AdapterContext): AdapterResult {
  requireNoRetention(ctx);
  fixedSupply(ctx, FLAP_TOTAL_SUPPLY);
  const t = ctx.request.terms;
  const cls = quoteClass(t);
  const chain = t.chain ?? 'bsc';
  if (chain !== 'bsc' && chain !== 'robinhood') throw new Error('Flap chain must be bsc or robinhood.');
  if (ctx.request.quote.decimals > 18) throw new Error('Flap quote decimals must be at most 18.');
  const custom = t.customTerms === true;
  if (!custom && (chain !== 'bsc' || ctx.request.quote.symbol.toUpperCase() !== 'BNB' || ctx.request.quote.decimals !== 18)) {
    throw new Error('The supplied Flap estimate profile is native BNB. Enable customTerms and enter hRaw, kRaw, rRaw, thresholdRaw, and curveFeeBps for another quote.');
  }
  const defaults = FLAP_BSC_ESTIMATE_CURVE_PROFILE;
  let state: FlapCurveState = {
    circulatingSupply: 0n, reserve: 0n, reserveDecimals: ctx.request.quote.decimals,
    dexSupplyThreshold: rawTerm(t, 'thresholdRaw', custom ? undefined : defaults.dexSupplyThreshold),
    h: rawTerm(t, 'hRaw', custom ? undefined : defaults.h),
    k: rawTerm(t, 'kRaw', custom ? undefined : defaults.k),
    r: rawTerm(t, 'rRaw', custom ? undefined : defaults.r),
  };
  if (state.dexSupplyThreshold <= 0n || state.dexSupplyThreshold >= ctx.supplyRaw || state.k <= 0n || state.r <= 0n) throw new Error('Flap curve terms must have positive k/r and a threshold strictly within total supply.');
  const curveFeeBps = BigInt(integerTerm(t, 'curveFeeBps', custom ? undefined : Number(defaults.bondingCurveFeeBps), 0, 9999));
  const poolBuyTaxBps = BigInt(integerTerm(t, 'poolBuyTaxBps', 0, 0, 9999));
  const capPct = numberTerm(t, 'perWalletCapPct', FLAP_STANDARD_MAX_WALLET_SUPPLY_PCT, 0, 100);
  const perWalletCapRaw = capPct === 0 ? undefined : ctx.supplyRaw * BigInt(Math.round(capPct * 1e6)) / 100_000_000n;
  const graduation = ctx.targetRaw >= state.dexSupplyThreshold;
  const usesPool = ctx.targetRaw > state.dexSupplyThreshold;
  const walletCap = chain === 'robinhood'
    ? resolveFlapRobinhoodWalletBudget(graduation ? 'graduation_bundle' : 'bundle', cls === 'native' ? 'native' : 'erc20')
    : FLAP_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS[cls];
  enforcePolicy(ctx, walletCap, 99);
  const poolBuyers = usesPool ? ctx.request.operations.poolBuyerCount ?? 2 : 0;
  const curveBuyers = usesPool ? ctx.request.operations.curveBuyerCount ?? ctx.buyerCount - poolBuyers : ctx.buyerCount;
  if (curveBuyers < 1 || poolBuyers < 0 || (usesPool && (poolBuyers < 1 || curveBuyers + poolBuyers !== ctx.buyerCount))) {
    throw new Error('Graduation requires positive curve and pool buyer counts that add up to the overall buyer count.');
  }
  const curveTarget = graduation ? state.dexSupplyThreshold : ctx.targetRaw;
  const curveAllocations = splits(curveTarget, curveBuyers);
  if (perWalletCapRaw !== undefined && curveAllocations.some((amount) => amount > perWalletCapRaw)) {
    throw new Error(`The ${capPct}% per-wallet curve cap requires more curve buyers. Use 0 only for a verified uncapped token type.`);
  }
  const curveBuys: Array<Record<string, unknown>> = [];
  let buyRaw = 0n;
  let actualBaseRaw = 0n;
  for (const [index, target] of curveAllocations.entries()) {
    state = { ...state, maxBuyAmount: perWalletCapRaw };
    const remaining = curveTarget - actualBaseRaw;
    const wanted = index === curveAllocations.length - 1 ? remaining : target;
    const quote = invertFlapExactIn(wanted, 10n ** 50n, (gross) => quoteFlapBuyExactIn(state, gross, curveFeeBps));
    if (!quote) throw new Error(`Flap curve cannot deliver buyer ${index + 1}'s allocation under these terms.`);
    buyRaw += quote.inAmount;
    actualBaseRaw += quote.outAmount;
    curveBuys.push({ buyer: index + 1, ...quote });
    state = { ...state, reserve: quote.postReserve, circulatingSupply: quote.postSupply };
  }
  const details: Record<string, unknown> = { curveTerms: { ...state, maxBuyAmount: perWalletCapRaw }, curveFeeBps, curveBuys, curveBuyers, poolBuyers, perWalletCapPct: capPct };
  let fdvQuote = units(calculateFlapPriceWad(state, state.circulatingSupply) * ctx.supplyRaw / WAD, 18);
  let reserveRaw = 0n;
  if (graduation) {
    let pool = modelFlapGraduatedPool({ buyTaxBps: poolBuyTaxBps, curveReserveAtThreshold: state.reserve, dexSupplyThreshold: state.dexSupplyThreshold, totalSupply: ctx.supplyRaw, quoteRetentionBps: BigInt(integerTerm(t, 'migrationRetentionBps', 0, 0, 9999)) });
    const poolBuys: Array<Record<string, unknown>> = [];
    const targetPool = ctx.targetRaw - actualBaseRaw;
    for (const target of targetPool > 0n ? splits(targetPool, poolBuyers) : []) {
      const q = invertFlapGraduatedPoolBuy(pool, target);
      if (!q) throw new Error('The graduated Flap pool cannot deliver the requested after-tax target.');
      buyRaw += q.quoteIn;
      actualBaseRaw += q.deliveredTokens;
      pool = q.postState;
      poolBuys.push(q as unknown as Record<string, unknown>);
    }
    fdvQuote = units(pool.reserveQuote * ctx.supplyRaw / pool.reserveToken, ctx.request.quote.decimals);
    details.poolBuys = poolBuys;
    details.finalPool = pool;
    // The supplied planner funds this as refundable headroom, not a trading cost.
    const crossingInput = curveBuys[curveBuys.length - 1]?.inAmount as bigint;
    reserveRaw = (crossingInput * FLAP_PLANNER_CROSSING_HEADROOM_BPS + 9999n) / 10000n;
    details.crossingRefundableHeadroomRaw = reserveRaw;
  }
  return {
    buyRaw, actualBaseRaw, fdvQuote, refundableReserveRaw: reserveRaw, phase: usesPool ? 'Curve + PancakeSwap V2' : graduation ? 'Curve → migration' : 'Bonding curve',
    details,
    warnings: [
      ...(recordedSnapshot(ctx) ? [] : [custom ? 'Flap custom terms are caller-supplied scenario inputs.' : 'Flap BNB values are the supplied estimate profile; refresh the Portal configuration for a new client quote.']),
      ...(cls !== 'native' ? ['Amounts are in the quote asset. Native-to-quote conversion, hop reserves and native gas require separate funding allowances.'] : []),
      ...(graduation ? ['Migration retention and pool tax are modeled inputs. The total includes the source planner’s refundable 2% crossing reserve.'] : []),
    ],
  };
}

function calculateFourNative(ctx: AdapterContext): AdapterResult {
  requireNoRetention(ctx);
  fixedSupply(ctx, 1000000000n * WAD);
  if (ctx.request.quote.symbol !== 'BNB' || ctx.request.quote.decimals !== 18 || ctx.liquidityRaw !== 0n) throw new Error('Four.meme native reports use BNB and derive initial liquidity from the curve.');
  enforcePolicy(ctx, FOURMEME_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS.native, FOURMEME_MAX_GRADUATION_BUNDLE_TARGET_PCT);
  const t = ctx.request.terms;
  const k = rawTerm(t, 'kRaw'), initialT = rawTerm(t, 'initialTRaw'), cap = rawTerm(t, 'maxOffersRaw');
  if (cap !== ctx.supplyRaw * 80n / 100n || initialT <= cap) throw new Error('Four.meme native curve shape differs from the verified 80% launch profile.');
  const feeBps = BigInt(integerTerm(t, 'protocolFeeBps', undefined, 0, 9999));
  const minimumFee = rawTerm(t, 'minTradingFeeRaw');
  const creatorBuyTaxBps = BigInt(integerTerm(t, 'creatorBuyTaxBps', 0, 0, 2500));
  if (creatorBuyTaxBps % 100n !== 0n) throw new Error('Four.meme creator tax uses whole percentage points.');
  const poolCount = ctx.targetRaw > cap ? ctx.request.operations.poolBuyerCount ?? 2 : 0;
  const curveCount = ctx.request.operations.curveBuyerCount ?? ctx.buyerCount - poolCount;
  if (curveCount < 1 || curveCount + poolCount !== ctx.buyerCount) throw new Error('Four.meme curve and pool wallet counts must add up to the total buyer count.');
  const curveTarget = ctx.targetRaw > cap ? cap : ctx.targetRaw;
  let virtualTokens = initialT, buyRaw = 0n, raisedRaw = 0n, crossingBuyRaw = 0n;
  const curveBuys = [];
  for (const tokenAmount of splits(curveTarget, curveCount)) {
    const cost = fourCurveCost(k, virtualTokens, tokenAmount);
    const protocolFee = fourProtocolFee(cost, feeBps, minimumFee);
    const creatorTax = cost * creatorBuyTaxBps / 10000n;
    const gross = cost + protocolFee + creatorTax;
    virtualTokens -= tokenAmount; raisedRaw += cost; buyRaw += gross; crossingBuyRaw = gross;
    curveBuys.push({ tokenAmount, cost, protocolFee, creatorTax, gross });
  }
  if (ctx.targetRaw < cap) return {
    buyRaw, actualBaseRaw: ctx.targetRaw, fdvQuote: fourCurveFdv(k, virtualTokens, ctx.supplyRaw), phase: 'Native BNB curve',
    details: { curveBuys, finalVirtualTokensRaw: virtualTokens, raisedRaw, curveModel: t.curveModel },
    warnings: ['Native curve arithmetic and separate protocol fees are verified against Four.meme Helper3 during refresh. Creator buy tax is a launch choice; reference-token taxes are not inherited.'],
  };
  const migrationFeeBps = BigInt(integerTerm(t, 'migrationFeeBps', Number(FOURMEME_MIGRATION_FEE_BPS), 0, 9999));
  let state: V2GraduatedPoolState = {
    reserveQuote: raisedRaw * (10000n - migrationFeeBps) / 10000n, reserveToken: ctx.supplyRaw - cap,
    buyTaxBps: creatorBuyTaxBps, feeBps: integerTerm(t, 'poolFeeBps', 25, 0, 9999),
  };
  const initialPool = { ...state }, poolBuys = [];
  let actualBaseRaw = cap;
  if (poolCount) for (const target of splits(ctx.targetRaw - cap, poolCount)) {
    const quote = invertV2GraduatedPoolBuy(state, target);
    if (!quote) throw new Error('Four.meme graduated liquidity cannot deliver the selected target.');
    state = quote.postState; buyRaw += quote.quoteIn; actualBaseRaw += quote.deliveredTokens; poolBuys.push(quote);
  }
  return {
    buyRaw, actualBaseRaw, refundableReserveRaw: (crossingBuyRaw * FOURMEME_PLANNER_CROSSING_HEADROOM_BPS + 9999n) / 10000n,
    fdvQuote: units(state.reserveQuote * ctx.supplyRaw / state.reserveToken, 18), phase: poolCount ? 'Curve + PancakeSwap V2' : 'Graduation endpoint',
    details: { curveBuys, raisedRaw, crossingBuyRaw, migrationFeeBps, initialPool, finalPool: state, poolBuys, curveModel: t.curveModel },
    warnings: ['Graduation uses the supplied 2% migration rule, generic V2 pool arithmetic, and a refundable 2% allowance on the crossing buy. Creator tax is an explicit launch choice.'],
  };
}

function calculateFourMeme(ctx: AdapterContext): AdapterResult {
  if (ctx.request.terms.curveModel === 'four-native-kt-v1') return calculateFourNative(ctx);
  requireNoRetention(ctx);
  const t = ctx.request.terms;
  const cls = quoteClass(t);
  enforcePolicy(ctx, FOURMEME_SHARED_WALLET_BUDGET_BY_QUOTE_CLASS[cls], FOURMEME_MAX_GRADUATION_BUNDLE_TARGET_PCT);
  const source = typeof t.quoteSource === 'string' ? t.quoteSource.trim() : '';
  const asOf = typeof t.quoteAsOf === 'string' ? t.quoteAsOf.trim() : '';
  if (!source || !asOf || Number.isNaN(Date.parse(asOf))) throw new Error('Four.meme needs quoteSource and a valid quoteAsOf timestamp for the supplied curve quote.');
  const quotedBuyerCount = integerTerm(t, 'quotedBuyerCount', undefined, 1, 48);
  if (quotedBuyerCount !== ctx.buyerCount) throw new Error('The authoritative Four.meme quote must use the same buyer count as this report.');
  if (ctx.targetPct <= 80) {
    const quotes = t.authoritativeQuotes;
    if (!Array.isArray(quotes)) throw new Error('Four.meme curve reports require authoritativeQuotes with one exact targetPct, grossQuote, and fdvQuote row per requested target.');
    const row = quotes.find((entry) => entry && typeof entry === 'object' && Number((entry as Terms).targetPct) === ctx.targetPct) as Terms | undefined;
    if (!row) throw new Error(`Provide an authoritative Four.meme quote for exactly ${ctx.targetPct}%; quotes are never interpolated.`);
    const buyRaw = amountTerm(row, 'grossQuote', ctx.request.quote.decimals);
    if (buyRaw <= 0n) throw new Error('Four.meme grossQuote must be positive.');
    const fdvQuote = numberTerm(row, 'fdvQuote', undefined, Number.MIN_VALUE);
    let refundableReserveRaw = 0n;
    if (ctx.targetPct === 80) {
      const crossingBuyGrossQuote = amountTerm(row, 'crossingBuyGrossQuote', ctx.request.quote.decimals);
      if (crossingBuyGrossQuote <= 0n || crossingBuyGrossQuote > buyRaw) throw new Error('The 80% quote requires the positive threshold-crossing input, no larger than the total gross cost.');
      refundableReserveRaw = (crossingBuyGrossQuote * FOURMEME_PLANNER_CROSSING_HEADROOM_BPS + 9999n) / 10000n;
    }
    return { buyRaw, actualBaseRaw: ctx.targetRaw, refundableReserveRaw, fdvQuote, phase: ctx.targetPct === 80 ? 'Authoritative migration quote' : 'Authoritative curve quote', details: { quoteSource: source, quoteAsOf: asOf, quotedBuyerCount, authoritativeQuote: row }, warnings: ['Four.meme curve funding is imported from the cited quote; the supplied package contains launch rules and graduated-pool math, not a standalone curve pricing contract. The 80% row must quote FDV after migration.'] };
  }
  const curveGrossQuote = amountTerm(t, 'curveGrossQuote', ctx.request.quote.decimals);
  const curveReserveQuote = amountTerm(t, 'curveReserveQuote', ctx.request.quote.decimals);
  const crossingBuyGrossQuote = amountTerm(t, 'crossingBuyGrossQuote', ctx.request.quote.decimals);
  if (curveGrossQuote <= 0n || curveReserveQuote <= 0n) throw new Error('Graduation requires positive full-curve gross cost and terminal curve reserves from the cited quote.');
  if (crossingBuyGrossQuote <= 0n || crossingBuyGrossQuote > curveGrossQuote) throw new Error('The positive threshold-crossing buy must not exceed the full-curve gross quote.');
  const curveDelivered = ctx.supplyRaw * 80n / 100n;
  const poolCount = ctx.request.operations.poolBuyerCount ?? 2;
  if (poolCount < 1 || poolCount >= ctx.buyerCount) throw new Error('Set a positive poolBuyerCount below the total buyer count.');
  const quotedCurveBuyerCount = integerTerm(t, 'quotedCurveBuyerCount', undefined, 1, 48);
  if (quotedCurveBuyerCount + poolCount !== ctx.buyerCount) throw new Error('quotedCurveBuyerCount plus poolBuyerCount must equal the total buyer count.');
  const migrationFeeBps = BigInt(integerTerm(t, 'migrationFeeBps', Number(FOURMEME_MIGRATION_FEE_BPS), 0, 9999));
  let state: V2GraduatedPoolState = {
    reserveQuote: curveReserveQuote * (10000n - migrationFeeBps) / 10000n,
    reserveToken: ctx.supplyRaw - curveDelivered,
    buyTaxBps: BigInt(integerTerm(t, 'poolBuyTaxBps', 0, 0, 9999)), feeBps: integerTerm(t, 'poolFeeBps', 25, 0, 9999),
  };
  const initialPool = { ...state };
  let buyRaw = curveGrossQuote;
  let actualBaseRaw = curveDelivered;
  const poolBuys = [];
  for (const target of splits(ctx.targetRaw - curveDelivered, poolCount)) {
    const q = invertV2GraduatedPoolBuy(state, target);
    if (!q) throw new Error('Four.meme graduated pool cannot deliver the requested after-tax allocation.');
    buyRaw += q.quoteIn;
    actualBaseRaw += q.deliveredTokens;
    state = q.postState;
    poolBuys.push(q);
  }
  return {
    buyRaw, actualBaseRaw, refundableReserveRaw: (crossingBuyGrossQuote * FOURMEME_PLANNER_CROSSING_HEADROOM_BPS + 9999n) / 10000n,
    fdvQuote: units(state.reserveQuote * ctx.supplyRaw / state.reserveToken, ctx.request.quote.decimals),
    phase: 'Quoted curve + PancakeSwap V2',
    details: { quoteSource: source, quoteAsOf: asOf, quotedBuyerCount, quotedCurveBuyerCount, curveGrossQuote, curveReserveQuote, crossingBuyGrossQuote, migrationFeeBps, initialPool, finalPool: state, poolBuys },
    warnings: ['Curve cost and reserve inputs must come from the cited full-curve quote. Graduation uses the supplied 2% migration rule and generic V2 pool arithmetic, and funds the source planner’s refundable 2% crossing reserve.'],
  };
}

export const EVM_MODEL_IDS = ['flap', 'letscash', 'lunch-v3', 'lunch-v4-tax', 'lunch-v4-rewards', 'pools-instant', 'sushi-launchpad', 'fourmeme'] as const;

export function calculateEvm(ctx: AdapterContext): AdapterResult {
  switch (ctx.request.modelId) {
    case 'flap': return calculateFlap(ctx);
    case 'letscash': return calculateLetsCash(ctx);
    case 'lunch-v3': case 'lunch-v4-tax': case 'lunch-v4-rewards': return calculateLunch(ctx);
    case 'pools-instant': return calculatePools(ctx);
    case 'sushi-launchpad': return calculateSushi(ctx);
    case 'fourmeme': return calculateFourMeme(ctx);
    default: throw new Error(`Unsupported EVM model: ${ctx.request.modelId}`);
  }
}
