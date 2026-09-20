import { createDefaultRequest, getModelCatalog } from './catalog'
import { renderLaunchReportPng } from './render'
import { injectionReference } from './injection'
import { launchReportCautions } from './client-summary'
import { formatAmount, parseAmount } from './utils'
import type { LaunchReport, LaunchReportRequest } from './types'

export interface LaunchMathSelection { modelId: string; liquidity?: string }
export interface LaunchMathButton { text: string; callback_data: string }
export interface LaunchMathView {
  text: string
  replyMarkup: { inline_keyboard: LaunchMathButton[][] }
}
export type LaunchMathGroup = 'solana' | 'bnb' | 'robinhood' | 'dex'
export type LaunchMathAction =
  | { action: 'home' }
  | { action: 'group'; group: LaunchMathGroup }
  | { action: 'review' | 'generate'; selection: LaunchMathSelection }

const groups: Record<LaunchMathGroup, string> = {
  solana: 'Solana', bnb: 'BNB Chain', robinhood: 'Robinhood Chain', dex: 'DEX examples',
}
const venueNames: Record<string, string> = {
  pumpfun: 'Pump.fun · SOL', 'pumpfun-custom': 'Pump.fun · USDC',
  stonkfun: 'Stonkfun', launchlab: 'LaunchLab · Stonkfun settings',
  'raydium-cpmm': 'Raydium CPMM', fourmeme: 'Four.meme', flap: 'Flap',
  pons: 'Pons V2', letscash: 'LetsCash', 'pools-instant': 'Pools · Instant Launch',
  'lunch-v3': 'lunch.fun · V3', 'lunch-v4-tax': 'lunch.fun · V4 tax',
  'lunch-v4-rewards': 'lunch.fun · V4 rewards', 'sushi-launchpad': 'Sushi Launchpad · V1',
  'uniswap-v2': 'Uniswap V2', 'uniswap-v3': 'Uniswap V3 · full range',
}

function groupFor(modelId: string): LaunchMathGroup {
  if (modelId.startsWith('uniswap-')) return 'dex'
  const chain = createDefaultRequest(modelId).chain
  return chain === 'Solana' ? 'solana' : chain === 'BNB Chain' ? 'bnb' : 'robinhood'
}

function venueName(modelId: string): string {
  return venueNames[modelId] || getModelCatalog().find(model => model.id === modelId)?.label || modelId
}

function checkedSelection(selection: LaunchMathSelection): Required<LaunchMathSelection> {
  if (!selection || typeof selection.modelId !== 'string' || !getModelCatalog().some(model => model.id === selection.modelId)) {
    throw new Error('Choose a venue from the Launch Math menu.')
  }
  const liquidity = selection.liquidity ?? 'compare'
  const preset = createDefaultRequest(selection.modelId)
  if (liquidity !== 'compare' && !preset.liquidityAmounts?.includes(liquidity)) {
    throw new Error('Choose an initial liquidity amount from the Launch Math menu.')
  }
  return { modelId: selection.modelId, liquidity }
}

function selectionData(action: 'review' | 'generate', selection: LaunchMathSelection) {
  const checked = checkedSelection(selection)
  return `lm:${action}:${checked.modelId}:${checked.liquidity}`
}

/** Stateless, bounded callbacks carry preset choices only, never editable protocol inputs. */
export function parseLaunchMathCallback(data: unknown): LaunchMathAction | null {
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 64) return null
  if (data === 'lm:home') return { action: 'home' }
  const parts = data.split(':')
  if (parts.length === 3 && parts[0] === 'lm' && parts[1] === 'group' && Object.hasOwn(groups, parts[2])) {
    return { action: 'group', group: parts[2] as LaunchMathGroup }
  }
  if (parts.length !== 4 || parts[0] !== 'lm' || !['review', 'generate'].includes(parts[1])) return null
  try {
    const selection = checkedSelection({ modelId: parts[2], liquidity: parts[3] })
    return { action: parts[1] as 'review' | 'generate', selection }
  } catch { return null }
}

export function launchMathHomeView(): LaunchMathView {
  return {
    text: 'Ghost Launch Math\n\nChoose a network, then a venue. I’ll prepare a client-ready image comparing the funding needed at different levels of token ownership.\n\nWallet prices, standard launch settings and USD conversion are handled for you.',
    replyMarkup: { inline_keyboard: [
      [{ text: 'Solana', callback_data: 'lm:group:solana' }, { text: 'BNB Chain', callback_data: 'lm:group:bnb' }],
      [{ text: 'Robinhood Chain', callback_data: 'lm:group:robinhood' }],
      [{ text: 'DEX examples · ETH', callback_data: 'lm:group:dex' }],
    ] },
  }
}

