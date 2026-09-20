import { calculateSolana, graduationCounts } from './adapters-solana'
import { calculateEvm } from './adapters-evm'
import { buildPonsV2InitialCurveState, planPonsV2GraduationBundle, planPonsV2LaunchBuys } from './amm-math/pons-v2-curve'
import { calculatePonsV2PoolSpotPriceWad } from './amm-math/pons-v2-graduated-pool'
import { uniswapV2GetAmountIn, uniswapV2GetAmountOut } from './amm-math/uniswap-v2'
import { buildUniswapV3FullRangePosition, getUniswapV3SqrtRatioAtTick, quoteUniswapV3ExactOutput, type UniswapV3FeeTier } from './amm-math/uniswap-v3'
import type { AdapterContext, AdapterResult, LaunchReport, LaunchReportAmounts, LaunchReportRequest, LaunchReportRow } from './types'
import { getAgedWalletUnitAmount, GHOST_PRICING_VERSION } from './pricing'
import { ceilDiv, formatAmount, integerTerm, jsonSafe, parseAmount, percentRaw, splitRaw, sumRaw, termBigInt } from './utils'
import sourceManifest from './source-manifest.json'
import { convertNativeOperations, nativeDecimals } from './funding'
import { injectionLiquidityRaw, injectionPolicyNote, validateInjectionPolicy } from './injection'

const MODEL_VERSION = 'ghost-launch-reports-v2'
const CORE_SOLANA = new Set(['pumpfun', 'pumpfun-custom', 'launchlab', 'stonkfun', 'raydium-cpmm'])
const MONEY_KEYS = ['setupAmount', 'buyerGasAmount', 'cleanupAmount', 'holderAmount', 'tipAmount', 'launchFeeAmount', 'recipientBufferAmount', 'sourceGasAmount', 'agedWalletUnitAmount'] as const

