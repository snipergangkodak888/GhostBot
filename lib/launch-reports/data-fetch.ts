/** Read-only launch inputs. Never retry a transaction or a Telegram delivery here. */
export class LaunchDataUnavailableError extends Error {
  readonly code = 'LAUNCH_DATA_UNAVAILABLE'
  constructor(readonly service: string, readonly retryAfterMs = 0, readonly httpStatus?: number) {
    super(`${service} is temporarily unavailable${httpStatus ? ` (HTTP ${httpStatus})` : ''}.`)
    this.name = 'LaunchDataUnavailableError'
  }
}

export function isLaunchDataUnavailable(error: unknown): error is LaunchDataUnavailableError {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'LAUNCH_DATA_UNAVAILABLE'
}

export function launchDataErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Unknown report error').replace(/\b(?:https?|wss?):\/\/\S+/gi, '[redacted URL]').slice(0, 400)
}

function retryDelay(response: Response): number {
  const value = response.headers.get('retry-after')
  if (!value) return 0
  const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(ms) ? Math.max(0, ms) : 0
}

/** Bounded retries for throttling, server faults and connection failures only. */
export async function fetchLaunchData(url: string, options: RequestInit, service: string, attempts = 3): Promise<Response> {
  let failure = new LaunchDataUnavailableError(service)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw failure
    let response: Response
    try {
      const timeout = AbortSignal.timeout(10_000)
      response = await fetch(url, { ...options, redirect: 'error', cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout })
    } catch {
      // Fetch errors may include credential-bearing URLs. Do not propagate them.
      failure = new LaunchDataUnavailableError(service)
      if (attempt === attempts || options.signal?.aborted) throw failure
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
      continue
    }
    if (response.ok || ![408, 425, 429, 500, 502, 503, 504].includes(response.status)) return response
    failure = new LaunchDataUnavailableError(service, retryDelay(response), response.status)
    await response.body?.cancel().catch(() => {})
    // Long provider cooldowns belong in the durable queue, not an open request.
    if (attempt === attempts || failure.retryAfterMs > 2_000) throw failure
    console.warn('[launch-data]', JSON.stringify({ event: 'retry', service, attempt, httpStatus: response.status }))
    await new Promise(resolve => setTimeout(resolve, Math.max(failure.retryAfterMs, 250 * 2 ** (attempt - 1))))
  }
  throw failure
}
