import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyAdminToken } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { getSheetSchema, SHEET_KIND_ORDER, type SheetKind } from "@/lib/sheet-schemas"

async function requireAdmin() {
  const token = cookies().get("admin_token")?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

function isoDate(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

const examples: Record<SheetKind, string[][]> = {
  income: [
    ["Date", "Source", "Amount", "Currency", "Status", "Notes"],
    [isoDate(0), "24/7 Traders", "3704", "USD", "received", "Daily client income"],
    [isoDate(-1), "Launch Client", "2280", "USD", "received", "Previous day income"],
    [isoDate(-3), "Strategy Desk", "1450", "USD", "pending", "Pending invoice"],
  ],
  expense: [
    ["Date", "Vendor", "Amount", "Currency", "Status", "Notes"],
    [isoDate(0), "Referrer payouts", "466", "USD", "paid", "Referral expense"],
    [isoDate(0), "Tools", "180", "USD", "paid", "Ops tools"],
    [isoDate(-2), "Traffic test", "320", "USD", "pending", "Campaign test"],
  ],
  payroll: [
    ["Date", "Member", "Amount", "Currency", "Status", "Notes"],
    [isoDate(0), "LOTUS", "887", "USD", "paid", "Daily distribution"],
    [isoDate(0), "CASPER", "820", "USD", "paid", "Daily distribution"],
    [isoDate(0), "BANDZ", "400", "USD", "pending", "Needs review"],
  ],
  notes: [
    ["Date", "Topic", "Detail", "Owner", "Status", "Notes"],
    [isoDate(0), "Launch plan", "Prepare dashboard and payroll flow", "LOTUS", "active", "Used for AI context"],
    [isoDate(1), "Client sync", "Review income and expense reports", "CASPER", "scheduled", "Reminder source"],
  ],
  custom: [
    ["Date", "Name", "Value", "Status", "Owner", "Notes"],
    [isoDate(0), "Wallet Source", "Team Wallet", "active", "Treasury", "Custom operational data"],
    [isoDate(0), "Risk Flag", "Medium", "watch", "Ops", "Used to test custom sheets"],
  ],
}

export async function POST() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const db = await getDb()
  const now = new Date()
  const project = {
    name: `Example Project ${now.toISOString().slice(0, 10)}`,
    owner: "Ghost Ops",
    status: "active",
    launchDate: isoDate(7),
    revenueToday: 3704,
    profitThisWeek: 2288,
    tags: ["example", "income", "expense", "payroll", "ai-ready"],
    notes: "Example project with all sheet types and mock data for testing the app and bot.",
    createdAt: now,
    updatedAt: now,
  }
  const projectResult = await db.collection("opsProjects").insertOne(project)
  const projectId = String(projectResult.insertedId)
  const projectName = project.name

  const sheets = SHEET_KIND_ORDER.map((kind) => {
    const schema = getSheetSchema(kind)
    return {
      title: schema.title,
      tabName: schema.tabName,
      category: schema.category,
      sheetType: kind,
      description: `Example ${schema.title.toLowerCase()} data for ${projectName}.`,
      projectId,
      projectName,
      values: examples[kind],
      sourceType: "example",
      createdAt: now,
      updatedAt: now,
    }
  })
  await db.collection("opsSheets").insertMany(sheets)

  const payrollRows = [
    {
      member: "LOTUS",
      role: "Lead",
      projectId,
      project: projectName,
      amount: 887,
      currency: "USD",
      status: "paid",
      date: isoDate(0),
      notes: "Example daily distribution",
      createdFrom: "example",
      createdAt: now,
      updatedAt: now,
    },
    {
      member: "CASPER",
      role: "Operator",
      projectId,
      project: projectName,
      amount: 820,
      currency: "USD",
      status: "paid",
      date: isoDate(0),
      notes: "Example daily distribution",
      createdFrom: "example",
      createdAt: now,
      updatedAt: now,
    },
    {
      member: "BANDZ",
      role: "Support",
      projectId,
      project: projectName,
      amount: 400,
      currency: "USD",
      status: "pending",
      date: isoDate(0),
      notes: "Example pending payroll row",
      createdFrom: "example",
      createdAt: now,
      updatedAt: now,
    },
    {
      member: "ABRA",
      role: "Trader",
      projectId,
      project: projectName,
      amount: 268,
      currency: "USD",
      status: "paid",
      date: isoDate(-1),
      notes: "Previous day payroll example",
      createdFrom: "example",
      createdAt: now,
      updatedAt: now,
    },
  ]
  await db.collection("opsPayroll").insertMany(payrollRows)

  await db.collection("opsReminders").insertOne({
    title: "Review example project data",
    message: "Check income, expense, payroll, notes, and custom data from the example project.",
    projectId,
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    recurrence: "none",
    audience: "team",
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({
    success: true,
    project: { ...project, _id: projectId },
    sheets,
    payrollRows,
  })
}
