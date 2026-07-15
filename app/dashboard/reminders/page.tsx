"use client"

import { useEffect, useMemo, useState } from "react"
import { Bell, Plus, Save, X } from "lucide-react"
import { toast } from "sonner"

type Project = { _id: string; name: string }
type HostedGroup = { chatId: string; title: string }

type Reminder = {
  _id: string
  title: string
  message?: string
  dueAt?: string
  recurrence?: string
  status?: string
  targetChatTitle?: string
}

export default function RemindersPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [groups, setGroups] = useState<HostedGroup[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({
    title: "",
    message: "",
    dueAt: new Date().toISOString().slice(0, 16),
    projectId: "",
    recurrence: "none",
    telegramChatId: "",
  })

  const load = async () => {
    const [projectRes, reminderRes, groupRes] = await Promise.all([
      fetch("/api/ops/projects", { cache: "no-store", credentials: "include" }),
      fetch("/api/ops/reminders", { cache: "no-store", credentials: "include" }),
      fetch("/api/ops/hosted-groups", { cache: "no-store", credentials: "include" }),
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

  const visible = useMemo(
    () => reminders.sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime()),
    [reminders],
  )

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
      body: JSON.stringify({ ...form, deliveryScope: "chat", targetChatTitle: selectedGroup?.title || form.telegramChatId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || "Reminder was not saved")
      return
    }
    toast.success("Reminder added")
    setFormOpen(false)
    setForm({ title: "", message: "", dueAt: new Date().toISOString().slice(0, 16), projectId: "", recurrence: "none", telegramChatId: "" })
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <PageTitle icon={<Bell />} title="Reminders" subtitle={`${visible.filter((item) => item.status !== "done").length} scheduled`} />
        </div>
        <button onClick={() => setFormOpen(true)} className="inline-flex h-14 w-20 shrink-0 items-center justify-center gap-1.5 self-center rounded-xl border border-[#ff4d5e]/20 bg-[#ff4d5e]/10 text-xs font-bold text-[#ff8a95]">
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {formOpen ? (
        <section className="rounded-2xl border border-[#ff4d5e]/20 bg-[#ff4d5e]/[0.055] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Add Reminder</h2>
            <button onClick={() => setFormOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/65"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Reminder title" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ff4d5e]/60" />
            <input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ff4d5e]/60" />
            <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ff4d5e]/60">
              <option value="">No project</option>
              {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
            </select>
            <select value={form.recurrence} onChange={(event) => setForm({ ...form, recurrence: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ff4d5e]/60">
              <option value="none">No repeat</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <select value={form.telegramChatId} onChange={(event) => setForm({ ...form, telegramChatId: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ff4d5e]/60 sm:col-span-2">
              <option value="">Deliver to…</option>
              {groups.map((group) => <option key={group.chatId} value={group.chatId}>{group.title}</option>)}
            </select>
            {!groups.length ? <p className="text-xs text-amber-300/70 sm:col-span-2">Mention the bot in a Telegram group once so it appears here.</p> : null}
            <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Message" className="min-h-20 rounded-lg border border-white/[0.08] bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-[#ff4d5e]/60 sm:col-span-2" />
          </div>
          <button onClick={saveReminder} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff4d5e] px-3 text-sm font-bold text-white">
            <Save className="h-4 w-4" />
            Save Reminder
          </button>
        </section>
      ) : null}

      <div className="space-y-3">
        {visible.map((reminder) => (
          <article key={reminder._id} className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-white">{reminder.title}</h2>
                <p className="mt-1 text-sm text-white/45">
                  {reminder.dueAt ? new Date(reminder.dueAt).toLocaleString() : "No date"}
                  {reminder.recurrence ? ` · ${reminder.recurrence}` : ""}
                  {reminder.targetChatTitle ? ` · → ${reminder.targetChatTitle}` : ""}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${reminder.status === "done" ? "bg-white/10 text-white/45" : "bg-[#ff4d5e]/15 text-[#ff8a95]"}`}>{reminder.status || "scheduled"}</span>
            </div>
            {reminder.message ? <p className="mt-3 line-clamp-3 text-sm text-white/65">{reminder.message}</p> : null}
          </article>
        ))}
        {!visible.length ? <Empty text="No reminders yet" /> : null}
      </div>
    </div>
  )
}

function PageTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex min-h-14 items-center gap-2.5 rounded-xl border border-[#ff4d5e]/20 bg-[#ff4d5e]/[0.06] px-3 py-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-[#ff4d5e]">{icon}<div><h1 className="text-lg font-bold">{title}</h1><p className="text-xs text-white/45">{subtitle}</p></div></div>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/[0.08] p-6 text-center text-sm text-white/40">{text}</div>
}
