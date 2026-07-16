#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import {
  botLabConfig,
  ensureBotLabServer,
  resetBotLab,
  sendBotLabUpdate,
  stopBotLabServer,
} from "./lib/bot-lab-client.mjs"

const config = botLabConfig({ telegramId: 990000099, chatId: 990000099 })
const scenariosPath = path.join(process.cwd(), "tests", "telegram-bot.scenarios.json")
const scenarios = JSON.parse(fs.readFileSync(scenariosPath, "utf8"))
let server
let failed = 0

function responseText(data) {
  return (data.messages || []).map((message) => message.text || "").join("\n")
}

try {
  server = await ensureBotLabServer(config, { quiet: true })
  await resetBotLab(config)
  console.log(`\nGhostBot conversation tests (${scenarios.length})\n`)

  for (const scenario of scenarios) {
    const scenarioConfig = {
      ...config,
      telegramId: Number(scenario.telegramId || config.telegramId),
      chatId: Number(scenario.chatId || scenario.telegramId || config.chatId),
    }
    if (scenario.resetBefore) await resetBotLab(scenarioConfig)
    const data = await sendBotLabUpdate(scenarioConfig, scenario.callbackData
      ? { callbackData: scenario.callbackData }
      : { text: scenario.text })
    const text = responseText(data)
    const missing = (scenario.expectIncludes || []).filter((expected) => !text.includes(expected))
    if (missing.length) {
      failed++
      console.log(`FAIL  ${scenario.name}`)
      console.log(`      Missing: ${missing.join(", ")}`)
      console.log(`      Response: ${text.replace(/\n/g, " ").slice(0, 240)}`)
    } else {
      console.log(`PASS  ${scenario.name}`)
    }
  }

  console.log(`\nResult: ${scenarios.length - failed} passed, ${failed} failed.\n`)
  if (failed) process.exitCode = 1
} catch (error) {
  console.error(`\n[bot:test] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  stopBotLabServer(server)
}
