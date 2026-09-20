'use client'

import { useEffect, useRef, useState } from 'react'
import { Calculator, Download, Upload, Save, RefreshCw, ArrowRight, ChevronDown, Check, FileText, Layers, Trash2 } from 'lucide-react'
import type { LaunchReport, LaunchReportRequest, ModelCatalogEntry } from '@/lib/launch-reports/types'

type Catalog = { models: ModelCatalogEntry[]; presets: Record<string, LaunchReportRequest>; pricing: Record<string, string>; pricingVersion: string }
type SavedSetup = { id: string; name: string; request: LaunchReportRequest }
const STORAGE = 'ghost-launch-math-setups-v1'
const human = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Bps/g, '(bps)').replace(/Raw/g, '(atomic units)').replace(/Wei/g, '(wei)').replace(/^./, s => s.toUpperCase())
const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits })
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const VENUE_HELP: Record<string, string> = {
  pumpfun: 'Standard SOL launch on Pump.fun, including purchases after graduation.',
  'pumpfun-custom': 'USDC launch on Pump.fun. SOL wallet and running costs are converted automatically.',
  launchlab: 'Stonkfun’s standard SOL launch settings on Raydium LaunchLab.',
  stonkfun: 'Stonkfun’s standard SOL launch. Other launch modes are outside this report.',
  pons: 'Pons V2 on Robinhood Chain, including purchases after graduation.',
  'raydium-cpmm': 'A new SOL pool on Raydium. Compare the funding needed at different pool sizes.',
  'uniswap-v2': 'A new V2-style pool. The standard example uses ETH, a 0.30% swap fee and no token tax.',
  'uniswap-v3': 'A new V3 pool with one full-range position. The standard example uses ETH and a 0.30% swap fee.',
  flap: 'Standard BNB launch on Flap, with no token tax and the standard wallet limit.',
  letscash: 'LetsCash on Robinhood Chain, using the standard factory configuration.',
  'pools-instant': 'Pools instant launch on Robinhood Chain.',
  'lunch-v3': 'Lunch V3 launch on Robinhood Chain.',
  'lunch-v4-tax': 'Lunch V4 launch on Robinhood Chain, including the selected creator tax.',
  'lunch-v4-rewards': 'Lunch V4 rewards launch on Robinhood Chain.',
  'sushi-launchpad': 'Sushi V1 launch on Robinhood Chain. Moon Mode is outside this report.',
  fourmeme: 'Standard BNB launch on Four.meme, including purchases after graduation.',
}
const download = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

async function requestData<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>, timeoutMs = 90_000): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, credentials: 'include' })
    if (!response.ok) {
      if (response.status === 401) throw new Error('Your Ghost session has expired. Sign in again, then retry.')
      const body = await response.json().catch(() => null)
      const message = typeof body?.error === 'string' ? body.error.slice(0, 500) : ''
      throw new Error(message || (response.status >= 500 ? 'Ghost could not finish the request. Please try again in a moment.' : `The request could not be completed (${response.status}). Please try again.`))
    }
    return await read(response)
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`The request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please try again.`)
    if (error instanceof TypeError) throw new Error('Could not reach Ghost. Check your connection and try again.')
    throw error
  } finally { clearTimeout(timeout) }
}
const readJson = async <T,>(response: Response): Promise<T> => {
  try { return await response.json() } catch { throw new Error('Ghost returned an unexpected response. Please reload the page and try again.') }
}

