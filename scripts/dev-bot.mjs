#!/usr/bin/env node

import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { spawn } from "node:child_process"

const cwd = process.cwd()
const envPath = path.join(cwd, ".env.local")
const port = Number(process.env.PORT || 3000)
const children = []
let stopping = false

function readEnvFile() {
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local is missing. Copy .env.local.example to .env.local and fill in the development credentials first.")
  }
  return fs.readFileSync(envPath, "utf8")
}

function envValue(contents, key) {
  const line = contents.split(/\r?\n/).find((row) => row.trim().startsWith(`${key}=`))
  if (!line) return ""
  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "")
}

function setEnvValue(contents, key, value) {
  const nextLine = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, "m")
  return pattern.test(contents) ? contents.replace(pattern, nextLine) : `${contents.trimEnd()}\n${nextLine}\n`
}

function updateLocalUrls(publicUrl) {
  let contents = readEnvFile()
  for (const key of ["NEXT_PUBLIC_BASE_URL", "NEXT_PUBLIC_APP_URL", "APP_BASE_URL"]) {
    contents = setEnvValue(contents, key, publicUrl)
  }
  fs.writeFileSync(envPath, contents)
}

function assertPortAvailable() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") reject(new Error(`Port ${port} is already in use. Stop the existing dev server and run npm run dev:bot again.`))
      else reject(error)
    })
    server.once("listening", () => server.close(resolve))
    server.listen(port)
  })
}

function startProcess(command, args, label, options = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  })
  children.push({ child, label })
  child.once("error", (error) => {
    console.error(`[dev:bot] ${label} failed to start: ${error.message}`)
    void stopAll(1)
  })
  child.once("exit", (code, signal) => {
    if (stopping) return
    console.error(`[dev:bot] ${label} stopped unexpectedly (${signal || code || 0}).`)
    void stopAll(code || 1)
  })
  return child
}

async function waitForTunnel(ngrok, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (ngrok.exitCode !== null) throw new Error(`ngrok exited with code ${ngrok.exitCode}`)
    try {
      const response = await fetch("http://127.0.0.1:4040/api/tunnels")
      const data = await response.json()
      const tunnel = data.tunnels?.find((item) => String(item.public_url || "").startsWith("https://"))
      if (tunnel?.public_url) return String(tunnel.public_url).replace(/\/+$/, "")
    } catch {
      // ngrok's local inspection API is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Timed out waiting for ngrok to publish an HTTPS tunnel.")
}

async function waitForApp(timeoutMs = 60_000) {
  const started = Date.now()
  const healthUrl = `http://127.0.0.1:${port}/api/health`
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(healthUrl)
      if (response.ok) return
    } catch {
      // Next.js is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for GhostBot at ${healthUrl}.`)
}

async function configureWebhook() {
  const response = await fetch(`http://127.0.0.1:${port}/api/telegram/set-webhook`, { method: "POST" })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.data?.ok !== true) {
    throw new Error(data?.data?.description || data?.error || "Telegram rejected the webhook.")
  }
  return data.webhook
}

async function stopAll(exitCode = 0) {
  if (stopping) return
  stopping = true
  console.log("\n[dev:bot] Stopping Next.js, ngrok, and the cron pinger…")
  for (const { child } of [...children].reverse()) {
    if (!child.pid || child.exitCode !== null) continue
    try {
      if (process.platform === "win32") child.kill("SIGTERM")
      else process.kill(-child.pid, "SIGTERM")
    } catch {
      // The child may already have stopped.
    }
  }
  setTimeout(() => process.exit(exitCode), 250)
}

async function main() {
  await assertPortAvailable()
  const initialEnv = readEnvFile()
  const fixedUrl = envValue(initialEnv, "NGROK_URL").replace(/^https?:\/\//, "").replace(/\/+$/, "")
  const ngrokArgs = ["http", String(port), "--log=stdout"]
  if (fixedUrl) ngrokArgs.splice(2, 0, `--url=${fixedUrl}`)

  console.log(`[dev:bot] Starting ngrok for localhost:${port}…`)
  const ngrok = startProcess("ngrok", ngrokArgs, "ngrok")
  const publicUrl = await waitForTunnel(ngrok)
  updateLocalUrls(publicUrl)
  console.log(`[dev:bot] Public URL: ${publicUrl}`)
  console.log("[dev:bot] Updated local app URLs in .env.local.")

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
  console.log("[dev:bot] Starting Next.js…")
  startProcess(npmCommand, ["run", "dev"], "Next.js", { env: { ...process.env, PORT: String(port) } })
  await waitForApp()

  const webhook = await configureWebhook()
  console.log(`[dev:bot] Telegram webhook connected: ${webhook}`)
  console.log("[dev:bot] Starting reminder cron pinger…")
  startProcess(process.execPath, ["scripts/dev-cron.mjs"], "cron pinger")
  console.log("[dev:bot] GhostBot is ready. Press Ctrl+C to stop everything.\n")
}

process.once("SIGINT", () => void stopAll(0))
process.once("SIGTERM", () => void stopAll(0))

main().catch((error) => {
  console.error(`[dev:bot] ${error instanceof Error ? error.message : String(error)}`)
  void stopAll(1)
})
