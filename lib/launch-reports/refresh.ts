/** Server-only, read-only configuration refresh; connection overrides stay on the server. */
import { fetchLaunchData } from './data-fetch'
import { readSolanaLaunchAccounts } from './solana-data'
import { createHash } from 'node:crypto'
import type { LaunchReportRequest } from './types'
import { validateRequest } from './engine'
import { createLaunchLabCurve } from './amm-math/launchlab-quote-math'
import { formatAmount, integerTerm } from './utils'
import { refreshFlapTerms } from './refresh-flap'
import { refreshFourMemeTerms } from './refresh-four'
import { refreshPonsTerms } from './refresh-pons'
import { refreshLetsCashTerms, refreshPoolsTerms } from './refresh-native-evm'
import { refreshSushiTerms, refreshLunchTerms } from './refresh-evm'

export const supportedRefreshModels = ['pumpfun', 'pumpfun-custom', 'stonkfun', 'raydium-cpmm', 'pons', 'letscash', 'pools-instant', 'launchlab', 'sushi-launchpad', 'lunch-v3', 'lunch-v4-tax', 'lunch-v4-rewards', 'fourmeme', 'flap'] as const
const RAY_CONFIGS = 'https://api-v3.raydium.io/main/cpmm-config'
const STONK_PRICING = 'https://www.stonkfun.xyz/api/public/v1/launchlab/pricing?quoteMint=So11111111111111111111111111111111111111112&mode=standard'
const LAUNCHLAB_PROGRAM = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'
const PUMP_FEES_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'
const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const PUMP_ACCOUNTS = ['5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx', '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt', '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf']
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const STONK_ACCOUNTS = ['6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX', '4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7']
type JsonObject = Record<string, any>

async function fetchJson(url: string, body?: JsonObject): Promise<JsonObject> {
  const response = await fetchLaunchData(url, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) }, 'Launch configuration service')
  if (!response.ok) throw new Error(`Public configuration service returned HTTP ${response.status}; saved terms were not changed`)
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('Public configuration response exceeds the supported size')
  return JSON.parse(text)
}


function accountBytes(account: JsonObject, owner: string, discriminator: string, minimum: number): Buffer {
  if (!account || account.owner !== owner || !Array.isArray(account.data) || account.data[1] !== 'base64') throw new Error('Configuration account owner or encoding does not match the verified program')
  const bytes = Buffer.from(account.data[0], 'base64')
  if (bytes.length < minimum || bytes.subarray(0, 8).toString('hex') !== discriminator) throw new Error('Configuration account layout changed; refresh needs an adapter update')
  return bytes
}

/** Official Pump Fees IDL: discriminator, bump, admin, flat Fees, Vec<FeeTier>. */
export function decodePumpFeeTiers(account: JsonObject, schedule: 'native' | 'stable' = 'native'): Array<{ thresholdRaw: string; lpFeeBps: number; protocolFeeBps: number; creatorFeeBps: number }> {
  const bytes = accountBytes(account, PUMP_FEES_PROGRAM, '8f3492bbdb7b4c9b', 69)
  let start = 65
  if (schedule === 'stable') {
    const nativeCount = bytes.readUInt32LE(65)
    if (nativeCount < 1 || nativeCount > 100 || bytes.length < 73 + nativeCount * 40) throw new Error('Pump native fee-tier vector is invalid')
    start += 4 + nativeCount * 40
  }
  const count = bytes.readUInt32LE(start)
  if (count < 1 || count > 100 || bytes.length < start + 4 + count * 40) throw new Error('Pump fee-tier vector is invalid')
  const rows = Array.from({ length: count }, (_, index) => {
    const offset = start + 4 + index * 40
    const threshold = bytes.readBigUInt64LE(offset) + (bytes.readBigUInt64LE(offset + 8) << 64n)
    const row = { thresholdRaw: threshold.toString(), lpFeeBps: Number(bytes.readBigUInt64LE(offset + 16)), protocolFeeBps: Number(bytes.readBigUInt64LE(offset + 24)), creatorFeeBps: Number(bytes.readBigUInt64LE(offset + 32)) }
    for (const key of ['lpFeeBps', 'protocolFeeBps', 'creatorFeeBps']) integerTerm(row, key, undefined, 9999)
    if (row.lpFeeBps + row.protocolFeeBps + row.creatorFeeBps >= 10000) throw new Error('Pump fees exceed the supported range')
    return row
  })
  if (rows[0].thresholdRaw !== '0' || rows.some((row, i) => i > 0 && BigInt(row.thresholdRaw) <= BigInt(rows[i - 1].thresholdRaw))) throw new Error('Pump fee tiers are not strictly ordered from zero')
  return rows
}

