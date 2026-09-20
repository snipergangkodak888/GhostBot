import type { LaunchReportRequest } from './types'
import { formatAmount, integerTerm } from './utils'
import { boundedInteger, createPinnedReader, signedWord } from './refresh-evm-common'
import { buildPoolsTradeInitialState } from './amm-math/pools-trade-instant'

const LETSCASH_FACTORY = '0x5bd1Fbe78a78fe8236fa00CF48fbEBA74ae34661'
const POOLS_STRATEGY = '0xC9566675b1Ea42861546f3c5B74Ace2c79c49572'

function nativeEth(request: LaunchReportRequest) {
  if (request.quote.symbol !== 'ETH' || request.quote.decimals !== 18 || request.base.decimals !== 18) throw new Error('This automatic resolver supports native ETH launches on Robinhood Chain')
}

export async function refreshLetsCashTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  nativeEth(request)
  const configId = integerTerm(request.terms, 'configId', 1000, 1_000_000)
  const reader = await createPinnedReader('robinhood')
  const [config, enabled, fee] = await Promise.all([
    reader.words(LETSCASH_FACTORY, 'getLaunchConfig(uint256)', 10, BigInt(configId).toString(16).padStart(64, '0')),
    reader.words(LETSCASH_FACTORY, 'launchEnabled()', 1), reader.words(LETSCASH_FACTORY, 'launchFee()', 1),
  ])
  if (enabled[0] !== 1n || config[7] !== 1n || config[9] !== 1n) throw new Error('LetsCash launching or the selected published configuration is currently disabled')
  if (config[1] !== 0n) throw new Error('Selected LetsCash configuration is not native ETH')
  if (config[2] <= 0n) throw new Error('LetsCash returned invalid token supply')
  const tickSpacing = boundedInteger(signedWord(config[3]), 1, 32767, 'LetsCash tick spacing')
  const startTick = boundedInteger(signedWord(config[4]), -887271, 887271, 'LetsCash opening tick')
  const feeRatePips = boundedInteger(config[6], 1, 999999, 'LetsCash trading fee')
  const snapshot = await reader.finish(), next = structuredClone(request)
  next.base.supply = formatAmount(config[2], 18)
  next.operations.launchFeeAmount = formatAmount(fee[0], 18)
  next.terms = { ...next.terms, configId, customTerms: true, tickSpacing, startTick, feeRatePips, _snapshot: { ...snapshot, factory: LETSCASH_FACTORY, moduleSetId: config[0].toString(), selfBurn: config[8] === 1n, rawConfig: config.map(String), source: 'https://github.com/letscashfun/sdk' } }
  next.termsSource = { kind: 'snapshot', label: `LetsCash native configuration ${configId}, Robinhood block ${snapshot.blockNumber}`, asOf: snapshot.observedAt, url: 'https://github.com/letscashfun/sdk' }
  return next
}

export async function refreshPoolsTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  nativeEth(request)
  const reader = await createPinnedReader('robinhood')
  const signatures = ['initialTick()', 'initialSqrtPriceX96()', 'positionLiquidity()', 'TOTAL_SUPPLY()', 'LP_FEE()', 'TICK_SPACING()', 'MIN_LAUNCH_TICK()']
  const values = await Promise.all(signatures.map(signature => reader.words(POOLS_STRATEGY, signature, 1).then(words => words[0])))
  const [initialTickRaw, initialSqrtPriceX96, positionLiquidity, supply, fee, spacing, minimumTick] = values
  if (supply !== 1000000000n * 10n ** 18n || fee !== 2500n || spacing !== 25n || signedWord(minimumTick) !== -160100n) throw new Error('The Pools Instant strategy structure changed beyond the supplied math model')
  const initialTick = boundedInteger(signedWord(initialTickRaw), -887271, 887271, 'Pools initial tick')
  buildPoolsTradeInitialState({ initialTick, initialSqrtPriceX96, positionLiquidity })
  const snapshot = await reader.finish(), next = structuredClone(request)
  next.base.supply = formatAmount(supply, 18)
  next.terms = { ...next.terms, initialTick, initialSqrtPriceX96: initialSqrtPriceX96.toString(), positionLiquidity: positionLiquidity.toString(), _snapshot: { ...snapshot, strategy: POOLS_STRATEGY, strategyVersion: 'v3.3.0', feePips: fee.toString(), tickSpacing: spacing.toString(), source: 'https://github.com/Uniswap/sdks/blob/main/sdks/liquidity-launcher-sdk/src/addresses.ts' } }
  next.termsSource = { kind: 'snapshot', label: `Pools Instant strategy v3.3.0, Robinhood block ${snapshot.blockNumber}`, asOf: snapshot.observedAt, url: 'https://github.com/Uniswap/liquidity-launcher' }
  return next
}
