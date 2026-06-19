"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Clock3, Copy, Play, RefreshCw } from "lucide-react"
import { toast } from "sonner"

type CronLog = {
  _id?: string
  type?: string
  runAt?: string
  result?: any
}

type CronResponse = {
  cronSecret?: string
  recent?: CronLog[]
}

function dateLabel(value?: string) {
  if (!value) return "Not run yet"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Not run yet" : date.toLocaleString()
}

function summarize(log: CronLog) {
  const result = log.result || {}
  if (!result.ok) return result.error || "Failed"
  const reminders = result.reminders || {}
  const calendar = result.calendar || {}
  const daily = result.dailyPerformance || {}
  return `Reminders ${reminders.due || 0}, calendar ${calendar.events || 0}, daily sent ${daily.sent || 0}`
}

export default function AdminCronPage() {
  const [data, setData] = useState<CronResponse>({})
  const [origin, setOrigin] = useState("")
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const endpoint = useMemo(() => {
    if (!origin) return ""
    const secret = String(data.cronSecret || "").trim()
    return `${origin}/api/cron/ops${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`
  }, [data.cronSecret, origin])

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/cron", { cache: "no-store", credentials: "include" })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setData(json)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOrigin(window.location.origin)
    load()
  }, [])

  const copy = async () => {
    if (!endpoint) return
    await navigator.clipboard.writeText(endpoint)
    toast.success("Cron link copied")
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const res = await fetch("/api/admin/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "ops-super" }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(json.error || "Cron run failed")
      else toast.success("Cron run completed")
      await load()
    } finally {
      setRunning(false)
    }
  }

  const recent = data.recent || []

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#2f80ff]/20 bg-[#2f80ff]/[0.055] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-white">
              <Clock3 className="h-5 w-5 text-[#8ab8ff]" />
              Cron Jobs
            </h1>
            <p className="mt-1 text-sm text-white/45">One operations cron endpoint for reminders, calendar launch reminders, hosted groups, and the daily EST performance report.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-sm font-semibold text-white disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button onClick={runNow} disabled={running} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2f80ff] px-3 text-sm font-bold text-white disabled:opacity-50">
              <Play className="h-4 w-4" />
              {running ? "Running..." : "Run Now"}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-white/[0.08] bg-black/30 p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase text-white/35">Super endpoint link</p>
            <button onClick={copy} className="inline-flex h-8 items-center gap-2 rounded-md bg-white/[0.06] px-2.5 text-xs font-semibold text-white">
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
          </div>
          <p className="break-all font-mono text-sm text-[#8ab8ff]">{endpoint || "Loading endpoint..."}</p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StatusCard title="Due reminders" body="Sends scheduled reminders to active team users and hosted groups." />
          <StatusCard title="Calendar launches" body="Sends launch reminders for today and tomorrow using EST dates." />
          <StatusCard title="Daily report" body="Sends profit and performance once per EST day." />
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
        <h2 className="text-base font-bold text-white">Recent Runs</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08]">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-4 py-3 font-semibold">Job</th>
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.08]">
              {recent.map((log) => (
                <tr key={log._id || `${log.type}-${log.runAt}`} className="text-white/70">
                  <td className="px-4 py-3 font-semibold text-white">{log.type || "cron"}</td>
                  <td className="px-4 py-3">{dateLabel(log.runAt)}</td>
                  <td className="px-4 py-3">{summarize(log)}</td>
                </tr>
              ))}
              {!recent.length ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-white/35">No cron runs yet</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/25 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-white">
        <CheckCircle2 className="h-4 w-4 text-[#42e6a4]" />
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-white/45">{body}</p>
    </div>
  )
}
