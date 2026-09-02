#!/usr/bin/env node

import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"

const port = Number(process.env.PORT || 3000)
const internalCronKey = randomUUID()
const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname
const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, GHOSTBOT_INTERNAL_CRON_KEY: internalCronKey },
  stdio: "inherit",
})

const reminderIntervalMs = Math.max(5_000, Number(process.env.REMINDER_CRON_INTERVAL_MS || 10_000) || 10_000)
const revenueIntervalMs = Math.max(60_000, Number(process.env.REVENUE_CRON_INTERVAL_MS || 5 * 60_000) || 5 * 60_000)
let reminderTickActive = false
let revenueTickActive = false

async function runLaunchTick() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cron/launches`, {
      method: "POST",
      headers: { "x-ghostbot-internal-cron": internalCronKey },
    })
    if (!response.ok) console.error(`[launch-cron] HTTP ${response.status}: ${await response.text()}`)
  } catch (error) {
    console.error("[launch-cron] scheduled run failed:", error instanceof Error ? error.message : error)
  }
}

async function runOrganicChannelTick() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cron/organic-channels`, {
      method: "POST",
      headers: { "x-ghostbot-internal-cron": internalCronKey },
    })
    if (!response.ok) console.error(`[organic-channel-cron] HTTP ${response.status}: ${await response.text()}`)
  } catch (error) {
    console.error("[organic-channel-cron] scheduled run failed:", error instanceof Error ? error.message : error)
  }
}

async function runReminderTick() {
  if (reminderTickActive) return
  reminderTickActive = true
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cron/reminders`, {
      method: "POST",
      headers: { "x-ghostbot-internal-cron": internalCronKey },
    })
    if (!response.ok) console.error(`[reminder-cron] HTTP ${response.status}: ${await response.text()}`)
  } catch (error) {
    console.error("[reminder-cron] scheduled run failed:", error instanceof Error ? error.message : error)
  } finally {
    reminderTickActive = false
  }
}

async function runRevenueTick() {
  if (revenueTickActive) return
  revenueTickActive = true
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cron/revenue`, {
      method: "POST",
      headers: { "x-ghostbot-internal-cron": internalCronKey },
    })
    if (!response.ok) console.error(`[revenue-cron] HTTP ${response.status}: ${await response.text()}`)
  } catch (error) {
    console.error("[revenue-cron] scheduled run failed:", error instanceof Error ? error.message : error)
  } finally {
    revenueTickActive = false
  }
}

const initial = setTimeout(runLaunchTick, 15_000)
const interval = setInterval(runLaunchTick, 5 * 60_000)
const organicInitial = setTimeout(runOrganicChannelTick, 20_000)
// This only polls GhostBot's database-backed scheduler. Telegram is contacted only for an eligible leased job.
const organicInterval = setInterval(runOrganicChannelTick, 10_000)
const reminderInitial = setTimeout(runReminderTick, 10_000)
const reminderInterval = setInterval(runReminderTick, reminderIntervalMs)
const revenueInitial = setTimeout(runRevenueTick, 30_000)
const revenueInterval = setInterval(runRevenueTick, revenueIntervalMs)

function stop(signal) {
  clearTimeout(initial)
  clearInterval(interval)
  clearTimeout(organicInitial)
  clearInterval(organicInterval)
  clearTimeout(reminderInitial)
  clearInterval(reminderInterval)
  clearTimeout(revenueInitial)
  clearInterval(revenueInterval)
  if (!child.killed) child.kill(signal)
}

process.on("SIGTERM", () => stop("SIGTERM"))
process.on("SIGINT", () => stop("SIGINT"))
child.on("exit", (code, signal) => {
  clearTimeout(initial)
  clearInterval(interval)
  clearTimeout(organicInitial)
  clearInterval(organicInterval)
  clearTimeout(reminderInitial)
  clearInterval(reminderInterval)
  clearTimeout(revenueInitial)
  clearInterval(revenueInterval)
  process.exitCode = code ?? (signal ? 1 : 0)
})
