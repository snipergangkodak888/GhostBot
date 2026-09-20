import type { LaunchReport } from './types'
import { formatAmount, parseAmount } from './utils'

/** Short client copy; the complete assumptions and warnings stay in the report data. */
export function launchReportCautions(report: LaunchReport): string[] {
  const notes: string[] = []
  const warnings = [...new Set([...report.warnings, ...report.rows.flatMap(row => row.warnings)])]
  for (const warning of warnings) {
    if (/^(Scenario estimates use|Network snapshot recorded|No USD exchange rate|Pump graduation|Native curve arithmetic)/.test(warning)) continue
    if (warning.startsWith('Operating allowances are zero:')) notes.push('Excludes network, setup, cleanup and holder costs.')
    else if (warning.startsWith('Initial pool liquidity is excluded')) notes.push('Initial pool liquidity excluded.')
    else if (warning.startsWith('Terms are a saved snapshot')) notes.push('Saved settings; refresh before quoting.')
    else if (warning.startsWith('Code estimate defaults')) notes.push('Illustrative setup.')
    else if (warning.startsWith('The aged-wallet unit price')) notes.push('Wallet FX supplied manually.')
    else if (warning.startsWith('V2 model assumes')) notes.push('No transfer tax; swap fees stay in the pool.')
    else if (warning.startsWith('V3 report models')) notes.push('New full-range pool; no transfer tax.')
    else if (warning.startsWith('Raydium CPMM creator fees')) notes.push('Creator fees disabled.')
    else if (warning.startsWith('Control is tokens retained')) notes.push('Supply shown after transfer fees.')
    else if (/^(Funding covers both token orderings|Funding and supply delivery)/.test(warning)) notes.push('MC shows the lower modeled outcome.')
    else if (/^(Migration retention and pool tax|Graduation uses the supplied 2%|Curve cost and reserve inputs)/.test(warning)) notes.push('Modeled migration; 2% crossing buffer included.')
    else if (warning.startsWith('Four.meme curve funding is imported')) notes.push('Curve costs use the supplied quote.')
    else notes.push(warning.replaceAll('FDV', 'MC'))
  }
  return [...new Set(notes)]
}

export function launchReportFootnotes(report: LaunchReport): string[] {
  const { request } = report
  const op = request.operations
  const wallet = request.fundingConversion?.nativeOperations || op
  const decimals = request.fundingConversion ? (wallet.currencySymbol === 'SOL' ? 9 : 18) : request.quote.decimals
  const walletTotal = formatAmount(parseAmount(wallet.agedWalletUnitAmount, decimals) * BigInt(op.agedWalletCount), decimals)
  const converted = wallet.currencySymbol !== request.quote.symbol ? `; converted to ${request.quote.symbol}` : ''
  const supply = op.retainedPct > 0 ? `purchased tokens + ${op.retainedPct}% team allocation` : 'purchased tokens'
  const policy = request.injectionLiquidity
  const cautions = launchReportCautions(report)
  const mm = !policy ? 'Excluded from this saved report; refresh to include.'
    : policy.referenceSymbol === 'SOL' ? '30 SOL through $500k MC; proportional above.'
      : '1.3 ETH through $300k MC; 2 ETH at $500k; $10k at $1m (min. 2 ETH). Scales between and above.'
  return [
    `SUPPLY: ${supply}. MC = price after buys × total supply.`,
    `AGED WALLETS: ${op.agedWalletCount} × ${wallet.agedWalletUnitAmount} ${wallet.currencySymbol} = ${walletTotal} ${wallet.currencySymbol}${converted}.`,
    `MM LIQUIDITY: ${mm}${policy && policy.referenceSymbol !== request.quote.symbol ? ` Converted to ${request.quote.symbol}.` : ''}`,
    policy ? 'TOTAL: Launch funding + aged wallets + MM liquidity. MM is separate from the initial pool; unused reserves remain capital.'
      : 'TOTAL: Launch funding + aged wallets. Unused reserves remain capital.',
    ...(cautions.length ? [`NOTES: ${cautions.join(' ')}`] : []),
  ]
}
