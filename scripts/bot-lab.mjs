#!/usr/bin/env node

import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import {
  botLabConfig,
  ensureBotLabServer,
  resetBotLab,
  sendBotLabUpdate,
  stopBotLabServer,
} from "./lib/bot-lab-client.mjs"

function parseArgs(argv) {
  const options = {}
  const message = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--group") options.chatType = "group"
    else if (arg === "--supergroup") options.chatType = "supergroup"
    else if (arg === "--telegram-id") options.telegramId = Number(argv[++index])
    else if (arg === "--chat-id") options.chatId = Number(argv[++index])
    else if (arg === "--port") options.port = Number(argv[++index])
    else message.push(arg)
  }
  return { options, message: message.join(" ").trim() }
}

function inlineButtons(messages) {
  return messages.flatMap((message) => message.replyMarkup?.inline_keyboard || []).flat()
}

function printResponse(data, showEvents = false) {
  for (const message of data.messages || []) {
    const label = message.type === "text" ? "bot" : `bot ${message.type}`
    console.log(`\n${label}> ${message.text || "(no caption)"}`)
    if (message.filename) console.log(`     ${message.filename} (${message.byteLength || 0} bytes)`)
  }

  const buttons = inlineButtons(data.messages || [])
  if (buttons.length) {
    console.log("")
    buttons.forEach((button, index) => console.log(`  [${index + 1}] ${button.text}`))
  }

  if (showEvents) {
    console.log("\nTelegram calls:")
    for (const call of data.calls || []) console.log(`  ${call.method}`)
  }
  return buttons
}

function printHelp(config) {
  console.log("\nGhostBot Telegram Bot Lab")
  console.log(`Identity: Telegram ${config.telegramId}, chat ${config.chatId} (${config.chatType})`)
  console.log("Type messages exactly as you would in Telegram.")
  console.log("Lab commands: :click N, :reset, :events, :help, :exit\n")
}

const parsed = parseArgs(process.argv.slice(2))
const config = botLabConfig(parsed.options)
let server

try {
  server = await ensureBotLabServer(config)

  if (parsed.message) {
    const data = await sendBotLabUpdate(config, { text: parsed.message })
    printResponse(data, process.env.BOT_LAB_SHOW_EVENTS === "true")
    process.exitCode = data.ok ? 0 : 1
  } else {
    printHelp(config)
    const rl = readline.createInterface({ input, output })
    let buttons = []
    let showEvents = false

    while (true) {
      const text = (await rl.question("you> ")).trim()
      if (!text) continue
      if (text === ":exit" || text === ":quit") break
      if (text === ":help") {
        printHelp(config)
        continue
      }
      if (text === ":events") {
        showEvents = !showEvents
        console.log(`Telegram call details ${showEvents ? "enabled" : "disabled"}.`)
        continue
      }
      if (text === ":reset") {
        const result = await resetBotLab(config)
        buttons = []
        console.log(`Conversation reset (${result.deleted} local conversation record(s) removed).`)
        continue
      }

      const click = text.match(/^:click\s+(\d+)$/i)
      let data
      if (click) {
        const button = buttons[Number(click[1]) - 1]
        if (!button?.callback_data) {
          console.log("That button is unavailable or opens a URL. Send :help for commands.")
          continue
        }
        data = await sendBotLabUpdate(config, { callbackData: button.callback_data })
      } else {
        data = await sendBotLabUpdate(config, { text })
      }
      buttons = printResponse(data, showEvents)
      console.log("")
    }
    rl.close()
  }
} catch (error) {
  console.error(`\n[bot:lab] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  stopBotLabServer(server)
}
