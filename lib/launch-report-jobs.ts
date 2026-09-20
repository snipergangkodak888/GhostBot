import { createHash } from 'node:crypto'
import { supabaseRest } from './supabase'
import { getBotPermissionContext, canUseLaunchReports } from './bot-permissions'
import { getTelegramBotToken, editTelegramMessage, isTelegramCaptureActive } from './telegram-bot'
import { createTelegramLaunchRequest, generateTelegramLaunchReport, renderTelegramLaunchReport, launchMathErrorView, type LaunchMathSelection } from './launch-reports/telegram'
import type { LaunchReport } from './launch-reports/types'
import { sendLaunchReportImage } from './launch-report-delivery'
import { isLaunchDataUnavailable, launchDataErrorMessage } from './launch-reports/data-fetch'

export const LAUNCH_REPORT_JOBS = 'launchReportJobs'
type JobStatus = 'queued' | 'running' | 'sending' | 'complete' | 'failed' | 'cancelled'
export type LaunchReportJob = {
  _id: string; chatId: string; telegramId: number; messageId: number
  selection: LaunchMathSelection; status: JobStatus; version: number
  createdAt: string; updatedAt: string; leaseUntil?: string
  report?: LaunchReport; deliveryUncertain?: boolean; deliveredMessageId?: number
  attempts?: number; nextAttemptAt?: string | null
  lastFailure?: { code: string; stage: string; at: string; message?: string; service?: string; httpStatus?: number }
}
type StoredJob = { id: string; data: LaunchReportJob }
function path(filters: Record<string, string> = {}) {
  return `documents?${new URLSearchParams({ collection: `eq.${LAUNCH_REPORT_JOBS}`, ...filters })}`
}
async function readJobs(filters: Record<string, string>) {
  const rows = await supabaseRest<StoredJob[]>(path({ select: 'id,data', ...filters }))
  return rows.map(row => ({ ...row.data, _id: row.id }))
}
// Conditional PATCH is atomic. The generic collection updateOne is deliberately
// not used here because it reads then upserts and cannot claim a job safely.
async function transition(job: LaunchReportJob, changes: Partial<LaunchReportJob>) {
  const next = { ...job, ...changes, version: job.version + 1, updatedAt: new Date().toISOString() }
  const rows = await supabaseRest<StoredJob[]>(path({ id: `eq.${job._id}`, 'data->>status': `eq.${job.status}`, 'data->>version': `eq.${job.version}` }), {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { data: next, updated_at: next.updatedAt },
  })
  return rows.length ? next : null
}

