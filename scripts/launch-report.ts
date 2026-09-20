import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getModelCatalog, createDefaultRequest } from '../lib/launch-reports/catalog'
import { calculateLaunchReport } from '../lib/launch-reports/engine'
import { renderLaunchReportSvg, renderLaunchReportPng, launchReportCsv } from '../lib/launch-reports/render'
import type { LaunchReportRequest } from '../lib/launch-reports/types'
import { prepareLaunchReport, validateLaunchDraft } from '../lib/launch-reports/prepare'

const MAX_INPUT_BYTES = 256 * 1024
const HELP = `Ghost Launch Math

  node scripts/launch-report.mjs list [--json]
  node scripts/launch-report.mjs init MODEL --out input.json [--overwrite]
  node scripts/launch-report.mjs generate input.json --out report-folder [--snapshot] [--overwrite]

Start with a model and choose client targets. Generation fetches current network settings and prices.
Use --snapshot to reproduce saved inputs without network access.
Generate writes input.json, report.json, report.csv, report.svg, and report.png.
This local tool does not send reports or change launch settings.
`

function parseOptions(args: string[]) {
  const positional: string[] = []
  let output: string | undefined
  let overwrite = false
  let json = false
  let snapshot = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--out') {
      if (output || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--out requires one output path')
      output = args[++i]
    } else if (arg === '--overwrite') overwrite = true
    else if (arg === '--json') json = true
    else if (arg === '--snapshot') snapshot = true
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    else positional.push(arg)
  }
  return { positional, output, overwrite, json, snapshot }
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readRequest(file: string): Promise<LaunchReportRequest> {
  const absolute = path.resolve(file)
  const stat = await fs.stat(absolute)
  if (!stat.isFile()) throw new Error('Input must be a JSON file')
  if (stat.size > MAX_INPUT_BYTES) throw new Error('Input JSON must be smaller than 256 KB')
  const text = await fs.readFile(absolute, 'utf8')
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new Error('Input JSON must be smaller than 256 KB')
  let request: LaunchReportRequest
  try { request = JSON.parse(text) } catch { throw new Error('Input is not valid JSON') }
  validateLaunchDraft(request)
  return request
}

export async function runLaunchReportCli(args: string[]) {
  const command = args[0]
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP)
    return
  }
  const { positional, output, overwrite, json, snapshot } = parseOptions(args.slice(1))
  if (command === 'list') {
    if (positional.length || output || overwrite || snapshot) throw new Error('list accepts only --json')
    const catalog = getModelCatalog()
    process.stdout.write(json ? `${JSON.stringify(catalog, null, 2)}\n` : `${catalog.map(model => `${model.id.padEnd(22)} ${model.label}\n  ${model.description}`).join('\n')}\n`)
    return
  }
  if (!['init', 'generate'].includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`)
  if (json || positional.length !== 1 || !output) throw new Error(`${command} requires one ${command === 'init' ? 'model ID' : 'input file'} and --out`)
  const destination = path.resolve(output)
  if (command === 'init') {
    if (snapshot) throw new Error('--snapshot applies to report generation only')
    const request = createDefaultRequest(positional[0])
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, `${JSON.stringify(request, null, 2)}\n`, { flag: overwrite ? 'w' : 'wx' })
    process.stdout.write(`Created ${destination}\nChoose the client and targets. Current launch terms are fetched during generation.\n`)
    return
  }

  const savedRequest = await readRequest(positional[0])
  const request = snapshot ? savedRequest : await prepareLaunchReport(savedRequest)
  const report = calculateLaunchReport(request)
  const successful = report.rows.filter(row => row.status === 'ok').length
  if (!successful) throw new Error(`No requested scenario could be calculated: ${Array.from(new Set(report.rows.map(row => row.error).filter(Boolean))).join('; ')}`)
  // The shared web renderer resolves bundled fonts/logo from the application root.
  // Keep user paths relative to the invoking directory, even when the CLI is elsewhere.
  const invocationDirectory = process.cwd()
  let svg: string
  let png: Buffer
  try {
    process.chdir(path.resolve(__dirname, '..'))
    svg = renderLaunchReportSvg(report)
    png = await renderLaunchReportPng(report)
  } finally {
    process.chdir(invocationDirectory)
  }
  const artifacts: Record<string, string | Buffer> = {
    'input.json': `${JSON.stringify(report.request, null, 2)}\n`,
    'report.json': `${JSON.stringify(report, null, 2)}\n`,
    'report.csv': launchReportCsv(report),
    'report.svg': svg,
    'report.png': png,
  }
  if (!overwrite) {
    const collisions = []
    for (const name of Object.keys(artifacts)) if (await exists(path.join(destination, name))) collisions.push(name)
    if (collisions.length) throw new Error(`Output already contains ${collisions.join(', ')}. Choose another folder or use --overwrite.`)
  }
  await fs.mkdir(destination, { recursive: true })
  for (const [name, data] of Object.entries(artifacts)) await fs.writeFile(path.join(destination, name), data, { flag: overwrite ? 'w' : 'wx' })
  process.stdout.write(`Created ${Object.keys(artifacts).length} files in ${destination}\nCalculated ${successful}/${report.rows.length} scenarios.\n`)
  if (report.warnings.length) process.stdout.write(`${report.warnings.map(warning => `Note: ${warning}`).join('\n')}\n`)
  if (successful !== report.rows.length) process.stdout.write('Some requested scenarios are unavailable; their reasons are included in the report.\n')
}
