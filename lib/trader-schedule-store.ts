import { supabaseRest } from "@/lib/supabase"
import { addDays, compileSchedule, DEFAULT_TRADERS, defaultWeekPayload, scheduleWeekStart } from "@/lib/trader-schedule"
import { SCHEDULE_TIME_ZONE, type SchedulePayload, type ScheduleWeek, type TraderProfile } from "@/lib/trader-schedule-types"

type TraderRow = {
  id: string
  display_name: string
  telegram_id?: number | null
  color: string
  can_cover_admin: boolean
  active: boolean
  target_hours_min: number | string
  target_hours_max: number | string
  sort_order: number
}

type WeekRow = {
  week_start: string
  time_zone: string
  draft_revision: number
  draft: SchedulePayload
  published_revision: number
  published: SchedulePayload | null
  draft_updated_by?: number | null
  published_by?: number | null
  published_at?: string | null
  created_at?: string
  updated_at?: string
}

function mapTrader(row: TraderRow): TraderProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    telegramId: row.telegram_id == null ? null : Number(row.telegram_id),
    color: row.color,
    canCoverAdmin: row.can_cover_admin,
    active: row.active,
    targetHoursMin: Number(row.target_hours_min || 0),
    targetHoursMax: Number(row.target_hours_max || 40),
    sortOrder: Number(row.sort_order || 0),
  }
}

function mapWeek(row: WeekRow): ScheduleWeek {
  return {
    weekStart: row.week_start,
    timeZone: row.time_zone,
    draftRevision: Number(row.draft_revision),
    draft: row.draft || { assignments: [] },
    publishedRevision: Number(row.published_revision || 0),
    published: row.published || null,
    draftUpdatedBy: row.draft_updated_by == null ? null : Number(row.draft_updated_by),
    publishedBy: row.published_by == null ? null : Number(row.published_by),
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function ensureTraderRoster() {
  const existing = await supabaseRest<TraderRow[]>("trader_profiles?select=*&order=sort_order.asc")
  if (existing.length) return existing.map(mapTrader)
  await supabaseRest("trader_profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: DEFAULT_TRADERS.map((row) => ({
      id: row.id,
      display_name: row.displayName,
      telegram_id: row.telegramId || null,
      color: row.color,
      can_cover_admin: row.canCoverAdmin,
      active: row.active,
      target_hours_min: row.targetHoursMin,
      target_hours_max: row.targetHoursMax,
      sort_order: row.sortOrder,
    })),
  })
  return DEFAULT_TRADERS
}

export async function updateTraderProfile(id: string, changes: Partial<TraderProfile>, audit?: { actorTelegramId: number; sourceChatId: string }) {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof changes.displayName === "string") body.display_name = changes.displayName.trim()
  if (changes.telegramId !== undefined) body.telegram_id = changes.telegramId || null
  if (typeof changes.color === "string") body.color = changes.color
  if (typeof changes.canCoverAdmin === "boolean") body.can_cover_admin = changes.canCoverAdmin
  if (typeof changes.active === "boolean") body.active = changes.active
  if (Number.isFinite(changes.targetHoursMin)) body.target_hours_min = changes.targetHoursMin
  if (Number.isFinite(changes.targetHoursMax)) body.target_hours_max = changes.targetHoursMax
  const rows = await supabaseRest<TraderRow[]>(`trader_profiles?id=eq.${encodeURIComponent(id)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body })
  if (rows[0] && audit) await writeAudit({ action: "update_trader_profile", actorTelegramId: audit.actorTelegramId, sourceChatId: audit.sourceChatId, details: { traderId: id, changedFields: Object.keys(body).filter((key) => key !== "updated_at") } })
  return rows[0] ? mapTrader(rows[0]) : null
}

export async function getScheduleWeek(weekStart = scheduleWeekStart()) {
  const rows = await supabaseRest<WeekRow[]>(`trader_schedule_weeks?week_start=eq.${encodeURIComponent(weekStart)}&select=*`)
  if (rows[0]) return mapWeek(rows[0])
  const roster = await ensureTraderRoster()
  const initial = compileSchedule(weekStart, defaultWeekPayload(weekStart), roster)
  await supabaseRest("trader_schedule_weeks?on_conflict=week_start", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: {
      week_start: weekStart,
      time_zone: SCHEDULE_TIME_ZONE,
      draft_revision: 1,
      draft: initial,
      published_revision: 1,
      published: initial,
      published_at: new Date().toISOString(),
    },
  })
  const created = await supabaseRest<WeekRow[]>(`trader_schedule_weeks?week_start=eq.${encodeURIComponent(weekStart)}&select=*`)
  if (!created[0]) throw new Error("Schedule week could not be created")
  return mapWeek(created[0])
}

async function writeAudit(params: { weekStart?: string | null; action: string; actorTelegramId?: number | null; sourceChatId?: string | null; revision?: number | null; details?: Record<string, unknown> }) {
  await supabaseRest("trader_schedule_audit", {
    method: "POST",
    body: {
      week_start: params.weekStart || null,
      action: params.action,
      actor_telegram_id: params.actorTelegramId || null,
      source_chat_id: params.sourceChatId || null,
      revision: params.revision || null,
      details: params.details || {},
    },
  })
}

export async function saveScheduleDraft(params: { weekStart: string; expectedRevision: number; payload: SchedulePayload; actorTelegramId: number; sourceChatId: string }) {
  const roster = await ensureTraderRoster()
  const compiled = compileSchedule(params.weekStart, params.payload, roster)
  const nextRevision = params.expectedRevision + 1
  const rows = await supabaseRest<WeekRow[]>(
    `trader_schedule_weeks?week_start=eq.${encodeURIComponent(params.weekStart)}&draft_revision=eq.${params.expectedRevision}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { draft: compiled, draft_revision: nextRevision, draft_updated_by: params.actorTelegramId, updated_at: new Date().toISOString() },
    },
  )
  if (!rows[0]) return { ok: false as const, conflict: true as const }
  await writeAudit({ weekStart: params.weekStart, action: "save_draft", actorTelegramId: params.actorTelegramId, sourceChatId: params.sourceChatId, revision: nextRevision, details: { assignments: compiled.assignments.length, errors: compiled.issues?.filter((issue) => issue.severity === "error").length || 0 } })
  return { ok: true as const, week: mapWeek(rows[0]) }
}

