import { fetchLaunchData, isLaunchDataUnavailable, LaunchDataUnavailableError } from './data-fetch'

const PUBLIC_RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com']
type AccountSnapshot = { context: { slot: number }; value: Record<string, any>[]; rpc: string; observedAt: string }
const pending = new Map<string, Promise<AccountSnapshot>>()
const cooldowns = new Map<string, number>()

function providers() {
  const configured = [process.env.LAUNCH_REPORT_SOLANA_RPC_URL, process.env.LAUNCH_REPORT_SOLANA_RPC_FALLBACK_URL].filter(Boolean) as string[]
  for (const value of configured) {
    try { if (new URL(value).protocol !== 'https:') throw new Error() }
    catch { throw new Error('Launch report Solana connections must be valid HTTPS URLs.') }
  }
  return [...new Set([...configured, ...PUBLIC_RPCS])].map(url => ({ url, label: PUBLIC_RPCS.includes(url) ? url : new URL(url).hostname.endsWith('.quiknode.pro') ? 'QuickNode Solana mainnet' : 'Configured Solana RPC' }))
}

async function readAccounts(addresses: string[], endpoints: ReturnType<typeof providers>): Promise<AccountSnapshot> {
  const failures: LaunchDataUnavailableError[] = []
  for (const { url, label } of endpoints) {
    const cooldown = (cooldowns.get(url) || 0) - Date.now()
    if (cooldown > 0) { failures.push(new LaunchDataUnavailableError('Solana launch settings', cooldown)); continue }
    try {
      const response = await fetchLaunchData(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [addresses, { encoding: 'base64', commitment: 'finalized' }] }),
        signal: AbortSignal.timeout(8_000),
      }, 'Solana launch settings', 1)
      if (!response.ok) throw new LaunchDataUnavailableError('Solana launch settings', 30_000, response.status)
      const text = await response.text()
      if (text.length > 1_000_000) throw new Error('Solana configuration response exceeds the supported size')
      let payload: Record<string, any>
      try { payload = JSON.parse(text) } catch { throw new LaunchDataUnavailableError('Solana launch settings') }
      if ([429, -32005, -32016].includes(payload?.error?.code)) throw new LaunchDataUnavailableError('Solana launch settings', 30_000)
      if (payload?.error || payload?.jsonrpc !== '2.0' || payload.id !== 1 || !Number.isSafeInteger(payload.result?.context?.slot) || payload.result.context.slot <= 0 || !Array.isArray(payload.result?.value) || payload.result.value.length !== addresses.length) {
        throw new Error('Solana configuration read failed; saved terms were not changed')
      }
      return { ...payload.result, rpc: label, observedAt: new Date().toISOString() }
    } catch (error) {
      if (!isLaunchDataUnavailable(error) && !(error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name))) throw error
      const failure = isLaunchDataUnavailable(error) ? error : new LaunchDataUnavailableError('Solana launch settings')
      failures.push(failure)
      cooldowns.set(url, Date.now() + Math.max(5_000, failure.retryAfterMs))
      console.warn('[launch-data]', JSON.stringify({ event: 'provider-unavailable', service: 'Solana launch settings', provider: label, httpStatus: failure.httpStatus }))
    }
  }
  throw new LaunchDataUnavailableError('Solana launch settings', Math.min(...failures.map(error => Math.max(5_000, error.retryAfterMs))), failures.find(error => error.httpStatus)?.httpStatus)
}

/** Share concurrent reads, never reuse stale results or mix accounts across providers. */
export async function readSolanaLaunchAccounts(addresses: string[]): Promise<AccountSnapshot> {
  const endpoints = providers(), key = JSON.stringify([endpoints.map(item => item.url), addresses])
  let work = pending.get(key)
  if (!work) {
    work = readAccounts(addresses, endpoints).finally(() => pending.delete(key))
    pending.set(key, work)
  }
  return structuredClone(await work)
}