export async function queueLaunchReport(params: { chatId: string | number; telegramId: number; messageId: number; selection: LaunchMathSelection }) {
  createTelegramLaunchRequest(params.selection) // Validate all choices before storage.
  if (!Number.isSafeInteger(params.messageId) || params.messageId <= 0) throw new Error('Open /launchmath to start a new report.')
  const selection = { modelId: params.selection.modelId, liquidity: params.selection.liquidity || 'compare' }
  const id = createHash('sha256').update(JSON.stringify([String(params.chatId), params.messageId, selection])).digest('hex').slice(0, 40)
  const current = (await readJobs({ id: `eq.${id}`, limit: '1' }))[0]
  if (current) {
    if (current.status === 'failed' || current.status === 'cancelled') {
      const retried = await transition(current, { status: 'queued', telegramId: params.telegramId, deliveryUncertain: false, attempts: 0, nextAttemptAt: null })
      return { job: retried || current, duplicate: !retried }
    }
    return { job: current, duplicate: true }
  }
  const active = (await readJobs({ 'data->>chatId': `eq.${params.chatId}`, 'data->>status': 'in.(queued,running,sending)', limit: '1' }))[0]
  if (active) return { job: active, duplicate: true }
  const now = new Date().toISOString()
  const job: LaunchReportJob = { _id: id, chatId: String(params.chatId), telegramId: params.telegramId, messageId: params.messageId, selection, status: 'queued', version: 0, createdAt: now, updatedAt: now }
  const rows = await supabaseRest<StoredJob[]>(path({ on_conflict: 'collection,id' }), {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: { collection: LAUNCH_REPORT_JOBS, id, data: job, created_at: now, updated_at: now },
  })
  return { job, duplicate: !rows.length }
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Report generation timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}
async function feedback(job: LaunchReportJob, token: string, reason: 'generation' | 'delivery') {
  const view = launchMathErrorView(job.selection, reason)
  const text = job.deliveryUncertain ? 'Telegram did not confirm delivery. Check this chat for the PNG before tapping Try again.' : view.text
  await editTelegramMessage(token, job.chatId, job.messageId, text, { replyMarkup: view.replyMarkup })
}
async function runJob(original: LaunchReportJob, token: string) {
  let job = await transition(original, { status: 'running', attempts: (original.attempts || 0) + 1, nextAttemptAt: null, leaseUntil: new Date(Date.now() + 180_000).toISOString() })
  if (!job) return
  try {
    const permission = await getBotPermissionContext({ telegramId: job.telegramId, chatId: job.chatId, capture: isTelegramCaptureActive() })
    if (!canUseLaunchReports(permission)) { await transition(job, { status: 'cancelled' }); return }
    const result = job.report ? renderTelegramLaunchReport(job.report, job.selection)
      : await withDeadline(generateTelegramLaunchReport(job.selection), 90_000)
    const currentPermission = await getBotPermissionContext({ telegramId: job.telegramId, chatId: job.chatId, capture: isTelegramCaptureActive() })
    if (!canUseLaunchReports(currentPermission)) { await transition(job, { status: 'cancelled' }); return }
    // Persist the exact result before delivery; a retry never changes the quote.
    job = await transition(job, { status: 'sending', report: result.report, leaseUntil: new Date(Date.now() + 60_000).toISOString() })
    if (!job) return
    const delivery = await sendLaunchReportImage(token, job.chatId, result)
    if (delivery.status !== 'sent') {
      const failed = await transition(job, { status: 'failed', deliveryUncertain: delivery.status === 'uncertain', lastFailure: { code: `TELEGRAM_${delivery.status.toUpperCase()}`, stage: 'sending', at: new Date().toISOString() } })
      console.error('[launch-report-jobs]', JSON.stringify({ event: 'delivery-failed', jobId: job._id, modelId: job.selection.modelId, outcome: delivery.status }))
      if (failed) await feedback(failed, token, 'delivery')
      return
    }
    job = await transition(job, { status: 'complete', deliveredMessageId: delivery.messageId })
    if (job) {
      console.info('[launch-report-jobs]', JSON.stringify({ event: 'complete', jobId: job._id, modelId: job.selection.modelId, attempt: job.attempts, deliveredMessageId: delivery.messageId }))
      await editTelegramMessage(token, job.chatId, job.messageId, 'Your report is ready below. Open the PNG to view or share it.', { replyMarkup: { inline_keyboard: [[{ text: 'New report', callback_data: 'lm:home' }]] } })
    }
  } catch (error) {
    if (!job || job.status === 'complete') return
    const transient = isLaunchDataUnavailable(error)
    const lastFailure = { code: transient ? error.code : 'REPORT_FAILED', stage: job.status, at: new Date().toISOString(), message: launchDataErrorMessage(error), ...(transient ? { service: error.service, httpStatus: error.httpStatus } : {}) }
    // Only retry reads/calculation, never an image that Telegram may have accepted.
    if (transient && job.status === 'running' && !job.report && (job.attempts || 0) < 3) {
      const delay = Math.max(15_000 * (job.attempts || 1), Math.min(error.retryAfterMs || 0, 120_000))
      const nextAttemptAt = new Date(Date.now() + delay).toISOString()
      const queued = await transition(job, { status: 'queued', nextAttemptAt, lastFailure })
      console.warn('[launch-report-jobs]', JSON.stringify({ event: 'retry-scheduled', jobId: job._id, modelId: job.selection.modelId, attempt: job.attempts, nextAttemptAt, ...lastFailure }))
      if (queued) await editTelegramMessage(token, job.chatId, job.messageId, 'The live data service is busy. I’m retrying automatically and will post your image here when it’s ready. You don’t need to tap again.', { replyMarkup: { inline_keyboard: [] } }).catch(() => {})
      return
    }
    console.error('[launch-report-jobs]', JSON.stringify({ event: 'failed', jobId: original._id, modelId: original.selection.modelId, attempt: job.attempts, ...lastFailure }))
    const failed = await transition(job, { status: 'failed', deliveryUncertain: job.status === 'sending', lastFailure }).catch(() => null)
    if (failed) await feedback(failed, token, failed.report ? 'delivery' : 'generation').catch(() => {})
  }
}
let activeRun: Promise<{ ok: true; processed: number }> | null = null
export function runLaunchReportJobs() {
  if (activeRun) return activeRun
  activeRun = (async () => {
    const token = await getTelegramBotToken()
    if (!token) return { ok: true as const, processed: 0 }
    const now = new Date().toISOString()
    const abandoned = await readJobs({ 'data->>status': 'in.(running,sending)', 'data->>leaseUntil': `lt.${now}`, limit: '10' })
    for (const job of abandoned) {
      const next = await transition(job, { status: job.status === 'running' ? 'queued' : 'failed', deliveryUncertain: job.status === 'sending' })
      if (next?.status === 'failed') await feedback(next, token, 'delivery').catch(() => {})
    }
    const jobs = await readJobs({ 'data->>status': 'eq.queued', or: `(data->>nextAttemptAt.is.null,data->>nextAttemptAt.lte.${now})`, order: 'created_at.asc', limit: '2' })
    await Promise.all(jobs.map(job => runJob(job, token)))
    return { ok: true as const, processed: jobs.length }
  })().finally(() => { activeRun = null })
  return activeRun
}
