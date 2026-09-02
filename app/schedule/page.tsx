"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Clock3, Copy, GripVertical, History, Lock, Plus, Send, Save, Settings2, ShieldCheck, Trash2, Users, X } from "lucide-react"
import { addDays, minuteToLabel, scheduleWeekStart } from "@/lib/trader-schedule"
import type { ScheduleRole, ScheduleWeek, ShiftAssignment, TraderProfile } from "@/lib/trader-schedule-types"

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const ROLE_LABELS: Record<ScheduleRole, string> = { admin: "Admin", trading: "Trading", lead: "Lead", launch_support: "Launch support", on_call: "On call" }
const snap = (value: number) => Math.round(value / 15) * 15
type ScheduleAuditRow = { id: string; action: string; revision: number | null; created_at: string; details?: { snapshot?: { assignments?: ShiftAssignment[] } } }

function clockValue(minute: number) {
  const value = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
}
function clockMinute(value: string) { const [h, m] = value.split(":").map(Number); return h * 60 + m }

export default function TraderSchedulePage() {
  const [week, setWeek] = useState<ScheduleWeek | null>(null)
  const [roster, setRoster] = useState<TraderProfile[]>([])
  const [audit, setAudit] = useState<ScheduleAuditRow[]>([])
  const [weekStart, setWeekStart] = useState(scheduleWeekStart())
  const [dayIndex, setDayIndex] = useState(() => Math.max(0, Math.min(6, Math.round((Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`) - Date.parse(`${scheduleWeekStart()}T12:00:00Z`)) / 86400000))))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState<ShiftAssignment | null>(null)
  const [editingTrader, setEditingTrader] = useState<TraderProfile | null>(null)
  const [locked, setLocked] = useState(true)
  const [changeSeq, setChangeSeq] = useState(0)
  const seqRef = useRef(0)
  const timelineRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (target = weekStart) => {
    setLoading(true); setError("")
    const res = await fetch(`/api/schedule?week=${encodeURIComponent(target)}`, { cache: "no-store", credentials: "include" })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(data.error || "Schedule access expired. Open it again from Management Chat."); return }
    setWeek(data.week); setRoster(data.roster || []); setAudit(data.audit || []); setDirty(false); setLocked(true)
  }, [weekStart])

  useEffect(() => { load(weekStart) }, [weekStart, load])

  const assignments = week?.draft.assignments || []
  const selectedDate = addDays(weekStart, dayIndex)
  const dayAssignments = assignments.filter((row) => row.date === selectedDate)
  const rosterById = useMemo(() => new Map(roster.map((row) => [row.id, row])), [roster])
  const issues = week?.draft.issues || []
  const errors = issues.filter((issue) => issue.severity === "error")
  const warnings = issues.filter((issue) => issue.severity === "warning")

  const mutate = (next: ShiftAssignment[]) => {
    seqRef.current += 1; setChangeSeq(seqRef.current); setDirty(true)
    setWeek((current) => current ? { ...current, draft: { ...current.draft, assignments: next } } : current)
  }

  const saveDraft = useCallback(async () => {
    if (!week || saving || !dirty) return
    const savingSeq = seqRef.current
    setSaving(true); setError("")
    const res = await fetch("/api/schedule", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", weekStart, expectedRevision: week.draftRevision, assignments: week.draft.assignments }) })
    const data = await res.json().catch(() => ({})); setSaving(false)
    if (!res.ok) { setError(data.error || "Draft could not be saved"); if (res.status === 409) setLocked(true); return }
    setWeek((current) => current ? { ...current, draftRevision: data.week.draftRevision, draft: savingSeq === seqRef.current ? data.week.draft : current.draft, updatedAt: data.week.updatedAt } : data.week)
    if (savingSeq === seqRef.current) setDirty(false)
  }, [week, saving, dirty, weekStart])

  useEffect(() => { if (!dirty || saving) return; const timer = window.setTimeout(() => void saveDraft(), 900); return () => window.clearTimeout(timer) }, [changeSeq, dirty, saving, saveDraft])

  const publish = async () => {
    if (!week) return
    if (dirty) { await saveDraft(); return setError("Draft saved. Review the refreshed coverage and tap Publish again.") }
    if (errors.length) return setError("Resolve every red admin-coverage issue before publishing.")
    setSaving(true)
    const res = await fetch("/api/schedule", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish", weekStart, expectedRevision: week.draftRevision }) })
    const data = await res.json().catch(() => ({})); setSaving(false)
    if (!res.ok) return setError(data.error || "Schedule could not be published")
    setWeek(data.week); setError("")
  }

  const copyPrevious = async () => {
    if (!week || dirty || !confirm("Replace this draft with the previous published week?")) return
    setSaving(true)
    const res = await fetch("/api/schedule", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "copy-previous", weekStart, expectedRevision: week.draftRevision }) })
    const data = await res.json().catch(() => ({})); setSaving(false)
    if (!res.ok) return setError(data.error || "Previous week could not be copied")
    setWeek(data.week); setDirty(false)
  }

  const saveTrader = async (trader: TraderProfile) => {
    setSaving(true)
    const res = await fetch("/api/schedule", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update-trader", id: trader.id, changes: trader }) })
    const data = await res.json().catch(() => ({})); setSaving(false)
    if (!res.ok) return setError(data.error || "Trader profile could not be saved")
    setRoster((current) => current.map((row) => row.id === data.trader.id ? data.trader : row)); setEditingTrader(null)
  }

  const restoreRevision = async (revision: number) => {
    if (!week || dirty || !confirm(`Restore published revision ${revision} into the draft? The live schedule will not change until you publish.`)) return
    setSaving(true); setError("")
    const res = await fetch("/api/schedule", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", weekStart, expectedRevision: week.draftRevision, revision }) })
    const data = await res.json().catch(() => ({})); setSaving(false)
    if (!res.ok) return setError(data.error || "Revision could not be restored")
    setWeek(data.week); setDirty(false)
  }

  const beginDrag = (event: React.PointerEvent, row: ShiftAssignment, mode: "move" | "resize") => {
    if (locked) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX; const originalStart = row.startMinute; const originalEnd = row.endMinute
    const width = timelineRef.current?.getBoundingClientRect().width || 1440
    const move = (next: PointerEvent) => {
      const delta = snap((next.clientX - startX) / width * 1440)
      setWeek((current) => current ? { ...current, draft: { ...current.draft, assignments: current.draft.assignments.map((item) => item.id === row.id ? mode === "resize" ? { ...item, endMinute: Math.max(originalStart + 15, Math.min(1560, originalEnd + delta)) } : { ...item, startMinute: Math.max(0, Math.min(1439, originalStart + delta)), endMinute: Math.max(15, Math.min(1560, originalEnd + delta)) } : item) } } : current)
    }
    const up = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up)
      const target = document.elementsFromPoint(next.clientX, next.clientY).find((element) => element instanceof HTMLElement && element.dataset.traderRow) as HTMLElement | undefined
      if (target?.dataset.traderRow && target.dataset.traderRow !== row.traderId) setWeek((current) => current ? { ...current, draft: { ...current.draft, assignments: current.draft.assignments.map((item) => item.id === row.id ? { ...item, traderId: target.dataset.traderRow! } : item) } } : current)
      seqRef.current += 1; setChangeSeq(seqRef.current); setDirty(true)
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up)
  }

  const saveEditor = (row: ShiftAssignment) => {
    const exists = assignments.some((item) => item.id === row.id)
    mutate(exists ? assignments.map((item) => item.id === row.id ? row : item) : [...assignments, row]); setEditing(null)
  }

  const coverageForDay = (week?.draft.coverageSlices || []).filter((slice) => Math.floor(slice.startMinute / 1440) === dayIndex)
  const nowSlice = (week?.published?.coverageSlices || []).find((slice) => Date.parse(slice.startAt) <= Date.now() && Date.parse(slice.endAt) > Date.now())
  const restorableRevisions = Array.from(new Set(audit.filter((row) => row.action === "publish" && row.details?.snapshot?.assignments).map((row) => Number(row.revision)).filter(Number.isFinite))).sort((a, b) => b - a)

  if (loading && !week) return <Loading />
  if (!week) return <AccessError message={error} />

  return (
    <main className="min-h-screen bg-[#05070c] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_-10%,rgba(47,128,255,.22),transparent_42%)]" />
      <div className="relative mx-auto max-w-[1680px] px-3 pb-24 pt-[calc(12px+var(--tg-safe-area-inset-top,0px))] sm:px-5">
        <header className="rounded-3xl border border-[#2f80ff]/25 bg-[#0b1220]/90 p-4 shadow-2xl backdrop-blur-xl sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-[11px] font-bold uppercase tracking-[.24em] text-[#67a4ff]">Ghost Operations</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Trader Scheduler</h1><p className="mt-1 text-sm text-white/45">ET · Draft changes stay private until published</p></div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setEditingTrader(roster[0] || null)} className="h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-white/65"><Settings2 className="mr-2 inline h-4 w-4" />Roster</button>
              <button onClick={() => setLocked(!locked)} className={`h-11 rounded-xl border px-4 text-sm font-bold ${locked ? "border-white/10 bg-white/5 text-white/65" : "border-[#2f80ff]/50 bg-[#2f80ff]/20 text-[#80b4ff]"}`}>{locked ? <><Lock className="mr-2 inline h-4 w-4" />Review</> : <><GripVertical className="mr-2 inline h-4 w-4" />Editing</>}</button>
              <button onClick={() => void saveDraft()} disabled={!dirty || saving} className="h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold disabled:opacity-35"><Save className="mr-2 inline h-4 w-4" />{saving ? "Saving…" : dirty ? "Save draft" : "Saved"}</button>
              <button onClick={publish} disabled={saving || errors.length > 0} className="h-11 rounded-xl bg-[#2f80ff] px-4 text-sm font-black shadow-[0_0_30px_rgba(47,128,255,.28)] disabled:opacity-35"><Send className="mr-2 inline h-4 w-4" />Publish</button>
            </div>
          </div>
        </header>

        {error ? <div className="mt-3 flex items-center justify-between rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200"><span><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</span><button onClick={() => setError("")}><X className="h-4 w-4" /></button></div> : null}

        <section className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_.8fr_.8fr]">
          <div className="rounded-2xl border border-white/8 bg-white/[.035] p-4"><p className="text-xs font-bold uppercase tracking-wider text-white/35">On shift now</p>{nowSlice ? <div className="mt-2"><p className="text-xl font-black">{nowSlice.active.map((id) => rosterById.get(id)?.displayName || id).join(" + ")}</p><p className="mt-1 text-sm text-white/50">Admin: {nowSlice.admins.map((id) => rosterById.get(id)?.displayName || id).join(", ")} · until {new Date(nowSlice.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET</p></div> : <p className="mt-2 text-sm text-white/45">No published shift is active in this loaded week.</p>}</div>
          <Stat icon={<ShieldCheck />} label="Admin coverage" value={errors.length ? `${errors.length} gap${errors.length === 1 ? "" : "s"}` : "24/7 covered"} tone={errors.length ? "red" : "green"} />
          <Stat icon={<Users />} label="Pairing warnings" value={`${warnings.filter((row) => row.code === "solo_coverage").length} interval${warnings.length === 1 ? "" : "s"}`} tone="amber" />
        </section>

        <section className="mt-4 rounded-3xl border border-white/8 bg-[#0a0e16]/92 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><button onClick={() => setWeekStart(addDays(weekStart, -7))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5"><ChevronLeft className="h-4 w-4" /></button><button onClick={() => setWeekStart(scheduleWeekStart())} className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold">Today</button><button onClick={() => setWeekStart(addDays(weekStart, 7))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5"><ChevronRight className="h-4 w-4" /></button><div className="ml-1"><p className="text-sm font-black">Week of {new Date(`${weekStart}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</p><p className="text-[11px] text-white/35">Draft r{week.draftRevision} · Published r{week.publishedRevision}</p></div></div>
            <div className="flex flex-wrap gap-2">{restorableRevisions.length ? <label className="relative"><History className="pointer-events-none absolute left-3 top-3 h-3.5 w-3.5 text-white/45" /><select aria-label="Restore a published revision" defaultValue="" disabled={dirty || saving} onChange={(event) => { const revision = Number(event.target.value); event.target.value = ""; if (revision) void restoreRevision(revision) }} className="h-10 appearance-none rounded-xl border border-white/10 bg-[#101725] pl-9 pr-3 text-xs font-bold text-white/65 disabled:opacity-35"><option value="" disabled>Revision history</option>{restorableRevisions.map((revision) => <option key={revision} value={revision}>Restore published r{revision}</option>)}</select></label> : null}<button onClick={copyPrevious} disabled={dirty || saving} className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold disabled:opacity-35"><Copy className="mr-1.5 inline h-3.5 w-3.5" />Copy last week</button><button onClick={() => setEditing({ id: crypto.randomUUID(), traderId: roster[0]?.id || "bands", date: selectedDate, startMinute: 540, endMinute: 1020, roles: ["trading"] })} disabled={locked} className="h-10 rounded-xl bg-white px-3 text-xs font-black text-black disabled:opacity-35"><Plus className="mr-1.5 inline h-3.5 w-3.5" />Add shift</button></div>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1.5">{DAY_NAMES.map((name, index) => { const date = addDays(weekStart, index); const dayIssues = issues.filter((row) => row.date === date); return <button key={name} onClick={() => setDayIndex(index)} className={`rounded-xl border px-1 py-2.5 text-center ${dayIndex === index ? "border-[#2f80ff]/60 bg-[#2f80ff]/18 text-white" : "border-white/8 bg-white/[.025] text-white/45"}`}><span className="block text-xs font-black">{name}</span><span className="mt-0.5 block text-[10px]">{date.slice(5)}</span>{dayIssues.length ? <span className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${dayIssues.some((row) => row.severity === "error") ? "bg-red-400" : "bg-amber-400"}`} /> : null}</button> })}</div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/8 bg-black/20">
            <div className="min-w-[1180px]">
              <div className="grid grid-cols-[130px_1fr] border-b border-white/8 bg-[#121a29]"><div className="px-3 py-3 text-[10px] font-black uppercase tracking-wider text-white/45">Trader / role</div><div className="grid grid-cols-[repeat(24,minmax(0,1fr))]">{Array.from({ length: 24 }, (_, hour) => <div key={hour} className="border-l border-white/8 py-3 text-center text-[9px] font-bold text-white/40">{String(hour).padStart(2, "0")}</div>)}</div></div>
              <div className="grid grid-cols-[130px_1fr] border-b border-white/8 bg-white/[.025]"><div className="px-3 py-2 text-[10px] font-bold uppercase text-white/35">Coverage</div><div className="relative h-8">{coverageForDay.map((slice) => <div key={`${slice.startMinute}-${slice.endMinute}`} className={`absolute inset-y-1 rounded-sm ${slice.grade === "ideal" ? "bg-emerald-400/60" : slice.grade === "solo" ? "bg-amber-400/65" : "bg-red-500/70"}`} style={{ left: `${((slice.startMinute % 1440) / 1440) * 100}%`, width: `${((slice.endMinute - slice.startMinute) / 1440) * 100}%` }} title={`${slice.grade}: ${minuteToLabel(slice.startMinute)}–${minuteToLabel(slice.endMinute)}`} />)}</div></div>
              <div ref={timelineRef}>{roster.filter((trader) => trader.active).map((trader) => <div key={trader.id} data-trader-row={trader.id} className="grid grid-cols-[130px_1fr] border-b border-white/[.055] last:border-0"><div className="flex min-h-16 items-center gap-2 px-3"><span className="h-8 w-1 rounded-full" style={{ background: trader.color }} /><div className="min-w-0"><p className="truncate text-xs font-black">{trader.displayName}</p><p className="text-[9px] text-white/35">{trader.canCoverAdmin ? "Admin eligible" : "Trader"} · {week.draft.hoursByTrader?.[trader.id] || 0}h</p></div></div><div className="relative min-h-16 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(4.166%-1px),rgba(255,255,255,.055)_calc(4.166%-1px),rgba(255,255,255,.055)_4.166%)]">{dayAssignments.filter((row) => row.traderId === trader.id).map((row) => <div key={row.id} onPointerDown={(event) => beginDrag(event, row, "move")} className={`group absolute top-2 h-12 select-none overflow-hidden rounded-lg border px-2 py-1 shadow-lg ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`} style={{ left: `${(row.startMinute / 1440) * 100}%`, width: `${(Math.min(1440, row.endMinute) - row.startMinute) / 1440 * 100}%`, background: `${trader.color}D9`, borderColor: `${trader.color}` }}><p className="truncate text-[10px] font-black text-black/85">{minuteToLabel(row.startMinute)}–{minuteToLabel(row.endMinute)}</p><p className="truncate text-[9px] font-bold text-black/60">{row.roles.map((role) => ROLE_LABELS[role]).join(" · ")}</p><button onPointerDown={(event) => event.stopPropagation()} onClick={() => setEditing(row)} className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded bg-black/20 text-black group-hover:grid">•••</button>{!locked ? <button aria-label="Resize shift" onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, row, "resize") }} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/15" /> : null}</div>)}</div></div>)}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/35">Unlock Editing to drag shifts, resize their right edge, or move them between trader rows. Times snap to 15 minutes.</p>
        </section>

        <section className="mt-4 grid gap-3 md:grid-cols-2">{roster.filter((row) => row.active).map((trader) => { const hours = week.draft.hoursByTrader?.[trader.id] || 0; const over = hours > trader.targetHoursMax; return <button onClick={() => setEditingTrader(trader)} key={trader.id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[.03] p-3 text-left transition hover:border-white/15"><span className="h-10 w-2 rounded-full" style={{ background: trader.color }} /><div className="min-w-0 flex-1"><div className="flex justify-between text-xs"><b>{trader.displayName}</b><span className={over ? "text-amber-300" : "text-white/45"}>{hours}h / {trader.targetHoursMin}–{trader.targetHoursMax}h</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full" style={{ width: `${Math.min(100, hours / trader.targetHoursMax * 100)}%`, background: trader.color }} /></div><p className="mt-2 text-[10px] text-white/30">{trader.telegramId ? `Telegram ${trader.telegramId}` : "Telegram account not linked"} · Tap to edit</p></div></button> })}</section>
      </div>
      {editing ? <ShiftEditor row={editing} roster={roster} onClose={() => setEditing(null)} onDelete={() => { mutate(assignments.filter((row) => row.id !== editing.id)); setEditing(null) }} onSave={saveEditor} /> : null}
      {editingTrader ? <RosterEditor trader={editingTrader} roster={roster} onSelect={setEditingTrader} onClose={() => setEditingTrader(null)} onSave={saveTrader} /> : null}
    </main>
  )
}

function RosterEditor({ trader, roster, onSelect, onClose, onSave }: { trader: TraderProfile; roster: TraderProfile[]; onSelect: (trader: TraderProfile) => void; onClose: () => void; onSave: (trader: TraderProfile) => void }) {
  const [draft, setDraft] = useState(trader)
  useEffect(() => setDraft(trader), [trader])
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center"><div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0d131f] p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-[#67a4ff]">Trader roster</p><h2 className="mt-1 text-xl font-black">Profiles and weekly targets</h2></div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10"><X className="h-4 w-4" /></button></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{roster.map((row) => <button key={row.id} onClick={() => onSelect(row)} className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-bold ${row.id === trader.id ? "border-[#2f80ff]/50 bg-[#2f80ff]/20" : "border-white/10 text-white/45"}`}><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: row.color }} />{row.displayName}</button>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs text-white/45">Display name<input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white" /></label><label className="space-y-1 text-xs text-white/45">Telegram user ID<input inputMode="numeric" value={draft.telegramId || ""} onChange={(event) => setDraft({ ...draft, telegramId: event.target.value ? Number(event.target.value) : null })} placeholder="Required for /myshift" className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white" /></label><label className="space-y-1 text-xs text-white/45">Minimum weekly hours<input type="number" min="0" max="100" value={draft.targetHoursMin} onChange={(event) => setDraft({ ...draft, targetHoursMin: Number(event.target.value) })} className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white" /></label><label className="space-y-1 text-xs text-white/45">Maximum weekly hours<input type="number" min="0" max="100" value={draft.targetHoursMax} onChange={(event) => setDraft({ ...draft, targetHoursMax: Number(event.target.value) })} className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white" /></label><label className="space-y-1 text-xs text-white/45">Color<input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-black p-1" /></label><label className="flex h-11 items-center gap-2 self-end rounded-xl border border-white/10 px-3 text-sm text-white/65"><input type="checkbox" checked={draft.canCoverAdmin} onChange={(event) => setDraft({ ...draft, canCoverAdmin: event.target.checked })} />Eligible for operational admin coverage</label></div><div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="h-11 rounded-xl border border-white/10 px-4 text-sm font-bold text-white/55">Cancel</button><button onClick={() => onSave(draft)} disabled={!draft.displayName.trim() || draft.targetHoursMax < draft.targetHoursMin} className="h-11 rounded-xl bg-[#2f80ff] px-4 text-sm font-black disabled:opacity-35">Save profile</button></div></div></div>
}

function ShiftEditor({ row, roster, onClose, onDelete, onSave }: { row: ShiftAssignment; roster: TraderProfile[]; onClose: () => void; onDelete: () => void; onSave: (row: ShiftAssignment) => void }) {
  const [draft, setDraft] = useState(row)
  const [overnight, setOvernight] = useState(row.endMinute >= 1440)
  const toggleRole = (role: ScheduleRole) => setDraft((current) => ({ ...current, roles: current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role] }))
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center"><div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0d131f] p-5 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-[#67a4ff]">Shift details</p><h2 className="mt-1 text-xl font-black">{new Date(`${draft.date}T12:00:00Z`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h2></div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10"><X className="h-4 w-4" /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs text-white/45">Trader<select value={draft.traderId} onChange={(event) => setDraft({ ...draft, traderId: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white">{roster.filter((row) => row.active).map((trader) => <option key={trader.id} value={trader.id}>{trader.displayName}</option>)}</select></label><label className="space-y-1 text-xs text-white/45">Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white" /></label><label className="space-y-1 text-xs text-white/45">Starts<input type="time" step="900" value={clockValue(draft.startMinute)} onChange={(event) => setDraft({ ...draft, startMinute: clockMinute(event.target.value) })} className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white" /></label><label className="space-y-1 text-xs text-white/45">Ends<input type="time" step="900" value={clockValue(draft.endMinute)} onChange={(event) => setDraft({ ...draft, endMinute: clockMinute(event.target.value) + (overnight ? 1440 : 0) })} className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white" /></label></div><label className="mt-3 flex items-center gap-2 text-xs text-white/55"><input type="checkbox" checked={overnight} onChange={(event) => { setOvernight(event.target.checked); setDraft({ ...draft, endMinute: clockMinute(clockValue(draft.endMinute)) + (event.target.checked ? 1440 : 0) }) }} />Ends the next day</label><div className="mt-4"><p className="text-xs font-bold text-white/45">Roles</p><div className="mt-2 flex flex-wrap gap-2">{(Object.keys(ROLE_LABELS) as ScheduleRole[]).map((role) => <button key={role} onClick={() => toggleRole(role)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${draft.roles.includes(role) ? "border-[#2f80ff]/50 bg-[#2f80ff]/20 text-[#80b4ff]" : "border-white/10 text-white/45"}`}>{draft.roles.includes(role) ? <Check className="mr-1 inline h-3 w-3" /> : null}{ROLE_LABELS[role]}</button>)}</div></div><textarea value={draft.teamNote || ""} onChange={(event) => setDraft({ ...draft, teamNote: event.target.value })} placeholder="Team-visible note, e.g. Launch oversight" className="mt-4 min-h-20 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white outline-none" /><div className="mt-5 flex items-center justify-between"><button onClick={onDelete} className="h-11 rounded-xl border border-red-500/25 px-3 text-sm font-bold text-red-300"><Trash2 className="mr-1.5 inline h-4 w-4" />Delete</button><div className="flex gap-2"><button onClick={onClose} className="h-11 rounded-xl border border-white/10 px-4 text-sm font-bold text-white/55">Cancel</button><button disabled={!draft.roles.length || draft.endMinute <= draft.startMinute} onClick={() => onSave(draft)} className="h-11 rounded-xl bg-[#2f80ff] px-4 text-sm font-black disabled:opacity-35">Save shift</button></div></div></div></div>
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "green" | "amber" | "red" }) { const color = tone === "green" ? "#34d399" : tone === "amber" ? "#fbbf24" : "#f87171"; return <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[.035] p-4"><span className="grid h-10 w-10 place-items-center rounded-xl" style={{ color, background: `${color}18` }}>{icon}</span><div><p className="text-xs font-bold uppercase tracking-wider text-white/35">{label}</p><p className="mt-1 text-base font-black" style={{ color }}>{value}</p></div></div> }
function Loading() { return <div className="grid min-h-screen place-items-center bg-[#05070c] text-white"><div className="text-center"><Clock3 className="mx-auto h-8 w-8 animate-pulse text-[#2f80ff]" /><p className="mt-3 text-sm text-white/45">Loading trader schedule…</p></div></div> }
function AccessError({ message }: { message: string }) { return <div className="grid min-h-screen place-items-center bg-[#05070c] p-6 text-white"><div className="max-w-sm rounded-3xl border border-red-500/20 bg-red-500/8 p-6 text-center"><Lock className="mx-auto h-8 w-8 text-red-300" /><h1 className="mt-3 text-xl font-black">Management access required</h1><p className="mt-2 text-sm text-white/50">{message || "Use the shared /schedule post in Management Chat to open a fresh planner session."}</p></div></div> }
