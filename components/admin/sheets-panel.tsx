"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Download, Edit3, Eye, Plus, Save, Search, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { getSheetSchema, normalizeSheetKind, SHEET_KIND_ORDER, SHEET_SCHEMAS, valuesForKind, type SheetKind } from "@/lib/sheet-schemas"

type OpsSheet = {
  _id: string
  title: string
  tabName?: string
  category?: string
  sheetType?: string
  description?: string
  projectId?: string
  projectName?: string
  sourceType?: string
  updatedAt?: string
}

type SheetValues = string[][]
type ProjectOption = { _id: string; name: string }
type RowDraft = Record<string, string>
type DataRow = { row: string[]; valueIndex: number }
type SheetsPanelProps = {
  projectId?: string
  projectName?: string
  hideProjectPicker?: boolean
  openAddSignal?: number
}

async function readJson(res: Response, fallback: any) {
  return res.json().catch(() => fallback)
}

function hasContent(row: string[]) {
  return row.some((cell) => String(cell || "").trim())
}

function money(value: string) {
  const amount = Number(String(value || "").replace(/[^0-9.-]/g, ""))
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"
}

function emptyDraft(kind: SheetKind): RowDraft {
  return Object.fromEntries(getSheetSchema(kind).headers.map((header) => [header, ""]))
}

function rowToDraft(kind: SheetKind, row: string[]): RowDraft {
  return Object.fromEntries(getSheetSchema(kind).headers.map((header, index) => [header, String(row[index] ?? "")]))
}

function draftToRow(kind: SheetKind, draft: RowDraft) {
  return getSheetSchema(kind).headers.map((header) => String(draft[header] ?? "").trim())
}

function fieldType(header: string) {
  const key = header.toLowerCase()
  if (key.includes("date")) return "date"
  if (key.includes("amount") || key.includes("value")) return "number"
  return "text"
}

function statusClass(value: string) {
  const status = value.toLowerCase()
  if (["paid", "done", "completed", "received", "approved"].includes(status)) return "bg-emerald-500/15 text-emerald-200"
  if (["late", "failed", "cancelled", "rejected"].includes(status)) return "bg-red-500/15 text-red-200"
  return "bg-amber-500/15 text-amber-100"
}

function schemaColor(kind: SheetKind) {
  if (kind === "income") return "text-emerald-200 bg-emerald-500/10 border-emerald-400/20"
  if (kind === "expense") return "text-red-200 bg-red-500/10 border-red-400/20"
  if (kind === "payroll") return "text-sky-200 bg-sky-500/10 border-sky-400/20"
  if (kind === "notes") return "text-violet-200 bg-violet-500/10 border-violet-400/20"
  return "text-white/70 bg-white/[0.04] border-white/[0.08]"
}

function cleanSheetTitle(sheet: OpsSheet, kind: SheetKind) {
  const fallback = SHEET_SCHEMAS[kind].title
  const rawTitle = String(sheet.title || "").trim()
  if (!rawTitle) return fallback

  const projectName = String(sheet.projectName || "").trim()
  const legacyTitles = kind === "notes" ? ["Project Notes"] : kind === "custom" ? ["Custom Data"] : []
  const acceptedTypeTitles = [fallback, ...legacyTitles]

  if (acceptedTypeTitles.some((label) => rawTitle.toLowerCase() === label.toLowerCase())) return fallback
  if (projectName) {
    const projectPrefix = `${projectName} `.toLowerCase()
    const titleLower = rawTitle.toLowerCase()
    if (titleLower.startsWith(projectPrefix)) {
      const withoutProject = rawTitle.slice(projectName.length).trim()
      if (acceptedTypeTitles.some((label) => withoutProject.toLowerCase() === label.toLowerCase())) return fallback
    }
  }

  return rawTitle
}

