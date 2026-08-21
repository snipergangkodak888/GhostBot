import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { verifyAdminToken } from "@/lib/auth"
import {
  acceptReceiptMatch,
  assignFeeProject,
  confirmFeeExpectation,
  createFeeFromReceipt,
  createFeeFromReceipts,
  ensureDailyTradingFeeExpectations,
  listRevenueDay,
  proposeReceiptMatch,
  revenuePayrollDraft,
  resolveFeeWithoutRevenue,
  setFeeQuoteAsset,
  setFeeType,
  updateReceiptClassification,
  valuePendingRevenueReceipts,
} from "@/lib/revenue-service"
import { teamDateKey } from "@/lib/team-timezone"
import type { FeeType, RevenueReceiptStatus } from "@/lib/revenue-types"
import { confirmConsolidation, saveConsolidationPreview } from "@/lib/revenue-consolidation"

export const dynamic = "force-dynamic"

async function requireAdmin() {
  const token = cookies().get("admin_token")?.value
  if (!token) return null
  try { return await verifyAdminToken(token) } catch { return null }
}

export async function GET(req: Request) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const date = url.searchParams.get("date") || teamDateKey(0)
  try {
    if (url.searchParams.get("payroll") === "1") return NextResponse.json(await revenuePayrollDraft(date))
    return NextResponse.json(await listRevenueDay(date))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Revenue data could not be loaded" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!await requireAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    let result: any
    switch (body.action) {
      case "ensure_daily": result = await ensureDailyTradingFeeExpectations(body.date || teamDateKey(0)); break
      case "value_pending": result = await valuePendingRevenueReceipts(body.date || teamDateKey(0)); break
      case "assign_project": result = await assignFeeProject(String(body.feeId), String(body.projectId)); break
      case "set_asset": result = await setFeeQuoteAsset(String(body.feeId), String(body.asset)); break
      case "set_fee_type": result = await setFeeType(String(body.feeId), String(body.feeType) as FeeType); break
      case "confirm_fee": result = await confirmFeeExpectation(String(body.feeId)); break
      case "propose_match": result = await proposeReceiptMatch(String(body.feeId)); break
      case "accept_match": result = await acceptReceiptMatch(String(body.feeId), null, Array.isArray(body.receiptIds) ? body.receiptIds.map(String) : undefined); break
      case "ignore_fee": result = await resolveFeeWithoutRevenue(String(body.feeId), "ignored"); break
      case "waive_fee": result = await resolveFeeWithoutRevenue(String(body.feeId), "waived"); break
      case "classify_receipt": result = await updateReceiptClassification(String(body.receiptId), String(body.status) as RevenueReceiptStatus, body.amountUsd === undefined ? undefined : body.amountUsd == null ? null : Number(body.amountUsd)); break
      case "create_receipt_fee": result = await createFeeFromReceipt({ receiptId: String(body.receiptId), feeType: String(body.feeType) as FeeType, projectId: body.projectId ? String(body.projectId) : null, amount: body.amount == null || body.amount === "" ? null : Number(body.amount) }); break
      case "create_grouped_receipt_fee": result = await createFeeFromReceipts({ receiptIds: Array.isArray(body.receiptIds) ? body.receiptIds.map(String) : [], feeType: String(body.feeType) as FeeType, projectId: body.projectId ? String(body.projectId) : null, amount: body.amount == null || body.amount === "" ? null : Number(body.amount) }); break
      case "preview_consolidation": result = await saveConsolidationPreview(String(body.date || teamDateKey(0)), Number(body.finalUsdc)); break
      case "confirm_consolidation": result = await confirmConsolidation(String(body.date || teamDateKey(0))); break
      default: return NextResponse.json({ error: "Unknown revenue action" }, { status: 400 })
    }
    return NextResponse.json({ ok: true, result })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Revenue action failed" }, { status: 400 })
  }
}
