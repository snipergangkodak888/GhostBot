export type OrganicChannelRatePolicy = {
  enabled: boolean
  minIntervalMs: number
  maxPerTwoHours: number
  maxPerEightHours: number
  maxPerTwentyFourHours: number
}

export type OrganicTelegramOperation =
  | "preflight"
  | "create_channel"
  | "set_photo"
  | "add_sumo_admin"
  | "create_invite"

export type OrganicTelegramErrorDecision = {
  kind: "flood_wait" | "transient_read" | "restriction" | "permanent" | "ambiguous_write"
  message: string
  operation?: OrganicTelegramOperation
  retryAfterSeconds?: number
  openCircuit: boolean
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

export function organicChannelRatePolicy(env: Record<string, string | undefined> = process.env) {
  return {
    // Fail closed: production must explicitly opt in after account/channel health has been reviewed.
    enabled: String(env.ORGANIC_CHANNEL_AUTOMATION_ENABLED || "false").toLowerCase() === "true",
    minIntervalMs: boundedInteger(env.ORGANIC_CHANNEL_MIN_INTERVAL_MINUTES, 30, 1, 24 * 60) * 60_000,
    maxPerTwoHours: boundedInteger(env.ORGANIC_CHANNEL_MAX_PER_2_HOURS, 2, 1, 20),
    maxPerEightHours: boundedInteger(env.ORGANIC_CHANNEL_MAX_PER_8_HOURS, 4, 1, 50),
    maxPerTwentyFourHours: boundedInteger(env.ORGANIC_CHANNEL_MAX_PER_24_HOURS, 10, 1, 100),
  } satisfies OrganicChannelRatePolicy
}

function timestamp(value: string | Date | number) {
  const result = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

export function nextOrganicChannelEligibleAt(
  creationTimes: Array<string | Date | number>,
  now: Date,
  policy: OrganicChannelRatePolicy,
) {
  const history = creationTimes
    .map(timestamp)
    .filter((value): value is number => value !== null && value <= now.getTime())
    .sort((a, b) => a - b)
  let candidate = now.getTime()

  const latest = history.at(-1)
  if (latest !== undefined) candidate = Math.max(candidate, latest + policy.minIntervalMs)

  const windows = [
    { durationMs: 2 * 60 * 60_000, maximum: policy.maxPerTwoHours },
    { durationMs: 8 * 60 * 60_000, maximum: policy.maxPerEightHours },
    { durationMs: 24 * 60 * 60_000, maximum: policy.maxPerTwentyFourHours },
  ]

  // Moving the candidate forward can only evict older history. Re-evaluate until all rolling windows allow one new creation.
  for (let pass = 0; pass < 10; pass += 1) {
    const before = candidate
    for (const window of windows) {
      const within = history.filter((value) => value > candidate - window.durationMs && value <= candidate)
      if (within.length >= window.maximum) {
        candidate = Math.max(candidate, within[within.length - window.maximum] + window.durationMs)
      }
    }
    if (candidate === before) break
  }

  return new Date(candidate)
}

function errorChain(error: unknown) {
  const chain: any[] = []
  let cursor: any = error
  for (let index = 0; cursor && index < 5; index += 1) {
    chain.push(cursor)
    cursor = cursor?.cause
  }
  return chain
}

function errorText(error: unknown) {
  const text = errorChain(error)
    .flatMap((item) => [item?.errorMessage, item?.message, item?.code, item?.name])
    .filter(Boolean)
    .join(" | ")
  return text || String(error || "Unknown Telegram automation error")
}

function errorOperation(error: unknown) {
  const operation = errorChain(error).map((item) => item?.operation).find(Boolean)
  return operation as OrganicTelegramOperation | undefined
}

function floodWaitSeconds(error: unknown, text: string) {
  const explicit = errorChain(error)
    .map((item) => Number(item?.seconds || item?.retryAfter || item?.retry_after || 0))
    .find((value) => Number.isFinite(value) && value > 0)
  if (explicit) return Math.ceil(explicit)
  const match = text.match(/FLOOD(?:_PREMIUM)?_WAIT[_\s-]?(\d+)/i)
    || text.match(/wait(?: of)?\s+(\d+)\s+seconds?/i)
  return match ? Math.max(1, Number(match[1])) : null
}

export function classifyOrganicTelegramError(error: unknown): OrganicTelegramErrorDecision {
  const message = errorText(error)
  const upper = message.toUpperCase()
  const operation = errorOperation(error)
  const floodSeconds = floodWaitSeconds(error, message)
  if (floodSeconds || upper.includes("FLOOD_WAIT") || upper.includes("FLOOD_PREMIUM_WAIT")) {
    return {
      kind: "flood_wait",
      message,
      operation,
      retryAfterSeconds: floodSeconds || 60,
      openCircuit: false,
    }
  }

  if (/(USER_RESTRICTED|PEER_FLOOD|SPAMREPORTED|ACCOUNT.*FROZEN|AUTH_KEY_DUPLICATED)/i.test(message)) {
    return { kind: "restriction", message, operation, openCircuit: true }
  }

  if (/(COULD NOT ADD PARTICIPANTS|CHAT_MEMBER_ADD_FAILED|USER_NOT_MUTUAL_CONTACT|USER_PRIVACY_RESTRICTED|FRESH_CHANGE_ADMINS_FORBIDDEN|CHAT_ADMIN_INVITE_REQUIRED|RIGHT_FORBIDDEN|BOT_GROUPS_BLOCKED)/i.test(message)) {
    return { kind: "permanent", message, operation, openCircuit: true }
  }

  const networkFailure = /(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|TIMEOUT|CONNECTION.*(?:CLOSED|FAILED|LOST))/i.test(message)
  if ((!operation || operation === "preflight") && networkFailure) {
    return { kind: "transient_read", message, operation, openCircuit: false }
  }

  if (operation && operation !== "preflight") {
    return { kind: "ambiguous_write", message, operation, openCircuit: true }
  }

  return { kind: "permanent", message, operation, openCircuit: true }
}
