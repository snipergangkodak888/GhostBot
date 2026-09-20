function originOf(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.origin
  } catch { return undefined }
}

/** Railway terminates HTTPS before forwarding to Next's internal HTTP listener. */
export function isLaunchReportOriginAllowed(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const supplied = request.headers.get('origin')
  if (!supplied) return true // Authenticated non-browser callers still require the admin cookie.
  const origin = originOf(supplied)
  if (!origin || origin !== supplied) return false

  const configured = [
    process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_BASE_URL, process.env.NEXT_PUBLIC_APP_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined,
  ].map(originOf).filter((value): value is string => Boolean(value))
  // Host is the request's destination. Do not trust a client-supplied
  // X-Forwarded-Host as an additional allowed origin.
  const host = request.headers.get('host')
  const forwardedProtocol = request.headers.get('x-forwarded-proto')
  const protocol = forwardedProtocol === 'https' || forwardedProtocol === 'http'
    ? forwardedProtocol : new URL(request.url).protocol.slice(0, -1)
  const destination = host && !/[\s,/@?#]/.test(host) ? originOf(`${protocol}://${host}`) : undefined
  const actualOrigin = destination || originOf(request.url)
  // A local developer may keep a public webhook/tunnel URL in .env.local.
  // Allow only the same loopback destination; production keeps its allowlist.
  if (process.env.NODE_ENV === 'development' && origin === actualOrigin && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) return true
  return configured.length ? configured.includes(origin) : origin === actualOrigin
}
