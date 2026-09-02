import { NextResponse } from "next/server"
import { requireScheduleEditor } from "@/lib/trader-schedule-access"
import { ensureTraderRoster, getScheduleWeek, listScheduleAudit, publishScheduleWeek, saveScheduleDraft, copyPreviousScheduleWeek, restoreScheduleRevision, updateTraderProfile } from "@/lib/trader-schedule-store"
import { scheduleWeekStart } from "@/lib/trader-schedule"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const editor = await requireScheduleEditor()
  if (!editor) return NextResponse.json({ error: "Management schedule access required" }, { status: 401 })
  const requested = new URL(req.url).searchParams.get("week") || scheduleWeekStart()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) return NextResponse.json({ error: "Invalid week" }, { status: 400 })
  const [week, roster, audit] = await Promise.all([getScheduleWeek(requested), ensureTraderRoster(), listScheduleAudit(requested)])
  return NextResponse.json({ week, roster, audit, editor })
}

export async function PATCH(req: Request) {
  const editor = await requireScheduleEditor()
  if (!editor) return NextResponse.json({ error: "Management schedule access required" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || "save")
  const weekStart = String(body.weekStart || "")
  if (action === "update-trader") {
    const trader = await updateTraderProfile(String(body.id || ""), body.changes || {}, { actorTelegramId: editor.telegramId, sourceChatId: editor.sourceChatId })
    return trader ? NextResponse.json({ trader }) : NextResponse.json({ error: "Trader not found" }, { status: 404 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return NextResponse.json({ error: "Invalid week" }, { status: 400 })
  const common = { weekStart, actorTelegramId: editor.telegramId, sourceChatId: editor.sourceChatId }
  const result = action === "publish"
    ? await publishScheduleWeek({ ...common, expectedDraftRevision: Number(body.expectedRevision) })
    : action === "copy-previous"
      ? await copyPreviousScheduleWeek({ ...common, expectedRevision: Number(body.expectedRevision) })
      : action === "restore"
        ? await restoreScheduleRevision({ ...common, expectedRevision: Number(body.expectedRevision), revision: Number(body.revision) })
      : await saveScheduleDraft({ ...common, expectedRevision: Number(body.expectedRevision), payload: { assignments: Array.isArray(body.assignments) ? body.assignments : [] } })
  if (!result.ok && "conflict" in result) return NextResponse.json({ error: "This week changed in another session. Reload before continuing.", conflict: true }, { status: 409 })
  if (!result.ok && "validation" in result) return NextResponse.json({ error: "Admin coverage must be complete before publishing.", issues: result.issues }, { status: 422 })
  if (!result.ok && "missing" in result) return NextResponse.json({ error: "That published revision is no longer available." }, { status: 404 })
  return NextResponse.json(result)
}
