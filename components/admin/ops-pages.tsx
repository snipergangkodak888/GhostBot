"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bell,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  DollarSign,
  Download,
  Edit2,
  Filter,
  FolderKanban,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { SheetsPanel } from "@/components/admin/sheets-panel"

type Project = {
  _id: string
  name: string
  owner?: string
  referrer?: string
  referrerWallet?: string
  referrerAccountId?: string | null
  referralPercentage?: number
  status: "active" | "inactive" | "in_progress"
  service?: string
  startDate?: string | null
  endDate?: string | null
  currentProfitLoss?: number
  launchDate?: string | null
  revenueToday?: number
  profitThisWeek?: number
  notes?: string
  tags?: string[]
}

type ProjectNote = {
  _id: string
  text: string
  projectId: string
  projectName: string
  authorName?: string
  createdAt?: string
}

type Reminder = {
  _id: string
  title: string
  message?: string
  projectId?: string | null
  dueAt?: string
  recurrence?: "none" | "hourly" | "daily" | "weekly"
  audience?: "team" | "individual"
  status?: "scheduled" | "done"
}

type PayrollRow = {
  _id: string
  member: string
  role?: string
  projectId?: string | null
  project?: string
  amount?: number
  currency?: string
  status?: "pending" | "paid"
  date?: string
  notes?: string
  createdAt?: string
  updatedAt?: string
}

type OpsDoc = {
  _id: string
  title: string
  category?: string
  source?: string
  body?: string
  updatedAt?: string
}

const emptyProject = {
  name: "",
  referrer: "",
  referrerWallet: "",
  referrerAccountId: "",
  referralPercentage: "0",
  status: "active",
  service: "",
  startDate: "",
  endDate: "",
  revenueToday: "0",
  currentProfitLoss: "0",
  tags: "",
  notes: "",
}

const emptyReminder = {
  title: "",
  message: "",
  projectId: "",
  dueAt: "",
  recurrence: "none",
  audience: "team",
  status: "scheduled",
}

