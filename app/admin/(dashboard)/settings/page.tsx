"use client"

import { FormEvent, useEffect, useState } from "react"
import { AlertTriangle, Bot, BrainCircuit, CheckCircle2, Database, Globe, KeyRound, Plus, RefreshCw, Save, Send, Settings } from "lucide-react"

type SettingsResponse = {
  settings?: {
    platformName?: string
    landingPageEnabled?: boolean
    cacheVersion?: string | number
    telegramBotUsername?: string
    openAi?: {
      enabled?: boolean
      apiKey?: string
      model?: string
      baseUrl?: string
    }
  }
  platformName?: string
  landingPageEnabled?: boolean
  cacheVersion?: string | number
  telegramBotUsername?: string
  openAi?: {
    enabled?: boolean
    apiKey?: string
    model?: string
    baseUrl?: string
  }
}

const AI_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
}

function normalizeAiModel(value?: string) {
  const model = String(value || "").trim()
  return !model || model === "gpt-4o-mini" ? "gpt-5.4-mini" : model
}

type WebhookStatus = {
  success?: boolean
  error?: string
  tokenConfigured?: boolean
  webhook?: {
    url?: string
    pending_update_count?: number
    last_error_message?: string
  }
  webhookInfo?: {
    url?: string
    pending_update_count?: number
    last_error_message?: string
  }
  webhookUrl?: string
  message?: string
}

