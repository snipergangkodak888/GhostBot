"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarDays, Plus, Save, X } from "lucide-react"
import { toast } from "sonner"

type Project = { _id: string; name: string; status: string; owner?: string; launchDate?: string }
type Reminder = { _id: string; title: string; dueAt?: string; status?: string }
type HostedGroup = { chatId: string; title: string }

function localDateTimeInput(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function browserTimeZone() {
  return typeof Intl === "undefined" ? "" : Intl.DateTimeFormat().resolvedOptions().timeZone || ""
}

export default function CalendarPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [groups, setGroups] = useState<HostedGroup[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({
    title: "",
    message: "",
    dueAt: localDateTimeInput(),
    projectId: "",
    telegramChatId: "",
  })

  const load = async () => {
    const [projectRes, reminderRes, groupRes] = await Promise.all([
      fetch("/api/ops/projects", { cache: "no-store" }),
      fetch("/api/ops/reminders", { cache: "no-store" }),
      fetch("/api/ops/hosted-groups", { cache: "no-store" }),
    ])
    const projectData = await projectRes.json().catch(() => [])
    const reminderData = await reminderRes.json().catch(() => [])
    const groupData = await groupRes.json().catch(() => ({ groups: [] }))
    setProjects(Array.isArray(projectData) ? projectData : Array.isArray(projectData?.projects) ? projectData.projects : [])
    setReminders(Array.isArray(reminderData) ? reminderData : Array.isArray(reminderData?.reminders) ? reminderData.reminders : [])
    setGroups(Array.isArray(groupData?.groups) ? groupData.groups : [])
  }

  useEffect(() => {
    load()
  }, [])

  const saveReminder = async () => {
    if (!form.title.trim() && !form.message.trim()) {
      toast.error("Reminder title or message is required")
      return
    }
    if (!form.telegramChatId) {
      toast.error("Select a delivery chat")
      return
    }
    const selectedGroup = groups.find((group) => group.chatId === form.telegramChatId)
    const res = await fetch("/api/ops/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...form, timeZone: browserTimeZone(), deliveryScope: "chat", targetChatTitle: selectedGroup?.title || form.telegramChatId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || "Reminder was not saved")
      return
    }
    toast.success("Reminder added")
    setFormOpen(false)
    setForm({ title: "", message: "", dueAt: localDateTimeInput(), projectId: "", telegramChatId: "" })
    load()
  }

  const events = useMemo(() => {
    const rows = [
      ...projects.filter((project) => project.launchDate).map((project) => ({
        id: `project-${project._id}`,
        date: project.launchDate || "",
        title: project.name,
        meta: project.owner || project.status,
        type: "Launch",
      })),
      ...reminders.filter((reminder) => reminder.dueAt).map((reminder) => ({
        id: `reminder-${reminder._id}`,
        date: reminder.dueAt || "",
        title: reminder.title,
        meta: reminder.status || "scheduled",
        type: "Reminder",
      })),
    ]
    return rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [projects, reminders])

  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <PageTitle icon={<CalendarDays />} title="Calendar" subtitle={`${events.length} upcoming items`} />
        </div>
        <button onClick={() => setFormOpen(true)} className="inline-flex h-14 w-20 shrink-0 items-center justify-center gap-1.5 self-center rounded-xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 text-xs font-bold text-[#ffb36f]">
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {formOpen ? (
        <section className="rounded-2xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/[0.055] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Add Reminder</h2>
            <button onClick={() => setFormOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/65"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Reminder title" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ff8a3d]/60" />
            <label className="space-y-1"><input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="h-10 w-full rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ff8a3d]/60" /><span className="block text-[11px] text-white/40">Your timezone: {browserTimeZone() || "Unknown"}</span></label>
            <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ff8a3d]/60 sm:col-span-2">
              <option value="">No project</option>
              {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
            </select>
            <select value={form.telegramChatId} onChange={(event) => setForm({ ...form, telegramChatId: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ff8a3d]/60 sm:col-span-2">
              <option value="">Deliver to…</option>
              {groups.map((group) => <option key={group.chatId} value={group.chatId}>{group.title}</option>)}
            </select>
            {!groups.length ? <p className="text-xs text-amber-300/70 sm:col-span-2">Mention the bot in a Telegram group once so it appears here.</p> : null}
            <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Message" className="min-h-20 rounded-lg border border-white/[0.08] bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-[#ff8a3d]/60 sm:col-span-2" />
          </div>
          <button onClick={saveReminder} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff8a3d] px-3 text-sm font-bold text-black">
            <Save className="h-4 w-4" />
            Save Reminder
          </button>
        </section>
      ) : null}

      <div className="space-y-3">
        {events.map((event) => (
          <article key={event.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
            <time className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[#ff8a3d]/14 text-center text-xs font-bold text-[#ffb36f]">
              {new Date(event.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </time>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/35">{event.type}</p>
              <h2 className="truncate text-base font-bold text-white">{event.title}</h2>
              <p className="mt-1 truncate text-sm text-white/45">{event.meta}</p>
            </div>
          </article>
        ))}
        {!events.length ? <Empty text="No launches or reminders yet" /> : null}
      </div>
    </div>
  )
}

function PageTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex min-h-14 items-center gap-2.5 rounded-xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/[0.06] px-3 py-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-[#ff8a3d]">{icon}<div><h1 className="text-lg font-bold">{title}</h1><p className="text-xs text-white/45">{subtitle}</p></div></div>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/[0.08] p-6 text-center text-sm text-white/40">{text}</div>
}