const emptyDoc = {
  title: "",
  category: "Ghost Bible",
  source: "manual",
  body: "",
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

const dateLabel = (value?: string | null) => {
  if (!value) return "No date"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString()
}

const projectStatusLabel = (value?: string) => value === "in_progress" ? "In Progress" : value ? value.replace(/\b\w/g, (char) => char.toUpperCase()) : "Active"

const todayKey = () => new Date().toISOString().slice(0, 10)

const emptyPayrollRow = (date = todayKey()): PayrollRow => ({
  _id: "",
  member: "",
  role: "",
  projectId: "",
  project: "",
  amount: 0,
  currency: "USD",
  status: "pending",
  date,
  notes: "",
})

function dateKey(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return todayKey()
  return date.toISOString().slice(0, 10)
}

function displayDate(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", options).format(new Date(`${value}T00:00:00`))
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

function csvCell(value: unknown) {
  const text = String(value ?? "")
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function readJson(res: Response, fallback: any) {
  return res.json().catch(() => fallback)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-white/40">{label}</span>
      {children}
    </label>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-sm text-white outline-none focus:border-[#146efc]/70 ${props.className || ""}`}
    />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#146efc]/70 ${props.className || ""}`}
    />
  )
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-24 w-full resize-y rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-sm text-white outline-none focus:border-[#146efc]/70 ${props.className || ""}`}
    />
  )
}

function IconButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-2.5 text-xs font-semibold text-white transition hover:border-[#146efc]/50 hover:bg-[#146efc]/15 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

function PageTitle({ icon, title, detail, onRefresh, action, color = colors.home }: { icon: React.ReactNode; title: string; detail: string; onRefresh?: () => void; action?: React.ReactNode; color?: string }) {
  return (
    <section className="flex min-h-16 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 backdrop-blur-xl" style={{ borderColor: `${color}33`, background: `${color}0f` }}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg [&_svg]:h-4 [&_svg]:w-4" style={{ background: `${color}24`, color }}>{icon}</span>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-white">{title}</h1>
          <p className="truncate text-xs text-white/45">{detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {action}
        {onRefresh && (
          <IconButton onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </IconButton>
        )}
      </div>
    </section>
  )
}

function SectionBlock({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 backdrop-blur-xl">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {detail ? <p className="mt-1 text-xs text-white/40">{detail}</p> : null}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-8 text-center text-sm text-white/40">{label}</div>
}

export function AdminProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([])
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"projects" | "notes">("projects")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "in_progress">("all")
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedId, setSelectedId] = useState("")
  const [noteText, setNoteText] = useState("")
  const [noteProjectId, setNoteProjectId] = useState("")
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [form, setForm] = useState(emptyProject)
  const [editing, setEditing] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [res, accountRes, noteRes] = await Promise.all([
        fetch("/api/ops/projects", { cache: "no-store", credentials: "include" }),
        fetch("/api/ops/payroll?ledger=1", { cache: "no-store", credentials: "include" }),
        fetch("/api/ops/project-notes", { cache: "no-store", credentials: "include" }),
      ])
      const data = await readJson(res, [])
      const accountData = await readJson(accountRes, {})
      const noteData = await readJson(noteRes, {})
      const nextProjects = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : []
      setProjects(nextProjects)
      setAccounts(Array.isArray(accountData?.accounts) ? accountData.accounts : [])
      setProjectNotes(Array.isArray(noteData?.notes) ? noteData.notes : [])
      setSelectedId((current) => current || nextProjects[0]?._id || "")
      setNoteProjectId((current) => current || nextProjects[0]?._id || "")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const startEdit = (project: Project) => {
    setEditing(project._id)
    setShowForm(true)
    setView("projects")
    setForm({
      name: project.name || "",
      referrer: project.referrer || project.owner || "",
      referrerWallet: project.referrerWallet || "",
      referrerAccountId: project.referrerAccountId || "",
      referralPercentage: String(project.referralPercentage ?? 0),
      status: project.status || "active",
      service: project.service || "",
      startDate: project.startDate ? String(project.startDate).slice(0, 10) : project.launchDate ? String(project.launchDate).slice(0, 10) : "",
      endDate: project.endDate ? String(project.endDate).slice(0, 10) : "",
      revenueToday: String(project.revenueToday || 0),
      currentProfitLoss: String(project.currentProfitLoss ?? project.profitThisWeek ?? 0),
      tags: (project.tags || []).join(", "),
      notes: project.notes || "",
    })
  }

  const reset = () => {
    setEditing(null)
    setForm(emptyProject)
    setShowForm(false)
  }

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Project name is required")
      return
    }
    const payload = {
      ...form,
      revenueToday: Number(form.revenueToday || 0),
      currentProfitLoss: Number(form.currentProfitLoss || 0),
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    }
    const url = editing ? `/api/ops/projects/${editing}` : "/api/ops/projects"
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      toast.error("Project was not saved")
      return
    }
    toast.success(editing ? "Project updated" : "Project created")
    reset()
    load()
  }

  const remove = async (id: string) => {
    if (!confirm("Delete this project?")) return
    const res = await fetch(`/api/ops/projects/${id}`, { method: "DELETE", credentials: "include" })
    if (!res.ok) {
      toast.error("Project was not deleted")
      return
    }
    setProjects((rows) => rows.filter((row) => row._id !== id))
    setSelectedId((current) => current === id ? "" : current)
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return projects
      .filter((project) => statusFilter === "all" || project.status === statusFilter)
      .filter((project) => !term || `${project.name} ${project.referrer || ""} ${project.referrerWallet || ""} ${project.service || ""} ${project.notes || ""} ${(project.tags || []).join(" ")}`.toLowerCase().includes(term))
      .sort((a, b) => {
        const rank = (status?: string) => status === "active" ? 0 : status === "in_progress" ? 1 : 2
        return rank(a.status) - rank(b.status)
      })
  }, [projects, query, statusFilter])

  const visibleNotes = useMemo(() => {
    const term = query.trim().toLowerCase()
    return projectNotes.filter((note) =>
      (!selectedId || note.projectId === selectedId) &&
      (!term || `${note.text} ${note.projectName} ${note.authorName || ""}`.toLowerCase().includes(term))
    )
  }, [projectNotes, query, selectedId])

  const handleAdd = () => {
    if (view === "notes") {
      setNoteProjectId(selectedId || projects[0]?._id || "")
      setShowNoteForm(true)
      return
    }
    setEditing(null)
    setForm(emptyProject)
    setShowForm(true)
    setView("projects")
  }

  const saveNote = async () => {
    if (!noteProjectId || !noteText.trim()) {
      toast.error("Choose a project and write a note")
      return
    }
    const res = await fetch("/api/ops/project-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ projectId: noteProjectId, text: noteText, authorName: "Admin" }),
    })
    if (!res.ok) {
      toast.error("Note was not posted")
      return
    }
    setNoteText("")
    setShowNoteForm(false)
    setSelectedId(noteProjectId)
    toast.success("Note posted")
    load()
  }

  return (
    <div className="space-y-5">
      <PageTitle
        icon={<FolderKanban className="h-5 w-5" />}
        title="Projects"
        detail="Create projects, track service, referrer, timing, status, and current P/L."
        onRefresh={load}
        color={colors.projects}
        action={<IconButton onClick={handleAdd} className="border-[#ffd43b]/50 bg-[#ffd43b] text-black hover:bg-[#ffd43b]/90"><Plus className="h-4 w-4" />Add</IconButton>}
      />
      {showForm ? <SectionBlock title={editing ? "Edit Project" : "Add Project"} detail="Project identity, referrer, service, timing, status, and current P/L.">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div>
            <h3 className="text-base font-bold text-white">{editing ? "Update project details" : "Create a new project"}</h3>
            <p className="mt-1 text-xs text-white/40">Use the same structure the app and AI read from.</p>
          </div>
          <IconButton onClick={reset}><X className="h-4 w-4" />Close</IconButton>
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Project name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Project name" /></Field>
            <Field label="Service"><Input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder="TGE + MM, MM, etc." /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Referrer"><Select value={form.referrerAccountId} onChange={(e) => {
              const account = accounts.find((item) => String(item._id || item.id) === e.target.value)
              setForm({ ...form, referrerAccountId: e.target.value, referrer: account?.name || "", referrerWallet: account?.wallet || account?.source || form.referrerWallet })
            }}><option value="">No referrer</option>{accounts.filter((account) => account.type === "REFERRER").map((account) => <option key={String(account._id || account.id)} value={String(account._id || account.id)}>{account.name}</option>)}</Select></Field>
            <Field label="Referrer Wallet"><Input value={form.referrerWallet} onChange={(e) => setForm({ ...form, referrerWallet: e.target.value })} placeholder="Optional wallet address" /></Field>
            <Field label="Referrer %"><Input type="number" min="0" max="100" value={form.referralPercentage} onChange={(e) => setForm({ ...form, referralPercentage: e.target.value })} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="in_progress">In Progress</option><option value="inactive">Inactive</option></Select></Field>
            <Field label="Start date"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="End date"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            <Field label="Current Profit / Loss"><Input type="number" value={form.currentProfitLoss} onChange={(e) => setForm({ ...form, currentProfitLoss: e.target.value })} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-1">
            <Field label="Revenue today"><Input type="number" value={form.revenueToday} onChange={(e) => setForm({ ...form, revenueToday: e.target.value })} /></Field>
          </div>
          <Field label="Tags"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="trading, launch, payroll" /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Project notes" /></Field>
        </div>
        <div className="mt-4 flex justify-end">
          <IconButton onClick={save} className="border-[#ffd43b]/50 bg-[#ffd43b] text-black hover:bg-[#ffd43b]/90">
            {editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editing ? "Save Project" : "Add Project"}
          </IconButton>
        </div>
      </SectionBlock> : null}
      <div className="grid grid-cols-2 rounded-2xl border border-[#ffd43b]/20 bg-black/45 p-1">
        <button onClick={() => setView("projects")} className={`h-10 rounded-xl text-sm font-bold transition ${view === "projects" ? "bg-[#ffd43b]/15 text-[#ffd43b]" : "text-white/45"}`}>Projects</button>
        <button onClick={() => { setView("notes"); setSelectedId("") }} className={`h-10 rounded-xl text-sm font-bold transition ${view === "notes" ? "bg-[#ffd43b]/15 text-[#ffd43b]" : "text-white/45"}`}>Notes</button>
      </div>

      <div className="relative flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#ffd43b]" />
          <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={view === "notes" ? "Search notes" : "Search projects"} />
        </div>
        {view === "projects" ? <IconButton onClick={() => setFilterOpen((current) => !current)} className="border-[#ffd43b]/30 bg-[#ffd43b]/10 text-[#ffe066]"><Filter className="h-4 w-4" />Filter</IconButton> : null}
        {filterOpen && view === "projects" ? <div className="absolute right-0 top-12 z-20 w-44 rounded-xl border border-white/[0.1] bg-[#111214] p-1.5 shadow-2xl">
          {([["all", "All Projects"], ["active", "Active"], ["in_progress", "In Progress"], ["inactive", "Inactive"]] as const).map(([value, label]) => (
            <button key={value} onClick={() => { setStatusFilter(value); setFilterOpen(false) }} className={`block h-9 w-full rounded-lg px-3 text-left text-xs font-semibold ${statusFilter === value ? "bg-[#ffd43b]/15 text-[#ffe066]" : "text-white/60 hover:bg-white/[0.05]"}`}>{label}</button>
          ))}
        </div> : null}
      </div>

      {view === "projects" ? <SectionBlock title="Project List" detail="All operational projects ordered from latest updates.">
        {loading ? <EmptyState label="Loading projects..." /> : filtered.length === 0 ? <EmptyState label="No projects yet" /> : (
          <div className="grid gap-3 xl:grid-cols-2">
            {filtered.map((project) => (
              <article key={project._id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-white">{project.name}</h3>
                    <p className="mt-1 text-sm text-white/45">{project.service || "No service"} - {dateLabel(project.startDate || project.launchDate)}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${project.status === "active" ? "bg-[#ffd43b]/18 text-[#ffd43b]" : project.status === "in_progress" ? "bg-blue-500/15 text-blue-200" : "bg-white/10 text-white/45"}`}>{projectStatusLabel(project.status)}</span>
                </div>
                {project.notes ? <p className="mt-3 line-clamp-2 text-sm text-white/60">{project.notes}</p> : null}
                <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-white/[0.08] bg-black/25 p-3">
                    <p className="text-xs uppercase text-white/40">Referrer</p>
                    <p className="mt-1 truncate font-bold text-white">{project.referrer || "None"}</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-black/25 p-3">
                    <p className="text-xs uppercase text-white/40">End</p>
                    <p className="mt-1 font-bold text-white">{dateLabel(project.endDate)}</p>
                  </div>
                  <div className="rounded-lg border border-[#42e6a4]/20 bg-[#42e6a4]/10 p-3">
                    <p className="text-xs uppercase text-white/40">Revenue</p>
                    <p className="mt-1 font-bold text-[#42e6a4]">{money(project.revenueToday)}</p>
                  </div>
                  <div className="rounded-lg border border-[#42e6a4]/20 bg-[#42e6a4]/10 p-3">
                    <p className="text-xs uppercase text-white/40">Profit / Loss</p>
                    <p className={`mt-1 font-bold ${Number(project.currentProfitLoss ?? project.profitThisWeek ?? 0) >= 0 ? "text-[#42e6a4]" : "text-red-300"}`}>{money(project.currentProfitLoss ?? project.profitThisWeek)}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <IconButton onClick={() => { setSelectedId(project._id); setView("notes") }} className="border-[#ffd43b]/30 bg-[#ffd43b]/10 px-3 text-[#ffe066]"><MessageSquareText className="h-4 w-4" />Notes</IconButton>
                  <IconButton onClick={() => startEdit(project)} className="px-3"><Edit2 className="h-4 w-4" />Edit</IconButton>
                  <IconButton onClick={() => remove(project._id)} className="px-3 text-red-300"><Trash2 className="h-4 w-4" />Remove</IconButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionBlock> : (
        <SectionBlock title="Project Notes" detail="Newest trader updates appear first. Filter the feed by project.">
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setSelectedId("")} className={`h-9 shrink-0 rounded-full border px-3 text-xs font-bold ${!selectedId ? "border-[#ffd43b]/40 bg-[#ffd43b]/15 text-[#ffe066]" : "border-white/[0.08] text-white/50"}`}>All Projects</button>
            {projects.map((project) => <button key={project._id} onClick={() => setSelectedId(project._id)} className={`h-9 shrink-0 rounded-full border px-3 text-xs font-bold ${selectedId === project._id ? "border-[#ffd43b]/40 bg-[#ffd43b]/15 text-[#ffe066]" : "border-white/[0.08] text-white/50"}`}>{project.name}</button>)}
          </div>
          {showNoteForm ? <div className="mb-4 rounded-xl border border-[#ffd43b]/20 bg-[#ffd43b]/[0.05] p-4">
            <div className="grid gap-3 md:grid-cols-[240px_1fr_auto]">
              <Select value={noteProjectId} onChange={(e) => setNoteProjectId(e.target.value)}><option value="">Choose project</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}</Select>
              <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="What did the trader update?" />
              <IconButton onClick={saveNote} className="border-[#ffd43b]/50 bg-[#ffd43b] text-black"><MessageSquareText className="h-4 w-4" />Post</IconButton>
            </div>
          </div> : null}
          <div className="space-y-3">
            {visibleNotes.map((note) => <article key={note._id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white">{note.authorName || "Team member"}</span>
                <button onClick={() => setSelectedId(note.projectId)} className="text-xs font-bold text-[#ffe066]">{note.projectName}</button>
                <span className="text-xs text-white/35">{note.createdAt ? new Date(note.createdAt).toLocaleString() : ""}</span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/70">{note.text}</p>
            </article>)}
            {!visibleNotes.length ? <EmptyState label="No project notes yet" /> : null}
          </div>
        </SectionBlock>
      )}
    </div>
  )
}

export function AdminRemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [form, setForm] = useState(emptyReminder)
  const [editing, setEditing] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [reminderRes, projectRes] = await Promise.all([
        fetch("/api/ops/reminders", { cache: "no-store", credentials: "include" }),
        fetch("/api/ops/projects", { cache: "no-store", credentials: "include" }),
      ])
      const reminderData = await readJson(reminderRes, [])
      const projectData = await readJson(projectRes, [])
      setReminders(Array.isArray(reminderData) ? reminderData : [])
      setProjects(Array.isArray(projectData) ? projectData : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const reset = () => {
    setEditing(null)
    setForm(emptyReminder)
    setShowForm(false)
  }

  const startEdit = (reminder: Reminder) => {
    setEditing(reminder._id)
    setShowForm(true)
    setForm({
      title: reminder.title || "",
      message: reminder.message || "",
      projectId: reminder.projectId || "",
      dueAt: reminder.dueAt ? String(reminder.dueAt).slice(0, 16) : "",
      recurrence: reminder.recurrence || "none",
      audience: reminder.audience || "team",
      status: reminder.status || "scheduled",
    })
  }

  const save = async () => {
    if (!form.title.trim()) {
      toast.error("Reminder title is required")
      return
    }
    const url = editing ? `/api/ops/reminders/${editing}` : "/api/ops/reminders"
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      toast.error("Reminder was not saved")
      return
    }
    toast.success(editing ? "Reminder updated" : "Reminder scheduled")
    reset()
    load()
  }

  const remove = async (id: string) => {
    if (!confirm("Delete this reminder?")) return
    const res = await fetch(`/api/ops/reminders/${id}`, { method: "DELETE", credentials: "include" })
    if (!res.ok) {
      toast.error("Reminder was not deleted")
      return
    }
    setReminders((rows) => rows.filter((row) => row._id !== id))
  }

  return (
    <div className="space-y-5">
      <PageTitle
        icon={<Bell className="h-5 w-5" />}
        title="Reminders"
        detail="Schedule team reminders that sync to bot delivery workflows."
        onRefresh={load}
        color={colors.reminders}
        action={<IconButton onClick={() => { setEditing(null); setForm(emptyReminder); setShowForm(true) }} className="border-[#ff4d5e]/50 bg-[#ff4d5e] hover:bg-[#ff4d5e]/90"><Plus className="h-4 w-4" />Add</IconButton>}
      />
      {showForm ? <SectionBlock title={editing ? "Edit Reminder" : "Add Reminder"} detail="Reminder timing, recurrence, audience, project assignment, and message.">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span />
          <IconButton onClick={reset}><X className="h-4 w-4" />Close</IconButton>
        </div>
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-4"><Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field></div>
          <div className="lg:col-span-3"><Field label="Project"><Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">No project</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}</Select></Field></div>
          <div className="lg:col-span-3"><Field label="Due"><Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field></div>
          <div className="lg:col-span-2"><Field label="Repeat"><Select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}><option value="none">None</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option></Select></Field></div>
          <div className="lg:col-span-2"><Field label="Audience"><Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}><option value="team">Team</option><option value="individual">Individual</option></Select></Field></div>
          <div className="lg:col-span-2"><Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="scheduled">Scheduled</option><option value="done">Done</option></Select></Field></div>
          <div className="lg:col-span-8"><Field label="Message"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field></div>
        </div>
        <div className="mt-4 flex justify-end">
          <IconButton onClick={save} className="border-[#ff4d5e]/50 bg-[#ff4d5e] hover:bg-[#ff4d5e]/90">
            {editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editing ? "Save Reminder" : "Schedule Reminder"}
          </IconButton>
        </div>
      </SectionBlock> : null}
      <SectionBlock title="Reminder List" detail="Scheduled and completed reminders.">
        {loading ? <EmptyState label="Loading reminders..." /> : reminders.length === 0 ? <EmptyState label="No reminders yet" /> : (
          <div className="grid gap-3 xl:grid-cols-2">
            {reminders.map((reminder) => (
              <div key={reminder._id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{reminder.title}</h3>
                    <p className="mt-1 text-xs text-white/40">{dateLabel(reminder.dueAt)} - {reminder.recurrence || "none"} - {reminder.audience || "team"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${reminder.status === "done" ? "bg-white/10 text-white/45" : "bg-[#ff4d5e]/18 text-[#ff7a86]"}`}>{reminder.status || "scheduled"}</span>
                </div>
                <p className="mt-3 text-sm text-white/60">{reminder.message || "No message"}</p>
                <div className="mt-4 flex justify-end gap-2">
                  <IconButton onClick={() => startEdit(reminder)} className="px-2"><Edit2 className="h-4 w-4" /></IconButton>
                  <IconButton onClick={() => remove(reminder._id)} className="px-2 text-red-300"><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionBlock>
    </div>
  )
}

export function AdminCalendarPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [form, setForm] = useState(emptyReminder)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [projectRes, reminderRes] = await Promise.all([
        fetch("/api/ops/projects", { cache: "no-store", credentials: "include" }),
        fetch("/api/ops/reminders", { cache: "no-store", credentials: "include" }),
      ])
      const projectData = await readJson(projectRes, [])
      const reminderData = await readJson(reminderRes, [])
      setProjects(Array.isArray(projectData) ? projectData : [])
      setReminders(Array.isArray(reminderData) ? reminderData : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const saveReminder = async () => {
    if (!form.title.trim()) {
      toast.error("Reminder title is required")
      return
    }
    const res = await fetch("/api/ops/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      toast.error("Reminder was not saved")
      return
    }
    toast.success("Reminder scheduled")
    setForm(emptyReminder)
    setShowForm(false)
    load()
  }

  const events = useMemo(() => {
    const rows = [
      ...projects.filter((project) => project.launchDate).map((project) => ({
        id: `project-${project._id}`,
        date: project.launchDate || "",
        type: "Launch",
        title: project.name,
        detail: project.service || project.referrer || "Project",
      })),
      ...reminders.filter((reminder) => reminder.dueAt).map((reminder) => ({
        id: `reminder-${reminder._id}`,
        date: reminder.dueAt || "",
        type: "Reminder",
        title: reminder.title,
        detail: reminder.message || reminder.recurrence || "Team reminder",
      })),
    ]
    return rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [projects, reminders])

  return (
    <div className="space-y-5">
      <PageTitle
        icon={<CalendarDays className="h-5 w-5" />}
        title="Calendar"
        detail="One schedule for project launches and team reminders."
        onRefresh={load}
        color={colors.calendar}
        action={<IconButton onClick={() => setShowForm(true)} className="border-[#ff8a3d]/50 bg-[#ff8a3d] text-black hover:bg-[#ff8a3d]/90"><Plus className="h-4 w-4" />Add</IconButton>}
      />
      {showForm ? <SectionBlock title="Add Calendar Reminder" detail="Create a reminder that appears in the calendar timeline.">
        <div className="mb-4 flex justify-end">
          <IconButton onClick={() => { setShowForm(false); setForm(emptyReminder) }}><X className="h-4 w-4" />Close</IconButton>
        </div>
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-4"><Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field></div>
          <div className="lg:col-span-3"><Field label="Project"><Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">No project</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}</Select></Field></div>
          <div className="lg:col-span-3"><Field label="Due"><Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field></div>
          <div className="lg:col-span-2"><Field label="Repeat"><Select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}><option value="none">None</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option></Select></Field></div>
          <div className="lg:col-span-12"><Field label="Message"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field></div>
        </div>
        <div className="mt-4 flex justify-end">
          <IconButton onClick={saveReminder} className="border-[#ff8a3d]/50 bg-[#ff8a3d] text-black hover:bg-[#ff8a3d]/90"><Save className="h-4 w-4" />Save Reminder</IconButton>
        </div>
      </SectionBlock> : null}
      <SectionBlock title="Calendar Timeline" detail="Project launches and reminders ordered by date.">
        {loading ? <EmptyState label="Loading calendar..." /> : events.length === 0 ? <EmptyState label="No calendar events yet" /> : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#ffb07a]">{event.type}</p>
                  <h3 className="mt-1 font-semibold text-white">{event.title}</h3>
                  <p className="mt-1 text-sm text-white/45">{event.detail}</p>
                </div>
                <div className="rounded-lg border border-[#ff8a3d]/25 bg-[#ff8a3d]/10 px-3 py-2 text-sm font-semibold text-[#ffb07a]">{dateLabel(event.date)}</div>
              </div>
            ))}
          </div>
        )}
      </SectionBlock>
    </div>
  )
}

