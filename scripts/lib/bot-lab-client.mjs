import { spawn } from "node:child_process"

export function botLabConfig(overrides = {}) {
  const port = Number(overrides.port || process.env.BOT_LAB_PORT || process.env.PORT || 3000)
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    telegramId: Number(overrides.telegramId || process.env.BOT_LAB_TELEGRAM_ID || 990000001),
    chatId: Number(overrides.chatId || process.env.BOT_LAB_CHAT_ID || 990000001),
    chatType: overrides.chatType || process.env.BOT_LAB_CHAT_TYPE || "private",
  }
}

async function appIsReady(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

export async function ensureBotLabServer(config, options = {}) {
  if (await appIsReady(config.baseUrl)) return { child: null, owned: false }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
  if (!options.quiet) console.log(`[bot:lab] Starting GhostBot on ${config.baseUrl}…`)
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(config.port) },
    stdio: options.quiet ? ["ignore", "ignore", "inherit"] : "inherit",
    detached: process.platform !== "win32",
  })

  const started = Date.now()
  while (Date.now() - started < 60_000) {
    if (child.exitCode !== null) throw new Error(`Next.js exited with code ${child.exitCode}.`)
    if (await appIsReady(config.baseUrl)) return { child, owned: true }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  stopBotLabServer({ child, owned: true })
  throw new Error(`Timed out waiting for GhostBot at ${config.baseUrl}.`)
}

export function stopBotLabServer(server) {
  if (!server?.owned || !server.child?.pid || server.child.exitCode !== null) return
  try {
    if (process.platform === "win32") server.child.kill("SIGTERM")
    else process.kill(-server.child.pid, "SIGTERM")
  } catch {
    // The development server may already have stopped.
  }
}

export async function sendBotLabUpdate(config, input) {
  const response = await fetch(`${config.baseUrl}/api/dev/telegram-lab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId: config.telegramId,
      chatId: config.chatId,
      chatType: config.chatType,
      ...input,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Bot Lab request failed with ${response.status}.`)
  return data
}

export async function resetBotLab(config) {
  const response = await fetch(`${config.baseUrl}/api/dev/telegram-lab?telegramId=${encodeURIComponent(config.telegramId)}`, {
    method: "DELETE",
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Bot Lab reset failed with ${response.status}.`)
  return data
}
