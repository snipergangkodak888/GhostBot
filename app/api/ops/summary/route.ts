import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { calculateSheetFinancials } from '@/lib/ops-sheets'
import {
  aggregateLedgerPeriod,
  monthStartKey,
  payrollFinancials,
  teamEstDateKey,
  weekStartKey,
} from '@/lib/payroll-financials'

export const dynamic = 'force-dynamic'

function shiftDateKey(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function GET() {
  let projects: any[] = []
  let reminders: any[] = []
  let payroll: any[] = []
  let docs: any[] = []
  let sheets: any[] = []
  let dailyPayrollEntries: any[] = []

  try {
    const db = await getDb()
    ;[projects, reminders, payroll, docs, sheets, dailyPayrollEntries] = await Promise.all([
      db.collection('opsProjects').find({}).toArray(),
      db.collection('opsReminders').find({}).toArray(),
      db.collection('opsPayroll').find({}).toArray(),
      db.collection('opsDocs').find({}).toArray(),
      db.collection('opsSheets').find({}).toArray(),
      db.collection('dailyPayrollEntries').find({}).toArray(),
    ])
  } catch {}

  const now = Date.now()
  const activeProjects = projects.filter((p: any) => p.status !== 'inactive')
  const upcomingReminders = reminders
    .filter((r: any) => r.status !== 'done' && new Date(r.dueAt).getTime() >= now)
    .sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 6)
  const payrollPending = payroll.filter((row: any) => row.status !== 'paid')
  const sheetFinancials = calculateSheetFinancials(sheets)
  const legacyRevenueToday = projects.reduce((sum: number, p: any) => sum + Number(p.revenueToday || 0), 0)
  const legacyProfitThisWeek = projects.reduce((sum: number, p: any) => sum + Number(p.profitThisWeek || 0), 0)
  const todayKey = teamEstDateKey()
  const weekStart = weekStartKey(todayKey)
  const monthStart = monthStartKey(todayKey)
  const payrollToday = payrollFinancials(dailyPayrollEntries, todayKey, todayKey)
  const payrollWeek = payrollFinancials(dailyPayrollEntries, weekStart, todayKey)
  const payrollMonth = payrollFinancials(dailyPayrollEntries, monthStart, todayKey)
  const revenueToday = payrollToday.hasEntries
    ? payrollToday.income
    : sheetFinancials.incomeToday || legacyRevenueToday
  const profitToday = payrollToday.hasEntries ? payrollToday.profit : sheetFinancials.profitToday
  const profitThisWeek = payrollWeek.hasEntries
    ? payrollWeek.profit
    : sheetFinancials.profitThisWeek || legacyProfitThisWeek
  const profitThisMonth = payrollMonth.hasEntries ? payrollMonth.profit : sheetFinancials.profitThisMonth
  const monthTotals = aggregateLedgerPeriod(dailyPayrollEntries, monthStart, todayKey)

  const cryptoRows = await Promise.all([
    price('ETH', 'ethereum'),
    price('SOL', 'solana'),
    price('BASE', 'base'),
  ])
  const crypto = {
    ethereum: cryptoRows[0]?.usd ?? null,
    solana: cryptoRows[1]?.usd ?? null,
    base: cryptoRows[2]?.usd ?? null,
  }

  return NextResponse.json({
    metrics: {
      activeProjects: activeProjects.length,
      inactiveProjects: projects.length - activeProjects.length,
      remindersScheduled: reminders.filter((r: any) => r.status !== 'done').length,
      payrollPending: payrollPending.length,
      docs: docs.length,
      sheets: sheets.length,
      revenueToday,
      profitToday,
      profitThisWeek,
      profitThisMonth,
      miscIncomeThisMonth: monthTotals.hasEntries ? monthTotals.miscIncome : 0,
      totalProfitPoolThisMonth: monthTotals.hasEntries ? monthTotals.totalProfitPool : profitThisMonth,
      payrollDaysThisMonth: monthTotals.dayCount,
      expenseToday: payrollToday.hasEntries
        ? payrollToday.expense
        : sheetFinancials.expenseToday + sheetFinancials.payrollToday,
      incomeThisWeek: payrollWeek.hasEntries ? payrollWeek.income : sheetFinancials.incomeThisWeek,
      expenseThisWeek: payrollWeek.hasEntries ? payrollWeek.expense - payrollWeek.payroll : sheetFinancials.expenseThisWeek,
      payrollThisWeek: payrollWeek.hasEntries ? payrollWeek.payroll : sheetFinancials.payrollThisWeek,
      expenseTotalThisWeek: payrollWeek.hasEntries
        ? payrollWeek.expense
        : sheetFinancials.expenseThisWeek + sheetFinancials.payrollThisWeek,
      expenseThisMonth: payrollMonth.hasEntries
        ? payrollMonth.expense
        : sheetFinancials.expenseThisMonth + sheetFinancials.payrollThisMonth,
    },
    projects: activeProjects.slice(0, 8),
    upcomingReminders,
    payrollPending: payrollPending.slice(0, 6),
    crypto,
  })
}

async function price(symbol: string, ids: string) {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { cache: 'no-store' })
    const json = await res.json()
    const value = json?.[ids]?.usd
    return { symbol, usd: typeof value === 'number' ? value : null }
  } catch {
    return { symbol, usd: null }
  }
}