export function AdminPayrollPage() {
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<"overview" | "employees" | "entry">("overview")
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [entries, setEntries] = useState<PayrollRow[]>([emptyPayrollRow(todayKey())])
  const [notes, setNotes] = useState("")
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFrom, setExportFrom] = useState(`${todayKey().slice(0, 8)}01`)
  const [exportTo, setExportTo] = useState(todayKey())

  const load = async () => {
    setLoading(true)
    try {
      const [payrollRes, projectRes] = await Promise.all([
        fetch("/api/ops/payroll", { cache: "no-store", credentials: "include" }),
        fetch("/api/ops/projects", { cache: "no-store", credentials: "include" }),
      ])
      const data = await readJson(payrollRes, [])
      const projectData = await readJson(projectRes, [])
      setRows(Array.isArray(data) ? data : [])
      setProjects(Array.isArray(projectData) ? projectData : Array.isArray(projectData?.projects) ? projectData.projects : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const rowsWithDates = useMemo(
    () => rows.map((row) => ({ ...row, date: row.date || dateKey(row.createdAt || row.updatedAt) })),
    [rows],
  )

  const monthRows = useMemo(
    () => rowsWithDates.filter((row) => String(row.date || "").startsWith(monthKey(selectedMonth))),
    [rowsWithDates, selectedMonth],
  )

  const dailyRows = useMemo(() => {
    const result = new Map<string, PayrollRow[]>()
    for (const row of monthRows) {
      const key = dateKey(row.date)
      result.set(key, [...(result.get(key) || []), row])
    }
    return result
  }, [monthRows])

  const monthStats = useMemo(() => {
    const paidRows = monthRows.filter((row) => row.status === "paid")
    const pendingRows = monthRows.filter((row) => row.status !== "paid")
    const paidDays = new Set(paidRows.map((row) => dateKey(row.date))).size
    const total = paidRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const pending = pendingRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    return {
      total,
      pending,
      paidDays,
      average: paidDays ? total / paidDays : 0,
      pendingDays: new Set(pendingRows.map((row) => dateKey(row.date))).size,
    }
  }, [monthRows])

  const employeeRows = useMemo(() => {
    const map = new Map<string, { member: string; paid: number; pending: number; rows: number }>()
    for (const row of monthRows) {
      const key = row.member || "Unnamed"
      const current = map.get(key) || { member: key, paid: 0, pending: 0, rows: 0 }
      if (row.status === "paid") current.paid += Number(row.amount || 0)
      else current.pending += Number(row.amount || 0)
      current.rows += 1
      map.set(key, current)
    }
    return Array.from(map.values()).sort((a, b) => b.paid + b.pending - (a.paid + a.pending))
  }, [monthRows])

  const monthDays = useMemo(() => {
    const count = daysInMonth(selectedMonth)
    return Array.from({ length: count }, (_, index) => {
      const day = count - index
      return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    })
  }, [selectedMonth])

  const openEntry = (date: string) => {
    const source = rowsWithDates.filter((row) => dateKey(row.date) === date)
    setSelectedDate(date)
    setEntries(source.length ? source.map((row) => ({ ...row, date })) : [emptyPayrollRow(date)])
    setNotes(source.find((row) => row.notes)?.notes || "")
    setTab("entry")
  }

  const loadTemplate = () => {
    const members = Array.from(new Set(rowsWithDates.map((row) => row.member).filter(Boolean)))
    if (!members.length) {
      setEntries([emptyPayrollRow(selectedDate)])
      toast.message("No previous team members yet")
      return
    }
    setEntries(members.map((member) => ({ ...emptyPayrollRow(selectedDate), member })))
  }

  const updateEntry = (index: number, patch: Partial<PayrollRow>) => {
    setEntries((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const removeEntry = async (index: number) => {
    const row = entries[index]
    if (row?._id) {
      const res = await fetch(`/api/ops/payroll/${row._id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        toast.error("Payroll row was not removed")
        return
      }
      await load()
    }
    setEntries((current) => current.length === 1 ? [emptyPayrollRow(selectedDate)] : current.filter((_, rowIndex) => rowIndex !== index))
  }

  const saveDay = async () => {
    const cleanRows = entries.filter((row) => row.member.trim())
    if (!cleanRows.length) {
      toast.error("Add at least one team member")
      return
    }
    setSaving(true)
    try {
      for (const row of cleanRows) {
        const project = projects.find((item) => item._id === row.projectId)
        const payload = {
          member: row.member,
          role: row.role || "",
          projectId: row.projectId || null,
          project: project?.name || row.project || "",
          amount: Number(row.amount || 0),
          currency: row.currency || "USD",
          status: row.status || "pending",
          date: selectedDate,
          notes,
        }
        const res = await fetch(row._id ? `/api/ops/payroll/${row._id}` : "/api/ops/payroll", {
          method: row._id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        })
        const data = await readJson(res, {})
        if (!res.ok) {
          toast.error(data.error || "Payroll was not saved")
          return
        }
      }
      toast.success("Payroll day saved")
      await load()
      setTab("overview")
    } finally {
      setSaving(false)
    }
  }

  const shiftMonth = (direction: -1 | 1) => {
    setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1))
  }

  const exportPayroll = () => {
    if (!exportFrom || !exportTo) {
      toast.error("Choose from and to dates")
      return
    }
    const from = exportFrom <= exportTo ? exportFrom : exportTo
    const to = exportFrom <= exportTo ? exportTo : exportFrom
    const exported = rowsWithDates.filter((row) => {
      const key = dateKey(row.date)
      return key >= from && key <= to
    })
    if (!exported.length) {
      toast.error("No payroll rows in this range")
      return
    }
    downloadCsv(`payroll_${from}_to_${to}.csv`, [
      ["Payroll", from, to],
      [],
      ["Date", "Member", "Status", "Amount", "Currency", "Role", "Project", "Notes"],
      ...exported.map((row) => [
        dateKey(row.date),
        row.member,
        row.status,
        row.amount,
        row.currency || "USD",
        row.role || "",
        row.project || "",
        row.notes || "",
      ]),
    ])
    toast.success("Payroll export downloaded")
    setExportOpen(false)
  }

  return (
    <div className="space-y-5">
      <PageTitle
        icon={<DollarSign className="h-5 w-5" />}
        title="Payroll"
        detail="Daily payroll overview, entries, templates, and project-assigned rows."
        onRefresh={load}
        color={colors.finance}
        action={<IconButton onClick={() => setExportOpen((current) => !current)} className="border-[#42e6a4]/40 bg-[#42e6a4]/10 text-[#b8ffe1] hover:bg-[#42e6a4]/15">{exportOpen ? <X className="h-4 w-4" /> : <Download className="h-4 w-4" />}{exportOpen ? "Close" : "Export"}</IconButton>}
      />

      {exportOpen ? (
        <SectionBlock title="Export Payroll" detail="Choose a date range and download a sheet-style CSV file.">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="From"><Input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} /></Field>
            <IconButton onClick={exportPayroll} className="self-end border-[#42e6a4]/50 bg-[#1f8f66] hover:bg-[#1f8f66]/90"><Download className="h-4 w-4" />Download</IconButton>
          </div>
        </SectionBlock>
      ) : null}

      <div className="grid grid-cols-3 rounded-2xl border border-[#42e6a4]/20 bg-black/45 p-1">
        {(["overview", "employees", "entry"] as const).map((item) => (
          <button key={item} onClick={() => item === "entry" ? openEntry(todayKey()) : setTab(item)} className={`h-10 rounded-xl text-sm font-bold capitalize transition ${tab === item ? "bg-[#42e6a4]/15 text-[#42e6a4]" : "text-white/45"}`}>{item}</button>
        ))}
      </div>

      {tab !== "entry" ? (
        <section className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <IconButton onClick={() => shiftMonth(-1)} className="h-10 w-10 px-0"><ChevronLeft className="h-5 w-5" /></IconButton>
          <div className="flex items-center gap-2 text-lg font-bold text-white"><CalendarDays className="h-5 w-5 text-[#42e6a4]" />{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(selectedMonth)}</div>
          <IconButton onClick={() => shiftMonth(1)} className="h-10 w-10 px-0"><ChevronRight className="h-5 w-5" /></IconButton>
        </section>
      ) : null}

      {tab === "overview" ? (
        <>
          <section className="grid gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 md:grid-cols-3">
            <AdminPayrollStat label="Total Payroll" value={money(monthStats.total)} hint="This month" />
            <AdminPayrollStat label="Days Paid" value={String(monthStats.paidDays)} hint={`of ${daysInMonth(selectedMonth)}`} />
            <AdminPayrollStat label="Average / Day" value={money(monthStats.average)} hint="Per paid day" />
          </section>
          <SectionBlock title="Daily Payroll" detail={`${monthStats.paidDays} paid days - ${monthStats.pendingDays} pending days`}>
            {loading ? <EmptyState label="Loading payroll..." /> : null}
            {!loading && monthDays.map((day) => {
              const dayRows = dailyRows.get(day) || []
              const total = dayRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
              const paid = dayRows.length > 0 && dayRows.every((row) => row.status === "paid")
              const pending = dayRows.some((row) => row.status !== "paid")
              return (
                <button key={day} onClick={() => openEntry(day)} className="flex w-full items-center gap-3 border-b border-white/[0.06] py-3 text-left last:border-0">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-bold ${dayRows.length ? "bg-[#42e6a4]/14 text-[#42e6a4]" : "bg-white/[0.06] text-white/50"}`}>{Number(day.slice(-2))}</span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold text-white">{displayDate(day)}</span><span className={`mt-0.5 block text-sm ${dayRows.length ? "text-[#42e6a4]" : "text-white/35"}`}>{dayRows.length ? money(total) : "-"}</span></span>
                  <span className={`text-sm font-semibold ${paid ? "text-[#42e6a4]" : pending ? "text-[#ffd166]" : "text-white/35"}`}>{paid ? "Paid" : pending ? "Pending" : "Open"}</span>
                  <ChevronRight className="h-5 w-5 text-white/55" />
                </button>
              )
            })}
          </SectionBlock>
        </>
      ) : null}

      {tab === "employees" ? (
        <SectionBlock title="Employees" detail="Monthly payroll totals by member.">
          {!employeeRows.length ? <EmptyState label="No employee payroll yet" /> : null}
          {employeeRows.map((employee) => (
            <article key={employee.member} className="flex items-center justify-between border-b border-white/[0.06] py-4 last:border-0">
              <div><h3 className="font-bold text-white">{employee.member}</h3><p className="mt-1 text-sm text-white/40">{employee.rows} rows this month</p></div>
              <div className="text-right"><p className="font-bold text-[#42e6a4]">{money(employee.paid)}</p><p className="mt-1 text-xs text-[#ffd166]">{money(employee.pending)} pending</p></div>
            </article>
          ))}
        </SectionBlock>
      ) : null}

      {tab === "entry" ? (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <IconButton onClick={() => setTab("overview")} className="h-10 w-10 rounded-full px-0"><ChevronLeft className="h-5 w-5" /></IconButton>
            <div className="min-w-0 flex-1"><h2 className="text-xl font-bold text-white">Daily Payroll Entry</h2><p className="text-sm text-white/40">Enter and save payroll information for one day.</p></div>
            <button onClick={saveDay} disabled={saving} className="text-sm font-bold text-[#42e6a4] disabled:opacity-50">Save Draft</button>
          </div>
          <div className="grid gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end">
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-[#42e6a4]/20 bg-[#42e6a4]/10 text-[#42e6a4]">
              <CalendarDays className="h-5 w-5" />
            </div>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white/40">Date</span>
              <Input type="date" value={selectedDate} onChange={(e) => openEntry(e.target.value)} />
              <span className="mt-1 block text-xs text-white/35">{displayDate(selectedDate, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</span>
            </label>
            <IconButton onClick={loadTemplate} className="h-10 border-[#42e6a4]/30 bg-[#42e6a4]/10 text-[#b8ffe1] hover:bg-[#42e6a4]/15">Load Template</IconButton>
          </div>
          <SectionBlock title="Team Payroll">
            <div className="mb-3 flex justify-end">
              <IconButton onClick={() => setEntries((current) => [...current, emptyPayrollRow(selectedDate)])} className="border-[#42e6a4]/30 bg-[#42e6a4]/10 text-[#42e6a4] hover:bg-[#42e6a4]/15"><Plus className="h-4 w-4" />Row</IconButton>
            </div>
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <div key={`${entry._id || "new"}-${index}`} className="grid gap-2 xl:grid-cols-[1fr_1fr_140px_120px_80px_40px]">
                  <Input value={entry.member} onChange={(e) => updateEntry(index, { member: e.target.value })} placeholder="Member" />
                  <Select value={entry.projectId || ""} onChange={(e) => { const project = projects.find((item) => item._id === e.target.value); updateEntry(index, { projectId: e.target.value, project: project?.name || "" }) }}><option value="">No project</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}</Select>
                  <Select value={entry.status || "pending"} onChange={(e) => updateEntry(index, { status: e.target.value as PayrollRow["status"] })}><option value="pending">Pending</option><option value="paid">Paid</option></Select>
                  <Input type="number" value={entry.amount || ""} onChange={(e) => updateEntry(index, { amount: Number(e.target.value || 0) })} placeholder="$0" />
                  <Input value={entry.currency || "USD"} onChange={(e) => updateEntry(index, { currency: e.target.value })} />
                  <IconButton onClick={() => removeEntry(index)} className="h-10 w-10 px-0 text-red-300"><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              ))}
            </div>
          </SectionBlock>
          <div className="grid gap-3 md:grid-cols-3">
            <AdminPayrollStat label="Total Expense" value={money(entries.reduce((sum, row) => sum + Number(row.amount || 0), 0))} hint="Current day" danger />
            <AdminPayrollStat label="Rows" value={String(entries.filter((row) => row.member.trim()).length)} hint="Filled rows" />
            <AdminPayrollStat label="Paid Rows" value={String(entries.filter((row) => row.status === "paid" && row.member.trim()).length)} hint="Marked paid" />
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes about today's payroll..." />
          <IconButton onClick={saveDay} disabled={saving} className="h-12 w-full rounded-2xl border-[#42e6a4]/50 bg-[#1f8f66] hover:bg-[#1f8f66]/90"><Save className="h-5 w-5" />Save Day</IconButton>
          <p className="text-center text-xs text-white/35">All changes will be saved for {displayDate(selectedDate)}</p>
        </section>
      ) : null}
    </div>
  )
}