/** Official native Pump Global IDL; legacy fee fields are deliberately ignored. */
export function decodePumpGlobal(account: JsonObject) {
  const bytes = accountBytes(account, PUMP_PROGRAM, 'a7e8e8b1c86c727f', 154)
  const value = { virtualBaseRaw: bytes.readBigUInt64LE(73), virtualQuoteRaw: bytes.readBigUInt64LE(81), realBaseRaw: bytes.readBigUInt64LE(89), supplyRaw: bytes.readBigUInt64LE(97), migrationFeeRaw: bytes.readBigUInt64LE(146) }
  if (value.virtualBaseRaw !== 1073000000000000n || value.realBaseRaw !== 793100000000000n || value.supplyRaw !== 1000000000000000n || value.virtualQuoteRaw <= 0n) throw new Error('Pump reserve shape changed; the supplied math must be reverified before using the new terms')
  return value
}

function snapshotHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

function base58Bytes(value: string): Buffer {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const character of value) { const digit = alphabet.indexOf(character); if (digit < 0) throw new Error('Invalid configured Solana address'); integer = integer * 58n + BigInt(digit) }
  return Buffer.from(integer.toString(16).padStart(64, '0'), 'hex')
}

async function refreshPump(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.quote.symbol !== 'SOL' || request.quote.decimals !== 9 || request.base.decimals !== 6 || request.base.supply !== '1000000000') throw new Error('Pump native refresh requires the standard SOL / 1-billion-token configuration')
  const result = await readSolanaLaunchAccounts(PUMP_ACCOUNTS)
  const tiers = decodePumpFeeTiers(result.value[0]), curve = decodePumpFeeTiers(result.value[1]), global = decodePumpGlobal(result.value[2])
  if (curve.length !== 1 || curve[0].lpFeeBps !== 0) throw new Error('Native curve fees changed to an unsupported tiered structure')
  const next = structuredClone(request), asOf = new Date().toISOString()
  next.terms = { ...next.terms, initialVirtualQuoteReserves: global.virtualQuoteRaw.toString(), protocolFeeBps: curve[0].protocolFeeBps, creatorFeeBps: curve[0].creatorFeeBps, migrationFeeRaw: global.migrationFeeRaw.toString(), ammFeeTiers: tiers, _snapshot: { rpc: result.rpc, slot: result.context.slot, commitment: 'finalized', accounts: PUMP_ACCOUNTS, observedAt: asOf, responseSha256: snapshotHash({ context: result.context, value: result.value }), layoutSource: 'https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump_fees.json' } }
  next.termsSource = { kind: 'snapshot', label: `Pump native global and fee accounts, finalized Solana slot ${result.context.slot}`, url: 'https://pump.fun/docs/fees', asOf }
  return next
}

