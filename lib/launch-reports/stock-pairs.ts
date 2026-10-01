import { createPublicClient, http, parseAbi, type Address } from 'viem'
import { createHash } from 'node:crypto'
import { fetchLaunchData } from './data-fetch'
import { readSolanaLaunchAccounts } from './solana-data'

export const STOCK_MODELS = ['pumpfun', 'pumpfun-custom', 'stonkfun', 'launchlab', 'pons']
export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
// PDA ["quote-control"], verified against the official Pump IDL.
export const PUMP_QUOTE_REGISTRY = '6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP'
export const CLOCK = 'SysvarC1ock11111111111111111111111111111111'
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const TOKEN_LEGACY = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export interface StockPair { id: string; address: string; symbol: string; name: string; decimals: number; multiplier?: string }
export const supportsStockPairs = (model: string) => STOCK_MODELS.includes(model)
export function validateStockId(id: string) { if (!/^[a-f0-9]{12}$/.test(id)) throw new Error('Choose a stock from the current pair menu.') }
export const stockId = (chain: string, address: string) => createHash('sha256').update(`${chain}:${chain === 'pons' ? address.toLowerCase() : address}`).digest('hex').slice(0, 12)
export async function stockJson(url: string, service = 'Stock pair settings'): Promise<any> {
  const response = await fetchLaunchData(url, { signal: AbortSignal.timeout(15_000) }, service, 2)
  if (!response.ok) throw new Error(`${service} returned HTTP ${response.status}. Please try again.`)
  const body = await response.text()
  if (body.length > 2_000_000) throw new Error(`${service} response is too large.`)
  return JSON.parse(body)
}
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString('hex')}`), out = '', zeros = 0
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n }
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  return '1'.repeat(zeros) + out
}
export function accountData(account: any, owner?: string, discriminator?: string, min = 0): Buffer {
  if (!account || (owner && account.owner !== owner) || account.data?.[1] !== 'base64') throw new Error('The selected pair has an unexpected on-chain account owner.')
  const bytes = Buffer.from(account.data[0], 'base64')
  if (bytes.length < min || (discriminator && bytes.subarray(0, 8).toString('hex') !== discriminator)) throw new Error('The selected pair has an unsupported account layout.')
  return bytes
}
export function decodePumpRegistry(account: any): Map<string, string> {
  const b = accountData(account, PUMP_PROGRAM, '38f423eec1d5a2c9', 108), count = b.readUInt32LE(104)
  if (count > 10_000 || b.length < 108 + count * 40) throw new Error('Pump quote registry layout changed.')
  return new Map(Array.from({ length: count }, (_, i) => [base58(b.subarray(108 + i * 40, 140 + i * 40)), b.readBigUInt64LE(140 + i * 40).toString()]))
}
/** Read both epoch fee schedules; choose the one active in the same RPC snapshot. */
export function decodeQuoteMint(account: any, epoch: bigint) {
  if (![TOKEN_LEGACY, TOKEN_2022].includes(account?.owner)) throw new Error('Unsupported quote token program.')
  const b = accountData(account, undefined, undefined, 82)
  if (b[45] !== 1 || b[44] > 18) throw new Error('The quote mint is uninitialized or has unsupported decimals.')
  let transferFee: { basisPoints: number; maximumFee: string } | undefined
  const extensions: number[] = []
  if (b.length > 82) {
    if (account.owner !== TOKEN_2022 || b.length < 166 || b[165] !== 1) throw new Error('Invalid extended quote mint.')
    for (let p = 166; p + 4 <= b.length;) {
      const type = b.readUInt16LE(p), length = b.readUInt16LE(p + 2); p += 4
      if (!type && !length) break
      if (p + length > b.length || extensions.includes(type)) throw new Error('Invalid quote extension data.')
      const v = b.subarray(p, p + length); p += length; extensions.push(type)
      if (type === 1) {
        if (length !== 108) throw new Error('Unsupported quote tax layout.')
        const start = epoch >= v.readBigUInt64LE(90) ? 90 : 72
        transferFee = { basisPoints: v.readUInt16LE(start + 16), maximumFee: v.readBigUInt64LE(start + 8).toString() }
        if (transferFee.basisPoints > 10_000) throw new Error('Invalid quote transfer tax.')
      }
      if (type === 9 || (type === 6 && (length !== 1 || v[0] !== 1)) || (type === 14 && (length !== 64 || v.subarray(32).some(x => x !== 0))) || (type === 26 && (length !== 33 || v[32] !== 0))) throw new Error('This quote token is paused, frozen, non-transferable or uses an active transfer hook.')
      if (![1, 3, 4, 6, 12, 14, 18, 19, 20, 21, 22, 23, 25, 26].includes(type)) throw new Error('This quote token has an extension that the calculator does not support yet.')
    }
  }
  return { decimals: b[44], tokenProgram: account.owner as string, transferFee, extensions }
}
let cached: { time: number; sol: StockPair[]; evm: StockPair[] } | undefined
async function catalogue(chain: 'sol' | 'evm'): Promise<StockPair[]> {
  if (cached && Date.now() - cached.time < 60_000 && cached[chain].length) return structuredClone(cached[chain])
  const pairs: StockPair[] = []
  if (chain === 'sol') {
    const data = await stockJson('https://www.stonkfun.xyz/api/public/v1/pairs')
    if (!Array.isArray(data.data?.pairs)) throw new Error('Stock pair catalogue is unavailable.')
    for (const p of data.data.pairs) {
      if (!p.launchable || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.mint) || !/^[a-zA-Z0-9._-]{1,20}$/.test(p.symbol) || !Number.isInteger(p.decimals)) continue
      // Curated equity/ETF collections, plus explicit custom mints for taxed quote support.
      if (['currency', 'solana'].includes(p.category)) continue
      pairs.push({ id: stockId('sol', p.mint), address: p.mint, symbol: p.symbol, name: String(p.name || p.symbol).slice(0, 70), decimals: p.decimals })
    }
  } else {
    const data = await stockJson('https://api.robinhood.com/rhj/assets')
    if (!Array.isArray(data.assets)) throw new Error('Robinhood stock catalogue is unavailable.')
    for (const p of data.assets) {
      const address = p.deployments?.find((d: any) => d.chainId === 4663)?.contractAddress
      if (!/^0x[0-9a-fA-F]{40}$/.test(address || '') || p.status !== 'ASSET_STATUS_ACTIVE' || !/^[a-zA-Z0-9._-]{1,20}$/.test(p.tokenSymbol)) continue
      pairs.push({ id: stockId('pons', address), address, symbol: p.tokenSymbol, name: String(p.tokenName).replace(' • Robinhood Token', '').slice(0, 70), decimals: p.tokenDecimals, multiplier: p.currentMultiplier })
    }
  }
  const next = cached && Date.now() - cached.time < 60_000 ? cached : { time: Date.now(), sol: [], evm: [] }
  next[chain] = pairs; cached = next
  return structuredClone(pairs)
}
let approvedCache: { time: number; ids: Set<string> } | undefined
async function approvedPons(pairs: StockPair[]): Promise<StockPair[]> {
  if (!approvedCache || Date.now() - approvedCache.time > 60_000) {
    const ids = new Set<string>()
    const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 15_000, retryCount: 1 }) })
    const blockNumber = await client.getBlockNumber()
    const abi = parseAbi(['function approvedPairTokens(address) view returns (bool)', 'function pairTokenEconomics(address) view returns (uint256,uint256,uint8)'])
    const contracts = pairs.flatMap(p => (['approvedPairTokens','pairTokenEconomics'] as const).map(functionName => ({address:'0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Address, abi, functionName, args:[p.address as Address]})))
    const results = await client.multicall({ contracts, blockNumber, multicallAddress:'0xcA11bde05977b3631167028862bE2a173976CA11', batchSize: 16_000 })
    pairs.forEach((p, i) => {
      const approval = results[i * 2], economics = results[i * 2 + 1]
      if (approval.status !== 'success' || economics.status !== 'success' || approval.result !== true) return
      const [phantom, threshold, decimals] = economics.result as readonly [bigint,bigint,number]
      if (phantom > 0n && threshold > 0n && decimals === p.decimals) ids.add(p.id)
    })
    approvedCache = { time: Date.now(), ids }
  }
  return pairs.filter(p => approvedCache!.ids.has(p.id))
}
let pumpMetadata: { time: number; pairs: StockPair[] } | undefined
async function pumpStocks(registry: Map<string, string>): Promise<StockPair[]> {
  if (pumpMetadata && Date.now() - pumpMetadata.time < 60_000) return pumpMetadata.pairs.filter(p => registry.has(p.address))
  const mints = [...registry.keys()], pairs: StockPair[] = []
  for (let i = 0; i < mints.length; i += 50) {
    const tokens = await stockJson('https://api.jup.ag/tokens/v2/search?' + new URLSearchParams({ query: mints.slice(i, i + 50).join(',') }), 'Stock token catalogue')
    if (!Array.isArray(tokens)) throw new Error('Stock token metadata is unavailable.')
    for (const p of tokens) {
      if (!registry.has(p.id) || !p.tags?.some((tag: string) => ['stocks','xstocks','equities'].includes(tag)) || !/^[a-zA-Z0-9._-]{1,20}$/.test(p.symbol) || !Number.isInteger(p.decimals)) continue
      pairs.push({id:stockId('sol', p.id), address:p.id, symbol:p.symbol, name:String(p.name || p.symbol).slice(0,70), decimals:p.decimals})
    }
  }
  pumpMetadata = { time: Date.now(), pairs }
  return pairs
}
export async function listStockPairs(modelId: string, query = ''): Promise<StockPair[]> {
  if (!supportsStockPairs(modelId)) throw new Error('This venue does not support stock pairs.')
  let pairs: StockPair[] = []
  if (!modelId.startsWith('pumpfun')) pairs = await catalogue(modelId === 'pons' ? 'evm' : 'sol')
  if (modelId === 'pons') pairs = await approvedPons(pairs)
  if (modelId.startsWith('pumpfun')) {
    const snapshot = await readSolanaLaunchAccounts([PUMP_QUOTE_REGISTRY])
    const registry = decodePumpRegistry(snapshot.value[0]); pairs = await pumpStocks(registry)
  }
  const search = query.trim().toLowerCase()
  return pairs.filter(p => !search || `${p.symbol} ${p.name} ${p.address}`.toLowerCase().includes(search)).sort((a, b) => a.symbol.localeCompare(b.symbol))
}
export async function resolveStockPair(modelId: string, id: string): Promise<StockPair> {
  validateStockId(id)
  const pair = (await listStockPairs(modelId)).find(p => p.id === id)
  if (!pair) throw new Error('This pair is no longer available. Choose another stock.')
  return pair
}