export function LaunchMathBuilder() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [draft, setDraft] = useState<LaunchReportRequest | null>(null)
  const [targets, setTargets] = useState('')
  const [liquidity, setLiquidity] = useState('')
  const [terms, setTerms] = useState('{}')
  const [report, setReport] = useState<LaunchReport | null>(null)
  const [saved, setSaved] = useState<SavedSetup[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [exportError, setExportError] = useState('')
  const [generationSeconds, setGenerationSeconds] = useState(0)
  const [useLiveSettings, setUseLiveSettings] = useState(true)
  const upload = useRef<HTMLInputElement>(null)
  const generationFeedback = useRef<HTMLDivElement>(null)
  const reportHeading = useRef<HTMLDivElement>(null)
  const generating = useRef(false)

  function showReport() {
    reportHeading.current?.focus({ preventScroll: true })
    reportHeading.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  function load(request: LaunchReportRequest, rates = catalog?.pricing) {
    const next = clone(request)
    const fixedPrice = rates?.[next.operations.currencySymbol.toUpperCase()]
    if (fixedPrice) next.operations.agedWalletUnitAmount = fixedPrice
    setDraft(next); setTargets(next.targetsPct.join(', ')); setLiquidity(next.liquidityAmounts?.join(', ') || '')
    setTerms(JSON.stringify(next.terms, null, 2)); setReport(null); setError(''); setNotice(''); setGenerationError(''); setExportError('')
  }
  useEffect(() => {
    let active = true
    requestData('/api/admin/launch-reports', {}, readJson<Catalog>, 30_000).then(data => {
      if (active) { setCatalog(data); load(data.presets.pumpfun, data.pricing) }
    }).catch(e => { if (active) setError(e.message) })
    try { const values = JSON.parse(localStorage.getItem(STORAGE) || '[]'); if (Array.isArray(values)) setSaved(values) } catch { /* A bad saved draft never prevents a fresh report. */ }
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (busy !== 'generate') return
    setGenerationSeconds(0)
    const timer = setInterval(() => setGenerationSeconds(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [busy])
  useEffect(() => {
    setGenerationError(''); setExportError('')
  }, [draft, targets, liquidity, terms, useLiveSettings])
  useEffect(() => { if (report) showReport() }, [report])
  useEffect(() => {
    if (!generationError) return
    generationFeedback.current?.focus({ preventScroll: true })
    generationFeedback.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' })
  }, [generationError])

  function request(): LaunchReportRequest {
    if (!draft) throw new Error('Choose a launch model.')
    if (!targets.trim()) throw new Error('Enter at least one supply target.')
    const parts = targets.split(',').map(s => s.trim())
    if (parts.some(s => !/^\d+(\.\d+)?$/.test(s))) throw new Error('Supply targets should be percentages separated by commas.')
    const parsed = JSON.parse(terms)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Launch terms must be an object.')
    return { ...clone(draft), targetsPct: parts.map(Number), liquidityAmounts: liquidity.trim() ? liquidity.split(',').map(s => s.trim()) : undefined, terms: parsed }
  }
  let current: LaunchReportRequest | null = null
  try { current = request() } catch { /* Errors appear on Generate or import. */ }
  const changed = !!report && JSON.stringify(current) !== JSON.stringify(report.request)
  const model = catalog?.models.find(m => m.id === draft?.modelId)
  const reportNeedsLiquidity = catalog?.models.find(m => m.id === report?.modelId)?.requiresLiquidity
  const validRows = report?.rows.filter(r => r.status === 'ok') || []
  const reportNotes = report ? [...new Set([...report.warnings, ...report.rows.flatMap(r => r.warnings)])] : []
  const displayedOperations = draft?.fundingConversion?.nativeOperations || draft?.operations
  const fixedPrice = catalog?.pricing[displayedOperations?.currencySymbol.toUpperCase() || '']
  const standardLiquidity = draft && catalog?.presets[draft.modelId]?.quote.symbol === draft.quote.symbol
    ? catalog.presets[draft.modelId].liquidityAmounts || [] : []
  const field = (key: 'title' | 'client', value: string) => setDraft(d => d && ({ ...d, [key]: value }))
  const operation = (key: string, value: string | number | boolean) => setDraft(d => d && ({ ...d, fundingConversion: undefined, operations: { ...(d.fundingConversion?.nativeOperations || d.operations), [key]: value } }))
  function launchChoice(key: string, value: string | number) { try { const next = JSON.parse(terms); next[key] = value; setTerms(JSON.stringify(next, null, 2)) } catch { setError('Load a valid saved launch configuration first.') } }
  function changeQuote(symbol: string) {
    const decimals = { SOL: 9, ETH: 18, BNB: 18, USDC: 6, USDT: 6 }[symbol]!
    const native = ['USDC', 'USDT'].includes(symbol) ? 'ETH' : symbol
    setDraft(d => d && ({ ...d, fundingConversion: undefined, quote: { symbol, decimals }, operations: { ...d.operations, currencySymbol: native, setupAmount: '0', buyerGasAmount: '0', cleanupAmount: '0', holderAmount: '0', tipAmount: '0', launchFeeAmount: '0', providerFeeBps: 0, recipientBufferAmount: '0', sourceGasAmount: '0', agedWalletUnitAmount: catalog?.pricing[native] || '0', agedWalletCount: d.operations.agedWalletCount } }))
    setLiquidity(''); setNotice('Quote currency changed. Enter liquidity in the new currency; operating allowances were cleared to prevent mixing currencies.')
  }

  async function generate() {
    if (generating.current || busy) return
    generating.current = true
    setBusy('generate'); setError(''); setNotice(''); setGenerationError(''); setExportError(''); setReport(null)
    try {
      const body = await requestData('/api/admin/launch-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: request(), refresh: useLiveSettings }) }, readJson<{ report: LaunchReport }>)
      if (!body?.report?.request || !Array.isArray(body.report.rows)) throw new Error('The report was incomplete. Please try again.')
      load(body.report.request)
      setReport(body.report)
    } catch (e) { setGenerationError(e instanceof Error ? e.message : 'Check the launch settings and try again.') } finally { generating.current = false; setBusy('') }
  }
  async function exportReport(format: 'png' | 'svg' | 'csv' | 'json') {
    if (!report || changed) return
    if (format === 'json') { download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `ghost-${report.modelId}-report.json`); return }
    setBusy(format); setError(''); setExportError('')
    try {
      const blob = await requestData('/api/admin/launch-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: report.request, format }) }, response => response.blob(), 60_000)
      download(blob, `ghost-${report.modelId}-report.${format}`)
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Export failed. Please try again.') } finally { setBusy('') }
  }
  async function refreshPrice() {
    if (!draft) return
    const symbol = draft.quote.symbol; setBusy('price'); setError('')
    try {
      const data = await requestData(`/api/admin/launch-reports/price?symbol=${encodeURIComponent(symbol)}`, {}, readJson<{ price: string; asOf: string; source: string }>, 30_000)
      setDraft(d => d?.quote.symbol === symbol ? { ...d, quote: { ...d.quote, usdPrice: data.price, priceAsOf: data.asOf, priceSource: data.source } } : d)
      setNotice(`Updated ${symbol}/USD price. Generate again to use it.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update price.') } finally { setBusy('') }
  }
  function saveSetup() {
    try {
      const value = request(); const name = value.client ? `${value.client} · ${model?.label}` : value.title
      const next = [...saved.filter(s => s.name !== name), { id: crypto.randomUUID(), name, request: value }].slice(-40)
      localStorage.setItem(STORAGE, JSON.stringify(next)); setSaved(next); setNotice('Setup saved in this browser. Export its settings to share with the team.'); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save setup.') }
  }
  async function importSetup(file?: File) {
    if (!file) return
    setBusy('import'); setError('')
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Report files must be smaller than 10 MB.')
      const parsed = JSON.parse(await file.text()); const value = parsed.request || parsed
      if (value.schemaVersion !== 1 || !catalog?.presets[value.modelId] || !value.operations || !value.quote || !value.base || !Array.isArray(value.targetsPct)) throw new Error('Choose an exported Ghost launch settings file.')
      const fixed = catalog.pricing[value.operations.currencySymbol?.toUpperCase()]
      if (fixed) value.operations.agedWalletUnitAmount = fixed
      const result = await requestData('/api/admin/launch-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: value, refresh: value.operations.currencySymbol !== value.quote.symbol }) }, readJson<{ report: LaunchReport }>)
      if (!result?.report?.request) throw new Error('The imported settings could not be checked. Please try again.')
      load(result.report.request); setNotice('Settings imported. Fixed wallet rates use the current Ghost pricing policy.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to import this file.') } finally { setBusy('') }
    if (upload.current) upload.current.value = ''
  }

  return <section className="launch-workbench">
    <div className="lm-heading"><div><div className="lm-eyebrow"><Calculator size={14} /> GHOST / CLIENT REPORTS</div><h1>Launch Math</h1><p>Choose a launchpad. Get a funding comparison to share with your client.</p></div></div>
    {error && <div role="alert" className="lm-alert">{error}</div>}
    {notice && <div role="status" className="lm-notice"><Check size={16} />{notice}</div>}
    {!draft || !catalog ? <div className="lm-panel lm-empty">{error ? 'Reload this page after signing in to Ghost admin.' : 'Loading launch models…'}</div> : <>
      <div className="lm-grid"><fieldset className="lm-config" disabled={!!busy}>
        <div className="lm-panel"><div className="lm-panel-heading"><Layers size={17} /><h2>Launch setup</h2></div>
          <label>Launchpad / DEX<select value={draft.modelId} onChange={e => load(catalog.presets[e.target.value])}>{[...new Set(catalog.models.map(m => m.group))].map(group => <optgroup key={group} label={group}>{catalog.models.filter(m => m.group === group).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>)}</select></label><p className="lm-help">{VENUE_HELP[draft.modelId] || model?.description}</p>
          <label>Client name <span className="lm-optional">Optional</span><input value={draft.client || ''} placeholder="Client or project name" maxLength={100} onChange={e => field('client', e.target.value)} /></label>
          {model?.requiresLiquidity && <div className="lm-liquidity"><label>Pool funds to compare ({draft.quote.symbol})<input value={liquidity} onChange={e => setLiquidity(e.target.value)} placeholder={standardLiquidity.join(', ') || 'Enter an amount'} /><span className="lm-help">Money supplied to the new pool before purchases. Enter up to four amounts, separated by commas.</span></label>{standardLiquidity.length > 0 && <><p className="lm-help">Standard comparison: {standardLiquidity.join(', ')} {draft.quote.symbol}.</p><div className="lm-chips">{standardLiquidity.map(value => <button key={value} aria-pressed={liquidity.trim() === value} onClick={() => setLiquidity(value)}>{value} {draft.quote.symbol}</button>)}<button aria-pressed={liquidity === standardLiquidity.join(', ')} onClick={() => setLiquidity(standardLiquidity.join(', '))}>Compare all</button></div></>}</div>}
          <div className="lm-default-summary"><strong>Ready to generate</strong><p>{displayedOperations!.agedWalletCount} aged wallets · {number(displayedOperations!.agedWalletCount * Number(displayedOperations!.agedWalletUnitAmount))} {displayedOperations!.currencySymbol} wallet budget included.</p><p>Injection / MM liquidity is calculated from each scenario’s MC and included in the total.</p><p>Compares {targets.split(',').map(value => `${value.trim()}%`).join(', ')} of total token supply.</p><span>{useLiveSettings ? 'Current launch settings and USD prices load automatically.' : 'Using saved settings and prices.'}</span></div>
          <button className="lm-primary" disabled={!!busy} onClick={generate} aria-describedby="launch-generation-feedback">{busy === 'generate' ? <RefreshCw className="lm-spin" size={17} /> : <Calculator size={17} />} {busy === 'generate' ? 'Generating report…' : 'Generate report'}<ArrowRight size={16} /></button>
          <div id="launch-generation-feedback" ref={generationFeedback} tabIndex={-1} className="lm-feedback" aria-live="polite" aria-atomic="true">
            {busy === 'generate' && <div className="lm-progress" role="status"><strong>Checking live settings and calculating your report</strong><p>{generationSeconds < 10 ? 'This usually takes a few seconds.' : `Still working · ${generationSeconds} seconds. Some launchpads take longer to respond.`}</p></div>}
            {generationError && <div className="lm-inline-error" role="alert"><strong>Report could not be generated</strong><p>{generationError}</p>{generationError.includes('session has expired') ? <a href="/admin/login">Sign in to Ghost</a> : <button onClick={generate} disabled={!!busy}>Try again</button>}</div>}
            {report && !changed && <button className="lm-view-report" onClick={showReport}><Check size={15} />{validRows.length ? 'Report ready — view results' : 'View scenario details'}<ArrowRight size={15} /></button>}
          </div>
        </div>
        <details className="lm-panel lm-advanced"><summary>Customize report · optional<ChevronDown size={16} /></summary><p className="lm-help">The standard comparison is ready to use. Change these only when a client needs a different setup.</p>
          <label>Report title<input value={draft.title} maxLength={120} onChange={e => field('title', e.target.value)} /></label>
          <label>Share of total token supply (%)<input value={targets} onChange={e => setTargets(e.target.value)} placeholder="40, 50, 60, 70, 80" /><span className="lm-help">Each percentage becomes a comparison row. This includes purchased tokens and any retained allocation in the setup.</span></label>
          <div className="lm-chips">{['40, 50, 60, 70, 75, 80', '50, 60, 70, 80, 90'].map(v => <button key={v} onClick={() => setTargets(v)}>{v}%</button>)}</div>
          <div className="lm-pair"><label>Number of aged wallets<input type="number" min="0" max="1000" value={displayedOperations!.agedWalletCount} onChange={e => operation('agedWalletCount', Number(e.target.value))} /></label><div className="lm-wallet-total"><small>Wallet budget</small><strong>{number(displayedOperations!.agedWalletCount * Number(displayedOperations!.agedWalletUnitAmount))} {displayedOperations!.currencySymbol}</strong></div></div>
          <p className="lm-help">{fixedPrice ? `Fixed price: ${fixedPrice} ${displayedOperations!.currencySymbol} per aged wallet.` : 'This setup uses its saved wallet allowance.'} Wallet purchases, buying wallets and holder wallets are separate counts.</p>
          {draft.modelId === 'letscash' && <label>Launch configuration<select value={String(current?.terms.configId || 1000)} onChange={e => launchChoice('configId', Number(e.target.value))}>{[1000,1001,1002,1004,1006,1016,1017,1018,1020,1022].map(id => <option key={id} value={id}>Configuration {id}{id === 1000 ? ' · standard' : ''}</option>)}</select></label>}
          <div className="lm-top-actions"><input ref={upload} type="file" accept=".json,application/json" hidden onChange={e => importSetup(e.target.files?.[0])} /><button disabled={!!busy} onClick={() => upload.current?.click()}><Upload size={15} /> Import settings</button><button onClick={saveSetup} disabled={!!busy}><Save size={15} /> Save setup</button></div>
        </details>
        <details className="lm-panel lm-advanced"><summary>USD conversion · automatic<ChevronDown size={16} /></summary><div className="lm-panel-heading"><FileText size={17} /><h2>Exchange rate</h2><button className="lm-icon" title="Refresh USD price" aria-label="Refresh USD price" disabled={!!busy} onClick={refreshPrice}><RefreshCw size={15} /></button></div><label>1 {draft.quote.symbol} in USD<input value={draft.quote.usdPrice || ''} placeholder="Optional — leave blank for native values" onChange={e => setDraft(d => d && ({ ...d, quote: { ...d.quote, usdPrice: e.target.value || undefined, priceSource: 'User-entered price', priceAsOf: new Date().toISOString() } }))} /></label><p className="lm-help">{draft.quote.usdPrice ? `${draft.quote.priceSource || 'User supplied'} · ${draft.quote.priceAsOf ? new Date(draft.quote.priceAsOf).toLocaleString() : 'Undated'}` : 'The current USD price is included automatically when you generate.'}</p></details>
        <details className="lm-panel lm-advanced"><summary>Advanced launch settings · optional<ChevronDown size={16} /></summary><p className="lm-help">Standard settings are already included. These controls are for someone who knows the specific launch setup; most reports need no changes.</p>
          <div className="lm-pair"><label>Token supply<input value={draft.base.supply} onChange={e => setDraft(d => d && ({ ...d, base: { ...d.base, supply: e.target.value } }))} /></label><label>Token decimals<input type="number" value={draft.base.decimals} onChange={e => setDraft(d => d && ({ ...d, base: { ...d.base, decimals: Number(e.target.value) } }))} /></label></div>
          <label>Token symbol<input value={draft.base.symbol} maxLength={16} onChange={e => setDraft(d => d && ({ ...d, base: { ...d.base, symbol: e.target.value } }))} /></label>
          {['uniswap-v2','uniswap-v3'].includes(draft.modelId) && <label>Pool quote currency<select value={draft.quote.symbol} onChange={e => changeQuote(e.target.value)}>{['ETH','BNB','USDC','USDT'].map(symbol => <option key={symbol}>{symbol}</option>)}</select></label>}
          {['uniswap-v2','uniswap-v3'].includes(draft.modelId) && ['USDC','USDT'].includes(draft.quote.symbol) && <label>Network funding currency<select value={displayedOperations!.currencySymbol} onChange={e => setDraft(d => d && ({ ...d, fundingConversion: undefined, operations: { ...(d.fundingConversion?.nativeOperations || d.operations), currencySymbol: e.target.value, setupAmount: '0', buyerGasAmount: '0', cleanupAmount: '0', holderAmount: '0', tipAmount: '0', launchFeeAmount: '0', recipientBufferAmount: '0', sourceGasAmount: '0', agedWalletUnitAmount: catalog.pricing[e.target.value] } }))}><option>ETH</option><option>BNB</option></select></label>}
          {draft.modelId === 'uniswap-v2' && <label>Pool swap fee (bps)<input type="number" min="0" max="9999" value={String(current?.terms.feeBps ?? 30)} onChange={e => launchChoice('feeBps', Number(e.target.value))} /></label>}
          {draft.modelId === 'uniswap-v3' && <label>Pool fee tier<select value={String(current?.terms.feePips ?? 3000)} onChange={e => launchChoice('feePips', Number(e.target.value))}>{[[100,'0.01%'],[500,'0.05%'],[3000,'0.30%'],[10000,'1.00%']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {['creatorTaxBps','buyTaxBps','creatorBuyTaxBps'].filter(key => current?.terms[key] !== undefined).map(key => <label key={key}>Selected creator buy tax (bps)<input type="number" min="0" value={String(current?.terms[key] ?? 0)} onChange={e => launchChoice(key, Number(e.target.value))} /></label>)}
          <label className="lm-check"><input type="checkbox" checked={useLiveSettings} onChange={e => setUseLiveSettings(e.target.checked)} />Fetch current network settings and prices</label>
          {!useLiveSettings && <p className="lm-help">Frozen snapshot mode: uses the exact saved terms and price, including their original dates.</p>}
          <p className="lm-help">Every allowance below is denominated in {displayedOperations!.currencySymbol}. For stablecoin launches, native costs are converted automatically when you generate.</p>
          <div className="lm-pair">{(['buyerCount', 'poolBuyerCount', 'retainedPct', 'holderCount'] as const).map(key => <label key={key}>{human(key)}<input type="number" value={displayedOperations![key] ?? ''} onChange={e => operation(key, Number(e.target.value))} /></label>)}</div>
          <div className="lm-pair">{(['setupAmount', 'buyerGasAmount', 'cleanupAmount', 'holderAmount', 'tipAmount', 'launchFeeAmount', 'recipientBufferAmount', 'sourceGasAmount'] as const).map(key => <label key={key}>{human(key)}<input value={displayedOperations![key]} onChange={e => operation(key, e.target.value)} /></label>)}</div>
          <div className="lm-pair"><label>Provider fee (bps)<input type="number" value={displayedOperations!.providerFeeBps} onChange={e => operation('providerFeeBps', Number(e.target.value))} /></label><label>Funded recipients<input type="number" value={displayedOperations!.recipientCount} onChange={e => operation('recipientCount', Number(e.target.value))} /></label></div>
          {!fixedPrice && <label>Wallet allowance per wallet ({displayedOperations!.currencySymbol})<input value={displayedOperations!.agedWalletUnitAmount} onChange={e => operation('agedWalletUnitAmount', e.target.value)} /></label>}
          <label className="lm-check"><input type="checkbox" checked={displayedOperations!.includeInitialLiquidity} onChange={e => operation('includeInitialLiquidity', e.target.checked)} />Include supplied pool liquidity in funding</label>
          <label>Protocol snapshot<textarea value={terms} readOnly spellCheck={false} rows={8} /></label>
          <label>Terms source<input value={draft.termsSource?.label || ''} onChange={e => setDraft(d => d && ({ ...d, termsSource: { ...d.termsSource, label: e.target.value, kind: 'user' } }))} /></label>
          <p className="lm-help">{draft.termsSource?.kind === 'snapshot' ? `Saved protocol snapshot · ${draft.termsSource.asOf}. Check current launch terms before quoting a client.` : 'Code estimates and user settings are labeled on the report. They are not live transaction quotes.'}</p>
          <button onClick={() => { try { download(new Blob([JSON.stringify(request(), null, 2)], { type: 'application/json' }), `ghost-${draft.modelId}-settings.json`) } catch (e) { setError(String(e)) } }}><Download size={14} /> Export settings</button>
        </details>
        {saved.length > 0 && <div className="lm-panel"><h2>Saved setups</h2><p className="lm-help">Stored in this browser.</p>{saved.map(s => <div className="lm-saved" key={s.id}><button onClick={() => load(s.request)}>{s.name}</button><button className="lm-icon" aria-label={`Delete ${s.name}`} onClick={() => { const next = saved.filter(x => x.id !== s.id); setSaved(next); localStorage.setItem(STORAGE, JSON.stringify(next)) }}><Trash2 size={14} /></button></div>)}</div>}
      </fieldset><div className="lm-output">
        {!report ? <div className="lm-panel lm-empty"><div className="lm-empty-icon"><Calculator size={28} /></div><div className="lm-eyebrow">READY WHEN YOU ARE</div><h2>Build a client-ready launch report</h2><p>Choose a venue and tap Generate report. Ghost compares the standard supply shares and includes wallets, planned fees and reserves.</p><div className="lm-steps"><span><b>01</b> Choose venue</span><span><b>02</b> Generate</span><span><b>03</b> Download</span></div><p className="lm-help">Download image to share · CSV and saved settings available too</p></div> : <>
          <div className="lm-panel lm-report-head" ref={reportHeading} tabIndex={-1}><div><div className="lm-eyebrow">CALCULATED REPORT</div><h2>{report.client || report.title}</h2><p>{catalog.models.find(m => m.id === report.modelId)?.label} · {validRows.length} calculated scenarios</p></div><div className="lm-exports">{(['png', 'csv', 'json'] as const).map(format => <button key={format} disabled={!!busy || changed || (format === 'png' && !validRows.length)} onClick={() => exportReport(format)}><Download size={14} />{busy === format ? 'Preparing…' : format === 'png' ? 'Download image' : format.toUpperCase()}</button>)}</div></div>
          {exportError && <div className="lm-inline-error" role="alert"><strong>Download could not be prepared</strong><p>{exportError}</p></div>}
          {changed && <div className="lm-notice">Inputs changed. Generate the analysis again before exporting.</div>}
          <div className="lm-reading-guide"><p><strong>Supply share</strong> means the share of all tokens held after purchases, including any retained allocation.</p><p><strong>Market cap (MC)</strong> is the value of all tokens at the modeled price after purchases.</p><p><strong>Total funding</strong> includes launch funding, aged wallets and the separate injection / MM liquidity reserve. Pool liquidity and unused reserves remain assets; the total is not just fees spent.</p></div>
          <div className="lm-mobile-scenarios" aria-label="Launch funding scenarios">
            {report.rows.map(row => <article className="lm-panel lm-scenario" key={row.id}>
              <div className="lm-scenario-heading"><div><h3>{row.targetPct}% of supply</h3>{row.status === 'ok' && <p>{row.phase}</p>}</div>
                {row.status === 'ok' && <div className="lm-scenario-total"><small>Total funding</small><strong>{number(Number(row.amounts?.total))} {report.request.quote.symbol}</strong>{row.totalUsd != null && <span>≈ ${number(row.totalUsd, 0)}</span>}</div>}
              </div>
              {row.status !== 'ok' ? <p className="lm-scenario-error">{row.error}</p> : <dl>
                <div><dt>Market cap (MC)</dt><dd>{report.request.quote.usdPrice ? `$${number(row.fdvUsd, 0)}` : `${number(row.fdvQuote, 0)} ${report.request.quote.symbol}`}</dd></div>
                {reportNeedsLiquidity && <div><dt>Initial liquidity</dt><dd>{row.liquidity} {report.request.quote.symbol}</dd></div>}
                <div><dt>Launch funding</dt><dd>{number(Number(row.amounts?.funding))} {report.request.quote.symbol}</dd></div>
                <div><dt>Aged wallets</dt><dd>{number(Number(row.amounts?.agedWallets))} {report.request.quote.symbol}</dd></div>
                <div><dt>Injection / MM liquidity</dt><dd>{number(Number(row.amounts?.injectionLiquidity || 0))} {report.request.quote.symbol}</dd></div>
              </dl>}
            </article>)}
          </div>
          <div className="lm-panel lm-table-panel"><div className="lm-table-scroll"><table><thead><tr><th>Supply share</th>{reportNeedsLiquidity && <th>Initial liquidity</th>}<th>Phase</th><th>MC {report.request.quote.usdPrice ? '(USD)' : `(${report.request.quote.symbol})`}</th><th>Launch funding</th><th>Aged wallets</th><th>Injection / MM</th><th>Total {report.request.quote.symbol}</th></tr></thead><tbody>{report.rows.map(row => <tr key={row.id}><td><b>{row.targetPct}%</b></td>{row.status !== 'ok' ? <td className="lm-row-error" colSpan={reportNeedsLiquidity ? 7 : 6}>{row.error}</td> : <>{reportNeedsLiquidity && <td>{row.liquidity}</td>}<td><span className="lm-phase">{row.phase}</span></td><td>{report.request.quote.usdPrice ? '$' : ''}{number(report.request.quote.usdPrice ? row.fdvUsd : row.fdvQuote, 0)}</td><td>{number(Number(row.amounts?.funding))}</td><td>{number(Number(row.amounts?.agedWallets))}</td><td>{number(Number(row.amounts?.injectionLiquidity || 0))}</td><td className="lm-total">{number(Number(row.amounts?.total))}{row.totalUsd != null && <small>≈ ${number(row.totalUsd, 0)}</small>}</td></>}</tr>)}</tbody></table></div></div>
          <div className="lm-panel"><h2>Included assumptions</h2><ul className="lm-assumptions">{report.assumptions.map((v, i) => <li key={i}>{v}</li>)}</ul>{reportNotes.length > 0 && <div className="lm-report-notes">{reportNotes.map((v, i) => <p key={i}>{v}</p>)}</div>}<div className="lm-report-stamp">Generated {new Date(report.generatedAt).toLocaleString()} · Saved inputs travel with the JSON report.</div></div>
        </>}
      </div></div>
    </>}
    <style jsx>{`
      .lm-optional{font-size:10px;color:#748aa7}.lm-default-summary{margin-top:18px;padding:13px;background:#17325340;border:1px solid #37689f44;border-radius:9px}.lm-default-summary strong{font-size:12px;color:#bed8fd}.lm-default-summary p{font-size:11px;color:#9eb7d9;line-height:1.6;margin:7px 0}.lm-default-summary>span{display:block;font-size:10px;line-height:1.6;color:#829cbe}.lm-reading-guide{padding:0 3px}.lm-reading-guide p{color:#8da2be;font-size:11px;line-height:1.7;margin:5px 0}.lm-reading-guide strong{color:#b4c9e7;font-weight:550}.lm-liquidity{border-top:1px solid #ffffff10;margin-top:17px;padding-top:3px}.lm-chips button[aria-pressed=true]{background:#1b497e66;border-color:#538de0;color:#cde2ff}@media(max-width:800px){.lm-chips button{min-height:40px}.lm-advanced summary{min-height:24px}.lm-steps{flex-wrap:wrap;justify-content:center}}
      .lm-mobile-scenarios{display:none}.lm-scenario-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.lm-scenario h3{font-size:17px;font-weight:650;margin:0}.lm-scenario-heading p{font-size:10px;color:#8ea8cc;margin:5px 0 0;max-width:130px}.lm-scenario-total{text-align:right;overflow-wrap:anywhere}.lm-scenario-total small,.lm-scenario-total span{display:block;font-size:10px;color:#829cbe}.lm-scenario-total strong{display:block;color:#92c0ff;font-size:18px;margin:3px 0}.lm-scenario dl{display:grid;grid-template-columns:1fr 1fr;gap:14px 12px;border-top:1px solid #ffffff0c;margin:16px 0 0;padding-top:14px}.lm-scenario dt{font-size:10px;color:#8299b9}.lm-scenario dd{font-size:13px;margin:4px 0 0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.lm-scenario-error{color:#e8b598;font-size:12px;line-height:1.6;margin:12px 0 0}@media(max-width:800px){.lm-mobile-scenarios{display:flex;flex-direction:column;gap:12px}.lm-table-panel{display:none}.lm-exports button{min-height:44px;padding:10px 12px}}
      .launch-workbench{color:#eaf1fd;max-width:1680px;margin:auto;padding-bottom:40px}.lm-heading{display:flex;justify-content:space-between;align-items:center;gap:24px;margin:8px 0 26px}.lm-eyebrow{display:flex;align-items:center;gap:7px;color:#89b7ff;font-size:10px;letter-spacing:1.6px;font-weight:650}.lm-heading h1{font-size:32px;letter-spacing:-1px;font-weight:650;margin:8px 0}.lm-heading p,.lm-report-head p{color:#91a2bc;font-size:13px;margin:4px 0}.lm-top-actions,.lm-exports{display:flex;gap:8px;flex-wrap:wrap}.launch-workbench button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid #ffffff18;background:#ffffff06;color:#c2d2e9;border-radius:8px;padding:9px 12px;font-size:12px;cursor:pointer;transition:background .15s}.launch-workbench button:hover{background:#ffffff0e}.launch-workbench button:disabled{opacity:.4;cursor:default}.lm-pricing{display:flex;align-items:center;gap:32px;background:linear-gradient(110deg,#11284b,#0b172d);border:1px solid #2e568544;border-radius:12px;padding:19px 22px;margin-bottom:22px}.lm-pricing strong{display:block;font-size:13px;margin-top:6px}.lm-rate{padding-left:24px;border-left:1px solid #ffffff14}.lm-rate b{font-size:21px;letter-spacing:-.5px}.lm-rate b span{font-size:12px;font-weight:500;color:#acc3e4}.lm-rate small{display:block;font-size:10px;color:#8299b9;margin-top:3px}.lm-policy{font-size:9px;color:#7186a3;margin-left:auto}.lm-grid{display:grid;grid-template-columns:minmax(270px,330px) minmax(0,1fr);gap:22px;align-items:start}.lm-config{border:0;padding:0;margin:0;min-inline-size:0}.lm-config,.lm-output{display:flex;flex-direction:column;gap:16px;min-width:0}.lm-panel{border:1px solid #ffffff12;background:#0a1321e8;border-radius:12px;padding:20px}.lm-panel-heading{display:flex;align-items:center;gap:9px;color:#8bb8fa;margin-bottom:18px}.lm-panel h2{font-size:14px;font-weight:600;color:#e7effe;margin:0}.lm-panel-heading .lm-icon{margin-left:auto}.launch-workbench label{display:flex;flex-direction:column;gap:7px;color:#a9bad3;font-size:11px;margin:13px 0}.launch-workbench input,.launch-workbench select,.launch-workbench textarea{background:#070e19;color:#e0eafa;border:1px solid #ffffff18;border-radius:7px;padding:10px 11px;font-size:12px;width:100%;outline:none}.launch-workbench input:focus,.launch-workbench select:focus,.launch-workbench textarea:focus{border-color:#548fe1;box-shadow:0 0 0 2px #3385ff18}.launch-workbench select option,.launch-workbench optgroup{background:#0b1422;color:#dbe8ff}.lm-help{font-size:11px;line-height:1.65;color:#798fab;margin:8px 0}.lm-chips{display:flex;gap:5px;flex-wrap:wrap}.lm-chips button{padding:5px 8px;font-size:9px;color:#809fc8;border-color:#233854}.lm-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.lm-wallet-total{display:flex;flex-direction:column;justify-content:center;padding-top:16px}.lm-wallet-total small{font-size:10px;color:#7d93b1}.lm-wallet-total strong{color:#8ebdff;font-size:16px;margin-top:5px}.launch-workbench .lm-primary{width:100%;background:#216ee6;border:1px solid #4285ef;color:white;font-weight:600;padding:12px;margin-top:12px}.launch-workbench .lm-primary:hover{background:#2c7afa}.lm-primary svg:last-child{margin-left:auto}.lm-advanced summary{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600;cursor:pointer;gap:10px}.lm-advanced textarea{font-family:monospace;font-size:10px;line-height:1.6}.launch-workbench .lm-check{flex-direction:row;align-items:center}.lm-check input{width:auto}.lm-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:510px;padding:50px;text-align:center;background:radial-gradient(ellipse at 50% 20%,#142a4933,transparent 70%),#0a1321e8}.lm-empty-icon{background:#1b3f701f;border:1px solid #325b8744;color:#91bfff;border-radius:15px;padding:20px;margin-bottom:24px}.lm-empty h2{font-size:23px;letter-spacing:-.4px;margin:12px 0}.lm-empty>p{font-size:13px;line-height:1.7;color:#889eba;max-width:410px}.lm-empty .lm-help{font-size:10px}.lm-steps{display:flex;gap:23px;font-size:11px;color:#9fb4d0;margin:27px 0}.lm-steps b{color:#578bd1;font-size:10px;margin-right:6px}.lm-alert,.lm-notice{padding:12px 16px;border-radius:9px;margin-bottom:16px;font-size:12px;line-height:1.6}.lm-alert{background:#8e39221c;border:1px solid #c77b5540;color:#e8b598}.lm-notice{display:flex;gap:8px;background:#18355a44;border:1px solid #386eaa44;color:#aacfff}.lm-report-head{display:flex;align-items:center;justify-content:space-between;gap:15px}.lm-report-head h2{font-size:21px;margin-top:8px}.lm-report-head p{font-size:11px;margin-top:8px}.lm-exports button{font-size:10px;padding:8px}.lm-table-panel{padding:0;overflow:hidden}.lm-table-scroll{overflow:auto}.launch-workbench table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}.launch-workbench th{color:#7f98bb;font-size:9px;font-weight:600;text-transform:uppercase;text-align:right;letter-spacing:.5px;background:#0c192b;padding:15px 13px}.launch-workbench td{padding:15px 13px;text-align:right;border-top:1px solid #ffffff08;font-variant-numeric:tabular-nums}.launch-workbench th:first-child,.launch-workbench td:first-child{text-align:left;padding-left:20px}.launch-workbench tbody tr:nth-child(even){background:#ffffff02}.launch-workbench .lm-total{background:#142b482e;color:#92c0ff;font-weight:600;font-size:14px}.lm-total small{display:block;color:#6688b7;font-weight:400;font-size:9px;margin-top:4px}.lm-phase{font-size:9px;color:#8ea8cc;background:#172a423b;padding:4px 6px;border-radius:4px}.launch-workbench .lm-row-error{font-size:11px;text-align:left;color:#ccac88;white-space:normal;min-width:240px;line-height:1.6}.lm-assumptions{padding-left:16px;color:#8da2be;font-size:11px;line-height:1.9;margin:12px 0}.lm-report-notes{border-top:1px solid #ffffff10;margin-top:15px;padding-top:10px}.lm-report-notes p{font-size:10px;line-height:1.65;color:#b4a780;margin:5px 0}.lm-report-stamp{font-size:9px;color:#536c8c;border-top:1px solid #ffffff0d;padding-top:13px;margin-top:16px}.lm-saved{display:flex;gap:8px;margin-top:7px}.lm-saved>button:first-child{flex:1;justify-content:flex-start;overflow:hidden;text-overflow:ellipsis;font-size:10px}.launch-workbench .lm-icon{padding:6px;background:transparent;border-color:transparent;flex-shrink:0}.lm-feedback{outline:none;scroll-margin-top:100px}.lm-feedback:empty{display:none}.lm-progress,.lm-inline-error{margin-top:12px;padding:13px;border-radius:8px;font-size:12px;line-height:1.6}.lm-progress{background:#17325366;border:1px solid #37689f66;color:#b6d6ff}.lm-progress p,.lm-inline-error p{margin:5px 0 8px}.lm-inline-error{background:#80342122;border:1px solid #ca785477;color:#f1bc9e}.lm-inline-error a{color:#fff;text-decoration:underline}.lm-view-report{width:100%;margin-top:12px}.lm-report-head{scroll-margin-top:100px;outline:none}.lm-spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1150px){.lm-grid{grid-template-columns:280px minmax(0,1fr)}.lm-heading{align-items:flex-start;flex-direction:column;gap:12px}.lm-pricing{gap:18px;flex-wrap:wrap}.lm-policy{display:none}.lm-pricing>div:first-child{width:100%}.lm-rate{padding-left:0;border-left:none;padding-right:15px}}@media(max-width:800px){.launch-workbench input,.launch-workbench select,.launch-workbench textarea{font-size:16px}.lm-grid{grid-template-columns:1fr}.lm-empty{min-height:340px;padding:30px}.lm-pricing{gap:12px;padding:18px}.lm-heading h1{font-size:27px}.lm-report-head{align-items:flex-start;flex-direction:column}.lm-rate b{font-size:19px}}
    `}</style>
  </section>
}