async function refreshPumpUsdc(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.quote.symbol !== 'USDC' || request.quote.decimals !== 6 || request.base.decimals !== 6 || request.base.supply !== '1000000000' || (request.terms.mint && request.terms.mint !== USDC_MINT)) throw new Error('Automatic non-SOL Pump settings currently cover standard USDC launches')
  if (request.terms.creatorFeeOverrideBps !== undefined) throw new Error('Pump creator overrides apply to exotic pairs; USDC uses the stable fee schedule')
  const result = await readSolanaLaunchAccounts([...PUMP_ACCOUNTS, USDC_MINT])
  const tiers = decodePumpFeeTiers(result.value[0], 'stable'), curve = decodePumpFeeTiers(result.value[1], 'stable'), native = decodePumpGlobal(result.value[2])
  const global = accountBytes(result.value[2], PUMP_PROGRAM, 'a7e8e8b1c86c727f', 1045)
  const mint = result.value[3], mintData = Buffer.from(mint?.data?.[0] ?? '', 'base64')
  if (!global.subarray(1013, 1045).equals(base58Bytes(USDC_MINT)) || global.readBigUInt64LE(1005) <= 0n) throw new Error('USDC is no longer in Pump Global’s supported quote-mint registry')
  if (mint?.owner !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' || mint?.data?.[1] !== 'base64' || mintData.length !== 82 || mintData[44] !== 6 || mintData[45] !== 1) throw new Error('The USDC mint does not match the verified token program and decimals')
  if (curve.length !== 1 || curve[0].lpFeeBps !== 0) throw new Error('USDC curve fees changed to an unsupported tiered structure')
  const next = structuredClone(request), asOf = new Date().toISOString()
  next.terms = { ...next.terms, mint: USDC_MINT, tokenProgramId: mint.owner, registry: PUMP_ACCOUNTS[2], quoteSchedule: 'stable', initialVirtualQuoteReserves: global.readBigUInt64LE(1005).toString(), protocolFeeBps: curve[0].protocolFeeBps, creatorFeeBps: curve[0].creatorFeeBps, migrationFeeRaw: '0', nativeMigrationCostLamports: native.migrationFeeRaw.toString(), ammFeeTiers: tiers, _snapshot: { rpc: result.rpc, slot: result.context.slot, commitment: 'finalized', accounts: [...PUMP_ACCOUNTS, USDC_MINT], observedAt: asOf, responseSha256: snapshotHash({ context: result.context, value: result.value }), feeSchedule: 'USDC stableFeeTiers', layoutSource: 'https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json' } }
  next.termsSource = { kind: 'snapshot', label: `Pump USDC registry, mint and stable fee accounts, finalized Solana slot ${result.context.slot}`, url: 'https://pump.fun/docs/fees', asOf }
  return next
}

/** Raydium SDK LaunchpadConfig and PlatformConfig layouts, fixed standard SOL accounts. */
export function decodeStonkFees(globalAccount: JsonObject, platformAccount: JsonObject) {
  const global = accountBytes(globalAccount, LAUNCHLAB_PROGRAM, '95089ccaa0fcb0d9', 115)
  const platform = accountBytes(platformAccount, LAUNCHLAB_PROGRAM, 'a04e8000f853e6a0', 728)
  if (global[16] !== 0) throw new Error('Stonkfun global config no longer uses the supported constant-product curve')
  if (!global.subarray(83, 115).equals(base58Bytes('So11111111111111111111111111111111111111112'))) throw new Error('Stonkfun global quote mint is not native wrapped SOL')
  const fees = { migrateFee: global.readBigUInt64LE(19).toString(), tradeFeeRate: global.readBigUInt64LE(27).toString(), platformFeeRate: platform.readBigUInt64LE(104).toString(), creatorFeeRate: platform.readBigUInt64LE(720).toString() }
  if (BigInt(fees.tradeFeeRate) + BigInt(fees.platformFeeRate) + BigInt(fees.creatorFeeRate) >= 1000000n) throw new Error('LaunchLab fee rates are invalid')
  return fees
}

async function refreshStonk(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.quote.symbol !== 'SOL' || request.quote.decimals !== 9 || request.base.decimals !== 6 || request.terms.transferFee !== undefined) throw new Error('Automatic Stonkfun refresh supports standard untaxed SOL launches; other modes require their exact verified terms')
  const [pricing, configs] = await Promise.all([fetchJson(STONK_PRICING), readSolanaLaunchAccounts(STONK_ACCOUNTS)])
  const data = pricing.data
  if (data?.quote?.mint !== 'So11111111111111111111111111111111111111112' || data.quote.decimals !== 9 || data.curve?.programId !== LAUNCHLAB_PROGRAM || data.curve.configId !== STONK_ACCOUNTS[0] || data.platform?.standard !== STONK_ACCOUNTS[1] || data.curve.curveType !== 'ConstantCurve' || data.curve.baseDecimals !== 6 || data.modes?.standard?.transferFee !== null) throw new Error('Stonkfun pricing identity or launch structure changed; verify the new configuration before continuing')
  const fees = decodeStonkFees(configs.value[0], configs.value[1])
  if (String(data.curve.migrateFeeRaw) !== fees.migrateFee) throw new Error('Stonkfun pricing and current global migration fee disagree; retry once the public configuration is consistent')
  const terms = { supply: String(data.curve.supply), totalSellA: String(data.curve.totalSellA), totalLockedAmount: String(data.curve.vesting?.totalLockedAmount), totalFundRaisingB: String(data.raise?.raw), ...fees }
  const curve = createLaunchLabCurve(terms)
  if (curve.virtualBase.toString() !== data.curve.derived?.virtualA || curve.virtualQuote.toString() !== data.curve.derived?.virtualB) throw new Error('Stonkfun virtual reserves disagree with the supplied LaunchLab derivation')
  const next = structuredClone(request), asOf = new Date().toISOString()
  next.base.supply = formatAmount(BigInt(terms.supply), 6)
  next.terms = { ...terms, _snapshot: { pricingUrl: STONK_PRICING, pricingGeneratedAt: pricing.meta?.generatedAt, rpc: configs.rpc, slot: configs.context.slot, commitment: 'finalized', accounts: STONK_ACCOUNTS, observedAt: asOf, responseSha256: snapshotHash({ pricing, configs: { context: configs.context, value: configs.value } }), layoutSource: 'https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/launchpad/layout.ts' } }
  next.termsSource = { kind: 'snapshot', label: `Stonkfun standard SOL pricing and LaunchLab fees, finalized Solana slot ${configs.context.slot}`, url: STONK_PRICING, asOf }
  return next
}

