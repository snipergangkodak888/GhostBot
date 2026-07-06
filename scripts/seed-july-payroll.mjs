#!/usr/bin/env node
/**
 * Seeds Ghost Test DB with July 2026 payroll ledger data from daily income sheets.
 * Usage: node scripts/seed-july-payroll.mjs
 */
import crypto from "node:crypto"
import fs from "fs"
import path from "path"
import dotenv from "dotenv"

const cwd = process.cwd()
const localEnv = path.join(cwd, ".env.local")
dotenv.config(fs.existsSync(localEnv) ? { path: localEnv } : undefined)

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const prodRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF || ""

if (!supabaseUrl || !serviceRoleKey) {
  console.error("[seed-july] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.local)")
  process.exit(1)
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0]
if (prodRef && projectRef === prodRef) {
  console.error("[seed-july] Refusing to seed production Supabase project.")
  process.exit(1)
}

function stableId(seed) {
  return crypto.createHash("md5").update(seed).digest("hex").slice(0, 24)
}

async function supabaseRest(pathname, options = {}) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${supabaseUrl}${pathname}`, {
        method: options.method || "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      if (!res.ok) {
        const message = await res.text().catch(() => res.statusText)
        throw new Error(`Supabase ${res.status}: ${message}`)
      }
      if (res.status === 204) return null
      return res.json().catch(() => null)
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError
}

async function upsertDocument(collection, id, data) {
  return supabaseRest("/rest/v1/documents?on_conflict=collection,id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      collection,
      id,
      data: { ...data, _id: id },
      updated_at: new Date().toISOString(),
    },
  })
}

async function fetchCollection(collection) {
  const rows = await supabaseRest(`/rest/v1/documents?collection=eq.${collection}&select=id,data`)
  return Array.isArray(rows) ? rows.map((row) => ({ id: row.id, ...row.data, _id: row.id })) : []
}

async function deleteByDate(collection, date) {
  const rows = await fetchCollection(collection)
  const matches = rows.filter((row) => String(row.date || "").slice(0, 10) === date)
  for (const row of matches) {
    await supabaseRest(`/rest/v1/documents?collection=eq.${collection}&id=eq.${row.id}`, { method: "DELETE" })
  }
}

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

function calculatePayrollLedger(input) {
  const basePay = Number(input.basePay ?? 150)
  const chartPay = Number(input.chartPay ?? 50)
  const accountsById = new Map(input.accounts.map((account) => [String(account.id || account._id), account]))
  const accountsByName = new Map(input.accounts.map((account) => [String(account.name || "").trim().toLowerCase(), account]))
  const projectsById = new Map((input.projects || []).map((project) => [String(project.id || project._id), project]))
  const distributions = new Map()

  const ensureDistribution = (account) => {
    const id = String(account.id || account._id)
    if (!distributions.has(id)) {
      distributions.set(id, {
        accountId: id,
        accountName: account.name,
        accountType: account.type,
        basePayroll: 0,
        referralCommission: 0,
        netProfitShare: 0,
        devShare: 0,
        total: 0,
        wallet: String(account.wallet || account.source || "").trim(),
      })
    }
    return distributions.get(id)
  }

  const totalDailyIncome = roundMoney(input.clientIncome.reduce((sum, row) => sum + Number(row.income || 0), 0))
  const totalDevAllo = roundMoney(input.devAllocations.reduce((sum, row) => sum + Number(row.income || 0), 0))

  let totalTeamPayroll = 0
  for (const row of input.teamPayroll) {
    if (row.status !== "active") continue
    const account = accountsById.get(row.accountId)
    if (!account || account.type !== "EMPLOYEE") continue
    const manualAmount = Number(row.manualAmount)
    let amount = 0
    if (Number.isFinite(manualAmount) && manualAmount > 0) {
      amount = roundMoney(manualAmount)
    } else {
      const projectCount = Array.isArray(row.projectIds) ? new Set(row.projectIds.filter(Boolean)).size : 0
      if (projectCount === 0 && Array.isArray(row.projectIds)) continue
      const extraProjects = projectCount > 0 ? projectCount - 1 : Math.max(0, Number(row.charts || 0))
      amount = roundMoney(basePay + chartPay * extraProjects)
    }
    const distribution = ensureDistribution(account)
    distribution.basePayroll = roundMoney(distribution.basePayroll + amount)
    totalTeamPayroll = roundMoney(totalTeamPayroll + amount)
  }

  const referrals = []
  let totalReferrals = 0
  for (const row of input.clientIncome) {
    if (row.skipReferral) continue
    const project = row.projectId ? projectsById.get(String(row.projectId)) : null
    const client = row.accountId ? accountsById.get(row.accountId) : null
    const referrerId = project?.referrerAccountId || (client?.referralId ?? client?.referral_id ?? null)
    const referrer = referrerId
      ? accountsById.get(String(referrerId))
      : project?.referrer
        ? accountsByName.get(String(project.referrer).trim().toLowerCase())
        : null
    const percentage = Number(
      project?.referralPercentage ??
      project?.referrerPercentage ??
      (client ? Number(client.profitSharePercentage ?? client.profit_share_percentage ?? 0) : 0),
    )
    if (!referrer || percentage <= 0) continue
    const amount = roundMoney(Math.floor(Number(row.income || 0) * (percentage / 100)))
    if (amount <= 0) continue
    const distribution = ensureDistribution(referrer)
    distribution.referralCommission = roundMoney(distribution.referralCommission + amount)
    referrals.push({
      referrerAccountId: String(referrer.id || referrer._id),
      referrerName: referrer.name,
      clientAccountId: project ? String(project.id || project._id) : client ? String(client.id || client._id) : "",
      clientName: project?.name || client?.name || "Project",
      percentage,
      amount,
    })
    totalReferrals = roundMoney(totalReferrals + amount)
  }

  const netProfit = roundMoney(totalDailyIncome - (totalTeamPayroll + totalReferrals))

  for (const account of input.accounts) {
    if (account.type !== "EMPLOYEE" && account.type !== "SYSTEM_TREASURY") continue
    const percentage = Number(account.profitSharePercentage ?? account.profit_share_percentage ?? 0)
    if (percentage <= 0) continue
    const distribution = ensureDistribution(account)
    distribution.netProfitShare = roundMoney(distribution.netProfitShare + netProfit * (percentage / 100))
    distribution.devShare = roundMoney(distribution.devShare + totalDevAllo * (percentage / 100))
  }

  const rows = Array.from(distributions.values())
    .map((row) => ({
      ...row,
      total: roundMoney(row.basePayroll + row.referralCommission + row.netProfitShare + row.devShare),
    }))
    .filter((row) => row.total !== 0)
    .sort((a, b) => b.total - a.total || a.accountName.localeCompare(b.accountName))

  return {
    totalDailyIncome,
    totalDevAllo,
    totalTeamPayroll,
    totalReferrals,
    netProfit,
    totalDistributed: roundMoney(rows.reduce((sum, row) => sum + row.total, 0)),
    referrals,
    distributions: rows,
  }
}

const EMPLOYEES = [
  { name: "LOTUS", profitSharePercentage: 22.5, wallet: "GxkWTuD8KyYb6" },
  { name: "CASPER", profitSharePercentage: 22.5, wallet: "8oR9qCPLCFiH1b" },
  { name: "LITWICK", profitSharePercentage: 10, wallet: "9UiUysdUvubiN8h" },
  { name: "ABRA", profitSharePercentage: 22.5, wallet: "mYkkV4WRNmWL" },
  { name: "NONCE", profitSharePercentage: 10, wallet: "28Gv8a3Mt7Nc6tq" },
  { name: "BANDZ", profitSharePercentage: 2, wallet: "HfCu5roJ3NehpN" },
  { name: "CAZAM", profitSharePercentage: 0, wallet: "HPNiaT45jdkiUuqt" },
]

const REFERRERS = [
  { name: "BK", wallet: "F43T5TKFHXVI" },
  { name: "FROG", wallet: "47PqinkZ5yAJI" },
]

const TREASURY = { name: "Treasury", profitSharePercentage: 10.5 }

const PROJECTS = [
  { name: "USWR", referrer: "BK", referralPercentage: 20 },
  { name: "AAIF", referrer: "BK", referralPercentage: 20 },
  { name: "USFR", referrer: "BK", referralPercentage: 20 },
  { name: "BBF", referrer: "BK", referralPercentage: 20 },
  { name: "PAPAYA", referrer: "FROG", referralPercentage: 20 },
  { name: "FREEDOM" },
  { name: "VIRL" },
  { name: "HOOD" },
  { name: "JOE" },
  { name: "ANSUM" },
  { name: "ARROW" },
  { name: "TOKINVES" },
  { name: "BOND" },
  { name: "USFS" },
]

/** @type {Array<{ date: string, payroll: Array<[string, object]>, trading: Array<[string, number]>, misc: Array<{ income: number, category: string, project?: string }> }>} */
const JULY_DAYS = [
  {
    date: "2026-07-01",
    payroll: [
      ["LITWICK", { charts: 6 }],
      ["BANDZ", { charts: 6 }],
      ["CAZAM", { manualAmount: 75 }],
    ],
    trading: [
      ["USWR", 8008], ["AAIF", 500], ["JOE", 554], ["FREEDOM", 500],
      ["BBF", 589], ["VIRL", 593], ["USFS", 500],
    ],
    misc: [
      { income: 1170, category: "fee_rebate" },
      { income: 72, category: "dev_allocation", project: "BBF" },
    ],
  },
  {
    date: "2026-07-02",
    payroll: [
      ["LITWICK", { charts: 6 }],
      ["BANDZ", { charts: 5 }],
      ["CAZAM", { manualAmount: 75 }],
    ],
    trading: [
      ["USWR", 12812], ["AAIF", 500], ["USFR", 500], ["FREEDOM", 500],
      ["BBF", 389], ["VIRL", 250], ["HOOD", 1000],
    ],
    misc: [
      { income: 1235, category: "fee_rebate" },
      { income: 67, category: "dev_allocation", project: "BBF" },
      { income: 267, category: "dev_allocation", project: "HOOD" },
    ],
  },
  {
    date: "2026-07-03",
    payroll: [
      ["LITWICK", { charts: 7 }],
      ["BANDZ", { charts: 5 }],
      ["CAZAM", { manualAmount: 75 }],
    ],
    trading: [
      ["USWR", 16120], ["AAIF", 1220], ["USFR", 7500], ["FREEDOM", 500],
      ["PAPAYA", 1052], ["VIRL", 513], ["HOOD", 500], ["JOE", 132], ["ANSUM", 2531],
    ],
    misc: [
      { income: 3004, category: "fee_rebate" },
      { income: 275, category: "private_liqs" },
      { income: 1462, category: "dev_allocation", project: "HOOD" },
      { income: 63, category: "dev_allocation", project: "PAPAYA" },
      { income: 202, category: "dev_allocation", project: "ANSUM" },
    ],
  },
  {
    date: "2026-07-04",
    payroll: [
      ["LITWICK", { charts: 7 }],
      ["BANDZ", { charts: 7 }],
    ],
    trading: [
      ["USWR", 7407], ["AAIF", 500], ["USFR", 500], ["FREEDOM", 500],
      ["PAPAYA", 500], ["VIRL", 250], ["HOOD", 500], ["ANSUM", 10454],
    ],
    misc: [
      { income: 1644, category: "fee_rebate" },
      { income: 895, category: "private_liqs" },
      { income: 718, category: "dev_allocation", project: "HOOD" },
      { income: 166, category: "dev_allocation", project: "PAPAYA" },
      { income: 2085, category: "dev_allocation", project: "ANSUM" },
    ],
  },
  {
    date: "2026-07-05",
    payroll: [
      ["LITWICK", { charts: 9 }],
      ["BANDZ", { charts: 7 }],
      ["CAZAM", { manualAmount: 150 }],
    ],
    trading: [
      ["USWR", 1527], ["AAIF", 712], ["USFR", 500], ["FREEDOM", 500],
      ["PAPAYA", 114], ["VIRL", 250], ["HOOD", 594], ["ANSUM", 3539],
      ["ARROW", 500], ["TOKINVES", 2444], ["BOND", 1035],
    ],
    misc: [
      { income: 1603, category: "fee_rebate" },
      { income: 182, category: "private_liqs" },
      { income: 637, category: "dev_allocation", project: "HOOD" },
      { income: 111, category: "dev_allocation", project: "PAPAYA" },
      { income: 918, category: "dev_allocation", project: "ANSUM" },
      { income: 872, category: "dev_allocation", project: "TOKINVES" },
      { income: 724, category: "dev_allocation", project: "BOND" },
    ],
  },
]

async function seedAccounts() {
  const now = new Date().toISOString()
  const accountIds = new Map()

  for (const row of EMPLOYEES) {
    const id = stableId(`employee:${row.name}`)
    accountIds.set(row.name, id)
    await upsertDocument("payrollAccounts", id, {
      name: row.name,
      type: "EMPLOYEE",
      profitSharePercentage: row.profitSharePercentage,
      wallet: row.wallet,
      createdAt: now,
      updatedAt: now,
    })
  }

  for (const row of REFERRERS) {
    const id = stableId(`referrer:${row.name}`)
    accountIds.set(row.name, id)
    await upsertDocument("payrollAccounts", id, {
      name: row.name,
      type: "REFERRER",
      wallet: row.wallet,
      profitSharePercentage: 0,
      createdAt: now,
      updatedAt: now,
    })
  }

  const treasuryId = stableId("treasury:main")
  accountIds.set(TREASURY.name, treasuryId)
  await upsertDocument("payrollAccounts", treasuryId, {
    name: TREASURY.name,
    type: "SYSTEM_TREASURY",
    profitSharePercentage: TREASURY.profitSharePercentage,
    createdAt: now,
    updatedAt: now,
  })

  console.log(`[seed-july] Upserted ${EMPLOYEES.length} employees, ${REFERRERS.length} referrers, treasury`)
  return accountIds
}

async function seedProjects(accountIds) {
  const now = new Date().toISOString()
  const projectIds = new Map()

  for (const row of PROJECTS) {
    const id = stableId(`project:${row.name}`)
    projectIds.set(row.name, id)
    const referrerAccountId = row.referrer ? accountIds.get(row.referrer) : null
    await upsertDocument("opsProjects", id, {
      name: row.name,
      owner: "Ghost Ops",
      status: "active",
      referrer: row.referrer || "",
      referrerAccountId: referrerAccountId || null,
      referralPercentage: Number(row.referralPercentage || 0),
      tags: ["payroll-seed", "july-2026"],
      notes: "Seeded from July 2026 daily income sheets",
      createdAt: now,
      updatedAt: now,
    })
  }

  console.log(`[seed-july] Upserted ${PROJECTS.length} projects`)
  return projectIds
}

async function savePayrollDay({ date, accounts, projects, accountIds, projectIds, day }) {
  const rules = {
    dayType: "Trading Days",
    recipient: "Traders Only",
    basePay: 150,
    extraPay: 50,
  }

  const teamPayroll = day.payroll.map(([name, opts]) => ({
    accountId: accountIds.get(name),
    status: "active",
    ...opts,
  }))

  const clientIncome = day.trading.map((entry) => {
    const [name, income, opts = {}] = entry
    return {
      projectId: projectIds.get(name),
      incomeType: "24/7 Traders",
      income,
      ...opts,
    }
  })

  const devAllocations = day.misc.map((row) => ({
    income: row.income,
    category: row.category || "dev_allocation",
    projectId: row.project ? projectIds.get(row.project) : undefined,
  }))

  const calculation = calculatePayrollLedger({
    accounts,
    projects,
    teamPayroll,
    clientIncome,
    devAllocations,
    basePay: rules.basePay,
    chartPay: rules.extraPay,
  })

  const inputs = { teamPayroll, clientIncome, devAllocations, rules }
  const now = new Date()

  await Promise.all([
    deleteByDate("dailyPayrollEntries", date),
    deleteByDate("ledgerTransactions", date),
  ])

  const miniLedgerRows = await fetchCollection("opsPayroll")
  for (const row of miniLedgerRows.filter((r) => String(r.date || "").slice(0, 10) === date && r.source === "mini-ledger")) {
    await supabaseRest(`/rest/v1/documents?collection=eq.opsPayroll&id=eq.${row.id}`, { method: "DELETE" })
  }

  const entryId = stableId(`daily-payroll:${date}`)
  const summary = {
    date,
    totalIncome: calculation.totalDailyIncome,
    totalDevAllo: calculation.totalDevAllo,
    totalTeamPayroll: calculation.totalTeamPayroll,
    totalReferrals: calculation.totalReferrals,
    netProfit: calculation.netProfit,
    totalDistributed: calculation.totalDistributed,
    inputs,
    calculation,
    notes: "Seeded from July 2026 spreadsheet",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  await upsertDocument("dailyPayrollEntries", entryId, summary)

  const transactionRows = calculation.distributions.flatMap((row) => {
    const parts = [
      ["base_payroll", row.basePayroll],
      ["referral_commission", row.referralCommission],
      ["net_profit_share", row.netProfitShare],
      ["dev_share", row.devShare],
    ]
    return parts
      .filter(([, amount]) => Number(amount || 0) !== 0)
      .map(([source, amount], index) => ({
        dailyPayrollEntryId: entryId,
        accountId: row.accountId,
        accountName: row.accountName,
        accountType: row.accountType,
        source,
        amount: Number(amount || 0),
        date,
        createdAt: now.toISOString(),
        _seedIndex: index,
      }))
  })

  for (const [index, row] of transactionRows.entries()) {
    const txId = stableId(`ledger-tx:${date}:${row.accountId}:${row.source}:${index}`)
    await upsertDocument("ledgerTransactions", txId, row)
  }

  for (const [index, row] of calculation.distributions.entries()) {
    const payId = stableId(`ops-payroll:${date}:${row.accountId}:${index}`)
    await upsertDocument("opsPayroll", payId, {
      member: row.accountName,
      accountId: row.accountId,
      role: row.accountType,
      amount: row.total,
      currency: "USD",
      status: "paid",
      date,
      notes: summary.notes,
      source: "mini-ledger",
      dailyPayrollEntryId: entryId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
  }

  console.log(
    `[seed-july] ${date} — income $${calculation.totalDailyIncome}, misc $${calculation.totalDevAllo}, payroll $${calculation.totalTeamPayroll}, referrals $${calculation.totalReferrals}, net $${calculation.netProfit}, distributed $${calculation.totalDistributed}`,
  )
}

async function main() {
  console.log(`[seed-july] Target: Ghost Test DB (${projectRef})`)
  const accountIds = await seedAccounts()
  const projectIds = await seedProjects(accountIds)

  const accounts = await fetchCollection("payrollAccounts")
  const projects = await fetchCollection("opsProjects").then((rows) =>
    rows.map((p) => ({
      ...p,
      id: p.id,
      referrerAccountId: p.referrerAccountId || null,
      referralPercentage: Number(p.referralPercentage || 0),
    })),
  )

  for (const day of JULY_DAYS) {
    await savePayrollDay({ date: day.date, accounts, projects, accountIds, projectIds, day })
  }

  const monthIncome = JULY_DAYS.reduce((sum, day) => sum + day.trading.reduce((s, [, v]) => s + v, 0), 0)
  const monthMisc = JULY_DAYS.reduce((sum, day) => sum + day.misc.reduce((s, row) => s + row.income, 0), 0)
  console.log(`[seed-july] Done — ${JULY_DAYS.length} days, $${monthIncome} trading income, $${monthMisc} misc income`)
}

main().catch((error) => {
  console.error(error?.cause?.message || error?.message || error)
  process.exitCode = 1
})
