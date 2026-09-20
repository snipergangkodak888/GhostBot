import { createHash } from 'node:crypto'
import { keccak256, toHex } from 'viem'
import type { LaunchReportRequest } from './types'
import { fourCurveCost, fourProtocolFee } from './four-curve'
import { formatAmount } from './utils'

const RPC = 'https://bsc-rpc.publicnode.com'
const MANAGER = '0x5c952063c7fc8610FFDB798152D69F0B9550762b'
const HELPER = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034'
const SUPPLY = 1000000000n * 10n ** 18n
const CAP = SUPPLY * 80n / 100n
const SOURCE = 'https://github.com/four-meme-community/fourmeme-docs/blob/main/docs/integration-guide.md'
type Reference = { token: string; index: string; info: bigint[]; extra: bigint[]; helper: bigint[]; initialT: bigint; key: string }

function words(hex: unknown): bigint[] {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-f]{64})+$/i.test(hex)) throw new Error('Four.meme returned an invalid contract response')
  return hex.slice(2).match(/.{64}/g)!.map(word => BigInt(`0x${word}`))
}

/**
 * Discover a native standard curve without asking the operator for a token.
 * Two recent eligible launches must agree on their immutable curve shape.
 * Existing-token taxes are deliberately not copied: the report describes a
 * new untaxed launch, with an explicit separately selected creator tax.
 */