export async function publishScheduleWeek(params: { weekStart: string; expectedDraftRevision: number; actorTelegramId: number; sourceChatId: string }) {
  const current = await getScheduleWeek(params.weekStart)
  if (current.draftRevision !== params.expectedDraftRevision) return { ok: false as const, conflict: true as const }
  const roster = await ensureTraderRoster()
  const compiled = compileSchedule(params.weekStart, current.draft, roster)
  const errors = compiled.issues?.filter((issue) => issue.severity === "error") || []
  if (errors.length) return { ok: false as const, validation: true as const, issues: errors }
  const nextPublishedRevision = current.publishedRevision + 1
  const now = new Date().toISOString()
  const rows = await supabaseRest<WeekRow[]>(
    `trader_schedule_weeks?week_start=eq.${encodeURIComponent(params.weekStart)}&draft_revision=eq.${params.expectedDraftRevision}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { published: compiled, published_revision: nextPublishedRevision, published_by: params.actorTelegramId, published_at: now, updated_at: now },
    },
  )
  if (!rows[0]) return { ok: false as const, conflict: true as const }
  await writeAudit({ weekStart: params.weekStart, action: "publish", actorTelegramId: params.actorTelegramId, sourceChatId: params.sourceChatId, revision: nextPublishedRevision, details: { draftRevision: params.expectedDraftRevision, assignments: compiled.assignments.length, warnings: compiled.issues?.filter((issue) => issue.severity === "warning").length || 0, snapshot: compiled } })
  return { ok: true as const, week: mapWeek(rows[0]) }
}

export async function restoreScheduleRevision(params: { weekStart: string; revision: number; expectedRevision: number; actorTelegramId: number; sourceChatId: string }) {
  const rows = await supabaseRest<Array<{ action: string; revision: number | null; details?: { snapshot?: SchedulePayload } }>>(
    `trader_schedule_audit?week_start=eq.${encodeURIComponent(params.weekStart)}&revision=eq.${params.revision}&select=action,revision,details&order=created_at.desc&limit=20`,
  )
  const snapshot = rows.find((row) => row.action === "publish" && Array.isArray(row.details?.snapshot?.assignments))?.details?.snapshot
  if (!snapshot) return { ok: false as const, missing: true as const }
  const restored = await saveScheduleDraft({ ...params, payload: snapshot })
  if (restored.ok) await writeAudit({ weekStart: params.weekStart, action: "restore_revision", actorTelegramId: params.actorTelegramId, sourceChatId: params.sourceChatId, revision: params.revision, details: { restoredAsDraftRevision: restored.week.draftRevision } })
  return restored
}

export async function copyPreviousScheduleWeek(params: { weekStart: string; expectedRevision: number; actorTelegramId: number; sourceChatId: string }) {
  const previousStart = addDays(params.weekStart, -7)
  const [target, previous, roster] = await Promise.all([getScheduleWeek(params.weekStart), getScheduleWeek(previousStart), ensureTraderRoster()])
  if (target.draftRevision !== params.expectedRevision) return { ok: false as const, conflict: true as const }
  const source = previous.published || previous.draft
  const assignments = source.assignments.map((row) => {
    const day = Math.round((Date.parse(`${row.date}T12:00:00Z`) - Date.parse(`${previousStart}T12:00:00Z`)) / 86_400_000)
    return { ...row, id: crypto.randomUUID(), date: new Date(Date.parse(`${params.weekStart}T12:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10) }
  })
  return saveScheduleDraft({ ...params, payload: compileSchedule(params.weekStart, { assignments }, roster) })
}

export async function listScheduleAudit(weekStart: string) {
  return supabaseRest<any[]>(`trader_schedule_audit?week_start=eq.${encodeURIComponent(weekStart)}&select=*&order=created_at.desc&limit=50`)
}
