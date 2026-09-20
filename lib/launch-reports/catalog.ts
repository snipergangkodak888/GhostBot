import type { LaunchReportRequest, ModelCatalogEntry, ModelPreset } from './types'
import { createGhostOperations } from './pricing'
import { EVM_PRESETS } from './catalog-evm'

const SNAPSHOT_DATE = '2026-09-19T23:13:00Z'
const FEE_TIERS = [
  ['0', 2, 93, 30], ['420000000000', 20, 5, 95], ['1470000000000', 20, 5, 90],
  ['2460000000000', 20, 5, 85], ['3440000000000', 20, 5, 80], ['4420000000000', 20, 5, 75],
  ['9820000000000', 20, 5, 70], ['14740000000000', 20, 5, 65], ['19650000000000', 20, 5, 60],
  ['24560000000000', 20, 5, 55], ['29470000000000', 20, 5, 50], ['34380000000000', 20, 5, 45],
  ['39300000000000', 20, 5, 40], ['44210000000000', 20, 5, 35], ['49120000000000', 20, 5, 30],
  ['54030000000000', 20, 5, 28], ['58940000000000', 20, 5, 25], ['63860000000000', 20, 5, 23],
  ['68770000000000', 20, 5, 20], ['73681000000000', 20, 5, 18], ['78590000000000', 20, 5, 15],
  ['83500000000000', 20, 5, 13], ['88400000000000', 20, 5, 10], ['93330000000000', 20, 5, 8], ['98240000000000', 20, 5, 5],
].map(([thresholdRaw, lpFeeBps, protocolFeeBps, creatorFeeBps]) => ({ thresholdRaw, lpFeeBps, protocolFeeBps, creatorFeeBps }))

function baseRequest(modelId: string, symbol = 'SOL', decimals = 9, tokenDecimals = 6): LaunchReportRequest {
  return {
    schemaVersion: 1, title: 'Launch funding analysis', modelId,
    targetsPct: [40, 50, 60, 70, 75, 80, 85, 90],
    base: { symbol: 'TOKEN', decimals: tokenDecimals, supply: '1000000000' },
    quote: { symbol, decimals }, terms: {}, operations: createGhostOperations(symbol),
    termsSource: { kind: 'code-default', label: 'Supplied AMM math estimate; verify settings for the specific launch' },
  }
}

const pump = baseRequest('pumpfun')
pump.terms = { initialVirtualQuoteReserves: '30000000000', protocolFeeBps: 95, creatorFeeBps: 30, migrationFeeRaw: '15000001', ammFeeTiers: FEE_TIERS }
pump.termsSource = { kind: 'snapshot', label: 'Pump public global and fee accounts; saved reference configuration, not a live quote', asOf: SNAPSHOT_DATE, url: 'https://pump.fun/docs/fees' }
pump.operations.poolBuyerCount = 1

const pumpCustom = baseRequest('pumpfun-custom', 'USDC', 6)
pumpCustom.terms = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
pumpCustom.operations = { ...createGhostOperations('SOL'), poolBuyerCount: 1 }
pumpCustom.termsSource = { kind: 'code-default', label: 'USDC launch choice; current Pump registry, stable fees and SOL funding conversion load automatically' }

const launchlab = baseRequest('launchlab')
launchlab.targetsPct = [40, 50, 60, 70, 75, 79.31]
launchlab.terms = { supply: '1000000000000000', totalSellA: '793100000000000', totalLockedAmount: '0', totalFundRaisingB: '85000000000', migrateFee: '0', tradeFeeRate: '2500', platformFeeRate: '10000', creatorFeeRate: '0' }
launchlab.termsSource = { kind: 'snapshot', label: 'Stonkfun standard SOL LaunchLab reference terms', asOf: SNAPSHOT_DATE, url: 'https://www.stonkfun.xyz/api/public/v1/launchlab/pricing?quoteMint=So11111111111111111111111111111111111111112&mode=standard' }
const stonk = structuredClone(launchlab); stonk.modelId = 'stonkfun'

