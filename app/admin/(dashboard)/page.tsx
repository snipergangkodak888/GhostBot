"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Bell, CalendarDays, CircleDollarSign, FolderKanban } from "lucide-react"

type Summary = {
  metrics?: {
    activeProjects?: number
    inactiveProjects?: number
    remindersScheduled?: number
    payrollPending?: number
    docs?: number
    revenueToday?: number
    profitThisWeek?: number
  }
  upcomingReminders?: Array<{ _id: string; title: string; dueAt?: string }>
  pendingPayroll?: Array<{ _id: string; member: string; amount: number; currency: string; status: string }>
  projects?: Array<{ _id: string; name: string; status: string; owner?: string; launchDate?: string; notes?: string }>
}

const money = (value?: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0))

const colors = {
  home: "#2f80ff",
  projects: "#ffd43b",
  calendar: "#ff8a3d",
  reminders: "#ff4d5e",
  data: "#a855f7",
  finance: "#42e6a4",
}

export default function AdminHomePage() {
  const [summary, setSummary] = useState<Summary>({})

  const load = async () => {
    try {
      const response = await fetch("/api/ops/summary", { cache: "no-store", credentials: "include" })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data && typeof data === "object" && !Array.isArray(data)) setSummary(data)
    } catch {}
  }

  useEffect(() => {
    load()
  }, [])

  const metrics = summary.metrics || {}
  const activeProjects = useMemo(() => (summary.projects || []).filter((project) => project.status === "active").slice(0, 6), [summary.projects])
  const calendarEvents = useMemo(() => {
    const launches = (summary.projects || [])
      .filter((project) => project.launchDate)
      .map((project) => ({
        id: `project-${project._id}`,
        date: project.launchDate || "",
        type: "Launch",
        title: project.name,
        detail: project.owner || project.status || "Project",
      }))
    const reminders = (summary.upcomingReminders || [])
      .filter((reminder) => reminder.dueAt)
      .map((reminder) => ({
        id: `reminder-${reminder._id}`,
        date: reminder.dueAt || "",
        type: "Reminder",
        title: reminder.title,
        detail: "Team reminder",
      }))
    return [...launches, ...reminders]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 8)
  }, [summary.projects, summary.upcomingReminders])

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<FolderKanban />} label="Active Projects" value={metrics.activeProjects || 0} color={colors.projects} />
        <Metric icon={<Bell />} label="Scheduled Reminders" value={metrics.remindersScheduled || 0} color={colors.reminders} />
        <Metric icon={<CircleDollarSign />} label="Revenue Today" value={money(metrics.revenueToday)} color={colors.finance} />
        <Metric icon={<CircleDollarSign />} label="Profit This Week" value={money(metrics.profitThisWeek)} color={colors.finance} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="Active Projects" href="/admin/projects" icon={<FolderKanban />} color={colors.projects}>
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Owner</th>
                  <th className="px-4 py-3 font-semibold">Launch</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {activeProjects.map((project) => (
                  <tr key={project._id}>
                    <td className="px-4 py-3 font-semibold text-white">{project.name}</td>
                    <td className="px-4 py-3 text-white/55">{project.owner || "Unassigned"}</td>
                    <td className="px-4 py-3 text-white/55">{project.launchDate ? new Date(project.launchDate).toLocaleDateString() : "-"}</td>
                    <td className="px-4 py-3"><span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: `${colors.projects}24`, color: colors.projects }}>{project.status}</span></td>
                  </tr>
                ))}
                {!activeProjects.length ? <tr><td colSpan={4} className="px-4 py-8 text-center text-white/35">No active projects yet</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Next Reminders" href="/admin/reminders" icon={<Bell />} color={colors.reminders}>
            <div className="space-y-2">
              {(summary.upcomingReminders || []).slice(0, 5).map((reminder) => (
                <div key={reminder._id} className="rounded-xl bg-white/[0.04] p-3">
                  <p className="text-sm font-semibold text-white">{reminder.title}</p>
                  <p className="mt-1 text-xs text-white/40">{reminder.dueAt ? new Date(reminder.dueAt).toLocaleString() : "No date"}</p>
                </div>
              ))}
              {!(summary.upcomingReminders || []).length ? <Empty text="No reminders scheduled" /> : null}
            </div>
          </Panel>

          <Panel title="Pending Payroll" href="/admin/payroll" icon={<CircleDollarSign />} color={colors.finance}>
            <div className="space-y-2">
              {(summary.pendingPayroll || []).slice(0, 4).map((row) => (
                <div key={row._id} className="flex items-center justify-between rounded-xl bg-white/[0.04] p-3">
                  <span className="text-sm font-semibold text-white">{row.member}</span>
                  <span className="text-sm font-bold" style={{ color: colors.finance }}>{money(row.amount, row.currency || "USD")}</span>
                </div>
              ))}
              {!(summary.pendingPayroll || []).length ? <Empty text="No pending payroll" /> : null}
            </div>
          </Panel>
        </div>
      </section>

      <Panel title="Calendar" href="/admin/calendar" icon={<CalendarDays />} color={colors.calendar}>
        <div className="grid min-h-32 gap-3 xl:grid-cols-2">
          {calendarEvents.map((event) => (
            <div key={event.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase" style={{ color: colors.calendar }}>{event.type}</p>
                <h3 className="mt-1 font-semibold text-white">{event.title}</h3>
                <p className="mt-1 text-sm text-white/45">{event.detail}</p>
              </div>
              <div className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: `${colors.calendar}40`, background: `${colors.calendar}1a`, color: "#ffb07a" }}>
                {formatDate(event.date)}
              </div>
            </div>
          ))}
          {!calendarEvents.length ? (
            <div className="col-span-full grid min-h-32 place-items-center rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-sm text-white/35">
              No calendar events yet
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return "No date"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString()
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5 backdrop-blur-xl">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5" style={{ background: `${color}24`, color }}>{icon}</div>
      <p className="text-xs font-semibold uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
    </div>
  )
}

function Panel({ title, href, icon, children, color }: { title: string; href: string; icon: React.ReactNode; children: React.ReactNode; color: string }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5 backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-white [&_svg]:h-4 [&_svg]:w-4" style={{ color }}>{icon}<span className="text-white">{title}</span></div>
        <Link href={href} className="text-xs font-bold" style={{ color }}>Open</Link>
      </div>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/[0.08] p-4 text-center text-sm text-white/35">{text}</div>
}
