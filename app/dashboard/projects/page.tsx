"use client"

import { useEffect, useMemo, useState } from "react"
import { Edit3, Filter, FolderKanban, MessageSquareText, Plus, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import type { PayrollAccount } from "@/lib/payroll-ledger"

type Project = {
  _id: string
  name: string
  status: "active" | "inactive" | "in_progress" | "paused" | "launching"
  referrer?: string
  referrerWallet?: string
  referrerAccountId?: string | null
  referralPercentage?: number
  service?: string
  startDate?: string
  endDate?: string
  currentProfitLoss?: number
  profitThisWeek?: number
  owner?: string
  launchDate?: string
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

const emptyProject = {
  name: "",
  referrer: "",
  referrerWallet: "",
  referrerAccountId: "",
  referralPercentage: "",
  status: "active",
  service: "",
  startDate: "",
  endDate: "",
  currentProfitLoss: "",
  notes: "",
  tags: "",
}

const money = (value?: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0))

const statusLabel = (value?: string) => value === "in_progress" ? "In Progress" : value ? value.replace(/\b\w/g, (char) => char.toUpperCase()) : "Active"

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [accounts, setAccounts] = useState<PayrollAccount[]>([])
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([])
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"projects" | "notes">("projects")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "in_progress">("all")
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedId, setSelectedId] = useState("")
  const [projectFormOpen, setProjectFormOpen] = useState(false)
  const [noteFormOpen, setNoteFormOpen] = useState(false)
  const [noteText, setNoteText] = useState("")
  const [noteProjectId, setNoteProjectId] = useState("")
  const [noteSaving, setNoteSaving] = useState(false)
  const [editingId, setEditingId] = useState("")
  const [form, setForm] = useState(emptyProject)

  const load = async () => {
    const [response, accountResponse, noteResponse] = await Promise.all([
      fetch("/api/ops/projects", { cache: "no-store", credentials: "include" }),
      fetch("/api/ops/payroll?ledger=1", { cache: "no-store", credentials: "include" }),
      fetch("/api/ops/project-notes", { cache: "no-store", credentials: "include" }),
    ])
    const data = await response.json().catch(() => [])
    const accountData = await accountResponse.json().catch(() => ({}))
    const noteData = await noteResponse.json().catch(() => ({}))
    const nextProjects = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : []
    setProjects(nextProjects)
    setAccounts(Array.isArray(accountData?.accounts) ? accountData.accounts : [])
    setProjectNotes(Array.isArray(noteData?.notes) ? noteData.notes : [])
    setSelectedId((current) => current || nextProjects[0]?._id || "")
    setNoteProjectId((current) => current || nextProjects[0]?._id || "")
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return projects
      .filter((project) => statusFilter === "all" || project.status === statusFilter)
      .filter((project) => !term || `${project.name} ${project.referrer || ""} ${project.referrerWallet || ""} ${project.service || ""} ${project.notes || ""}`.toLowerCase().includes(term))
      .sort((a, b) => {
        const rank = (status?: string) => status === "active" ? 0 : status === "in_progress" ? 1 : 2
        return rank(a.status) - rank(b.status)
      })
  }, [projects, query, statusFilter])

  const visibleNotes = useMemo(() => {
    const term = query.trim().toLowerCase()
    return projectNotes.filter((note) => {
      const matchesProject = !selectedId || note.projectId === selectedId
      const matchesSearch = !term || `${note.text} ${note.projectName} ${note.authorName || ""}`.toLowerCase().includes(term)
      return matchesProject && matchesSearch
    })
  }, [projectNotes, query, selectedId])

  const startCreate = () => {
    setEditingId("")
    setForm(emptyProject)
    setProjectFormOpen(true)
    setView("projects")
  }

  const handleAdd = () => {
    if (view === "notes") {
      setNoteProjectId(selectedId || projects[0]?._id || "")
      setNoteFormOpen(true)
      return
    }
    startCreate()
  }

  const startEdit = (project: Project) => {
    setEditingId(project._id)
    setForm({
      name: project.name || "",
      referrer: project.referrer || project.owner || "",
      referrerWallet: project.referrerWallet || "",
      referrerAccountId: project.referrerAccountId || "",
      referralPercentage: String(project.referralPercentage ?? 0),
      status: project.status === "inactive" ? "inactive" : project.status === "in_progress" ? "in_progress" : "active",
      service: project.service || "",
      startDate: project.startDate ? project.startDate.slice(0, 10) : project.launchDate ? project.launchDate.slice(0, 10) : "",
      endDate: project.endDate ? project.endDate.slice(0, 10) : "",
      currentProfitLoss: String(project.currentProfitLoss ?? project.profitThisWeek ?? 0),
      notes: project.notes || "",
      tags: (project.tags || []).join(", "),
    })
    setProjectFormOpen(true)
    setView("projects")
  }

  const saveProject = async () => {
    if (!form.name.trim()) {
      toast.error("Project name is required")
      return
    }
    const payload = {
      ...form,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    }
    const res = await fetch(editingId ? `/api/ops/projects/${editingId}` : "/api/ops/projects", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || "Project was not saved")
      return
    }
    toast.success(editingId ? "Project updated" : "Project created")
    setProjectFormOpen(false)
    setEditingId("")
    setForm(emptyProject)
    await load()
  }

  const saveNote = async () => {
    if (!noteProjectId) {
      toast.error("Choose a project")
      return
    }
    if (!noteText.trim()) {
      toast.error("Write a note")
      return
    }
    setNoteSaving(true)
    try {
      const res = await fetch("/api/ops/project-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: noteProjectId, text: noteText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Note was not added")
        return
      }
      setNoteText("")
      setNoteFormOpen(false)
      setSelectedId(noteProjectId)
      toast.success("Note posted")
      await load()
    } finally {
      setNoteSaving(false)
    }
  }

  const removeProject = async (project: Project) => {
    if (!confirm(`Delete ${project.name}?`)) return
    const res = await fetch(`/api/ops/projects/${project._id}`, { method: "DELETE", credentials: "include" })
    if (!res.ok) {
      toast.error("Project was not deleted")
      return
    }
    toast.success("Project deleted")
    setSelectedId((current) => current === project._id ? "" : current)
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <PageTitle icon={<FolderKanban />} title="Projects" subtitle={`${projects.filter((p) => p.status === "active").length} active projects`} />
        </div>
        <button onClick={handleAdd} className="inline-flex h-14 w-20 shrink-0 items-center justify-center gap-1.5 self-center rounded-xl border border-[#ffd43b]/20 bg-[#ffd43b]/10 text-xs font-bold text-[#ffe066]">
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {projectFormOpen ? (
        <section className="rounded-2xl border border-[#ffd43b]/20 bg-[#ffd43b]/[0.055] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">{editingId ? "Edit Project" : "Add Project"}</h2>
            <button onClick={() => setProjectFormOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/65"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Project name" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
            <input value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })} placeholder="Service, ex. TGE + MM or MM" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
            <select
              value={form.referrerAccountId}
              onChange={(event) => {
                const account = accounts.find((item) => String(item._id || item.id) === event.target.value)
                setForm({
                  ...form,
                  referrerAccountId: event.target.value,
                  referrer: account?.name || "",
                  referrerWallet: account?.wallet || account?.source || form.referrerWallet,
                })
              }}
              className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60"
            >
              <option value="">No referrer</option>
              {accounts.filter((account) => account.type === "REFERRER").map((account) => <option key={String(account._id || account.id)} value={String(account._id || account.id)}>{account.name}</option>)}
            </select>
            <input value={form.referrerWallet} onChange={(event) => setForm({ ...form, referrerWallet: event.target.value })} placeholder="Referrer wallet (optional)" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
            <input type="number" min="0" max="100" value={form.referralPercentage} onChange={(event) => setForm({ ...form, referralPercentage: event.target.value })} placeholder="Referrer percentage" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60">
              <option value="active">Active</option>
              <option value="in_progress">In Progress</option>
              <option value="inactive">Inactive</option>
            </select>
            <input type="number" value={form.currentProfitLoss} onChange={(event) => setForm({ ...form, currentProfitLoss: event.target.value })} placeholder="Current Profit / Loss" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
            <input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
            <input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="Tags, separated by commas" className="h-10 rounded-lg border border-white/[0.08] bg-black/35 px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60 sm:col-span-2" />
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notes" className="min-h-20 rounded-lg border border-white/[0.08] bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-[#ffd43b]/60 sm:col-span-2" />
          </div>
          <button onClick={saveProject} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-[#ffd43b] px-3 text-sm font-bold text-black">
            <Save className="h-4 w-4" />
            Save Project
          </button>
        </section>
      ) : null}

      <div className="grid grid-cols-2 rounded-2xl border border-[#ffd43b]/20 bg-black/45 p-1">
        <button onClick={() => setView("projects")} className={`h-10 rounded-xl text-sm font-bold transition ${view === "projects" ? "bg-[#ffd43b]/15 text-[#ffd43b]" : "text-white/45"}`}>Projects</button>
        <button onClick={() => { setView("notes"); setSelectedId("") }} className={`h-10 rounded-xl text-sm font-bold transition ${view === "notes" ? "bg-[#ffd43b]/15 text-[#ffd43b]" : "text-white/45"}`}>Notes</button>
      </div>

      <div className="relative flex gap-2">
        <label className="relative block min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#ffd43b]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "notes" ? "Search notes" : "Search projects"} className="h-12 w-full rounded-2xl border border-[#ffd43b]/20 bg-[#ffd43b]/[0.04] pl-11 pr-4 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
        </label>
        {view === "projects" ? (
          <button onClick={() => setFilterOpen((current) => !current)} className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#ffd43b]/20 bg-[#ffd43b]/10 px-4 text-xs font-bold text-[#ffe066]">
            <Filter className="h-4 w-4" />
            Filter
          </button>
        ) : null}
        {filterOpen && view === "projects" ? (
          <div className="absolute right-0 top-14 z-20 w-44 rounded-xl border border-white/[0.1] bg-[#111214] p-1.5 shadow-2xl">
            {([
              ["all", "All Projects"],
              ["active", "Active"],
              ["in_progress", "In Progress"],
              ["inactive", "Inactive"],
            ] as const).map(([value, label]) => (
              <button key={value} onClick={() => { setStatusFilter(value); setFilterOpen(false) }} className={`block h-9 w-full rounded-lg px-3 text-left text-xs font-semibold ${statusFilter === value ? "bg-[#ffd43b]/15 text-[#ffe066]" : "text-white/60 hover:bg-white/[0.05]"}`}>
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {view === "projects" ? <div className="space-y-3">
        {filtered.map((project) => (
          <article key={project._id} className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-white">{project.name}</h2>
                <p className="mt-1 text-sm text-white/45">{project.service || "No service"} · {project.startDate || project.launchDate ? new Date(project.startDate || project.launchDate || "").toLocaleDateString() : "No start date"}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${project.status === "active" ? "bg-[#ffd43b]/15 text-[#ffe066]" : project.status === "in_progress" ? "bg-blue-500/15 text-blue-200" : "bg-white/10 text-white/45"}`}>{statusLabel(project.status)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-white/[0.08] bg-black/25 p-2 text-white/55">Referrer: <span className="text-white">{project.referrer || "None"}</span></div>
              <div className="rounded-lg border border-white/[0.08] bg-black/25 p-2 text-white/55">P/L: <span className={Number(project.currentProfitLoss ?? project.profitThisWeek ?? 0) >= 0 ? "text-[#42e6a4]" : "text-red-300"}>{money(project.currentProfitLoss ?? project.profitThisWeek)}</span></div>
            </div>
            {project.notes ? <p className="mt-3 line-clamp-3 text-sm text-white/65">{project.notes}</p> : null}
            {project.tags?.length ? <div className="mt-3 flex flex-wrap gap-2">{project.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-black/35 px-2 py-1 text-xs text-white/45">{tag}</span>)}</div> : null}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={() => { setSelectedId(project._id); setView("notes") }} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#ffd43b]/20 bg-[#ffd43b]/10 px-2 text-xs font-bold text-[#ffe066]">
                <MessageSquareText className="h-4 w-4" />
                Notes
              </button>
              <button onClick={() => startEdit(project)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-bold text-white">
                <Edit3 className="h-4 w-4" />
                Edit
              </button>
              <button onClick={() => removeProject(project)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2 text-xs font-bold text-red-200">
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            </div>
          </article>
        ))}
        {!filtered.length ? <Empty text="No projects found" /> : null}
      </div> : null}

      {view === "notes" ? (
        <div className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setSelectedId("")} className={`h-9 shrink-0 rounded-full border px-3 text-xs font-bold ${!selectedId ? "border-[#ffd43b]/40 bg-[#ffd43b]/15 text-[#ffe066]" : "border-white/[0.08] bg-white/[0.035] text-white/50"}`}>All Projects</button>
            {projects.map((project) => (
              <button key={project._id} onClick={() => setSelectedId(project._id)} className={`h-9 shrink-0 rounded-full border px-3 text-xs font-bold ${selectedId === project._id ? "border-[#ffd43b]/40 bg-[#ffd43b]/15 text-[#ffe066]" : "border-white/[0.08] bg-white/[0.035] text-white/50"}`}>
                {project.name}
              </button>
            ))}
          </div>

          {noteFormOpen ? (
            <section className="rounded-2xl border border-[#ffd43b]/20 bg-[#ffd43b]/[0.055] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-white">Post Update</h2>
                <button onClick={() => setNoteFormOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/60"><X className="h-4 w-4" /></button>
              </div>
              <select value={noteProjectId} onChange={(event) => setNoteProjectId(event.target.value)} className="h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#ffd43b]/60">
                <option value="">Choose project</option>
                {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
              </select>
              <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="What did you update today?" className="mt-2 min-h-28 w-full rounded-xl border border-white/[0.08] bg-black/35 p-3 text-sm text-white outline-none focus:border-[#ffd43b]/60" />
              <button onClick={saveNote} disabled={noteSaving} className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#ffd43b] text-sm font-bold text-black disabled:opacity-50">
                <MessageSquareText className="h-4 w-4" />
                Post Note
              </button>
            </section>
          ) : null}

          <div className="space-y-3">
            {visibleNotes.map((note) => (
              <article key={note._id} className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ffd43b]/12 text-sm font-black text-[#ffe066]">
                    {(note.authorName || "T").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-white">{note.authorName || "Team member"}</span>
                      <span className="text-xs text-white/35">{note.createdAt ? new Date(note.createdAt).toLocaleString() : ""}</span>
                    </div>
                    <button onClick={() => setSelectedId(note.projectId)} className="mt-1 text-xs font-bold text-[#ffe066]">{note.projectName}</button>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/75">{note.text}</p>
                  </div>
                </div>
              </article>
            ))}
            {!visibleNotes.length ? <Empty text="No project notes yet" /> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PageTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex min-h-14 items-center gap-2.5 rounded-xl border border-[#ffd43b]/20 bg-[#ffd43b]/[0.06] px-3 py-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-[#ffd43b]">{icon}<div><h1 className="text-lg font-bold">{title}</h1><p className="text-xs text-white/45">{subtitle}</p></div></div>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/[0.08] p-6 text-center text-sm text-white/40">{text}</div>
}
