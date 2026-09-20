#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(projectRoot, 'scripts/launch-report.mjs')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'ghost-launch-report-cli-'))
function run(args, expected = 0, cwd = projectRoot) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 })
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result
}

try {
  const catalog = JSON.parse(run(['list', '--json']).stdout)
  assert.ok(catalog.some(model => model.id === 'uniswap-v2'))
  assert.ok(catalog.some(model => model.id === 'launchlab'))
  const input = path.join(temporary, 'scenario.json')
  const output = path.join(temporary, 'client-report')
  run(['init', 'uniswap-v2', '--out', input])
  const request = JSON.parse(await readFile(input, 'utf8'))
  request.title = 'Client & launch <review>'
  request.targetsPct = [20, 30]
  request.liquidityAmounts = ['10']
  request.operations.retainedPct = 0
  await writeFile(input, JSON.stringify(request))
  run(['generate', '--snapshot', 'scenario.json', '--out', 'client-report'], 0, temporary)
  assert.deepEqual((await readdir(output)).sort(), ['input.json', 'report.csv', 'report.json', 'report.png', 'report.svg'])
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'))
  assert.equal(report.rows.length, 2)
  assert.ok(report.rows.every(row => row.status === 'ok'))
  assert.equal(report.title, request.title)
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'input.json'), 'utf8')), report.request)
  const png = await readFile(path.join(output, 'report.png'))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const svg = await readFile(path.join(output, 'report.svg'), 'utf8')
  assert.ok(svg.includes('Client &amp; launch &lt;review&gt;'))
  assert.ok((await readFile(path.join(output, 'report.csv'), 'utf8')).includes('20'))
  assert.match(run(['generate', '--snapshot', input, '--out', output], 1).stderr, /already contains/)
  assert.deepEqual(await readFile(path.join(output, 'report.png')), png, 'Unapproved overwrite must preserve the original image')
  request.title = 'Updated client report'
  await writeFile(input, JSON.stringify(request))
  run(['generate', '--snapshot', input, '--out', output, '--overwrite'])
  assert.equal(JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')).title, request.title)
  request.operations.buyerCount = 1.5
  await writeFile(input, JSON.stringify(request))
  assert.match(run(['generate', '--snapshot', input, '--out', path.join(temporary, 'invalid')], 1).stderr, /buyer|integer/i)
  await writeFile(input, '{bad json')
  assert.match(run(['generate', '--snapshot', input, '--out', output], 1).stderr, /valid JSON/)
  await writeFile(input, ' '.repeat(256 * 1024 + 1))
  assert.match(run(['generate', '--snapshot', input, '--out', output], 1).stderr, /256 KB/)
  run(['init', 'not-a-real-model', '--out', path.join(temporary, 'bad-model.json')], 1)
  process.stdout.write('PASS: CLI model discovery, input validation, shared exports, escaped labels, PNG rendering, and overwrite protection.\n')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
