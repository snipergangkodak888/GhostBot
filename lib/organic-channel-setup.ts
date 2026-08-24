export const SUMO_TRADE_BOT_USERNAME = "sumo_trade_bot"

export function normalizeOrganicTicker(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^\$+/, "")
    .trim()
    .toUpperCase()
}

export function validOrganicTicker(value: unknown) {
  return /^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(normalizeOrganicTicker(value))
}

export function organicChannelTitle(ticker: unknown) {
  return `$${normalizeOrganicTicker(ticker)} - Organic Trade Notifications`
}

export function validSumoProfileId(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim())
}

export function sumoSubscribeCommand(channelId: number | string, profileId: unknown) {
  return `/subscribe_channel ${String(channelId).trim()} ${String(profileId || "").trim()}`
}

export function organicChannelCompletionMessage(inviteLink: unknown, command: unknown, sumoBotUsername = SUMO_TRADE_BOT_USERNAME) {
  const username = String(sumoBotUsername || SUMO_TRADE_BOT_USERNAME).trim().replace(/^@/, "")
  return [
    "Channel created successfully.",
    "",
    "Invite link:",
    String(inviteLink || "").trim(),
    "",
    `DM this to @${username} once token is live:`,
    String(command || "").trim(),
  ].join("\n")
}

export function addBotToChannelUrl(username: unknown, permissions: string[]) {
  const botUsername = String(username || "").trim().replace(/^@/, "")
  if (!botUsername) return ""
  return `https://t.me/${botUsername}?startchannel&admin=${permissions.join("+")}`
}

export function ghostBotOrganicChannelUrl(username: unknown) {
  return addBotToChannelUrl(username, ["change_info", "post_messages", "edit_messages", "invite_users"])
}

export function sumoBotChannelUrl() {
  return addBotToChannelUrl(SUMO_TRADE_BOT_USERNAME, ["post_messages"])
}