export function launchMathGroupView(group: LaunchMathGroup): LaunchMathView {
  if (!Object.hasOwn(groups, group)) throw new Error('Choose a network from the Launch Math menu.')
  const rows = getModelCatalog().filter(model => groupFor(model.id) === group).map(model => [{
    text: venueName(model.id), callback_data: selectionData('review', { modelId: model.id }),
  }])
  return {
    text: `Ghost Launch Math · ${groups[group]}\n\n${group === 'dex'
      ? 'Choose a pool model. These are example ETH pools using the displayed liquidity and fee assumptions; they are not quotes for an existing pool.'
      : 'Where will the token launch? Choose a venue to see the standard report setup.'}`,
    replyMarkup: { inline_keyboard: [...rows, [{ text: '← Choose network', callback_data: 'lm:home' }]] },
  }
}

/** Make a fresh copy so one teammate's choices cannot alter another report. */
export function createTelegramLaunchRequest(selection: LaunchMathSelection): LaunchReportRequest {
  const checked = checkedSelection(selection)
  const request = createDefaultRequest(checked.modelId)
  request.title = `${venueName(checked.modelId)} · launch funding`
  if (checked.liquidity !== 'compare') request.liquidityAmounts = [checked.liquidity]
  if (groupFor(checked.modelId) === 'dex') request.chain = 'ETH pool example'
  return request
}

function walletLine(request: LaunchReportRequest) {
  const operations = request.fundingConversion?.nativeOperations || request.operations
  const decimals = operations.currencySymbol === 'SOL' ? 9 : 18
  const total = formatAmount(parseAmount(operations.agedWalletUnitAmount, decimals) * BigInt(operations.agedWalletCount), decimals)
  return `${operations.agedWalletCount} aged wallets × ${operations.agedWalletUnitAmount} ${operations.currencySymbol} = ${total} ${operations.currencySymbol}`
}

const operatingExclusionNote = 'Network, setup, cleanup and holder costs are excluded in this standard example.'

function hasNoOperatingAllowances(request: LaunchReportRequest): boolean {
  const op = request.operations
  const raw = (amount: string) => parseAmount(amount, request.quote.decimals)
  return raw(op.setupAmount) + raw(op.buyerGasAmount) * BigInt(op.buyerCount)
    + raw(op.cleanupAmount) + raw(op.holderAmount) * BigInt(op.holderCount) + raw(op.tipAmount) === 0n
}

export function launchMathReviewView(selection: LaunchMathSelection): LaunchMathView {
  const checked = checkedSelection(selection)
  const request = createTelegramLaunchRequest(checked)
  const isDex = groupFor(checked.modelId) === 'dex'
  const lines = [
    `Ghost Launch Math · ${venueName(checked.modelId)}`,
    '',
    `Compare token ownership: ${request.targetsPct.map(target => `${target}%`).join(', ')}.`,
    `Every total includes ${walletLine(request)}.`,
  ]
  if (request.quote.symbol !== request.operations.currencySymbol) lines.push(`Native operating and wallet costs convert into ${request.quote.symbol} automatically.`)
  if (request.liquidityAmounts?.length) {
    lines.push(`Initial liquidity: ${request.liquidityAmounts.join(' / ')} ${request.quote.symbol} (included in funding).`)
    lines.push(`${request.operations.retainedPct}% of tokens are kept by the team; the report includes them in ownership.`)
  }
  lines.push(injectionReference(checked.modelId) === 'SOL'
    ? 'Injection / MM liquidity: 30 SOL through $500k MC, scaling above; added to each total.'
    : 'Injection / MM liquidity: 1.3 ETH through $300k MC, 2 ETH at $500k, about $10,000 at $1m; scales between and above. Converted to the report currency and added to each total.')
  if (isDex) lines.push(`Example pool · ${checked.modelId === 'uniswap-v3' ? 'full range · ' : ''}0.30% swap fee · 1 billion tokens.`)
  if (['fourmeme', 'lunch-v4-tax'].includes(checked.modelId)) lines.push('Standard example: 0% creator buy tax.')
  if (checked.modelId === 'sushi-launchpad') lines.push('Uses the V1 launch model.')
  if (hasNoOperatingAllowances(request)) lines.push(operatingExclusionNote)
  lines.push('', isDex ? 'Current USD prices load when you generate.' : 'Current launch settings and USD prices load when you generate.')
  lines.push('The image shows estimated funding, fees and reserves. It does not launch a token or move funds.')
  const keyboard: LaunchMathButton[][] = [[{ text: '📊 Generate image', callback_data: selectionData('generate', checked) }]]
  const amounts = createDefaultRequest(checked.modelId).liquidityAmounts
  if (amounts?.length) {
    keyboard.push([{ text: `${checked.liquidity === 'compare' ? '✓ ' : ''}Compare all liquidity amounts`, callback_data: selectionData('review', { modelId: checked.modelId }) }])
    // Two buttons per row stay readable on small phones.
    for (let i = 0; i < amounts.length; i += 2) keyboard.push(amounts.slice(i, i + 2).map(amount => ({
      text: `${checked.liquidity === amount ? '✓ ' : ''}${amount} ${request.quote.symbol} only`,
      callback_data: selectionData('review', { modelId: checked.modelId, liquidity: amount }),
    })))
  }
  keyboard.push([{ text: '← Change venue', callback_data: `lm:group:${groupFor(checked.modelId)}` }])
  return { text: lines.join('\n'), replyMarkup: { inline_keyboard: keyboard } }
}

