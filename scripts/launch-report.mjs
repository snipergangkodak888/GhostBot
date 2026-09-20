#!/usr/bin/env node
// Local CLI bootstrap for the same TypeScript engine used by the web application.
import path from 'node:path'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'

try {
  const { runLaunchReportCli } = loadSource(path.join(projectRoot, 'scripts/launch-report.ts'))
  await runLaunchReportCli(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`Launch report: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