async function refreshRaydium(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.quote.symbol !== 'SOL' || request.quote.decimals !== 9) throw new Error('Automatic Raydium CPMM settings currently cover SOL-quoted pool scenarios')
  if (request.terms.creatorFeeRate !== undefined && Number(request.terms.creatorFeeRate) !== 0) throw new Error('Automatic Raydium CPMM settings cover creator fees disabled; a different fee choice cannot be silently changed')
  const payload = await fetchJson(RAY_CONFIGS)
  if (payload.success === false || !Array.isArray(payload.data)) throw new Error('Raydium configuration response is invalid')
  const index = request.terms.configIndex === undefined ? 0 : integerTerm(request.terms, 'configIndex', undefined, 65535)
  const config = payload.data.find((entry: JsonObject) => entry.index === index)
  if (!config || typeof config.id !== 'string') throw new Error(`Raydium CPMM configuration ${index} was not returned`)
  integerTerm(config, 'tradeFeeRate', undefined, 999999)
  for (const key of ['protocolFeeRate', 'fundFeeRate']) integerTerm(config, key, undefined, 1000000)
  if (config.protocolFeeRate + config.fundFeeRate > 1000000) throw new Error('Raydium fee shares are invalid')
  const next = structuredClone(request), asOf = new Date().toISOString()
  next.terms = { ...next.terms, configIndex: index, tradeFeeRate: config.tradeFeeRate, protocolFeeRate: config.protocolFeeRate, fundFeeRate: config.fundFeeRate, creatorFeeRate: 0, _snapshot: { url: RAY_CONFIGS, configId: config.id, observedAt: asOf, creatorFeePolicy: 'disabled for this scenario', responseSha256: snapshotHash(config) } }
  if (request.quote.symbol === 'SOL' && request.quote.decimals === 9) {
    if (!/^(0|[1-9]\d*)$/.test(String(config.createPoolFee))) throw new Error('Raydium did not return a valid current pool creation fee')
    next.operations.launchFeeAmount = formatAmount(BigInt(config.createPoolFee), 9)
  }
  next.termsSource = { kind: 'snapshot', label: `Raydium CPMM configuration ${index}; creator fee disabled`, url: RAY_CONFIGS, asOf }
  return next
}

export async function refreshLaunchTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  validateRequest(request)
  let next: LaunchReportRequest
  switch (request.modelId) {
    case 'pumpfun': next = await refreshPump(request); break
    case 'pumpfun-custom': next = await refreshPumpUsdc(request); break
    case 'launchlab':
    case 'stonkfun': next = await refreshStonk(request); break
    case 'raydium-cpmm': next = await refreshRaydium(request); break
    case 'flap': next = await refreshFlapTerms(request); break
    case 'fourmeme': next = await refreshFourMemeTerms(request); break
    case 'pons': next = await refreshPonsTerms(request); break
    case 'letscash': next = await refreshLetsCashTerms(request); break
    case 'pools-instant': next = await refreshPoolsTerms(request); break
    case 'sushi-launchpad': next = await refreshSushiTerms(request); break
    case 'lunch-v3':
    case 'lunch-v4-tax':
    case 'lunch-v4-rewards': next = await refreshLunchTerms(request); break
    default: throw new Error('Automatic refresh is not available for this model; load its verified launch configuration into model terms')
  }
  validateRequest(next)
  return next
}
