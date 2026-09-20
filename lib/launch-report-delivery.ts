import { isTelegramCaptureActive, sendTelegramPhoto } from './telegram-bot'
import { launchDataErrorMessage } from './launch-reports/data-fetch'

/** Inline photo: visible in chat and forwardable, with the existing result buttons. */
export async function sendLaunchReportImage(token: string, chatId: string, result: { png: Buffer; filename: string; caption: string; replyMarkup: Record<string, unknown> }): Promise<{ status: 'sent' | 'rejected' | 'uncertain'; messageId?: number }> {
  if (isTelegramCaptureActive()) {
    const delivered = await sendTelegramPhoto(token, chatId, result.png, result.caption, result.filename, { replyMarkup: result.replyMarkup })
    return { status: delivered ? 'sent' : 'rejected' }
  }
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('photo', new Blob([new Uint8Array(result.png)], { type: 'image/png' }), result.filename)
  form.append('caption', result.caption.slice(0, 1024))
  form.append('reply_markup', JSON.stringify(result.replyMarkup))
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
    const body = await response.json().catch(() => null)
    if (response.ok && body?.ok === true && Number.isSafeInteger(body.result?.message_id) && Array.isArray(body.result?.photo) && body.result.photo.length > 0) return { status: 'sent', messageId: body.result.message_id }
    console.warn('[launch-report-delivery]', JSON.stringify({ event: body?.ok === false ? 'rejected' : 'uncertain', httpStatus: response.status, errorCode: body?.error_code, description: typeof body?.description === 'string' ? launchDataErrorMessage(new Error(body.description)) : undefined }))
    return { status: body?.ok === false ? 'rejected' : 'uncertain' }
  } catch { return { status: 'uncertain' } }
}