export function SheetsPanel({ projectId: lockedProjectId = "", projectName: lockedProjectName = "", hideProjectPicker = false, openAddSignal = 0 }: SheetsPanelProps = {}) {
  const [sheets, setSheets] = useState<OpsSheet[]>([])
  const [active, setActive] = useState<OpsSheet | null>(null)
  const [mode, setMode] = useState<"list" | "view" | "edit">("list")
  const [values, setValues] = useState<SheetValues>(valuesForKind("custom", []))
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [projectId, setProjectId] = useState("")
  const [sheetType, setSheetType] = useState<SheetKind>("custom")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [sheetQuery, setSheetQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rowDraft, setRowDraft] = useState<RowDraft>(emptyDraft("custom"))
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastOpenAddSignal = useRef(openAddSignal)

  const schema = getSheetSchema(sheetType)
  const effectiveProjectId = lockedProjectId || projectId
  const selectedProjectName = lockedProjectName || projects.find((project) => project._id === projectId)?.name || ""
  const visibleSheets = useMemo(
    () => lockedProjectId ? sheets.filter((sheet) => String(sheet.projectId || "") === lockedProjectId) : sheets,
    [lockedProjectId, sheets],
  )
  const filteredVisibleSheets = useMemo(() => {
    const term = sheetQuery.trim().toLowerCase()
    if (!term) return visibleSheets
    return visibleSheets.filter((sheet) =>
      `${sheet.title || ""} ${sheet.projectName || ""} ${sheet.category || ""} ${sheet.sheetType || ""} ${sheet.description || ""}`.toLowerCase().includes(term),
    )
  }, [sheetQuery, visibleSheets])
  const rows = useMemo<DataRow[]>(
    () => values.slice(1).map((row, index) => ({ row, valueIndex: index + 1 })).filter((item) => hasContent(item.row)),
    [values],
  )

  const loadSheets = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/ops/sheets", { cache: "no-store", credentials: "include" })
      const data = await readJson(res, { sheets: [] })
      setSheets(Array.isArray(data?.sheets) ? data.sheets : [])
    } finally {
      setLoading(false)
    }
  }

  const loadSheet = async (sheet: OpsSheet, nextMode: "list" | "view" | "edit" = "list") => {
    const kind = normalizeSheetKind(sheet.sheetType)
    setActive(sheet)
    setMode(nextMode)
    setAddOpen(false)
    setTitle(cleanSheetTitle(sheet, kind))
    setDescription(sheet.description || "")
    setProjectId(sheet.projectId || "")
    setSheetType(kind)
    setRowDraft(emptyDraft(kind))
    setEditingRow(null)
    const res = await fetch(`/api/ops/sheets/${sheet._id}`, { cache: "no-store", credentials: "include" })
    const data = await readJson(res, { values: [] })
    setValues(valuesForKind(kind, data?.values))
  }

  useEffect(() => {
    loadSheets()
    fetch("/api/ops/projects", { cache: "no-store", credentials: "include" })
      .then((res) => res.json())
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    if (!lockedProjectId) return
    setProjectId(lockedProjectId)
    if (active && String(active.projectId || "") !== lockedProjectId) closeSelection()
  }, [active, lockedProjectId])

  const createSheet = async (kind: SheetKind) => {
    const nextSchema = getSheetSchema(kind)
    const res = await fetch("/api/ops/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        action: "create",
        sheetType: kind,
        title: nextSchema.title,
        tabName: nextSchema.tabName,
        category: nextSchema.category,
        projectId: effectiveProjectId,
        projectName: selectedProjectName,
      }),
    })
    const data = await readJson(res, {})
    if (!res.ok) {
      toast.error(data.error || "Data file was not created")
      return
    }
    toast.success("Data file created")
    setSheets((current) => [data.sheet, ...current])
    loadSheet(data.sheet, "edit")
  }

  const uploadCsvFile = async (file?: File | null) => {
    if (!file) return
    const text = await file.text()
    const res = await fetch("/api/ops/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        action: "upload",
        sheetType: "custom",
        title: file.name.replace(/\.csv$/i, "") || SHEET_SCHEMAS.custom.title,
        projectId: effectiveProjectId,
        projectName: selectedProjectName,
        csv: text,
      }),
    })
    const data = await readJson(res, {})
    if (!res.ok) {
      toast.error(data.error || "CSV file was not uploaded")
      return
    }
    toast.success("CSV file uploaded")
    setSheets((current) => [data.sheet, ...current])
    loadSheet(data.sheet, "edit")
  }

  const save = async () => {
    if (!active) {
      toast.error("Create or select a data file first")
      return
    }
    setSaving(true)
    try {
      const nextSchema = getSheetSchema(sheetType)
      const res = await fetch(`/api/ops/sheets/${active._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: title || nextSchema.title,
          tabName: nextSchema.tabName,
          category: nextSchema.category,
          sheetType,
          description,
          projectId: effectiveProjectId,
          projectName: selectedProjectName,
          values,
        }),
      })
      const data = await readJson(res, {})
      if (!res.ok) {
        toast.error(data.error || "Data file was not saved")
        return
      }
      toast.success("Data saved")
      setActive(data.sheet)
      setSheets((current) => current.map((sheet) => sheet._id === data.sheet._id ? data.sheet : sheet))
      setValues(valuesForKind(sheetType, data.values || values))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!active || !confirm("Delete this data file from the project?")) return
    const res = await fetch(`/api/ops/sheets/${active._id}`, { method: "DELETE", credentials: "include" })
    if (!res.ok) {
      toast.error("Data file was not deleted")
      return
    }
    toast.success("Data file deleted")
    setSheets((current) => current.filter((sheet) => sheet._id !== active._id))
    closeSelection()
  }

  const exportCsv = () => {
    if (!active) {
      toast.error("Select a data file first")
      return
    }
    window.location.href = `/api/ops/sheets/${active._id}?format=csv`
  }

  const closeSelection = () => {
    setActive(null)
    setMode("list")
    setAddOpen(false)
    setValues(valuesForKind("custom", []))
    setRowDraft(emptyDraft("custom"))
    setEditingRow(null)
  }

  useEffect(() => {
    if (openAddSignal === lastOpenAddSignal.current) return
    lastOpenAddSignal.current = openAddSignal
    if (!openAddSignal) return
    if (mode !== "list") closeSelection()
    setAddOpen(true)
  }, [mode, openAddSignal])

  const changeKind = (kind: SheetKind) => {
    const nextSchema = getSheetSchema(kind)
    setSheetType(kind)
    setTitle(nextSchema.title)
    setValues((current) => valuesForKind(kind, current.slice(1)))
    setRowDraft(emptyDraft(kind))
    setEditingRow(null)
  }

  const saveRow = () => {
    const row = draftToRow(sheetType, rowDraft)
    if (!hasContent(row)) {
      toast.error("Fill at least one field")
      return
    }
    const headers = schema.headers
    setValues((current) => {
      const next = valuesForKind(sheetType, current)
      if (editingRow === null) return [headers, ...next.slice(1), row]
      return next.map((item, index) => index === editingRow ? row : item)
    })
    setRowDraft(emptyDraft(sheetType))
    setEditingRow(null)
  }

  const editRow = (item: DataRow) => {
    setEditingRow(item.valueIndex)
    setRowDraft(rowToDraft(sheetType, item.row))
  }

  const deleteRow = (item: DataRow) => {
    setValues((current) => valuesForKind(sheetType, current).filter((_, index) => index !== item.valueIndex))
    if (editingRow === item.valueIndex) {
      setRowDraft(emptyDraft(sheetType))
      setEditingRow(null)
    }
  }

  return (
    <section
      onClick={() => {
        if (mode === "list" && active) closeSelection()
        if (mode === "list" && addOpen) setAddOpen(false)
      }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        {mode === "list" && !hideProjectPicker ? (
          <select
            value={projectId}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-9 max-w-[58%] rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#9333ea]/70"
          >
            <option value="">No project selected</option>
            {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
          </select>
        ) : <span />}

        {mode === "list" ? (
          <div onClick={(event) => event.stopPropagation()} className="relative">
            <button
              onClick={() => setAddOpen((current) => !current)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#9333ea] px-3 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Add File
            </button>
            {addOpen ? (
              <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-xl border border-white/[0.08] bg-[#121018] shadow-2xl shadow-black/40">
                {SHEET_KIND_ORDER.map((kind) => (
                  <button
                    key={kind}
                    onClick={() => {
                      setAddOpen(false)
                      createSheet(kind)
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold text-white hover:bg-white/[0.06]"
                  >
                    <span>Create {SHEET_SCHEMAS[kind].title}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${schemaColor(kind)}`}>{SHEET_SCHEMAS[kind].category}</span>
                  </button>
                ))}
                <button
                  onClick={() => {
                    setAddOpen(false)
                    fileInputRef.current?.click()
                  }}
                  className="flex w-full items-center gap-2 border-t border-white/[0.08] px-3 py-2.5 text-left text-sm font-semibold text-white hover:bg-white/[0.06]"
                >
                  <Upload className="h-4 w-4 text-[#d8b4fe]" />
                  Import CSV as Custom
                </button>
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                uploadCsvFile(event.target.files?.[0])
                event.target.value = ""
              }}
            />
          </div>
        ) : null}
      </div>

      {mode === "list" ? (
        <div className="grid gap-3">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c084fc]" />
            <input
              value={sheetQuery}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setSheetQuery(event.target.value)}
              placeholder="Search data files"
              className="h-10 w-full rounded-xl border border-[#9333ea]/20 bg-[#9333ea]/[0.04] pl-10 pr-3 text-sm text-white outline-none focus:border-[#9333ea]/60"
            />
          </label>
          {loading ? <span className="text-sm text-white/35">Loading data files...</span> : null}
          {!loading && filteredVisibleSheets.length === 0 ? <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-sm text-white/35">No data files found</div> : null}
          {filteredVisibleSheets.map((sheet) => {
            const kind = normalizeSheetKind(sheet.sheetType)
            const displayTitle = cleanSheetTitle(sheet, kind)
            return (
              <div
                key={sheet._id}
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  if (active?._id === sheet._id) closeSelection()
                  else loadSheet(sheet, "list")
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  if (active?._id === sheet._id) closeSelection()
                  else loadSheet(sheet, "list")
                }}
                className={`rounded-xl border p-4 text-left transition ${active?._id === sheet._id ? "border-[#9333ea]/45 bg-[#9333ea]/10" : "border-white/[0.08] bg-white/[0.035] hover:border-[#9333ea]/45 hover:bg-[#9333ea]/10"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{displayTitle}</p>
                    <p className="mt-1 text-xs text-white/40">{SHEET_SCHEMAS[kind].category} / {SHEET_SCHEMAS[kind].title}{sheet.projectName ? ` - ${sheet.projectName}` : ""}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${schemaColor(kind)}`}>{SHEET_SCHEMAS[kind].title}</span>
                </div>
                {active?._id === sheet._id ? (
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        setMode("view")
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-2 text-xs font-semibold text-white"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        setMode("edit")
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[#9333ea] px-2 text-xs font-semibold text-white"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        remove()
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2 text-xs font-semibold text-red-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-[#9333ea]/20 bg-[#9333ea]/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
            <button onClick={() => setMode("list")} className="inline-flex items-center gap-2 text-sm font-semibold text-[#d8b4fe]">
              <ArrowLeft className="h-4 w-4" />
              Files
            </button>
            <div className="flex flex-wrap gap-2">
              {mode === "edit" ? <button onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#9333ea] px-3 text-sm font-semibold text-white disabled:opacity-50">
                <Save className="h-4 w-4" />
                Save
              </button> : null}
              <button onClick={exportCsv} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-sm font-semibold text-white">
                <Download className="h-4 w-4" />
                Export
              </button>
              <button onClick={remove} className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 text-sm font-semibold text-red-200">
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          </div>

          {mode === "edit" ? (
            <div className="grid gap-3 lg:grid-cols-[160px_1fr_1fr]">
              <select value={sheetType} onChange={(event) => changeKind(normalizeSheetKind(event.target.value))} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#9333ea]/70">
                {SHEET_KIND_ORDER.map((kind) => <option key={kind} value={kind}>{SHEET_SCHEMAS[kind].title}</option>)}
              </select>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="h-10 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-sm text-white outline-none focus:border-[#9333ea]/70" placeholder="File title" />
              {hideProjectPicker ? (
                <div className="flex h-10 items-center rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-sm font-semibold text-white/65">{selectedProjectName || "No project"}</div>
              ) : (
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#9333ea]/70">
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                </select>
              )}
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-10 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-sm text-white outline-none focus:border-[#9333ea]/70 lg:col-span-3" placeholder="Description" />
            </div>
          ) : null}

          {mode === "edit" ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {schema.headers.map((header) => (
                  <label key={header} className={header === "Notes" || header === "Detail" ? "md:col-span-2 xl:col-span-3" : ""}>
                    <span className="mb-1 block text-xs font-semibold text-white/45">{header}</span>
                    {header === "Status" ? (
                      <select value={rowDraft[header] || ""} onChange={(event) => setRowDraft((current) => ({ ...current, [header]: event.target.value }))} className="h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#9333ea]/70">
                        <option value="">Choose status</option>
                        <option value="pending">Pending</option>
                        <option value="paid">Paid</option>
                        <option value="received">Received</option>
                        <option value="approved">Approved</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    ) : header === "Notes" || header === "Detail" ? (
                      <textarea value={rowDraft[header] || ""} onChange={(event) => setRowDraft((current) => ({ ...current, [header]: event.target.value }))} className="min-h-20 w-full rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-sm text-white outline-none focus:border-[#9333ea]/70" placeholder={header} />
                    ) : (
                      <input type={fieldType(header)} value={rowDraft[header] || ""} onChange={(event) => setRowDraft((current) => ({ ...current, [header]: event.target.value }))} className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-sm text-white outline-none focus:border-[#9333ea]/70" placeholder={header} />
                    )}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={saveRow} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#9333ea] px-3 text-sm font-semibold text-white">
                  <Plus className="h-4 w-4" />
                  {editingRow === null ? "Add row" : "Update row"}
                </button>
                <button
                  onClick={() => {
                    setRowDraft(emptyDraft(sheetType))
                    setEditingRow(null)
                  }}
                  className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-sm font-semibold text-white"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          <div className="overflow-auto rounded-xl border border-white/[0.08]">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-white/[0.04] text-left text-xs uppercase text-white/45">
                  {schema.headers.map((header) => <th key={header} className="whitespace-nowrap border-b border-white/[0.08] px-3 py-3 font-semibold">{header}</th>)}
                  {mode === "edit" ? <th className="border-b border-white/[0.08] px-3 py-3 text-right font-semibold">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={schema.headers.length + (mode === "edit" ? 1 : 0)} className="px-3 py-8 text-center text-white/35">No rows yet</td></tr>
                ) : rows.map((item) => (
                  <tr key={item.valueIndex} className="border-b border-white/[0.06] last:border-0">
                    {schema.headers.map((header, index) => {
                      const value = String(item.row[index] ?? "")
                      if (header === "Status") return <td key={header} className="whitespace-nowrap px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(value)}`}>{value || "pending"}</span></td>
                      if (header === "Amount" || header === "Value") return <td key={header} className="whitespace-nowrap px-3 py-3 font-semibold text-white">{money(value)}</td>
                      return <td key={header} className="min-w-28 px-3 py-3 text-white/70">{value || "-"}</td>
                    })}
                    {mode === "edit" ? (
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <button onClick={() => editRow(item)} className="mr-2 h-8 rounded-lg border border-white/[0.08] bg-white/[0.045] px-2 text-xs font-semibold text-white">Edit</button>
                        <button onClick={() => deleteRow(item)} className="h-8 rounded-lg border border-red-400/20 bg-red-500/10 px-2 text-xs font-semibold text-red-200">Remove</button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
