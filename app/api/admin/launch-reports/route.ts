import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'
import { getModelCatalog, createDefaultRequest } from '@/lib/launch-reports/catalog'
import { calculateLaunchReport } from '@/lib/launch-reports/engine'
import { launchReportCsv, renderLaunchReportPng, renderLaunchReportSvg } from '@/lib/launch-reports/render'
import { GHOST_WALLET_PRICING, GHOST_PRICING_VERSION } from '@/lib/launch-reports/pricing'
import manifest from '@/lib/launch-reports/source-manifest.json'
import { prepareLaunchReport } from '@/lib/launch-reports/prepare'
import { isLaunchReportOriginAllowed } from '@/lib/launch-reports/request-origin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
async function authorized() {
  const token = cookies().get('admin_token')?.value
  if (!token) return false
  try { return (await verifyAdminToken(token)).role === 'admin' } catch { return false }
}
const headers = { 'Cache-Control': 'no-store' }

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: 'Admin sign-in required.' }, { status: 401, headers })
  const models = getModelCatalog()
  return NextResponse.json({ models, presets: Object.fromEntries(models.map(m => [m.id, createDefaultRequest(m.id)])), pricing: GHOST_WALLET_PRICING, pricingVersion: GHOST_PRICING_VERSION, source: manifest }, { headers })
}

export async function POST(req: Request) {
  if (!(await authorized())) return NextResponse.json({ error: 'Admin sign-in required.' }, { status: 401, headers })
  if (!isLaunchReportOriginAllowed(req)) {
    console.warn('[launch-reports] Request rejected', { code: 'origin_mismatch', origin: req.headers.get('origin'), destination: new URL(req.url).origin })
    return NextResponse.json({ error: 'This page could not be verified. Reload Ghost and try again.', code: 'origin_mismatch' }, { status: 403, headers })
  }
  const started = Date.now()
  let modelId: string | undefined
  try {
    if (Number(req.headers.get('content-length') || 0) > 262144) throw new Error('Configuration exceeds 256 KB.')
    const text = await req.text()
    if (Buffer.byteLength(text) > 262144) throw new Error('Configuration exceeds 256 KB.')
    const body = JSON.parse(text)
    if (typeof body.request?.modelId === 'string') modelId = body.request.modelId.slice(0, 50)
    const format = body.format || 'json'
    if (!['json', 'csv', 'svg', 'png'].includes(format)) throw new Error('Choose JSON, CSV, SVG or PNG.')
    const request = body.refresh === true ? await prepareLaunchReport(body.request) : body.request
    const report = calculateLaunchReport(request)
    const filename = `ghost-${report.modelId}-launch-report`
    if (format === 'json') return NextResponse.json({ report, source: manifest, pricingVersion: GHOST_PRICING_VERSION }, { headers })
    const content = format === 'png' ? new Uint8Array(renderLaunchReportPng(report)) : format === 'svg' ? renderLaunchReportSvg(report) : launchReportCsv(report)
    const mime = { png: 'image/png', svg: 'image/svg+xml', csv: 'text/csv; charset=utf-8' }[format as 'png' | 'svg' | 'csv']
    return new NextResponse(content, { headers: { ...headers, 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename}.${format}"`, 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    console.error('[launch-reports] Generation failed', { modelId, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : 'Unknown error' })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not calculate this configuration.' }, { status: 400, headers })
  }
}