function assertCount(value: number, label: string, max: number, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > max) throw new Error(`${label} must be an integer between ${minimum} and ${max}`)
}
function validDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date and time with a timezone`)
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new Error(`${label} contains an invalid calendar date`)
}

export function validateRequest(request: LaunchReportRequest): void {
  if (!request || request.schemaVersion !== 1) throw new Error('A version 1 launch report request is required')
  if (typeof request.title !== 'string' || !request.title.trim() || request.title.length > 160) throw new Error('Report title is required and must be at most 160 characters')
  if (request.client !== undefined && (typeof request.client !== 'string' || request.client.length > 160)) throw new Error('Client label must be at most 160 characters')
  if (typeof request.modelId !== 'string' || request.modelId.length > 50) throw new Error('A launch model is required')
  if (request.chain !== undefined && (typeof request.chain !== 'string' || request.chain.length > 100)) throw new Error('Chain label must be at most 100 characters')
  if (!Array.isArray(request.targetsPct) || request.targetsPct.length < 1 || request.targetsPct.length > 16) throw new Error('Choose between 1 and 16 supply targets')
  for (const pct of request.targetsPct) if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 100 || Math.abs(pct * 1e6 - Math.round(pct * 1e6)) > 1e-6) throw new Error('Supply targets must be above zero and at most 100%, with at most 6 decimal places')
  for (const [label, asset] of [['Base token', request.base], ['Quote currency', request.quote]] as const) {
    if (!asset || typeof asset.symbol !== 'string' || !/^[A-Za-z0-9._ -]{1,24}$/.test(asset.symbol)) throw new Error(`${label} needs a plain symbol of at most 24 characters`)
    assertCount(asset.decimals, `${label} decimals`, 30)
  }
  if (parseAmount(request.base.supply, request.base.decimals, 'Total supply') <= 0n) throw new Error('Total supply must be positive')
  if (request.liquidityAmounts !== undefined && (!Array.isArray(request.liquidityAmounts) || request.liquidityAmounts.length > 4)) throw new Error('Choose at most 4 initial liquidity values')
  for (const amount of request.liquidityAmounts ?? []) parseAmount(amount, request.quote.decimals, 'Initial liquidity')
  if (!request.terms || typeof request.terms !== 'object' || Array.isArray(request.terms) || JSON.stringify(request.terms).length > 50000) throw new Error('Model terms must be a JSON object smaller than 50 KB')
  const op = request.operations
  if (!op || op.currencySymbol !== request.quote.symbol) throw new Error('Operating allowances need automatic conversion into the quote currency. Generate with current settings before using snapshot mode.')
  assertCount(op.buyerCount, 'Buyer count', 64, 1)
  for (const key of ['curveBuyerCount', 'poolBuyerCount'] as const) if (op[key] !== undefined) assertCount(op[key]!, key, 64, 1)
  for (const key of ['holderCount', 'recipientCount', 'agedWalletCount'] as const) assertCount(op[key], key, 10000)
  assertCount(op.providerFeeBps, 'Funding provider fee basis points', 9999)
  if (typeof op.retainedPct !== 'number' || !Number.isFinite(op.retainedPct) || op.retainedPct < 0 || op.retainedPct >= 100) throw new Error('Retained supply must be between 0 and 100% exclusive')
  if (typeof op.includeInitialLiquidity !== 'boolean') throw new Error('Specify whether the funding total includes initial liquidity')
  for (const key of MONEY_KEYS) parseAmount(op[key], request.quote.decimals, key)
  const fixedWalletPrice = getAgedWalletUnitAmount(request.quote.symbol)
  if (fixedWalletPrice !== undefined && parseAmount(op.agedWalletUnitAmount, request.quote.decimals) !== parseAmount(fixedWalletPrice, request.quote.decimals)) throw new Error(`Ghost aged-wallet pricing is fixed at ${fixedWalletPrice} ${request.quote.symbol} per wallet`)
  if (!fixedWalletPrice && op.agedWalletCount > 0 && parseAmount(op.agedWalletUnitAmount, request.quote.decimals) === 0n) throw new Error('Ghost wallet pricing must be converted automatically by choosing a native funding currency, or use zero wallets.')
  if (request.quote.usdPrice !== undefined) {
    if (parseAmount(request.quote.usdPrice, 30, 'USD exchange rate') <= 0n || !Number.isFinite(Number(request.quote.usdPrice))) throw new Error('USD exchange rate must be positive')
    validDate(request.quote.priceAsOf, 'Exchange-rate timestamp')
    if (typeof request.quote.priceSource !== 'string' || !request.quote.priceSource.trim() || request.quote.priceSource.length > 500) throw new Error('A source is required for the USD exchange rate')
  }
  if (request.termsSource?.asOf !== undefined) validDate(request.termsSource.asOf, 'Terms snapshot timestamp')
  if (request.fundingConversion) {
    const conversion = request.fundingConversion, native = conversion.nativeOperations
    if (!['USDC', 'USDT'].includes(request.quote.symbol)) throw new Error('Funding conversion requires a supported stablecoin quote.')
    validDate(conversion.asOf, 'Native funding exchange-rate timestamp')
    if (typeof conversion.source !== 'string' || !conversion.source.trim() || conversion.source.length > 1000) throw new Error('Funding conversion requires a price source.')
    if (conversion.quoteUsdPrice !== request.quote.usdPrice) throw new Error('Funding conversion does not match the report USD price. Generate again.')
    validateRequest({ ...request, injectionLiquidity: undefined, fundingConversion: undefined, liquidityAmounts: undefined, operations: native, quote: { symbol: native?.currencySymbol, decimals: nativeDecimals(native?.currencySymbol), usdPrice: conversion.nativeUsdPrice, priceAsOf: conversion.asOf, priceSource: conversion.source } })
    const expected = convertNativeOperations(native, request.quote.symbol, request.quote.decimals, conversion.nativeUsdPrice, conversion.quoteUsdPrice)
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) if (expected[key] !== op[key]) throw new Error('Converted funding does not match its retained native allowance and exchange rate. Generate again.')
  }
  validateInjectionPolicy(request)
}

function ponsAdapter(context: AdapterContext): AdapterResult {
  const { request, supplyRaw, targetRaw } = context
  if (request.base.decimals !== 18 || request.quote.decimals !== 18) throw new Error('Pons V2 uses 18-decimal token and quote amounts')
  if (context.retainedRaw !== 0n || context.liquidityRaw !== 0n) throw new Error('Pons derives its initial curve and pool inventory; use zero retained supply and no initial-liquidity sweep')
  const t = request.terms
  const phantomQuoteWei = termBigInt(t, 'phantomQuoteWei')
  const creatorTaxBps = integerTerm(t, 'creatorTaxBps', 0, 9900)
  const initialState = buildPonsV2InitialCurveState({ supplyWei: supplyRaw, phantomQuoteWei, graduationThresholdWei: termBigInt(t, 'graduationThresholdWei'), curveFeeBps: integerTerm(t, 'curveFeeBps', undefined, 9900), creatorTaxBps })
  if (targetRaw <= initialState.sellableTokensWei) {
    if (context.buyerCount > 32) throw new Error('Pons allows at most 32 curve wallets')
    const plan = planPonsV2LaunchBuys({ initialState, allocations: splitRaw(targetRaw, context.buyerCount).filter(x => x > 0n).map((tokensOutWei, i) => ({ walletId: `curve-${i + 1}`, tokensOutWei })), slippageBps: 0 })
    return { buyRaw: plan.totalGrossInputWei, actualBaseRaw: plan.totalTokensOutWei, fdvQuote: Number(plan.finalState.quoteReserveWei) / 1e18 / Number(plan.finalState.tokenReserveWei) * Number(supplyRaw), phase: 'Curve', details: { plan } }
  }
  const counts = graduationCounts(context)
  if (counts.curve > 32 || counts.pool > 32) throw new Error('Pons supports at most 32 curve wallets and 32 pool wallets')
  const plan = planPonsV2GraduationBundle({
    initialState, allocations: splitRaw(initialState.sellableTokensWei, counts.curve).map((tokensOutWei, i) => ({ walletId: `curve-${i + 1}`, tokensOutWei })),
    poolAllocations: splitRaw(targetRaw - initialState.sellableTokensWei, counts.pool).map((tokensOutWei, i) => ({ walletId: `pool-${i + 1}`, tokensOutWei })),
    slippageBps: 0, phantomQuoteWei, tokenIsCurrency0: t.tokenIsCurrency0 === true,
    poolTerms: { hookFeeBps: integerTerm(t, 'hookFeeBps', undefined, 9999), creatorTaxBps, poolFeePips: integerTerm(t, 'poolFeePips', undefined, 999999), tickSpacing: integerTerm(t, 'tickSpacing', undefined, 32767) },
  })
  const final = plan.finalPoolStates[0]
  return { buyRaw: plan.totalCurveInputWei + plan.totalPoolInputWei, actualBaseRaw: plan.curve.totalTokensOutWei + sumRaw(plan.poolBuys.map(row => row.expectedTokensOutWei)), fdvQuote: Number(calculatePonsV2PoolSpotPriceWad(final)) / 1e18 * (Number(supplyRaw) / 1e18), phase: 'Curve + graduated pool', details: { plan, count: counts } }
}

function v2Adapter(context: AdapterContext): AdapterResult {
  const { request, liquidityRaw, supplyRaw, retainedRaw, targetRaw } = context
  if (liquidityRaw <= 0n) throw new Error('Initial quote liquidity must be positive')
  const feeBps = integerTerm(request.terms, 'feeBps', undefined, 9999)
  let quoteReserve = liquidityRaw, baseReserve = supplyRaw - retainedRaw, buyRaw = 0n, actualBaseRaw = retainedRaw
  const buys = []
  for (const target of splitRaw(targetRaw - retainedRaw, context.buyerCount)) {
    if (target === 0n) continue
    const input = uniswapV2GetAmountIn({ amountOut: target, reserveIn: quoteReserve, reserveOut: baseReserve, feeBps })
    const actual = uniswapV2GetAmountOut({ amountIn: input, reserveIn: quoteReserve, reserveOut: baseReserve, feeBps })
    if (actual < target) throw new Error('V2 input verification failed')
    quoteReserve += input; baseReserve -= actual; buyRaw += input; actualBaseRaw += actual
    buys.push({ targetRaw: target, inputRaw: input, actualBaseRaw: actual })
  }
  return { buyRaw, actualBaseRaw, initialLiquidityRaw: liquidityRaw, fdvQuote: Number(quoteReserve) / 10 ** request.quote.decimals / Number(baseReserve) * Number(supplyRaw), phase: 'Constant-product pool', details: { buys, finalQuoteRaw: quoteReserve, finalBaseRaw: baseReserve }, warnings: ['V2 model assumes the entire trade fee stays in pool reserves and the token has no transfer tax.'] }
}

function v3Adapter(context: AdapterContext): AdapterResult {
  const { request, liquidityRaw, supplyRaw, retainedRaw, targetRaw } = context
  if (liquidityRaw <= 0n) throw new Error('Initial quote liquidity must be positive')
  const feePips = integerTerm(request.terms, 'feePips', undefined, 999999) as UniswapV3FeeTier
  const tokenIsToken0 = request.terms.tokenIsToken0 !== false
  const baseInventory = supplyRaw - retainedRaw
  const position = buildUniswapV3FullRangePosition({ amount0Desired: tokenIsToken0 ? baseInventory : liquidityRaw, amount1Desired: tokenIsToken0 ? liquidityRaw : baseInventory, feeTier: feePips })
  let state = { liquidity: position.liquidity, sqrtPriceX96: position.sqrtPriceX96, sqrtPriceLowerX96: getUniswapV3SqrtRatioAtTick(position.tickLower), sqrtPriceUpperX96: getUniswapV3SqrtRatioAtTick(position.tickUpper) }
  let buyRaw = 0n, actualBaseRaw = retainedRaw
  const buys = []
  for (const target of splitRaw(targetRaw - retainedRaw, context.buyerCount)) {
    if (target === 0n) continue
    const buy = quoteUniswapV3ExactOutput(state, target, feePips, !tokenIsToken0)
    if (buy.insufficientLiquidity || buy.amountOut !== target) throw new Error('Target exceeds the supplied single-range liquidity')
    state = buy.nextState; buyRaw += buy.amountIn; actualBaseRaw += buy.amountOut; buys.push(buy)
  }
  const ratio = (Number(state.sqrtPriceX96) / 2 ** 96) ** 2
  const priceRaw = tokenIsToken0 ? ratio : 1 / ratio
  return { buyRaw, actualBaseRaw, initialLiquidityRaw: tokenIsToken0 ? position.actualAmount1 : position.actualAmount0, fdvQuote: priceRaw * Number(supplyRaw) / 10 ** request.quote.decimals, phase: 'Full-range concentrated pool', details: { position, buys, finalState: state }, warnings: ['V3 report models a newly created single full-range position; it does not simulate an existing pool with multiple initialized ranges or transfer-tax tokens.'] }
}

function adapter(context: AdapterContext): AdapterResult {
  if (context.liquidityRaw !== 0n && !['raydium-cpmm', 'uniswap-v2', 'uniswap-v3'].includes(context.request.modelId)) throw new Error('This launch model derives its opening liquidity; remove the initial-liquidity sweep')
  if (CORE_SOLANA.has(context.request.modelId)) return calculateSolana(context)
  if (context.request.modelId === 'pons') return ponsAdapter(context)
  if (context.request.modelId === 'uniswap-v2') return v2Adapter(context)
  if (context.request.modelId === 'uniswap-v3') return v3Adapter(context)
  return calculateEvm(context)
}

export function calculateLaunchReport(request: LaunchReportRequest): LaunchReport {
  validateRequest(request)
  const supplyRaw = parseAmount(request.base.supply, request.base.decimals)
  const op = request.operations, decimals = request.quote.decimals
  const amount = (key: typeof MONEY_KEYS[number]) => parseAmount(op[key], decimals)
  const operationalRaw = amount('setupAmount') + amount('buyerGasAmount') * BigInt(op.buyerCount) + amount('cleanupAmount') + amount('holderAmount') * BigInt(op.holderCount) + amount('tipAmount') + amount('launchFeeAmount')
  const retainedRaw = percentRaw(supplyRaw, op.retainedPct)
  const warnings = ['Scenario estimates use the supplied terms and ordered purchases; they are not executable transaction quotes.']
  if (request.quote.usdPrice === undefined) warnings.push('No USD exchange rate was supplied; all financial totals remain in quote currency.')
  if (request.termsSource?.kind === 'snapshot') {
    const age = request.termsSource.asOf ? Date.now() - Date.parse(request.termsSource.asOf) : Infinity
    warnings.push(age >= 0 && age < 30 * 60 * 1000
      ? `Network snapshot recorded at ${request.termsSource.asOf}; these exact inputs are retained with the report.`
      : `Terms are a saved snapshot${request.termsSource.asOf ? ` from ${request.termsSource.asOf}` : ''}; refresh them for a new client quote.`)
  }
  else if (request.termsSource?.kind === 'code-default') warnings.push('Code estimate defaults are not a live launchpad configuration.')
  if (!getAgedWalletUnitAmount(request.quote.symbol) && op.agedWalletCount > 0 && !request.fundingConversion) warnings.push('The aged-wallet unit price is an explicit conversion into the selected quote currency; verify that conversion.')
  if (operationalRaw - amount('launchFeeAmount') === 0n) warnings.push('Operating allowances are zero: network, setup, cleanup and holder costs are excluded unless added to this scenario.')
  if (!op.includeInitialLiquidity) warnings.push('Initial pool liquidity is excluded from the funding total.')
  const rows: LaunchReportRow[] = []
  for (const targetPct of request.targetsPct) for (const liquidity of request.liquidityAmounts?.length ? request.liquidityAmounts : ['0']) {
    const row: LaunchReportRow = { id: `${rows.length + 1}`, targetPct, liquidity, status: 'unavailable', warnings: [] }
    try {
      const targetRaw = percentRaw(supplyRaw, targetPct)
      if (targetRaw < retainedRaw) throw new Error('Target control is below the retained supply allocation')
      const result = adapter({ request, targetPct, targetRaw, supplyRaw, liquidityRaw: parseAmount(liquidity, decimals), buyerCount: op.buyerCount, retainedRaw })
      if (result.actualBaseRaw < targetRaw) throw new Error('Model did not reach the requested supply target')
      if (result.actualBaseRaw > supplyRaw || result.buyRaw < 0n || (result.fdvQuote !== null && (!Number.isFinite(result.fdvQuote) || result.fdvQuote < 0))) throw new Error('Model returned an invalid amount or price')
      const initialLiquidity = op.includeInitialLiquidity ? result.initialLiquidityRaw ?? 0n : 0n
      const modelReserves = result.refundableReserveRaw ?? 0n
      const baseFunding = result.buyRaw + initialLiquidity + operationalRaw + modelReserves
      const providerFee = ceilDiv(baseFunding * 10_000n, 10_000n - BigInt(op.providerFeeBps)) - baseFunding
      const recipientBuffers = BigInt(op.recipientCount) * amount('recipientBufferAmount'), sourceGas = amount('sourceGasAmount')
      const funding = baseFunding + providerFee + recipientBuffers + sourceGas
      const agedWallets = BigInt(op.agedWalletCount) * amount('agedWalletUnitAmount')
      const fx = request.quote.usdPrice === undefined ? null : Number(request.quote.usdPrice)
      const mcUsd = fx === null || result.fdvQuote === null ? null : result.fdvQuote * fx
      const injectionLiquidity = injectionLiquidityRaw(request, mcUsd)
      const raw = { buys: result.buyRaw, initialLiquidity, operations: operationalRaw, modelReserves, providerFee, recipientBuffers, sourceGas, funding, agedWallets, injectionLiquidity, total: funding + agedWallets + injectionLiquidity }
      const amounts = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, formatAmount(value, decimals)])) as unknown as LaunchReportAmounts
      Object.assign(row, { status: 'ok', actualPct: Number(result.actualBaseRaw * 100_000_000n / supplyRaw) / 1e6, phase: result.phase, amounts, raw: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.toString()])), fdvQuote: result.fdvQuote, fdvUsd: fx === null || result.fdvQuote === null ? null : result.fdvQuote * fx, totalUsd: fx === null ? null : Number(amounts.total) * fx, details: jsonSafe(result.details), warnings: result.warnings ?? [] })
    } catch (error) { row.error = error instanceof Error ? error.message : 'Unable to calculate this scenario' }
    rows.push(row)
  }
  return {
    schemaVersion: 1, modelVersion: MODEL_VERSION, sourceVersion: `${sourceManifest.package}@${sourceManifest.version}`, sourceHashes: sourceManifest.files, pricingVersion: GHOST_PRICING_VERSION,
    generatedAt: new Date().toISOString(), title: request.title, ...(request.client ? { client: request.client } : {}), modelId: request.modelId, request: structuredClone(request), rows, warnings,
    assumptions: [
      `Network: ${request.chain || 'As specified by the supplied launch configuration'}.`,
      `Control includes ${op.retainedPct}% retained allocation; ordered purchases are split across ${op.buyerCount} buyers.`,
      request.fundingConversion ? `Native ${request.fundingConversion.nativeOperations.currencySymbol} allowances were converted automatically into ${op.currencySymbol} at ${request.fundingConversion.nativeUsdPrice} USD per native coin and ${request.fundingConversion.quoteUsdPrice} USD per quote unit; ${request.fundingConversion.asOf}. Each allowance is rounded up to the quote currency's smallest unit.` : `All operating allowances are in ${op.currencySymbol}.`,
      `Operating allowance = setup ${op.setupAmount} + ${op.buyerCount} × buyer gas ${op.buyerGasAmount} + cleanup ${op.cleanupAmount} + ${op.holderCount} × holder funding ${op.holderAmount} + tip ${op.tipAmount} + launch fee ${op.launchFeeAmount}.`,
      request.fundingConversion ? `Aged wallets = ${op.agedWalletCount} × ${request.fundingConversion.nativeOperations.agedWalletUnitAmount} ${request.fundingConversion.nativeOperations.currencySymbol}; fixed Ghost commercial pricing, converted to ${op.agedWalletUnitAmount} ${request.quote.symbol} each.` : `Aged wallets = ${op.agedWalletCount} × ${op.agedWalletUnitAmount} ${request.quote.symbol}; ${getAgedWalletUnitAmount(request.quote.symbol) ? 'fixed Ghost commercial pricing' : 'explicit quote-currency allowance'}.`,
      `Provider fee ${op.providerFeeBps} bps is grossed up on purchases, included liquidity, operating allowances and model reserves; recipient buffers and source gas are then added.`,
      injectionPolicyNote(request),
      ...(request.injectionLiquidity && request.injectionLiquidity.referenceSymbol !== request.quote.symbol ? [`Injection conversion: 1 ${request.injectionLiquidity.referenceSymbol} = $${request.injectionLiquidity.referenceUsdPrice}; 1 ${request.quote.symbol} = $${request.injectionLiquidity.quoteUsdPrice}. Reference rate recorded ${request.injectionLiquidity.asOf}.`] : []),
      'Total = launch funding + aged wallets + injection / MM liquidity. The MM reserve is held separately; it does not change modeled purchases or MC and is not subject to the launch funding provider fee.',
      'Funding is capital required, not irreversible expense. Liquidity, holder balances and unused reserves remain assets.',
      'MC (market cap) = spot price after the modeled buys × total token supply.',
    ],
  }
}
