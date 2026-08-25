import "server-only"

import fs from "node:fs"
import path from "node:path"
import bigInt from "big-integer"
import { Api, TelegramClient } from "teleproto"
import { CustomFile } from "teleproto/client/uploads"
import { StringSession } from "teleproto/sessions"
import type { OrganicAutomationGateway, OrganicChannelRef } from "./organic-channel-automation"

type TelegramUserConfig = {
  apiId: number
  apiHash: string
  session: string
  logoPath: string
  sumoBotUsername: string
}

function configuredLogoPath() {
  const configured = String(process.env.SUMO_CHANNEL_LOGO_PATH || "public/logos/sumo-black.jpg").trim()
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}

export function telegramUserAutomationConfig() {
  const apiId = Number(process.env.TELEGRAM_USER_API_ID || 0)
  const apiHash = String(process.env.TELEGRAM_USER_API_HASH || "").trim()
  const session = String(process.env.TELEGRAM_USER_SESSION || "").trim()
  const logoPath = configuredLogoPath()
  const sumoBotUsername = String(process.env.SUMO_TRADE_BOT_USERNAME || "sumo_trade_bot").trim().replace(/^@/, "")
  const missing: string[] = []
  if (!Number.isSafeInteger(apiId) || apiId <= 0) missing.push("TELEGRAM_USER_API_ID")
  if (!apiHash) missing.push("TELEGRAM_USER_API_HASH")
  if (!session) missing.push("TELEGRAM_USER_SESSION")
  if (!fs.existsSync(logoPath)) missing.push(`Sumo logo (${logoPath})`)
  return {
    configured: missing.length === 0,
    missing,
    config: { apiId, apiHash, session, logoPath, sumoBotUsername } satisfies TelegramUserConfig,
  }
}

export function telegramUserAutomationConfigured() {
  return telegramUserAutomationConfig().configured
}

function inputChannel(channel: OrganicChannelRef) {
  return new Api.InputChannel({
    channelId: bigInt(channel.id),
    accessHash: bigInt(channel.accessHash),
  })
}

function channelRef(entity: any): OrganicChannelRef | null {
  const id = entity?.id?.toString?.()
  const accessHash = entity?.accessHash?.toString?.()
  return id && accessHash ? { id, accessHash } : null
}

export async function createTelegramUserGateway(): Promise<{
  gateway: OrganicAutomationGateway
  sumoBotUsername: string
  close(): Promise<void>
}> {
  const state = telegramUserAutomationConfig()
  if (!state.configured) throw new Error(`Telegram user automation is not configured: ${state.missing.join(", ")}`)
  const config = state.config
  const client = new TelegramClient(new StringSession(config.session), config.apiId, config.apiHash, {
    connectionRetries: 5,
    // Surface every FLOOD_WAIT to the database scheduler instead of sleeping and replaying inside the client.
    floodSleepThreshold: 0,
  })
  client.setLogLevel("warn" as any)
  try {
    await client.connect()
    if (!(await client.checkAuthorization())) {
      throw new Error("TELEGRAM_USER_SESSION is no longer authorized; run the authorization script again")
    }
  } catch (error) {
    await client.disconnect().catch(() => undefined)
    throw error
  }

  let sumoBotInput: any = null

  const gateway: OrganicAutomationGateway = {
    async preflight() {
      if (!fs.existsSync(config.logoPath)) throw new Error(`Sumo logo not found at ${config.logoPath}`)
      if (!(await client.checkAuthorization())) throw new Error("Telegram user session is not authorized")
      sumoBotInput = await client.getInputEntity(`@${config.sumoBotUsername}`)
    },

    async createBroadcastChannel(title, about) {
      const result: any = await client.invoke(new Api.channels.CreateChannel({
        broadcast: true,
        megagroup: false,
        title,
        about,
      }))
      const channel = Array.isArray(result?.chats)
        ? result.chats.find((chat: any) => chat instanceof Api.Channel)
        : null
      const ref = channelRef(channel)
      if (!ref) throw new Error("Telegram created the channel but did not return its access reference")
      return ref
    },

    async setChannelPhoto(channel) {
      const stat = fs.statSync(config.logoPath)
      const file = new CustomFile(path.basename(config.logoPath), stat.size, config.logoPath)
      const uploaded = await client.uploadFile({ file, workers: 1 })
      await client.invoke(new Api.channels.EditPhoto({
        channel: inputChannel(channel),
        photo: new Api.InputChatUploadedPhoto({ file: uploaded }),
      }))
    },

    async addSumoBotAsAdmin(channel) {
      const bot = sumoBotInput || await client.getInputEntity(`@${config.sumoBotUsername}`)
      await client.invoke(new Api.channels.EditAdmin({
        channel: inputChannel(channel),
        userId: bot,
        adminRights: new Api.ChatAdminRights({ postMessages: true, editMessages: true }),
        rank: "Sumo Trade Bot",
      }))
    },

    async createInviteLink(channel, title) {
      const invite: any = await client.invoke(new Api.messages.ExportChatInvite({
        peer: inputChannel(channel),
        title,
        requestNeeded: false,
      }))
      const link = String(invite?.link || "")
      if (!link) throw new Error("Telegram did not return a channel invite link")
      return link
    },
  }

  return {
    gateway,
    sumoBotUsername: config.sumoBotUsername,
    close: async () => {
      await client.disconnect()
    },
  }
}
