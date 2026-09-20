import { toFunctionSelector } from 'viem'

const CHAINS = { robinhood: { id: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com' }, bsc: { id: 56, rpc: 'https://bsc-rpc.publicnode.com' } } as const

/** Fixed-endpoint, block-pinned read helper. Never accepts a caller RPC URL. */
export async function createPinnedReader(chain: keyof typeof CHAINS) {
  const config = CHAINS[chain], signal = AbortSignal.timeout(20000)
  let id = 0
  async function rpc(method: string, params: unknown[]): Promise<any> {
    const response = await fetch(config.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), cache: 'no-store', redirect: 'error', signal })
    if (!response.ok) throw new Error(`Public ${chain} RPC returned HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > 2_000_000) throw new Error('Public RPC response is unexpectedly large')
    const json = JSON.parse(text)
    if (json.error || json.result === undefined) throw new Error(`Public ${chain} RPC failed ${method}`)
    return json.result
  }
  const [chainId, block] = await Promise.all([rpc('eth_chainId', []), rpc('eth_blockNumber', [])])
  if (BigInt(chainId) !== BigInt(config.id) || !/^0x[0-9a-f]+$/i.test(block)) throw new Error('Public RPC returned an unexpected chain or block')
  const header = await rpc('eth_getBlockByNumber', [block, false])
  if (!header || header.number !== block || !/^0x[0-9a-f]{64}$/i.test(header.hash) || !/^0x[0-9a-f]+$/i.test(header.timestamp)) throw new Error('Public RPC returned an invalid block header')
  const age = Date.now() / 1000 - Number(BigInt(header.timestamp))
  if (age < -120 || age > 1800) throw new Error('Public RPC is stale; retry when current data is available')
  async function words(address: string, signature: string, count: number, args = ''): Promise<bigint[]> {
    if (!/^0x[0-9a-f]{40}$/i.test(address) || !/^(?:[0-9a-f]{64})*$/i.test(args)) throw new Error('Invalid configured contract read')
    const data = await rpc('eth_call', [{ to: address, data: toFunctionSelector(signature) + args }, block])
    if (typeof data !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(data)) throw new Error(`The ${signature} response no longer matches the verified contract interface`)
    return data.slice(2).match(/.{64}/g)!.map((word: string) => BigInt(`0x${word}`))
  }
  async function finish() {
    const again = await rpc('eth_getBlockByNumber', [block, false])
    if (again.hash !== header.hash) throw new Error('The reference block changed during the read; retry')
    return { chainId: config.id, rpc: config.rpc, blockNumber: BigInt(block).toString(), blockHash: header.hash, blockTime: new Date(Number(BigInt(header.timestamp)) * 1000).toISOString(), observedAt: new Date().toISOString() }
  }
  return { rpc, words, finish, block }
}

export const signedWord = (value: bigint): bigint => value >= 1n << 255n ? value - (1n << 256n) : value

export function boundedInteger(value: bigint, min: number, max: number, field: string): number {
  if (value < BigInt(min) || value > BigInt(max)) throw new Error(`${field} is outside the verified model range`)
  return Number(value)
}
