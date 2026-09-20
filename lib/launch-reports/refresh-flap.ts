import { toEventSelector } from 'viem'
import type { LaunchReportRequest } from './types'
import { boundedInteger, createPinnedReader } from './refresh-evm-common'

const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0'
const CREATED = toEventSelector('TokenCreated(uint256,address,uint256,address,string,string,string)')
const SOURCE = 'https://docs.flap.sh/flap/developers/token-launcher-developers/launch-token-through-portal'

/** Native BNB, untaxed token, Portal's current standard V2 launch profile. */
export async function refreshFlapTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.quote.symbol !== 'BNB' || request.quote.decimals !== 18 || request.base.decimals !== 18 || (request.terms.chain && request.terms.chain !== 'bsc')) throw new Error('Automatic Flap settings currently cover native BNB launches on BNB Chain')
  for (const key of ['poolBuyTaxBps', 'migrationRetentionBps']) if (request.terms[key] !== undefined && Number(request.terms[key]) !== 0) throw new Error('Automatic Flap settings cover the untaxed standard profile; a saved taxed scenario cannot be silently changed')
  if (request.terms.perWalletCapPct !== undefined && Number(request.terms.perWalletCapPct) !== 2) throw new Error('Automatic Flap settings require the standard 2% per-wallet cap')
  const reader = await createPinnedReader('bsc')
  const [config, fees] = await Promise.all([
    reader.words(PORTAL, 'getQuoteTokenConfiguration(address)', 5, '0'.repeat(64)),
    reader.words(PORTAL, 'getFeeRate()', 2),
  ])
  // Curve 20 is the official native-BNB profile. Requiring identical primary and
  // alternate curves makes recent launch immutables unambiguous for new launches.
  if (config[0] !== 1n || config[1] !== 20n || config[2] !== config[1] || config[3] !== 0n || config[4] !== 0n) throw new Error('Flap changed its standard native BNB launch profile; automatic quoting needs a verified adapter update')
  const protocolBuyFeeBps = boundedInteger(fees[0], 0, 9999, 'Flap protocol buy fee')
  const samples: Array<{ address: string; createdBlock: string; values: bigint[] }> = []
  for (const distance of [500n, 2500n]) {
    const logs = await reader.rpc('eth_getLogs', [{ address: PORTAL, fromBlock: `0x${(BigInt(reader.block) - distance).toString(16)}`, toBlock: reader.block, topics: [CREATED] }])
    if (!Array.isArray(logs) || logs.length > 1000) throw new Error('Flap launch discovery returned an invalid result')
    const candidates = logs.slice(-16).reverse().filter((log: any) => !log.removed && log.address?.toLowerCase() === PORTAL.toLowerCase() && log.topics?.[0] === CREATED && /^0x[0-9a-f]+$/i.test(log.data) && log.data.length >= 2 + 7 * 64)
    const fresh = await Promise.all(candidates.map(async (log: any) => {
      const address = `0x${log.data.slice(2 + 3 * 64 + 24, 2 + 4 * 64)}`
      const values = await reader.words(PORTAL, 'getTokenV9Safe(address)', 19, address.slice(2).padStart(64, '0'))
      return { address, createdBlock: log.blockNumber, values }
    }))
    samples.push(...fresh.filter(sample => sample.values[9] === 0n && sample.values[16] === 0n && sample.values[17] === 0n && !samples.some(previous => previous.address === sample.address)))
    if (samples.length >= 2) break
  }
  if (samples.length < 2) throw new Error('Flap has too few recent native launches to verify the current curve automatically; retry when fresh launch data is available')
  const [first, second] = samples, values = first.values
  if ([5, 6, 7, 8, 18].some(index => values[index] !== second.values[index])) throw new Error('Recent Flap native launches disagree on the active curve or fees; a single current profile cannot be verified')
  if (values[5] <= 0n || values[6] <= 0n || values[7] <= 0n || values[8] !== 800000000n * 10n ** 18n) throw new Error('Flap native curve structure changed beyond the supplied model')
  const curveFeeBps = boundedInteger(values[18], protocolBuyFeeBps, 9999, 'Flap effective curve fee')
  const snapshot = await reader.finish(), next = structuredClone(request)
  next.base.supply = '1000000000'
  next.terms = { ...next.terms, chain: 'bsc', quoteClass: 'native', customTerms: true, rRaw: values[5].toString(), hRaw: values[6].toString(), kRaw: values[7].toString(), thresholdRaw: values[8].toString(), curveFeeBps, poolBuyTaxBps: 0, migrationRetentionBps: 0, perWalletCapPct: 2, _snapshot: { ...snapshot, portal: PORTAL, curveId: Number(config[1]), protocolBuyFeeBps, effectiveCurveFeeBps: curveFeeBps, tokenType: 'standard untaxed token; V2 migration', recentNativeSamples: [first, second].map(sample => ({ address: sample.address, createdBlock: sample.createdBlock })), source: SOURCE } }
  next.termsSource = { kind: 'snapshot', label: `Flap native BNB Portal and two recent matching launch curves, block ${snapshot.blockNumber}`, url: SOURCE, asOf: snapshot.observedAt }
  return next
}