export default function AdminSettingsPage() {
  const [form, setForm] = useState({
    platformName: "Ghost Team System",
    landingPageEnabled: true,
    cacheVersion: "1",
    telegramBotUsername: "",
    openAi: {
      enabled: true,
      apiKey: "",
      model: "gpt-5.4-mini",
      baseUrl: AI_BASE_URLS.openai,
    },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [currentDomain, setCurrentDomain] = useState("")
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null)
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookMessage, setWebhookMessage] = useState("")
  const [exampleLoading, setExampleLoading] = useState(false)
  const [exampleMessage, setExampleMessage] = useState("")

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/admin/settings", { cache: "no-store" })
      const data: SettingsResponse = await response.json()
      const settings = data.settings || data
      setForm({
        platformName: settings.platformName || "Ghost Team System",
        landingPageEnabled: settings.landingPageEnabled !== false,
        cacheVersion: String(settings.cacheVersion ?? "1"),
        telegramBotUsername: settings.telegramBotUsername || "",
        openAi: {
          enabled: settings.openAi?.enabled !== false,
          apiKey: settings.openAi?.apiKey || "",
          model: normalizeAiModel(settings.openAi?.model),
          baseUrl: settings.openAi?.baseUrl || AI_BASE_URLS.openai,
        },
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setCurrentDomain(window.location.origin)
    load()
    loadWebhookStatus()
  }, [])

  const loadWebhookStatus = async () => {
    try {
      const response = await fetch("/api/admin/setup-webhook", { cache: "no-store", credentials: "include" })
      const data: WebhookStatus = await response.json().catch(() => ({}))
      setWebhookStatus(data)
    } catch {
      setWebhookStatus({ error: "Could not load webhook status" })
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const setupWebhook = async () => {
    const origin = window.location.origin
    const webhookUrl = `${origin}/api/telegram/webhook`
    setCurrentDomain(origin)
    setWebhookLoading(true)
    setWebhookMessage("")
    try {
      const response = await fetch("/api/admin/setup-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ webhookUrl }),
      })
      const data: WebhookStatus = await response.json().catch(() => ({}))
      setWebhookStatus(data)
      setWebhookMessage(response.ok ? "Webhook connected successfully" : data.error || "Webhook setup failed")
    } finally {
      setWebhookLoading(false)
    }
  }

  const addExampleProject = async () => {
    setExampleLoading(true)
    setExampleMessage("")
    try {
      const response = await fetch("/api/admin/example-project", {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json().catch(() => ({}))
      setExampleMessage(response.ok ? `Created ${data.project?.name || "example project"}` : data.error || "Example project was not created")
    } finally {
      setExampleLoading(false)
    }
  }

  const targetWebhookUrl = currentDomain ? `${currentDomain}/api/telegram/webhook` : ""
  const activeWebhook = webhookStatus?.webhookInfo || webhookStatus?.webhook
  const webhookMatches = !!activeWebhook?.url && !!targetWebhookUrl && activeWebhook.url === targetWebhookUrl

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 [&_svg]:h-6 [&_svg]:w-6 [&_svg]:text-[#146efc]">
          <Settings />
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-sm text-white/45">Operations app, AI, domain landing, and Telegram bot settings.</p>
          </div>
        </div>
        <button onClick={load} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-[#146efc]" aria-label="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <form onSubmit={save} className="rounded-lg border border-white/[0.08] bg-white/[0.035] p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-2 text-xs text-white/45"><Globe className="h-3.5 w-3.5" />Platform name</span>
            <input value={form.platformName} onChange={(event) => setForm({ ...form, platformName: event.target.value })} className="h-11 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-[#146efc]" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-white/45">Cache version</span>
            <input value={form.cacheVersion} onChange={(event) => setForm({ ...form, cacheVersion: event.target.value })} className="h-11 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-[#146efc]" />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 flex items-center gap-2 text-xs text-white/45"><Bot className="h-3.5 w-3.5" />Telegram bot username</span>
            <input value={form.telegramBotUsername} onChange={(event) => setForm({ ...form, telegramBotUsername: event.target.value.replace(/^@/, "") })} className="h-11 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-[#146efc]" />
          </label>

          <section className="rounded-lg border border-[#42e6a4]/20 bg-[#42e6a4]/[0.05] p-4 md:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Database className="h-4 w-4 text-[#42e6a4]" />Example project data</h2>
                <p className="mt-1 text-xs text-white/40">Create one real project with income, expense, payroll, notes, and custom sheets filled with mock rows.</p>
              </div>
              <button
                type="button"
                onClick={addExampleProject}
                disabled={exampleLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1f8f66] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {exampleLoading ? "Creating..." : "Add Example Project"}
              </button>
            </div>
            {exampleMessage ? <p className="mt-3 text-sm font-semibold text-[#b8ffe1]">{exampleMessage}</p> : null}
          </section>

          <section className="rounded-lg border border-[#2f80ff]/20 bg-[#2f80ff]/[0.05] p-4 md:col-span-2">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Send className="h-4 w-4 text-[#8ab8ff]" />Telegram webhook setup</h2>
                <p className="mt-1 text-xs text-white/40">This uses the Telegram bot token saved on the server and connects it to the domain opened in this tab.</p>
              </div>
              <button
                type="button"
                onClick={setupWebhook}
                disabled={webhookLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#2f80ff] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {webhookLoading ? "Setting..." : "Setup Webhook"}
              </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/[0.08] bg-black/30 p-3">
                <p className="text-xs font-semibold uppercase text-white/35">Current tab webhook</p>
                <p className="mt-2 break-all font-mono text-xs text-[#8ab8ff]">{targetWebhookUrl || "Loading domain..."}</p>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-black/30 p-3">
                <p className="text-xs font-semibold uppercase text-white/35">Telegram webhook</p>
                <p className="mt-2 break-all font-mono text-xs text-white/65">{activeWebhook?.url || "Not connected yet"}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className={`flex items-center gap-2 ${webhookMatches ? "text-emerald-200" : "text-amber-200"}`}>
                {webhookMatches ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {webhookMatches ? "Webhook is connected to this domain" : "Webhook is not connected to this current domain yet"}
              </div>
              {webhookStatus?.error ? <p className="text-sm font-semibold text-red-200">{webhookStatus.error}</p> : null}
              {activeWebhook?.last_error_message ? <p className="text-sm text-red-200">Telegram error: {activeWebhook.last_error_message}</p> : null}
              {typeof activeWebhook?.pending_update_count === "number" ? <p className="text-xs text-white/40">Pending updates: {activeWebhook.pending_update_count}</p> : null}
              {webhookMessage ? <p className="text-sm font-semibold text-[#8ab8ff]">{webhookMessage}</p> : null}
            </div>
          </section>

          <section className="rounded-lg border border-[#2f80ff]/20 bg-[#2f80ff]/[0.05] p-4 md:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-white"><BrainCircuit className="h-4 w-4 text-[#8ab8ff]" />AI bot settings</h2>
                <p className="mt-1 text-xs text-white/40">Stored in the database and used by the bot for sheet/project analysis.</p>
              </div>
              <Toggle
                checked={form.openAi.enabled}
                onChange={(checked) => setForm({ ...form, openAi: { ...form.openAi, enabled: checked } })}
                label="Enabled"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs text-white/45">API base URL</span>
                <select
                  value={form.openAi.baseUrl}
                  onChange={(event) => setForm({ ...form, openAi: { ...form.openAi, baseUrl: event.target.value } })}
                  className="h-11 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-[#2f80ff]"
                >
                  <option value={AI_BASE_URLS.openai}>OpenAI API - {AI_BASE_URLS.openai}</option>
                  <option value={AI_BASE_URLS.openrouter}>OpenRouter API - {AI_BASE_URLS.openrouter}</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-2 text-xs text-white/45"><KeyRound className="h-3.5 w-3.5" />OpenAI API key</span>
                <input
                  type="password"
                  value={form.openAi.apiKey}
                  onChange={(event) => setForm({ ...form, openAi: { ...form.openAi, apiKey: event.target.value } })}
                  className="h-11 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-[#2f80ff]"
                  placeholder="sk-..."
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-white/45">Model</span>
                <input
                  value={form.openAi.model}
                  onChange={(event) => setForm({ ...form, openAi: { ...form.openAi, model: event.target.value } })}
                  className="h-11 w-full rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-[#2f80ff]"
                  placeholder="gpt-5.4-mini"
                />
              </label>
            </div>
          </section>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.08] bg-black/30 p-4 md:col-span-2">
            <span>
              <span className="block text-sm font-semibold text-white">Domain landing page</span>
              <span className="mt-1 block text-xs text-white/40">When off, the public domain stays locked on the centered logo screen.</span>
            </span>
            <Toggle
              checked={form.landingPageEnabled}
              onChange={(checked) => setForm({ ...form, landingPageEnabled: checked })}
            />
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-md bg-[#146efc] px-4 text-sm font-bold text-white disabled:opacity-50">
            <Save className="h-4 w-4" />
            Save
          </button>
          {saved ? <p className="text-sm font-semibold text-[#76a9ff]">Saved</p> : null}
        </div>
      </form>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-xs font-semibold text-white/60"
    >
      {label ? <span>{label}</span> : null}
      <span className={`relative h-6 w-11 rounded-full border transition ${checked ? "border-[#2f80ff]/60 bg-[#2f80ff]" : "border-white/10 bg-white/[0.08]"}`}>
        <span className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  )
}
