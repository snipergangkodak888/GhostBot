"use client"

import { useEffect, useState } from "react"
import { APP_NAME, MAIN_LOGO_URL } from "@/lib/branding"

interface PublicSettings {
  platformName?: string
  logoUrl?: string
  telegramBotUsername?: string
  contactTelegram?: string
  contactEmail?: string
  landingPageEnabled?: boolean
}

const icon = (name: string) =>
  `https://api.iconify.design/${name}.svg?color=%23146efc`

const features = [
  {
    icon: "line-md:calendar",
    title: "Launch Calendar",
    body: "Track upcoming launches, milestones, and project timing in one operations view.",
  },
  {
    icon: "line-md:bell-alert-loop",
    title: "Team Reminders",
    body: "Create scheduled and recurring reminders that sync into Telegram for delivery.",
  },
  {
    icon: "line-md:document-list",
    title: "Project Intelligence",
    body: "Keep project status, notes, payroll, strategy docs, and trader communications searchable.",
  },
]

export default function LandingPage() {
  const [settings, setSettings] = useState<PublicSettings>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/public-settings", { cache: "no-store" })
        if (res.ok) {
          const json = await res.json()
          setSettings({
            platformName: json.settings?.platformName || APP_NAME,
            logoUrl: MAIN_LOGO_URL,
            telegramBotUsername: json.settings?.telegramBotUsername || "",
            contactTelegram: json.settings?.contactTelegram || "",
            contactEmail: json.settings?.contactEmail || "",
            landingPageEnabled: json.settings?.landingPageEnabled !== false,
          })
        }
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const platform = settings.platformName || APP_NAME
  const logoUrl = MAIN_LOGO_URL
  const botUsername = (settings.telegramBotUsername || "").replace(/^@/, "")
  const botLink = botUsername ? `https://t.me/${botUsername}` : undefined

  if (loading || settings.landingPageEnabled === false) return <LogoOnlyScreen logoUrl={logoUrl} platform={platform} />

  return (
    <main className="min-h-screen bg-black text-white overflow-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5 sm:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#146efc]/40 bg-[#146efc]/10">
              <img src={logoUrl} alt={platform} className="h-7 w-7 object-contain" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">{platform}</p>
              <p className="text-xs text-white/45">TG app + bot operations</p>
            </div>
          </div>
          {botLink && (
            <a
              href={botLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#146efc] px-4 text-sm font-semibold text-white transition hover:bg-[#2d7fff]"
            >
              <img src={logoUrl} alt="" className="h-5 w-5 object-contain" />
              Open Bot
            </a>
          )}
        </header>

        <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.08fr_0.92fr]">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#146efc]/35 bg-[#146efc]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#8db8ff]">
              <img src={logoUrl} alt="" className="h-5 w-5 object-contain" />
              Internal MM command center
            </p>
            <h1 className="max-w-3xl text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
              Telegram App + Bot for live team operations.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/62 sm:text-lg">
              Query revenue, manage launches, log project notes, coordinate reminders, monitor crypto prices, and ask internal docs from Telegram or the dashboard.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {botLink ? (
                <a
                  href={botLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#146efc] px-6 font-bold text-white transition hover:bg-[#2d7fff]"
                >
                  <img src={logoUrl} alt="" className="h-5 w-5 object-contain" />
                  Launch Telegram Bot
                </a>
              ) : (
                <span className="inline-flex h-12 items-center justify-center rounded-full border border-white/12 px-6 text-sm text-white/50">
                  Telegram bot not configured
                </span>
              )}
              <a
                href="/admin"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/14 px-6 font-semibold text-white transition hover:border-[#146efc]/60 hover:text-[#8db8ff]"
              >
                <img src={icon("line-md:cog-loop")} alt="" className="h-5 w-5" />
                Admin Panel
              </a>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-[#146efc]/10">
            <div className="rounded-[1.5rem] border border-[#146efc]/20 bg-black p-4">
              <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-white/40">Today</p>
                  <p className="text-xl font-bold">Operations Pulse</p>
                </div>
                <div className="rounded-full bg-[#146efc] px-3 py-1 text-xs font-bold">Live</div>
              </div>
              <div className="grid gap-3">
                {[
                  ["Active Projects", "12", "line-md:folder-multiple"],
                  ["Upcoming Launches", "5", "line-md:calendar"],
                  ["Open Reminders", "18", "line-md:bell-alert-loop"],
                  ["Docs Indexed", "2 manuals", "line-md:file-document"],
                ].map(([label, value, iconName]) => (
                  <div key={label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                    <div className="flex items-center gap-3">
                      <img src={icon(iconName)} alt="" className="h-6 w-6" />
                      <span className="text-sm text-white/65">{label}</span>
                    </div>
                    <strong className="text-lg">{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 pb-12 md:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <img src={icon(feature.icon)} alt="" className="mb-4 h-8 w-8" />
              <h2 className="text-lg font-bold">{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/55">{feature.body}</p>
            </article>
          ))}
        </section>

        <footer className="border-t border-white/10 py-5 text-sm text-white/40">
          © {new Date().getFullYear()} {platform}. Internal operations only.
        </footer>
      </div>
    </main>
  )
}

function LogoOnlyScreen({ logoUrl, platform }: { logoUrl: string; platform: string }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-black">
      <img src={logoUrl} alt={platform} className="h-28 w-28 object-contain" />
    </main>
  )
}
