import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import type { LaunchReport } from './types'

const xml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const short = (v: unknown, n = 100) => { const s = String(v ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s }
const cash = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 0 })
const cents = (raw: string, decimals: number) => (BigInt(raw) * 100n + 10n ** BigInt(decimals) / 2n) / (10n ** BigInt(decimals))
const fixed = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`
const wrap = (value: string, width = 142) => {
  const lines: string[] = []; let line = ''
  for (const word of value.split(/\s+/)) { if ((line + ' ' + word).length > width && line) { lines.push(line); line = word } else line += `${line ? ' ' : ''}${word}` }
  if (line) lines.push(line)
  return lines
}

/** All exports consume the same frozen result, never recalculate with newer inputs. */
export function renderLaunchReportSvg(report: LaunchReport): string {
  if (!report.rows.some(r => r.status === 'ok')) throw new Error('Calculate at least one valid scenario before exporting an image.')
  if (report.rows.length > 64) throw new Error('An image can contain at most 64 scenarios.')
  const q = report.request.quote
  const stamp = new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const notes = [...new Set([...report.assumptions, ...report.warnings, ...report.rows.flatMap(r => r.warnings)])].flatMap(s => wrap(s))
  const height = 348 + report.rows.length * 61 + notes.length * 22 + 90
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="${height * 2}" viewBox="0 0 1600 ${height}" role="img" aria-label="${xml(report.title)}">`]
  const fontPath = join(process.cwd(), 'node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2')
  const font = readFileSync(fontPath).toString('base64')
  parts.push(`<style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font})}text{font-family:Geist,Arial,sans-serif;font-variant-numeric:tabular-nums}</style><rect width="1600" height="${height}" fill="#07101f"/>`)
  const t = (s: unknown, x: number, y: number, size = 16, color = '#ecf3ff', weight = 400, anchor = 'start') => parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${xml(s)}</text>`)
  const line = (y: number) => parts.push(`<path d="M44 ${y}H1556" stroke="#23334a"/>`)
  const logo = readFileSync(join(process.cwd(), 'public/logos/ghost-launch-math.jpg')).toString('base64')
  parts.push(`<image x="44" y="30" width="58" height="58" href="data:image/jpeg;base64,${logo}"/>`)
  t('GHOST', 118, 56, 25, '#fff', 700); t('LAUNCH MATH', 119, 80, 11, '#91a6c1', 600)
  t('CLIENT SCENARIO REPORT', 1556, 51, 12, '#84b9ff', 600, 'end'); t(stamp, 1556, 77, 11, '#91a6c1', 400, 'end')
  line(112); t(short(report.title, 68), 44, 160, 32, '#f1f5ff', 700)
  t(short(`${report.client ? `${report.client} · ` : ''}${report.modelId} · ${report.request.chain || q.symbol} · ${report.request.base.supply} ${report.request.base.symbol} total supply`, 150), 44, 193, 15, '#9dafc7')
  t(short(`Terms: ${report.request.termsSource?.label || 'User-supplied inputs'}${report.request.termsSource?.asOf ? ` · ${report.request.termsSource.asOf}` : ''}`, 158), 44, 223, 12, '#9dafc7')
  t(q.usdPrice ? `FX: 1 ${q.symbol} = $${q.usdPrice} · ${q.priceSource || 'User supplied'} · ${q.priceAsOf || 'No date supplied'}` : `Native ${q.symbol} estimates · USD conversion not supplied`, 44, 246, 12, '#9dafc7')
  const cols = [44, 188, 355, 695, 953, 1200, 1450]
  const headers = ['CONTROL', `INITIAL LP (${q.symbol})`, 'PHASE', q.usdPrice ? 'FDV (USD)' : `FDV (${q.symbol})`, `FUNDING (${q.symbol})`, `WALLETS (${q.symbol})`, `TOTAL (${q.symbol})`]
  headers.forEach((s, i) => t(s, cols[i], 286, 11, i === 6 ? '#84b9ff' : '#9dafc7', 600, i < 3 ? 'start' : 'middle')); line(303)
  report.rows.forEach((row, i) => {
    const y = 312 + i * 61
    if (i % 2) parts.push(`<rect x="44" y="${y - 2}" width="1512" height="58" rx="3" fill="#0e1c30"/>`)
    t(`${row.targetPct}%`, cols[0], y + 31, 21, '#f1f5ff', 600)
    if (row.status !== 'ok' || !row.raw) { t(short(row.error || 'Required launch inputs are missing.', 130), cols[1], y + 31, 14, '#e6ba88'); return }
    t(row.liquidity === '0' ? '—' : short(row.liquidity, 14), cols[1], y + 31, 18)
    t(short(row.phase, 28), cols[2], y + 31, 14, '#a6bbd6')
    t(`${q.usdPrice ? '$' : ''}${cash(q.usdPrice ? row.fdvUsd : row.fdvQuote)}`, cols[3], y + 31, 20, '#f1f5ff', 400, 'middle')
    // Reconcile displayed funding to rounded total less rounded wallet cost.
    const walletCents = cents(row.raw.agedWallets, q.decimals), totalCents = cents(row.raw.total, q.decimals)
    t(fixed(totalCents - walletCents), cols[4], y + 31, 20, '#f1f5ff', 400, 'middle')
    t(fixed(walletCents), cols[5], y + 31, 20, '#9dafc7', 400, 'middle')
    parts.push(`<rect x="1340" y="${y - 2}" width="216" height="58" rx="4" fill="#152b49"/>`)
    t(fixed(totalCents), cols[6], y + (q.usdPrice ? 24 : 32), 24, '#84b9ff', 700, 'middle')
    if (q.usdPrice) t(`≈ $${cash(Number(fixed(totalCents)) * Number(q.usdPrice))}`, cols[6], y + 45, 11, '#a6bbd6', 400, 'middle')
  })
  const foot = 326 + report.rows.length * 61; line(foot)
  notes.forEach((note, i) => t(note, 44, foot + 28 + i * 22, 12, i === 0 ? '#84b9ff' : '#9dafc7'))
  t('Scenario estimate • Capital includes stated reserves and liquidity • Values rounded for display', 44, height - 28, 11, '#728aa9')
  t('GHOST / LAUNCH MATH', 1556, height - 28, 10, '#728aa9', 600, 'end')
  parts.push('</svg>'); return parts.join('\n')
}

export function renderLaunchReportPng(report: LaunchReport): Buffer {
  const svg = renderLaunchReportSvg(report)
  const fonts = ['Geist-Regular.ttf', 'Geist-SemiBold.ttf', 'Geist-Bold.ttf'].map(n => join(process.cwd(), 'node_modules/geist/dist/fonts/geist-sans', n))
  return Buffer.from(new Resvg(svg, { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Geist' } }).render().asPng())
}

export function launchReportCsv(report: LaunchReport): string {
  const cell = (v: unknown) => { const s = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` }
  const headers = ['model', 'quote', 'target_percent', 'actual_percent', 'initial_liquidity', 'phase', 'purchases', 'operations', 'model_reserves', 'provider_fee', 'recipient_buffers', 'source_gas', 'funding', 'aged_wallets', 'total', 'fdv_quote', 'fdv_usd', 'status', 'notes']
  const rows = report.rows.map(r => [report.modelId, report.request.quote.symbol, r.targetPct, r.actualPct, r.amounts?.initialLiquidity, r.phase, r.amounts?.buys, r.amounts?.operations, r.amounts?.modelReserves, r.amounts?.providerFee, r.amounts?.recipientBuffers, r.amounts?.sourceGas, r.amounts?.funding, r.amounts?.agedWallets, r.amounts?.total, r.fdvQuote, r.fdvUsd, r.status, r.error || r.warnings.join('; ')])
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
