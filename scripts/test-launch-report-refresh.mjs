#!/usr/bin/env node
import path from 'node:path'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'
process.chdir(projectRoot)
const { testRefresh } = loadSource(path.join(projectRoot, 'scripts/test-launch-report-refresh.ts'))
await testRefresh()
