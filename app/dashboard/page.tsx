"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Bell, Check, Copy, FolderKanban, RefreshCw, UserPlus } from "lucide-react"

type Summary = {
  metrics?: {
    activeProjects?: number
    remindersScheduled?: number
    docs?: number
    revenueToday?: number
    profitToday?: number
    profitThisWeek?: number
    profitThisMonth?: number
    expenseToday?: number
    expenseTotalThisWeek?: number
    expenseThisMonth?: number
  }
  crypto?: Record<string, number | null>
  upcomingReminders?: Array<{ _id: string; title: string; dueAt?: string }>
  projects?: Array<{ _id: string; name: string; status: string; owner?: string; launchDate?: string; notes?: string }>
}

const dateLabel = (value?: string) => {
  if (!value) return "No date"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString()
}

const money = (value?: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0))

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary>({})
  const [loading, setLoading] = useState(true)
  const [profitIndex, setProfitIndex] = useState(0)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const [inviteCode, setInviteCode] = useState("")
  const [inviteLoading, setInviteLoading] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/ops/summary", { cache: "no-store" })
      const data = await response.json().catch(() => ({}))
      setSummary(data && typeof data === "object" && !Array.isArray(data) ? data : {})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const activeProjects = useMemo(
    () => (summary.projects || []).filter((project) => project.status === "active").slice(0, 3),
    [summary.projects],
  )
  const nextReminder = summary.upcomingReminders?.[0]
  const metrics = summary.metrics || {}
  const profitCards = [
    { label: "Today", profit: metrics.profitToday, expense: metrics.expenseToday },
    { label: "This Week", profit: metrics.profitThisWeek, expense: metrics.expenseTotalThisWeek },
    { label: "This Month", profit: metrics.profitThisMonth, expense: metrics.expenseThisMonth },
  ]
  const handleProfitSwipe = (x: number) => {
    if (touchStart === null) return
    const delta = touchStart - x
    if (Math.abs(delta) > 42) {
      setProfitIndex((current) => Math.min(profitCards.length - 1, Math.max(0, current + (delta > 0 ? 1 : -1))))
    }
    setTouchStart(null)
  }
  const createInvite = async () => {
    setInviteLoading(true)
    setCopiedInvite(false)
    try {
      const response = await fetch("/api/user/invite-member", { method: "POST" })
      const data = await response.json().catch(() => ({}))
      setInviteCode(String(data?.code?.code || data?.code || ""))
    } finally {
      setInviteLoading(false)
    }
  }

  const copyInvite = async () => {
    if (!inviteCode) return
    await navigator.clipboard?.writeText(inviteCode).catch(() => {})
    setCopiedInvite(true)
    window.setTimeout(() => setCopiedInvite(false), 1400)
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#8ab8ff]">Profit</p>
            <h1 className="mt-1 text-2xl font-bold text-white">Financial snapshot</h1>
          </div>
          <button onClick={load} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-black/30 text-[#8ab8ff]" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div
          className="overflow-hidden"
          onTouchStart={(event) => setTouchStart(event.touches[0]?.clientX ?? null)}
          onTouchEnd={(event) => handleProfitSwipe(event.changedTouches[0]?.clientX ?? 0)}
        >
          <div className="flex transition-transform duration-200 ease-out" style={{ transform: `translateX(-${profitIndex * 100}%)` }}>
            {profitCards.map((card) => (
              <div key={card.label} className="w-full shrink-0 pr-3">
                <ProfitTile label={card.label} profit={card.profit} expense={card.expense} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-center gap-1.5">
            {profitCards.map((card, index) => (
              <button
                key={card.label}
                onClick={() => setProfitIndex(index)}
                className={`h-1.5 rounded-full transition-all ${index === profitIndex ? "w-5 bg-[#2f80ff]" : "w-1.5 bg-white/20"}`}
                aria-label={card.label}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <MiniLink href="/dashboard/projects" icon={<FolderKanban />} label="Projects" value={metrics.activeProjects || 0} color="#ffd43b" />
        <MiniLink href="/dashboard/reminders" icon={<Bell />} label="Reminders" value={metrics.remindersScheduled || 0} color="#ff4d5e" />
      </section>

      <section className="rounded-xl border border-[#2f80ff]/20 bg-white/[0.035] p-2.5">
        <div className="flex min-h-10 items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2f80ff]/15 text-[#8ab8ff]">
              <UserPlus className="h-4 w-4" />
            </div>
            <h2 className="truncate text-sm font-semibold text-white">Invite Team Member</h2>
          </div>
          <button
            onClick={createInvite}
            disabled={inviteLoading}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#2f80ff] px-3 text-xs font-bold text-white disabled:opacity-60"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {inviteLoading ? "Creating" : "Invite"}
          </button>
        </div>
        {inviteCode ? (
          <div className="mt-2 flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/30 pl-2.5 pr-1">
            <code className="min-w-0 flex-1 truncate text-xs font-bold tracking-wide text-[#8ab8ff]">{inviteCode}</code>
            <button
              onClick={copyInvite}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[0.08] text-white"
                aria-label="Copy invite code"
            >
              {copiedInvite ? <Check className="h-3.5 w-3.5 text-[#42e6a4]" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Next Reminder</h2>
          <Link href="/dashboard/reminders" className="text-xs font-semibold text-[#8db8ff]">View</Link>
        </div>
        {nextReminder ? (
          <div className="rounded-xl bg-black/30 p-4">
            <p className="font-semibold text-white">{nextReminder.title}</p>
            <p className="mt-1 text-sm text-white/45">{dateLabel(nextReminder.dueAt)}</p>
          </div>
        ) : (
          <Empty text="No reminders scheduled" />
        )}
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Active Projects</h2>
          <Link href="/dashboard/projects" className="text-xs font-semibold text-[#8db8ff]">Open</Link>
        </div>
        <div className="space-y-2">
          {activeProjects.map((project) => (
            <Link key={project._id} href="/dashboard/projects" className="block rounded-xl bg-black/30 p-4">
              <p className="font-semibold text-white">{project.name}</p>
              <p className="mt-1 text-sm text-white/45">{project.owner || "No owner"} · {dateLabel(project.launchDate)}</p>
            </Link>
          ))}
          {!activeProjects.length ? <Empty text="No active projects yet" /> : null}
        </div>
      </section>

    </div>
  )
}

function MiniLink({ href, icon, label, value, color }: { href: string; icon: React.ReactNode; label: string; value: React.ReactNode; color: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full [&_svg]:h-4 [&_svg]:w-4" style={{ background: `${color}24`, color }}>{icon}</div>
      <p className="text-xs text-white/45">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </Link>
  )
}

function ProfitTile({ label, profit, expense }: { label: string; profit?: number; expense?: number }) {
  const isLoss = Number(profit || 0) < 0
  return (
    <div className="rounded-2xl border border-[#2f80ff]/20 bg-white/[0.04] p-5 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/40">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${isLoss ? "text-[#ff6b78]" : "text-white"}`}>{money(profit)}</p>
      <p className="mt-3 text-sm font-semibold text-[#ff6b78]">Expense {money(expense)}</p>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/[0.08] p-4 text-center text-sm text-white/35">{text}</div>
}
