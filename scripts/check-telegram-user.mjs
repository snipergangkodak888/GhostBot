#!/usr/bin/env node

import process from "node:process"
import dotenv from "dotenv"
import { TelegramClient } from "teleproto"
import { StringSession } from "teleproto/sessions/index.js"

dotenv.config({ path: ".env.local" })

const apiId = Number(process.env.TELEGRAM_USER_API_ID || 0)
const apiHash = String(process.env.TELEGRAM_USER_API_HASH || "").trim()
const session = String(process.env.TELEGRAM_USER_SESSION || "").trim()
if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash || !session) {
  console.error("TELEGRAM_USER_API_ID, TELEGRAM_USER_API_HASH, and TELEGRAM_USER_SESSION are required in .env.local.")
  process.exit(1)
}

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 })
client.setLogLevel("warn")
try {
  await client.connect()
  if (!(await client.checkAuthorization())) throw new Error("The saved session is no longer authorized")
  const me = await client.getMe()
  const sumoUsername = String(process.env.SUMO_TRADE_BOT_USERNAME || "sumo_trade_bot").trim().replace(/^@/, "")
  const sumo = await client.getEntity(`@${sumoUsername}`)
  console.log(`Telegram user session is healthy: @${me.username || "no_username"} (ID ${me.id.toString()})`)
  console.log(`Sumo Bot is resolvable without sending /start: @${sumo.username || sumoUsername}`)
} finally {
  await client.disconnect().catch(() => undefined)
}