function AdminPayrollStat({ label, value, hint, danger = false }: { label: string; value: string; hint: string; danger?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
      <p className="text-xs font-semibold uppercase text-white/40">{label}</p>
      <p className={`mt-2 truncate text-2xl font-bold ${danger ? "text-[#ff6b78]" : "text-white"}`}>{value}</p>
      <p className="mt-1 text-xs text-white/35">{hint}</p>
    </div>
  )
}

export function AdminDataPage() {
  const [docs, setDocs] = useState<OpsDoc[]>([])
  const [query, setQuery] = useState("")
  const [form, setForm] = useState(emptyDoc)
  const [editing, setEditing] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async (q = query) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/docs${q ? `?q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store", credentials: "include" })
      const data = await readJson(res, [])
      setDocs(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load("")
  }, [])

  const reset = () => {
    setEditing(null)
    setForm(emptyDoc)
    setShowForm(false)
  }

  const startEdit = (doc: OpsDoc) => {
    setEditing(doc._id)
    setShowForm(true)
    setForm({
      title: doc.title || "",
      category: doc.category || "Ghost Bible",
      source: doc.source || "manual",
      body: doc.body || "",
    })
  }

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error("Title and body are required")
      return
    }
    const url = editing ? `/api/ops/docs/${editing}` : "/api/ops/docs"
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      toast.error("Document was not saved")
      return
    }
    toast.success(editing ? "Document updated" : "Document created")
    reset()
    load()
  }

  const remove = async (id: string) => {
    if (!confirm("Delete this document?")) return
    const res = await fetch(`/api/ops/docs/${id}`, { method: "DELETE", credentials: "include" })
    if (!res.ok) {
      toast.error("Document was not deleted")
      return
    }
    setDocs((rows) => rows.filter((row) => row._id !== id))
  }

  return (
    <div className="space-y-5">
      <PageTitle
        icon={<BookOpen className="h-5 w-5" />}
        title="Knowledge"
        detail="Project data files, operations notes, and searchable internal reference data."
        onRefresh={() => load()}
        color={colors.data}
        action={<IconButton onClick={() => { setEditing(null); setForm(emptyDoc); setShowForm(true) }} className="border-[#9333ea]/50 bg-[#9333ea] hover:bg-[#9333ea]/90"><Plus className="h-4 w-4" />Add</IconButton>}
      />
      <SectionBlock title="Data Files" detail="Structured project sheets for income, expense, payroll, notes, and custom data.">
        <SheetsPanel />
      </SectionBlock>
      {showForm ? <SectionBlock title={editing ? "Edit Knowledge Document" : "Add Knowledge Document"} detail="Manual notes, process references, and internal documentation.">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span />
          <IconButton onClick={reset}><X className="h-4 w-4" />Close</IconButton>
        </div>
        <div className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-5"><Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field></div>
          <div className="lg:col-span-3"><Field label="Category"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Ghost Bible</option><option>Trader Comms</option><option>Operations Manual</option><option>Notes</option></Select></Field></div>
          <div className="lg:col-span-4"><Field label="Source"><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field></div>
          <div className="lg:col-span-12"><Field label="Content"><Textarea className="min-h-40" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field></div>
        </div>
        <div className="mt-4 flex justify-end"><IconButton onClick={save} className="border-[#9333ea]/50 bg-[#9333ea] hover:bg-[#9333ea]/90"><Save className="h-4 w-4" />Save Document</IconButton></div>
      </SectionBlock> : null}
      <SectionBlock title="Knowledge Documents" detail="Searchable documentation and internal reference notes.">
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" /><Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents" /></div>
          <IconButton onClick={() => load(query)}>Search</IconButton>
        </div>
        {loading ? <EmptyState label="Loading documents..." /> : docs.length === 0 ? <EmptyState label="No documents yet" /> : (
          <div className="grid gap-3 xl:grid-cols-2">
            {docs.map((doc) => (
              <article key={doc._id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase text-[#c084fc]">{doc.category || "Document"}</p><h3 className="mt-1 font-semibold text-white">{doc.title}</h3></div>
                  <div className="flex gap-2"><IconButton onClick={() => startEdit(doc)} className="px-2"><Edit2 className="h-4 w-4" /></IconButton><IconButton onClick={() => remove(doc._id)} className="px-2 text-red-300"><Trash2 className="h-4 w-4" /></IconButton></div>
                </div>
                <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm text-white/55">{doc.body}</p>
              </article>
            ))}
          </div>
        )}
      </SectionBlock>
    </div>
  )
}