const pons = baseRequest('pons', 'ETH', 18, 18)
pons.terms = { phantomQuoteWei: '1680000000000000000', graduationThresholdWei: '4200000000000000000', curveFeeBps: 100, creatorTaxBps: 100, hookFeeBps: 100, poolFeePips: 0, tickSpacing: 200, tokenIsCurrency0: false }
pons.operations = { ...pons.operations, setupAmount: '0.10', buyerGasAmount: '0.01', launchFeeAmount: '0.0005', poolBuyerCount: 2 }

const raydium = baseRequest('raydium-cpmm')
raydium.targetsPct = [50, 60, 70, 80, 90]; raydium.liquidityAmounts = ['25', '30', '40', '50']
raydium.terms = { tradeFeeRate: 2500, protocolFeeRate: 120000, fundFeeRate: 40000, creatorFeeRate: 0 }
raydium.operations = { ...raydium.operations, retainedPct: 30, setupAmount: '0.16', launchFeeAmount: '0.15' }
raydium.termsSource = { kind: 'snapshot', label: 'Raydium CPMM configuration 0; creator fee disabled', asOf: SNAPSHOT_DATE, url: 'https://api-v3.raydium.io/main/cpmm-config' }

const v2 = baseRequest('uniswap-v2', 'ETH', 18, 18)
v2.targetsPct = [40, 50, 60, 70, 80, 90]; v2.liquidityAmounts = ['2', '4']
v2.terms = { feeBps: 30 }; v2.operations.retainedPct = 30
const v3 = structuredClone(v2); v3.modelId = 'uniswap-v3'; v3.terms = { feePips: 3000, tokenIsToken0: true }

const CORE_PRESETS: Record<string, ModelPreset> = {
  pumpfun: { label: 'Pump.fun · native SOL', group: 'Solana', description: 'Native curve and graduated PumpSwap pool with a dated fee snapshot.', request: pump },
  'pumpfun-custom': { label: 'Pump.fun · USDC', group: 'Solana', description: 'Automatic USDC registry and stable fee tiers; SOL wallet and operating costs convert at current prices.', request: pumpCustom },
  launchlab: { label: 'LaunchLab · Stonkfun profile', group: 'Solana', description: 'Raydium LaunchLab using Stonkfun’s current standard SOL launch configuration.', request: launchlab },
  stonkfun: { label: 'Stonkfun · LaunchLab', group: 'Solana', description: 'Stonkfun standard LaunchLab reference; terms can be replaced for reward mode.', request: stonk },
  pons: { label: 'Pons V2', group: 'EVM launchpads', description: 'Curve and graduated full-range pool, including creator and hook fees.', request: pons },
  'raydium-cpmm': { label: 'Raydium CPMM', group: 'Solana', description: 'Quote-liquidity sensitivity with protocol and fund fee accounting.', requiresLiquidity: true, request: raydium },
  'uniswap-v2': { label: 'Uniswap V2 / V2-compatible', group: 'DEX math', description: 'Constant-product pool with a configurable fee and retained supply.', requiresLiquidity: true, request: v2 },
  'uniswap-v3': { label: 'Uniswap V3 · full range', group: 'DEX math', description: 'Single full-range position with canonical integer rounding.', requiresLiquidity: true, request: v3 },
}

export function getModelCatalog(): ModelCatalogEntry[] {
  return Object.entries({ ...CORE_PRESETS, ...EVM_PRESETS }).map(([id, preset]) => ({ id, label: preset.label, description: preset.description, group: preset.group ?? 'EVM launchpads', requiresLiquidity: preset.requiresLiquidity ?? false }))
}
export const listModels = getModelCatalog

export function createDefaultRequest(modelId: string): LaunchReportRequest {
  const preset = ({ ...CORE_PRESETS, ...EVM_PRESETS })[modelId]
  if (!preset) throw new Error(`Unknown launch model: ${modelId}`)
  const request = structuredClone(preset.request)
  request.chain = ['pumpfun','pumpfun-custom','launchlab','stonkfun','raydium-cpmm'].includes(modelId) ? 'Solana'
    : modelId === 'flap' || modelId === 'fourmeme' ? 'BNB Chain'
    : modelId.startsWith('uniswap-') ? 'User-selected EVM network'
    : 'Robinhood Chain'
  return request
}
