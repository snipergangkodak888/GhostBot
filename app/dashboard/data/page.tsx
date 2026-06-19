"use client"

import { useEffect, useMemo, useState } from "react"
import { BookOpen, FolderKanban, Search } from "lucide-react"
import { SheetsPanel } from "@/components/admin/sheets-panel"

type Project = {
  _id: string
  name: string
  status: "active" | "inactive" | "paused" | "launching"
  owner?: string
  launchDate?: string
  notes?: string
  tags?: string[]
}

export default function DataPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState("")

  const load = async () => {
    const response = await fetch("/api/ops/projects", { cache: "no-store", credentials: "include" })
    const data = await response.json().catch(() => [])
    const nextProjects = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : []
    setProjects(nextProjects)
    setSelectedId((current) => current || nextProjects[0]?._id || "")
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return projects
    return projects.filter((project) => `${project.name} ${project.owner || ""} ${project.notes || ""}`.toLowerCase().includes(term))
  }, [projects, query])

  const selectedProject = projects.find((project) => project._id === selectedId) || filtered[0] || null

  return (
    <div className="space-y-4">
      <PageTitle icon={<BookOpen />} title="Data" subtitle={`${projects.length} project sections`} />

      <label className="relative block">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a855f7]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" className="h-12 w-full rounded-2xl border border-[#a855f7]/20 bg-[#a855f7]/[0.04] pl-11 pr-4 text-sm text-white outline-none focus:border-[#a855f7]/60" />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {filtered.map((project) => {
          const selected = selectedProject?._id === project._id
          return (
            <button
              key={project._id}
              onClick={() => setSelectedId(project._id)}
              className={`rounded-2xl border p-4 text-left transition ${selected ? "border-[#a855f7]/45 bg-[#a855f7]/10" : "border-white/[0.08] bg-white/[0.035] hover:border-[#a855f7]/35 hover:bg-[#a855f7]/[0.06]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-white">{project.name}</h2>
                  <p className="mt-1 text-sm text-white/45">{project.owner || "No owner"} · {project.launchDate ? new Date(project.launchDate).toLocaleDateString() : "No launch date"}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${project.status === "active" ? "bg-[#a855f7]/15 text-[#d8b4fe]" : "bg-white/10 text-white/45"}`}>{project.status}</span>
              </div>
              {project.tags?.length ? <div className="mt-3 flex flex-wrap gap-2">{project.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-black/35 px-2 py-1 text-xs text-white/45">{tag}</span>)}</div> : null}
            </button>
          )
        })}
      </div>

      {!filtered.length ? <Empty text="No projects found" /> : null}

      {selectedProject ? (
        <section className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl border border-[#a855f7]/20 bg-[#a855f7]/[0.06] p-4">
            <FolderKanban className="h-5 w-5 text-[#c084fc]" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-white">{selectedProject.name}</h2>
              <p className="text-sm text-white/45">Project data</p>
            </div>
          </div>
          <SheetsPanel projectId={selectedProject._id} projectName={selectedProject.name} hideProjectPicker />
        </section>
      ) : null}
    </div>
  )
}

function PageTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex min-h-14 items-center gap-2.5 rounded-xl border border-[#a855f7]/20 bg-[#a855f7]/[0.06] px-3 py-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-[#c084fc]">{icon}<div><h1 className="text-lg font-bold">{title}</h1><p className="text-xs text-white/45">{subtitle}</p></div></div>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/[0.08] p-6 text-center text-sm text-white/40">{text}</div>
}
