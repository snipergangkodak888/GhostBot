#!/usr/bin/env node
import path from 'node:path'
import { loadSource, projectRoot } from './launch-report-runtime.mjs'

process.chdir(projectRoot)
loadSource(path.join(projectRoot, 'scripts/test-launch-reports.ts'))