export function launchMathProgressView(selection: LaunchMathSelection): LaunchMathView {
  const checked = checkedSelection(selection)
  return {
    text: `Preparing your ${venueName(checked.modelId)} image…\n\nI’m checking the latest settings, calculating the scenarios and preparing the report. This usually takes a few seconds. The image will appear here when ready.`,
    replyMarkup: { inline_keyboard: [] },
  }
}

export function launchMathErrorView(selection: LaunchMathSelection, reason: 'generation' | 'delivery' = 'generation'): LaunchMathView {
  const checked = checkedSelection(selection)
  return {
    text: reason === 'delivery'
      ? `Your ${venueName(checked.modelId)} report was calculated, but Telegram could not receive the image. Please try again.`
      : `I couldn’t prepare the ${venueName(checked.modelId)} image with the latest settings. No estimate was sent. Please try again in a moment.`,
    replyMarkup: { inline_keyboard: [
      [{ text: 'Try again', callback_data: selectionData('generate', checked) }],
      [{ text: '← Change venue', callback_data: `lm:group:${groupFor(checked.modelId)}` }],
    ] },
  }
}

export function launchMathResultCaption(report: LaunchReport): string {
  const available = report.rows.filter(row => row.status === 'ok').length
  const missing = report.rows.length - available
  return [
    `Ghost · ${venueName(report.modelId)}`,
    `${available} scenarios · ${report.request.operations.agedWalletCount} aged wallets${report.request.injectionLiquidity ? ' + MM liquidity' : ''} included.`,
    !report.request.injectionLiquidity ? 'MM excluded from this saved report; refresh to include.' : '',
    launchReportCautions(report).filter(note => /excluded|excludes|refresh/i.test(note)).join(' '),
    missing ? `${missing} unavailable scenario${missing === 1 ? '' : 's'} marked in the image.` : '',
  ].filter(Boolean).join('\n')
}

/** Uses precisely the web/CLI calculation pipeline, with fresh public inputs on each run. */
export async function generateTelegramLaunchReport(selection: LaunchMathSelection): Promise<{
  report: LaunchReport; png: Buffer; filename: string; caption: string; replyMarkup: LaunchMathView['replyMarkup']
}> {
  const [{ prepareLaunchReport }, { calculateLaunchReport }] = await Promise.all([import('./prepare'), import('./engine')])
  const checked = checkedSelection(selection)
  const request = await prepareLaunchReport(createTelegramLaunchRequest(checked))
  const report = calculateLaunchReport(request)
  return renderTelegramLaunchReport(report, checked)
}

/** Delivery retries render the saved result without fetching rates or recalculating. */
export function renderTelegramLaunchReport(report: LaunchReport, selection: LaunchMathSelection): {
  report: LaunchReport; png: Buffer; filename: string; caption: string; replyMarkup: LaunchMathView['replyMarkup']
} {
  const checked = checkedSelection(selection)
  if (report.modelId !== checked.modelId) throw new Error('The saved report does not match the selected venue.')
  if (!report.rows.some(row => row.status === 'ok')) throw new Error('No funding scenarios could be calculated with the current launch settings.')
  const png = renderLaunchReportPng(report)
  return {
    report, png, filename: `ghost-${checked.modelId}-launch-report.png`, caption: launchMathResultCaption(report),
    replyMarkup: { inline_keyboard: [
      [{ text: 'Refresh this report', callback_data: selectionData('generate', checked) }],
      [{ text: 'New report', callback_data: 'lm:home' }],
    ] },
  }
}