export async function refreshFourMemeTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.quote.symbol !== 'BNB' || request.quote.decimals !== 18 || request.base.decimals !== 18 || request.base.supply !== '1000000000') throw new Error('Automatic Four.meme reports use the standard native BNB / 1-billion-token launch')
  if (request.terms.quoteClass !== undefined && request.terms.quoteClass !== 'native') throw new Error('Automatic Four.meme reports currently support the direct native BNB curve')
  let id = 0
  const observations: unknown[] = []
  async function rpc(method: string, params: unknown[]) {
    const payload = { jsonrpc: '2.0', id: ++id, method, params }
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error(`Four.meme public chain read returned HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > 1_000_000) throw new Error('Four.meme chain response is too large')
    const body = JSON.parse(text)
    if (body.error || body.result === undefined) throw new Error(`Four.meme public chain read failed: ${body.error?.message || 'missing result'}`)
    observations.push({ method, params, result: body.result })
    return body.result
  }
  if (BigInt(await rpc('eth_chainId', [])) !== 56n) throw new Error('Four.meme provider returned a different chain')
  const block = await rpc('eth_getBlockByNumber', ['finalized', false])
  if (!block || !/^0x[0-9a-f]+$/i.test(block.number) || !/^0x[0-9a-f]{64}$/i.test(block.hash)) throw new Error('Four.meme finalized block is invalid')
  const asOf = new Date(Number(BigInt(block.timestamp)) * 1000).toISOString()
  const blockAge = Date.now() - Date.parse(asOf)
  if (blockAge > 5 * 60 * 1000 || blockAge < -2 * 60 * 1000) throw new Error('Four.meme provider returned a stale or future finalized block')
  async function call(address: string, signature: string, args: (bigint | string)[] = []) {
    const data = `${keccak256(toHex(signature)).slice(0, 10)}${args.map(value => BigInt(value).toString(16).padStart(64, '0')).join('')}`
    return words(await rpc('eth_call', [{ to: address, data }, block.number]))
  }
  const [countResult, managerResult, launchFeeResult] = await Promise.all([
    call(MANAGER, '_tokenCount()'), call(HELPER, 'TOKEN_MANAGER_2()'), call(MANAGER, '_launchFee()'),
  ])
  if (managerResult[0] !== BigInt(MANAGER)) throw new Error('Four.meme Helper3 routes to a different manager')
  const count = countResult[0]
  if (count < 2n || count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Four.meme token registry is invalid')
  const references: Reference[] = []
  let selected: Reference[] | undefined
  for (let offset = 0; offset < 96 && !selected; offset += 8) {
    const page = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const registryIndex = count - BigInt(offset + index)
      if (registryIndex < 1n) return null
      const [rawAddress] = await call(MANAGER, '_tokens(uint256)', [registryIndex])
      if (rawAddress === 0n) return null
      const token = `0x${rawAddress.toString(16).padStart(40, '0')}`
      const info = await call(MANAGER, '_tokenInfos(address)', [token])
      // Active V2 native curve only. Exclude quoted assets and nonstandard supply/caps.
      if (info.length !== 13 || info[0] !== rawAddress || info[1] !== 0n || info[3] !== SUPPLY || info[4] !== CAP || info[7] <= 0n || info[7] > CAP || info[12] !== 0n) return null
      const [extra, helper] = await Promise.all([call(MANAGER, '_tokenInfoEx1s(address)', [token]), call(HELPER, 'getTokenInfo(address)', [token])])
      if (extra.length !== 5 || extra[2] !== 0n || extra[4] !== 0n || helper.length !== 12 || helper[0] !== 2n || helper[1] !== BigInt(MANAGER) || helper[2] !== 0n || helper[7] !== info[7] || helper[8] !== CAP || helper[9] !== info[8] || helper[10] !== info[5] || helper[11] !== 0n) return null
      const initialT = info[11] + CAP - info[7]
      if (initialT <= CAP || info[10] <= 0n || helper[4] >= 10000n) return null
      if (fourCurveCost(info[10], initialT, CAP - info[7]) !== info[8]) return null
      const key = [info[3], info[4], info[5], info[10], initialT, helper[4], helper[5]].join(':')
      return { token, index: registryIndex.toString(), info, extra, helper, initialT, key }
    }))
    references.push(...page.filter((value): value is Reference => value !== null))
    // Confirm the newest eligible profile. Never fall back to an older common
    // profile merely because a newly changed configuration has only one launch.
    const newest = references[0]
    if (newest) {
      const matches = references.filter(value => value.key === newest.key)
      if (matches.length >= 2) selected = matches.slice(0, 2)
    }
  }
  if (!selected) throw new Error('Could not verify two matching current Four.meme native configurations; retry the automatic refresh later')
  const checks: unknown[] = []
  for (const reference of selected) {
    const remaining = reference.info[7]
    const amounts = [...new Set([1n, 10n ** 18n, remaining / 2n, remaining - 1n, remaining].filter(value => value > 0n).map(String))].map(BigInt)
    const quotes = await Promise.all(amounts.map(async amount => {
      const result = await call(HELPER, 'tryBuy(address,uint256,uint256)', [reference.token, amount, 0n])
      const cost = fourCurveCost(reference.info[10], reference.info[11], amount)
      const fee = fourProtocolFee(cost, reference.helper[4], reference.helper[5])
      if (result.length !== 8 || result[0] !== BigInt(MANAGER) || result[1] !== 0n || result[2] !== amount || result[3] !== cost || result[4] !== fee || result[5] !== cost + fee || result[6] !== 0n) throw new Error('Four.meme live Helper3 quote no longer matches the verified native curve arithmetic')
      return { token: reference.token, amountRaw: amount.toString(), costRaw: cost.toString(), feeRaw: fee.toString() }
    }))
    checks.push(...quotes)
  }
  const first = selected[0]
  const next = structuredClone(request)
  const creatorTax = request.terms.creatorBuyTaxBps ?? 0
  if (typeof creatorTax !== 'number' || !Number.isInteger(creatorTax) || creatorTax < 0 || creatorTax > 2500 || creatorTax % 100 !== 0) throw new Error('Four.meme creator buy tax must use whole percentage points between 0 and 25%')
  next.terms = {
    quoteClass: 'native', curveModel: 'four-native-kt-v1', kRaw: first.info[10].toString(), initialTRaw: first.initialT.toString(), maxOffersRaw: CAP.toString(), maxRaisingRaw: first.info[5].toString(),
    protocolFeeBps: Number(first.helper[4]), minTradingFeeRaw: first.helper[5].toString(), creatorBuyTaxBps: creatorTax, migrationFeeBps: 200, poolBuyTaxBps: creatorTax, poolFeeBps: 25,
    _snapshot: { rpc: RPC, blockNumber: block.number, blockHash: block.hash, blockTimestamp: asOf, observedAt: new Date().toISOString(), manager: MANAGER, helper: HELPER, referenceTokens: selected.map(value => ({ token: value.token, registryIndex: value.index, creatorType: Number((value.info[2] >> 10n) & 63n) })), quoteChecks: checks, responseSha256: createHash('sha256').update(JSON.stringify(observations)).digest('hex'), scenario: 'New standard native BNB launch; reference-token creator taxes are not inherited.' },
  }
  next.operations.launchFeeAmount = formatAmount(launchFeeResult[0], 18)
  next.termsSource = { kind: 'snapshot', label: `Four.meme native curve and Helper3 fees, finalized BNB Chain block ${BigInt(block.number)}`, url: SOURCE, asOf }
  return next
}
