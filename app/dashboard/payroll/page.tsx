"use client"

import { type ReactNode, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, DollarSign, Download, Edit3, Image, Plus, Save, Send, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { usePayrollCalculator } from "@/hooks/use-payroll-calculator"
import type { PayrollAccount, PayrollAccountType } from "@/lib/payroll-ledger"
import {
  MISC_INCOME_CATEGORIES,
  miscIncomeCategoryIsSingleton,
  miscIncomeProjectDisabled,
  miscIncomeProjectRequired,
  validateDevAllocations,
} from "@/lib/payroll-misc"

type Payroll = {
  _id?: string
  member: string
  role?: string
  projectId?: string | null
  project?: string
  amount: number
  currency: string
  status: "pending" | "paid"
  date?: string
  notes?: string
  createdAt?: string
  updatedAt?: string
}

type Project = {
  _id: string
  name: string
  referrer?: string
  referrerWallet?: string
  referrerAccountId?: string | null
  referralPercentage?: number
}
type DailyPayrollEntry = {
  _id: string
  date: string
  inputs?: {
    teamPayroll?: Array<{ accountId: string; status: "active" | "inactive"; projectIds?: string[]; charts?: number; manualAmount?: number }>
    clientIncome?: Array<{ accountId?: string; projectId?: string; incomeType?: string; income: number; skipReferral?: boolean }>
    devAllocations?: Array<{ accountId?: string; projectId?: string; income: number; category?: string }>
    rules?: { dayType?: string; recipient?: string; basePay?: number; extraPay?: number }
  }
  notes?: string
}

type Tab = "overview" | "entry"
type AccountForm = {
  id: string
  name: string
  type: PayrollAccountType
  wallet: string
  profitSharePercentage: string
  referralId: string
}

type ReferrerRowForm = {
  projectId: string
  referrerAccountId: string
  percentage: string
}

type ReferrerRowEditForm = ReferrerRowForm & {
  amount: string
}

const emptyRow = (date: string): Payroll => ({
  member: "",
  role: "",
  projectId: "",
  project: "",
  amount: 0,
  currency: "USD",
  status: "pending",
  date,
  notes: "",
})

const emptyAccountForm: AccountForm = {
  id: "",
  name: "",
  type: "EMPLOYEE",
  wallet: "",
  profitSharePercentage: "0",
  referralId: "",
}

const emptyReferrerRowForm: ReferrerRowForm = {
  projectId: "",
  referrerAccountId: "",
  percentage: "",
}

const money = (amount: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount || 0))

function dateKey(value?: string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function displayDate(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  const date = new Date(`${value}T00:00:00`)
  if (!value || Number.isNaN(date.getTime())) return "Choose date"
  return new Intl.DateTimeFormat("en-US", options).format(date)
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

function csvCell(value: unknown) {
  const text = String(value ?? "")
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function teamExpense(row: { status: "active" | "inactive"; projectIds?: string[]; charts?: number; manualAmount?: number }, basePay: number, extraPay: number) {
  if (row.status !== "active") return 0
  const manualAmount = Number(row.manualAmount)
  if (Number.isFinite(manualAmount) && manualAmount > 0) return manualAmount
  const projectCount = Array.isArray(row.projectIds) ? new Set(row.projectIds.filter(Boolean)).size : 0
  if (Array.isArray(row.projectIds) && projectCount === 0) return 0
  const extraProjects = projectCount > 0 ? projectCount - 1 : Math.max(0, Number(row.charts || 0))
  return Number(basePay || 0) + Number(extraPay || 0) * extraProjects
}

function accountTypeLabel(type: PayrollAccountType) {
  if (type === "SYSTEM_TREASURY") return "Treasury"
  return type.charAt(0) + type.slice(1).toLowerCase()
}

function accountTypeDescription(type: PayrollAccountType) {
  if (type === "EMPLOYEE") return "Team member paid from assigned project work."
  if (type === "CLIENT") return "Client identity used for project and income records."
  if (type === "REFERRER") return "Independent referrer available when creating projects."
  return "System treasury used for profit distributions."
}

export default function PayrollPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [rows, setRows] = useState<Payroll[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [accounts, setAccounts] = useState<PayrollAccount[]>([])
  const [dailyEntries, setDailyEntries] = useState<DailyPayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [tab, setTab] = useState<Tab>("overview")
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [datePickerMonth, setDatePickerMonth] = useState(() => new Date(`${today}T00:00:00`))
  const [entries, setEntries] = useState<Payroll[]>([emptyRow(today)])
  const [notes, setNotes] = useState("")
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFrom, setExportFrom] = useState(`${today.slice(0, 8)}01`)
  const [exportTo, setExportTo] = useState(today)
  const [accountFormOpen, setAccountFormOpen] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm)
  const [accountSaving, setAccountSaving] = useState(false)
  const [referrerRowOpen, setReferrerRowOpen] = useState(false)
  const [referrerRowForm, setReferrerRowForm] = useState<ReferrerRowForm>(emptyReferrerRowForm)
  const [referrerRowSaving, setReferrerRowSaving] = useState(false)
  const [editingReferrerKey, setEditingReferrerKey] = useState("")
  const [referrerRowEditForm, setReferrerRowEditForm] = useState<ReferrerRowEditForm>({ ...emptyReferrerRowForm, amount: "" })
  const payroll = usePayrollCalculator(accounts, projects)
  const displayedReferralRows = useMemo(() => {
    const rows = new Map<string, {
      referrerAccountId: string
      referrerName: string
      projectId: string
      projectName: string
      percentage: number
      amount: number
    }>()

    for (const project of projects) {
      const referrerAccountId = String(project.referrerAccountId || "")
      const percentage = Number(project.referralPercentage || 0)
      if (!referrerAccountId || percentage <= 0) continue
      const referrer = accounts.find((account) => String(account._id || account.id) === referrerAccountId)
      rows.set(`${project._id}:${referrerAccountId}`, {
        referrerAccountId,
        referrerName: referrer?.name || project.referrer || "Referrer",
        projectId: project._id,
        projectName: project.name,
        percentage,
        amount: 0,
      })
    }

    for (const referral of payroll.calculation.referrals) {
      const key = `${referral.clientAccountId}:${referral.referrerAccountId}`
      const current = rows.get(key)
      rows.set(key, {
        referrerAccountId: referral.referrerAccountId,
        referrerName: referral.referrerName,
        projectId: referral.clientAccountId,
        projectName: referral.clientName,
        percentage: referral.percentage,
        amount: Number(current?.amount || 0) + Number(referral.amount || 0),
      })
    }

    return Array.from(rows.values())
  }, [accounts, payroll.calculation.referrals, projects])

  const load = async () => {
    setLoading(true)
    try {
      const [payrollResponse, projectResponse] = await Promise.all([
        fetch("/api/ops/payroll", { cache: "no-store", credentials: "include" }),
        fetch("/api/ops/projects", { cache: "no-store", credentials: "include" }),
      ])
      const ledgerResponse = await fetch("/api/ops/payroll?ledger=1", { cache: "no-store", credentials: "include" })
      const data = await payrollResponse.json().catch(() => [])
      const projectData = await projectResponse.json().catch(() => [])
      const ledgerData = await ledgerResponse.json().catch(() => ({}))
      setRows(Array.isArray(data) ? data : Array.isArray(data?.payroll) ? data.payroll : [])
      setProjects(Array.isArray(projectData) ? projectData : Array.isArray(projectData?.projects) ? projectData.projects : [])
      setAccounts(Array.isArray(ledgerData?.accounts) ? ledgerData.accounts : [])
      setDailyEntries(Array.isArray(ledgerData?.dailyEntries) ? ledgerData.dailyEntries : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const rowsWithDates = useMemo(
    () => rows.map((row) => ({ ...row, date: row.date || dateKey(row.createdAt || row.updatedAt) })),
    [rows],
  )

  const monthRows = useMemo(
    () => rowsWithDates.filter((row) => String(row.date || "").startsWith(monthKey(selectedMonth))),
    [rowsWithDates, selectedMonth],
  )

  const dailyRows = useMemo(() => {
    const result = new Map<string, Payroll[]>()
    for (const row of monthRows) {
      const key = dateKey(row.date)
      result.set(key, [...(result.get(key) || []), row])
    }
    return result
  }, [monthRows])

  const monthStats = useMemo(() => {
    const paidRows = monthRows.filter((row) => row.status === "paid")
    const pendingRows = monthRows.filter((row) => row.status !== "paid")
    const paidDays = new Set(paidRows.map((row) => dateKey(row.date))).size
    const total = paidRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const pending = pendingRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    return {
      total,
      pending,
      paidDays,
      average: paidDays ? total / paidDays : 0,
      pendingDays: new Set(pendingRows.map((row) => dateKey(row.date))).size,
    }
  }, [monthRows])

  const monthDays = useMemo(() => {
    const count = daysInMonth(selectedMonth)
    return Array.from({ length: count }, (_, index) => {
      const day = count - index
      return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    })
  }, [selectedMonth])

  const openEntry = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
      toast.error("Choose a valid payroll date")
      return
    }
    const source = rowsWithDates.filter((row) => dateKey(row.date) === date)
    const ledgerEntry = dailyEntries.find((entry) => dateKey(entry.date) === date)
    setSelectedDate(date)
    setEntries(source.length ? source.map((row) => ({ ...row, date })) : [emptyRow(date)])
    payroll.loadDraft(ledgerEntry?.inputs)
    setNotes(ledgerEntry?.notes || source.find((row) => row.notes)?.notes || "")
    setTab("entry")
  }

  const loadTemplate = () => {
    if (!payroll.employees.length && !projects.length) {
      toast.message("Add employees and projects first")
      return
    }
    payroll.loadTemplate()
  }

  const updateEntry = (index: number, patch: Partial<Payroll>) => {
    setEntries((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const removeEntry = async (index: number) => {
    const row = entries[index]
    if (row?._id) {
      const res = await fetch(`/api/ops/payroll/${row._id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        toast.error("Payroll row was not removed")
        return
      }
      await load()
    }
    setEntries((current) => current.length === 1 ? [emptyRow(selectedDate)] : current.filter((_, rowIndex) => rowIndex !== index))
  }

  const saveDay = async (returnToOverview = true, quiet = false) => {
    const hasInputs = payroll.teamPayroll.length || payroll.clientIncome.length || payroll.devAllocations.length
    if (!hasInputs) {
      toast.error("Add payroll or project income rows")
      return false
    }
    const miscErrors = validateDevAllocations(payroll.devAllocations)
    if (miscErrors.length) {
      toast.error(miscErrors[0])
      return false
    }
    setSaving(true)
    try {
      const res = await fetch("/api/ops/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "ledger-day",
          date: selectedDate,
          notes,
          teamPayroll: payroll.teamPayroll,
          clientIncome: payroll.clientIncome,
          devAllocations: payroll.devAllocations,
          rules: payroll.rules,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Payroll was not saved")
        return false
      }
      if (!quiet) toast.success("Payroll day saved")
      await load()
      if (returnToOverview) setTab("overview")
      return true
    } finally {
      setSaving(false)
    }
  }

  const sharePayroll = async (mode: "text" | "report") => {
    setSharing(true)
    try {
      const saved = await saveDay(false, true)
      if (!saved) return
      const res = await fetch("/api/ops/payroll/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ date: selectedDate, mode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || (mode === "report" ? "Payroll report was not sent" : "Payroll snapshot was not sent"))
        return
      }
      const failed = Array.isArray(data.failed) && data.failed.length ? `; failed: ${data.failed.join(", ")}` : ""
      const label = mode === "report" ? "Report" : "Summary"
      toast.success(`${label} sent to ${data.sent} Telegram destination${data.sent === 1 ? "" : "s"}${failed}`)
    } finally {
      setSharing(false)
    }
  }

  const shareDay = () => sharePayroll("text")
  const shareReport = () => sharePayroll("report")

  const shiftMonth = (direction: -1 | 1) => {
    setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1))
  }

  const exportPayroll = () => {
    if (!exportFrom || !exportTo) {
      toast.error("Choose from and to dates")
      return
    }
    const from = exportFrom <= exportTo ? exportFrom : exportTo
    const to = exportFrom <= exportTo ? exportTo : exportFrom
    const exported = rowsWithDates.filter((row) => {
      const key = dateKey(row.date)
      return key >= from && key <= to
    })
    if (!exported.length) {
      toast.error("No payroll rows in this range")
      return
    }
    downloadCsv(`payroll_${from}_to_${to}.csv`, [
      ["Payroll", from, to],
      [],
      ["Date", "Member", "Status", "Amount", "Currency", "Role", "Project", "Notes"],
      ...exported.map((row) => [
        dateKey(row.date),
        row.member,
        row.status,
        row.amount,
        row.currency || "USD",
        row.role || "",
        row.project || "",
        row.notes || "",
      ]),
    ])
    toast.success("Payroll export downloaded")
    setExportOpen(false)
  }

  const createAccount = async (type: PayrollAccountType) => {
    const label = type === "SYSTEM_TREASURY" ? "treasury account" : type.toLowerCase()
    const name = window.prompt(`New ${label} name`)
    if (!name?.trim()) return
    const wallet = window.prompt("Wallet / source (optional)") || ""
    let referralId: string | null = null
    let profitSharePercentage = 0
    if (type === "CLIENT") {
      const referrerName = window.prompt("Referrer account name (optional)") || ""
      const referrer = accounts.find((account) => account.name.toLowerCase() === referrerName.trim().toLowerCase())
      referralId = referrer ? String(referrer._id || referrer.id) : null
      profitSharePercentage = Number(window.prompt("Referral percentage (0 if none)", referralId ? "10" : "0") || 0)
    } else {
      profitSharePercentage = Number(window.prompt("Profit share percentage (0 if none)", type === "SYSTEM_TREASURY" ? "0" : "0") || 0)
    }
    const res = await fetch("/api/ops/payroll/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: name.trim(), type, wallet, referralId, profitSharePercentage }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || "Account was not created")
      return
    }
    toast.success("Account added")
    await load()
  }

  const openNewAccount = (type: PayrollAccountType) => {
    setAccountForm({ ...emptyAccountForm, type })
    setAccountFormOpen(true)
  }

  const openEditAccount = (account?: PayrollAccount | null) => {
    if (!account) {
      toast.error("Choose a member first")
      return
    }
    setAccountForm({
      id: String(account._id || account.id || ""),
      name: account.name || "",
      type: account.type || "EMPLOYEE",
      wallet: account.wallet || account.source || "",
      profitSharePercentage: String(account.profitSharePercentage ?? account.profit_share_percentage ?? 0),
      referralId: String(account.referralId || account.referral_id || ""),
    })
    setAccountFormOpen(true)
  }

  const saveAccount = async () => {
    if (!accountForm.name.trim()) {
      toast.error("Member name is required")
      return
    }
    setAccountSaving(true)
    try {
      const res = await fetch("/api/ops/payroll/accounts", {
        method: accountForm.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: accountForm.id,
          name: accountForm.name.trim(),
          type: accountForm.type,
          wallet: accountForm.wallet.trim(),
          referralId: null,
          profitSharePercentage: accountForm.type === "EMPLOYEE" || accountForm.type === "SYSTEM_TREASURY"
            ? Number(accountForm.profitSharePercentage || 0)
            : 0,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Account was not saved")
        return
      }
      toast.success(accountForm.id ? "Account updated" : "Account created")
      setAccountFormOpen(false)
      setAccountForm(emptyAccountForm)
      await load()
    } finally {
      setAccountSaving(false)
    }
  }

  const openReferrerRow = () => {
    const project = projects[0]
    setReferrerRowForm({
      projectId: project?._id || "",
      referrerAccountId: project?.referrerAccountId || payroll.referrers[0]?._id || payroll.referrers[0]?.id || "",
      percentage: String(project?.referralPercentage ?? ""),
    })
    setReferrerRowOpen(true)
  }

  const saveReferrerRow = async () => {
    const project = projects.find((item) => item._id === referrerRowForm.projectId)
    const referrer = payroll.referrers.find((item) => String(item._id || item.id) === referrerRowForm.referrerAccountId)
    const percentage = Number(referrerRowForm.percentage || 0)
    if (!project || !referrer) {
      toast.error("Choose a project and referrer")
      return
    }
    if (percentage <= 0 || percentage > 100) {
      toast.error("Enter a referral percentage from 1 to 100")
      return
    }
    setReferrerRowSaving(true)
    try {
      const res = await fetch(`/api/ops/projects/${project._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          referrer: referrer.name,
          referrerWallet: referrer.wallet || referrer.source || "",
          referrerAccountId: String(referrer._id || referrer.id),
          referralPercentage: percentage,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Referrer row was not saved")
        return
      }
      setReferrerRowOpen(false)
      setReferrerRowForm(emptyReferrerRowForm)
      toast.success("Referrer row added")
      await load()
    } finally {
      setReferrerRowSaving(false)
    }
  }

  const projectTradingIncome = (projectId: string) =>
    payroll.clientIncome
      .filter((row) => String(row.projectId || "") === String(projectId))
      .reduce((total, row) => total + Number(row.income || 0), 0)

  const startEditingReferrerRow = (row: (typeof displayedReferralRows)[number]) => {
    setEditingReferrerKey(`${row.projectId}:${row.referrerAccountId}`)
    setReferrerRowEditForm({
      projectId: row.projectId,
      referrerAccountId: row.referrerAccountId,
      percentage: String(row.percentage),
      amount: String(row.amount),
    })
  }

  const saveEditedReferrerRow = async () => {
    const project = projects.find((item) => item._id === referrerRowEditForm.projectId)
    const referrer = payroll.referrers.find((item) => String(item._id || item.id) === referrerRowEditForm.referrerAccountId)
    const percentage = Number(referrerRowEditForm.percentage || 0)
    if (!project || !referrer || percentage <= 0 || percentage > 100) {
      toast.error("Choose a referrer and enter a percentage from 1 to 100")
      return
    }
    setReferrerRowSaving(true)
    try {
      const res = await fetch(`/api/ops/projects/${project._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          referrer: referrer.name,
          referrerWallet: referrer.wallet || referrer.source || "",
          referrerAccountId: String(referrer._id || referrer.id),
          referralPercentage: percentage,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Referrer row was not updated")
        return
      }
      setEditingReferrerKey("")
      toast.success("Referrer row updated")
      await load()
    } finally {
      setReferrerRowSaving(false)
    }
  }

  const removeReferrerRow = async (projectId: string) => {
    setReferrerRowSaving(true)
    try {
      const res = await fetch(`/api/ops/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          referrer: "",
          referrerWallet: "",
          referrerAccountId: null,
          referralPercentage: 0,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Referrer row was not removed")
        return
      }
      setEditingReferrerKey("")
      toast.success("Referrer row removed")
      await load()
    } finally {
      setReferrerRowSaving(false)
    }
  }

  const accountById = (id: string) => accounts.find((account) => String(account._id || account.id) === String(id))

  const openDatePicker = () => {
    const current = new Date(`${selectedDate}T00:00:00`)
    setDatePickerMonth(Number.isNaN(current.getTime()) ? new Date() : current)
    setDatePickerOpen(true)
  }

  const choosePayrollDate = (date: string) => {
    openEntry(date)
    setDatePickerOpen(false)
  }

  return (
    <div className="max-w-full space-y-4 overflow-x-hidden">
      <section className="rounded-xl border border-[#42e6a4]/20 bg-[#42e6a4]/[0.055] px-3 py-2.5 shadow-[0_14px_40px_rgba(66,230,164,0.07)]">
        <div className="flex items-center gap-2.5">
          <DollarSign className="h-6 w-6 shrink-0 text-[#42e6a4]" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-white">Payroll</h1>
          </div>
          <button onClick={() => setExportOpen((current) => !current)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#42e6a4]/20 bg-[#42e6a4]/10 px-2.5 text-xs font-bold text-[#b8ffe1]">
            {exportOpen ? <X className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {exportOpen ? "Close" : "Export"}
          </button>
        </div>
        {exportOpen ? (
          <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/35 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label>
                <span className="mb-1 block text-xs font-semibold text-white/45">From</span>
                <input type="date" value={exportFrom} onChange={(event) => setExportFrom(event.target.value)} className="h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#42e6a4]/60" />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-white/45">To</span>
                <input type="date" value={exportTo} onChange={(event) => setExportTo(event.target.value)} className="h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#42e6a4]/60" />
              </label>
              <button onClick={exportPayroll} className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1f8f66] px-4 text-sm font-bold text-white sm:mt-[18px]">
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-2.5 grid grid-cols-2 rounded-lg border border-white/[0.08] bg-black/45 p-1">
          {(["overview", "entry"] as Tab[]).map((item) => (
            <button
              key={item}
              onClick={() => item === "entry" ? openEntry(today) : setTab(item)}
              className={`h-8 rounded-md text-xs font-semibold capitalize transition ${tab === item ? "bg-[#42e6a4]/12 text-[#42e6a4]" : "text-white/45"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      {tab !== "entry" ? (
        <section className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <button onClick={() => shiftMonth(-1)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-white">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 text-lg font-bold text-white">
            <CalendarDays className="h-5 w-5 text-[#42e6a4]" />
            {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(selectedMonth)}
          </div>
          <button onClick={() => shiftMonth(1)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-white">
            <ChevronRight className="h-5 w-5" />
          </button>
        </section>
      ) : null}

      {tab === "overview" ? (
        <>
          <section className="grid grid-cols-3 gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
            <Stat label="Total Payroll" value={money(monthStats.total)} hint="This month" />
            <Stat label="Days Paid" value={String(monthStats.paidDays)} hint={`of ${daysInMonth(selectedMonth)}`} />
            <Stat label="Average / Day" value={money(monthStats.average)} hint="Per paid day" />
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035]">
            <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
              <h2 className="text-lg font-bold text-white">Daily Payroll</h2>
              <div className="flex gap-3 text-sm font-semibold">
                <span className="text-[#42e6a4]">{monthStats.paidDays} Paid</span>
                <span className="text-[#ffd166]">{monthStats.pendingDays} Pending</span>
              </div>
            </div>
            {loading ? <div className="p-6 text-center text-sm text-white/35">Loading payroll...</div> : null}
            {!loading && monthDays.map((day) => {
              const dayRows = dailyRows.get(day) || []
              const total = dayRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
              const paid = dayRows.length > 0 && dayRows.every((row) => row.status === "paid")
              const pending = dayRows.some((row) => row.status !== "paid")
              return (
                <button key={day} onClick={() => openEntry(day)} className="flex w-full items-center gap-3 border-b border-white/[0.06] px-4 py-3 text-left last:border-0">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-bold ${dayRows.length ? "bg-[#42e6a4]/14 text-[#42e6a4]" : "bg-white/[0.06] text-white/50"}`}>{Number(day.slice(-2))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-white">{displayDate(day)}</span>
                    <span className={`mt-0.5 block text-sm ${dayRows.length ? "text-[#42e6a4]" : "text-white/35"}`}>{dayRows.length ? money(total) : "-"}</span>
                  </span>
                  <span className={`text-sm font-semibold ${paid ? "text-[#42e6a4]" : pending ? "text-[#ffd166]" : "text-white/35"}`}>{paid ? "Paid" : pending ? "Pending" : "Open"}</span>
                  <ChevronRight className="h-5 w-5 text-white/55" />
                </button>
              )
            })}
          </section>
        </>
      ) : null}

      {tab === "entry" ? (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setTab("overview")} className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-white/[0.035] text-white">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-white">Daily Payroll Entry</h2>
              <p className="text-sm text-white/40">Enter and save today&apos;s payroll information</p>
            </div>
            <button onClick={() => void saveDay()} disabled={saving || sharing} className="h-8 px-1 text-xs font-bold text-[#42e6a4] disabled:opacity-50">Save Draft</button>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
            <button
              type="button"
              onClick={openDatePicker}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#42e6a4]/20 bg-[#42e6a4]/10 text-[#42e6a4]"
              aria-label="Select payroll date"
            >
              <CalendarDays className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <span className="text-xs uppercase text-white/40">Date</span>
              <button type="button" onClick={openDatePicker} className="mt-1 block text-left text-base font-bold text-white">
                {displayDate(selectedDate, { month: "long", day: "numeric", year: "numeric" })}
              </button>
            </div>
            <button onClick={loadTemplate} className="h-10 shrink-0 rounded-xl border border-[#42e6a4]/20 bg-[#42e6a4]/10 px-3 text-xs font-bold text-[#b8ffe1]">Load Template</button>
          </div>

          {datePickerOpen ? (
            <PayrollDatePicker
              month={datePickerMonth}
              selectedDate={selectedDate}
              onMonthChange={setDatePickerMonth}
              onSelect={choosePayrollDate}
              onClose={() => setDatePickerOpen(false)}
            />
          ) : null}

          {accountFormOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={() => setAccountFormOpen(false)}>
              <div className="w-full max-w-md rounded-xl border border-[#42e6a4]/25 bg-[#101513] p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">{accountForm.id ? "Edit" : "Create"} {accountTypeLabel(accountForm.type)}</h3>
                    <p className="text-xs text-white/40">{accountTypeDescription(accountForm.type)}</p>
                  </div>
                  <button onClick={() => setAccountFormOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/65"><X className="h-4 w-4" /></button>
                </div>
                <div className="space-y-2">
                  <LabeledAccountInput label={`${accountTypeLabel(accountForm.type)} Name`}>
                    <input value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} className="ledger-input w-full" placeholder={`Enter ${accountTypeLabel(accountForm.type).toLowerCase()} name`} autoFocus />
                  </LabeledAccountInput>
                  <LabeledAccountInput label="Wallet / Source">
                    <input value={accountForm.wallet} onChange={(event) => setAccountForm({ ...accountForm, wallet: event.target.value })} className="ledger-input w-full" placeholder="Optional wallet or payment source" />
                  </LabeledAccountInput>
                  {accountForm.type === "EMPLOYEE" || accountForm.type === "SYSTEM_TREASURY" ? (
                    <LabeledAccountInput label="Profit Share %">
                      <input type="number" min="0" max="100" value={accountForm.profitSharePercentage} onChange={(event) => setAccountForm({ ...accountForm, profitSharePercentage: event.target.value })} className="ledger-input w-full" placeholder="0" />
                    </LabeledAccountInput>
                  ) : null}
                </div>
                <button onClick={saveAccount} disabled={accountSaving} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1f8f66] text-xs font-bold text-white disabled:opacity-50">
                  <Save className="h-4 w-4" />
                  Save {accountTypeLabel(accountForm.type)}
                </button>
              </div>
            </div>
          ) : null}

          {referrerRowOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={() => setReferrerRowOpen(false)}>
              <div className="w-full max-w-md rounded-xl border border-[#ff6b78]/25 bg-[#171112] p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">Add Referrer Row</h3>
                    <p className="text-xs text-white/40">Referral applies only to trading income.</p>
                  </div>
                  <button onClick={() => setReferrerRowOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/65"><X className="h-4 w-4" /></button>
                </div>
                <div className="space-y-2">
                  <LabeledAccountInput label="Project">
                    <select
                      value={referrerRowForm.projectId}
                      onChange={(event) => {
                        const project = projects.find((item) => item._id === event.target.value)
                        setReferrerRowForm({
                          projectId: event.target.value,
                          referrerAccountId: project?.referrerAccountId || payroll.referrers[0]?._id || payroll.referrers[0]?.id || "",
                          percentage: String(project?.referralPercentage ?? ""),
                        })
                      }}
                      className="ledger-input w-full"
                    >
                      <option value="">Choose project</option>
                      {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                    </select>
                  </LabeledAccountInput>
                  <LabeledAccountInput label="Referrer">
                    <select value={referrerRowForm.referrerAccountId} onChange={(event) => setReferrerRowForm({ ...referrerRowForm, referrerAccountId: event.target.value })} className="ledger-input w-full">
                      <option value="">Choose referrer</option>
                      {payroll.referrers.map((referrer) => <option key={String(referrer._id || referrer.id)} value={String(referrer._id || referrer.id)}>{referrer.name}</option>)}
                    </select>
                  </LabeledAccountInput>
                  <LabeledAccountInput label="Trading Income Share %">
                    <input type="number" min="1" max="100" value={referrerRowForm.percentage} onChange={(event) => setReferrerRowForm({ ...referrerRowForm, percentage: event.target.value })} className="ledger-input w-full" placeholder="10" />
                  </LabeledAccountInput>
                </div>
                <button onClick={saveReferrerRow} disabled={referrerRowSaving} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#b53a48] text-xs font-bold text-white disabled:opacity-50">
                  <Save className="h-4 w-4" />
                  Save Referrer Row
                </button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-2 lg:grid-cols-2">
            <LedgerPanel title="Team Payroll" color="text-[#42e6a4]" action={<AddMiniButton onClick={() => openNewAccount("EMPLOYEE")} label="New Employee" />}>
              {payroll.teamPayroll.map((row, index) => (
                <div key={`team-${index}`} className="min-w-0 overflow-hidden rounded-lg border border-white/[0.07] bg-black/20 p-2">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_64px] gap-1.5">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Employee</span>
                      <select value={row.accountId} onChange={(event) => payroll.updateTeamRow(index, { accountId: event.target.value })} className="ledger-input w-full">
                        <option value="">Employee</option>
                        {payroll.employees.map((account) => <option key={String(account._id || account.id)} value={String(account._id || account.id)}>{account.name}</option>)}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Status</span>
                      <select value={row.status} onChange={(event) => payroll.updateTeamRow(index, { status: event.target.value as "active" | "inactive" })} className={`ledger-input w-full text-center ${row.status === "active" ? "text-[#42e6a4]" : "text-[#ff6b78]"}`}>
                        <option value="active">ON</option>
                        <option value="inactive">OFF</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-1.5">
                    <div className="min-w-0">
                      <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Payroll Expense</span>
                      <div className="ledger-input flex w-full items-center justify-end overflow-hidden pr-2 text-right font-bold tabular-nums text-[#42e6a4]">{money(teamExpense(row, payroll.rules.basePay, payroll.rules.extraPay))}</div>
                    </div>
                    <RowActions onEdit={() => openEditAccount(accountById(row.accountId))} onRemove={() => payroll.removeTeamRow(index)} />
                  </div>
                  <div className="mt-2 grid min-w-0 grid-cols-2 gap-1.5">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Charts</span>
                      <input
                        type="number"
                        min="0"
                        value={row.charts ?? ""}
                        onChange={(event) => payroll.updateTeamRow(index, { charts: Number(event.target.value || 0), manualAmount: undefined })}
                        className="ledger-input w-full pr-2 text-right tabular-nums"
                        placeholder="0"
                        disabled={Boolean(row.manualAmount) || (row.projectIds || []).length > 0}
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Custom Pay</span>
                      <input
                        type="number"
                        min="0"
                        value={row.manualAmount ?? ""}
                        onChange={(event) => {
                          const manualAmount = Number(event.target.value || 0)
                          payroll.updateTeamRow(index, manualAmount > 0 ? { manualAmount, charts: undefined, projectIds: [] } : { manualAmount: undefined })
                        }}
                        className="ledger-input w-full pr-2 text-right tabular-nums"
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                  <div className="mt-2">
                    <p className="mb-1 text-[9px] font-bold uppercase text-white/38">Projects Worked</p>
                    <div className="flex flex-wrap gap-1">
                      {projects.map((project) => {
                        const selected = (row.projectIds || []).includes(project._id)
                        return (
                          <button
                            key={project._id}
                            onClick={() => {
                              const current = row.projectIds || []
                              payroll.updateTeamRow(index, { projectIds: selected ? current.filter((id) => id !== project._id) : [...current, project._id] })
                            }}
                            className={`h-7 rounded-md border px-2 text-[10px] font-bold transition ${selected ? "border-[#42e6a4]/40 bg-[#42e6a4]/15 text-[#b8ffe1]" : "border-white/[0.08] bg-white/[0.035] text-white/45"}`}
                          >
                            {project.name}
                          </button>
                        )
                      })}
                      {!projects.length ? <span className="text-[10px] text-white/35">Create projects first</span> : null}
                    </div>
                  </div>
                </div>
              ))}
              {!payroll.teamPayroll.length ? <EmptyLedgerText text="No team payroll rows yet" /> : null}
              <WideAddButton onClick={payroll.addTeamRow} label="Add Payroll Row" />
            </LedgerPanel>

            <LedgerPanel title="Trading Income" color="text-[#42e6a4]" action={<AddMiniButton onClick={() => openNewAccount("CLIENT")} label="New Client" />}>
              {payroll.clientIncome.map((row, index) => (
                <div key={`income-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(72px,88px)_34px] items-end gap-1.5">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Project</span>
                    <select value={row.projectId || ""} onChange={(event) => payroll.updateClientIncomeRow(index, { projectId: event.target.value, incomeType: "trading" })} className="ledger-input w-full">
                      <option value="">Project</option>
                      {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                    </select>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1 block text-right text-[9px] font-bold uppercase text-white/38">Income</span>
                    <input type="number" value={row.income || ""} onChange={(event) => payroll.updateClientIncomeRow(index, { income: Number(event.target.value || 0) })} className="ledger-input w-full pr-2 text-right tabular-nums" placeholder="$0" />
                  </label>
                  <IconDeleteButton onClick={() => payroll.removeClientIncomeRow(index)} />
                </div>
              ))}
              {!payroll.clientIncome.length ? <EmptyLedgerText text="No trading income rows yet" /> : null}
              <WideAddButton onClick={payroll.addClientIncomeRow} label="Add Trading Income" />
            </LedgerPanel>

            <LedgerPanel title="Misc Income" color="text-[#42e6a4]">
              {payroll.devAllocations.map((row, index) => {
                const category = String(row.category || "dev_allocation")
                const projectRequired = miscIncomeProjectRequired(category)
                return (
                  <div key={`dev-${index}`} className="grid min-w-0 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(72px,88px)_34px] items-end gap-1.5">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Category</span>
                      <select
                        value={category}
                        onChange={(event) => payroll.updateDevAllocationRow(index, { category: event.target.value, projectId: miscIncomeProjectRequired(event.target.value) ? row.projectId : undefined })}
                        className="ledger-input w-full"
                      >
                        {MISC_INCOME_CATEGORIES.map((item) => {
                          const alreadyUsed = miscIncomeCategoryIsSingleton(item.id) && payroll.devAllocations.some(
                            (otherRow, otherIndex) => otherIndex !== index && otherRow.category === item.id,
                          )
                          return <option key={item.id} value={item.id} disabled={alreadyUsed}>{item.label}</option>
                        })}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Project{projectRequired ? "" : " (optional)"}</span>
                      <select
                        value={row.projectId || ""}
                        onChange={(event) => payroll.updateDevAllocationRow(index, { projectId: event.target.value || undefined })}
                        className="ledger-input w-full"
                        disabled={miscIncomeProjectDisabled(category)}
                      >
                        <option value="">{projectRequired ? "Choose project" : "None"}</option>
                        {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-right text-[9px] font-bold uppercase text-white/38">Income</span>
                      <input type="number" value={row.income || ""} onChange={(event) => payroll.updateDevAllocationRow(index, { income: Number(event.target.value || 0) })} className="ledger-input w-full pr-2 text-right tabular-nums" placeholder="$0" />
                    </label>
                    <IconDeleteButton onClick={() => payroll.removeDevAllocationRow(index)} />
                  </div>
                )
              })}
              {!payroll.devAllocations.length ? <EmptyLedgerText text="No misc income rows yet" /> : null}
              <WideAddButton onClick={payroll.addDevAllocationRow} label="Add Misc Income" />
            </LedgerPanel>

            <LedgerPanel title="Referrer Income (Expense)" color="text-[#ff6b78]" action={<AddMiniButton onClick={() => openNewAccount("REFERRER")} label="New Referrer" />}>
              {displayedReferralRows.map((row) => (
                <div key={`referral-${row.projectId}-${row.referrerAccountId}`} className="rounded-lg border border-white/[0.07] bg-black/20 p-2">
                  {editingReferrerKey === `${row.projectId}:${row.referrerAccountId}` ? (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Referrer</span>
                          <select
                            value={referrerRowEditForm.referrerAccountId}
                            onChange={(event) => setReferrerRowEditForm({ ...referrerRowEditForm, referrerAccountId: event.target.value })}
                            className="ledger-input w-full"
                          >
                            {payroll.referrers.map((referrer) => (
                              <option key={String(referrer._id || referrer.id)} value={String(referrer._id || referrer.id)}>{referrer.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Project</span>
                          <div className="ledger-input flex items-center truncate">{row.projectName}</div>
                        </label>
                      </div>
                      <div className="mt-1.5 grid min-w-0 grid-cols-2 items-end gap-1.5">
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Percent</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={referrerRowEditForm.percentage}
                            onChange={(event) => {
                              const percentage = event.target.value
                              const amount = projectTradingIncome(row.projectId) * (Number(percentage || 0) / 100)
                              setReferrerRowEditForm({ ...referrerRowEditForm, percentage, amount: String(Math.round(amount * 100) / 100) })
                            }}
                            className="ledger-input w-full pr-2 text-right tabular-nums"
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Amount</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={referrerRowEditForm.amount}
                            onChange={(event) => {
                              const amount = event.target.value
                              const income = projectTradingIncome(row.projectId)
                              if (income <= 0) {
                                toast.error("Add trading income before editing the referral amount")
                                return
                              }
                              const percentage = Number(amount || 0) / income * 100
                              setReferrerRowEditForm({ ...referrerRowEditForm, amount, percentage: String(Math.round(percentage * 100) / 100) })
                            }}
                            className="ledger-input w-full pr-2 text-right tabular-nums"
                          />
                        </label>
                        <div className="col-span-2 flex h-8 items-center justify-end gap-1">
                          <button onClick={saveEditedReferrerRow} disabled={referrerRowSaving} title="Save" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#42e6a4]/25 bg-[#42e6a4]/10 text-[#42e6a4] disabled:opacity-50">
                            <Save className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setEditingReferrerKey("")} title="Cancel" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-white/55">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="min-w-0">
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Referrer</span>
                          <div className="ledger-input flex items-center truncate">{row.referrerName}</div>
                        </div>
                        <div className="min-w-0">
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Project</span>
                          <div className="ledger-input flex items-center truncate">{row.projectName}</div>
                        </div>
                      </div>
                      <div className="mt-1.5 grid min-w-0 grid-cols-2 items-end gap-1.5">
                        <div>
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Percent</span>
                          <div className="ledger-input flex items-center justify-end pr-2 tabular-nums">{row.percentage}%</div>
                        </div>
                        <div>
                          <span className="mb-1 block text-[9px] font-bold uppercase text-white/38">Amount</span>
                          <div className="ledger-input flex items-center justify-end pr-2 tabular-nums">{money(row.amount)}</div>
                        </div>
                        <div className="col-span-2 flex h-8 items-center justify-end gap-1">
                          <button onClick={() => startEditingReferrerRow(row)} title="Edit" aria-label="Edit referrer row" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#42e6a4]/25 bg-[#42e6a4]/10 text-[#42e6a4]">
                            <Edit3 className="h-3 w-3" />
                          </button>
                          <button onClick={() => removeReferrerRow(row.projectId)} disabled={referrerRowSaving} title="Delete" aria-label="Delete referrer row" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400/20 bg-red-500/10 text-red-200 disabled:opacity-50">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {!displayedReferralRows.length ? <EmptyLedgerText text="No referrer rows yet" /> : null}
              <WideAddButton onClick={openReferrerRow} label="Add Referrer Row" />
            </LedgerPanel>
          </div>

          <LedgerPanel title="Daily Distributions" color="text-[#b475ff]" action={<AddMiniButton onClick={() => openNewAccount("SYSTEM_TREASURY")} label="Add Treasury" />}>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(68px,82px)] gap-1.5 px-1 pb-0.5 sm:grid-cols-[minmax(0,1fr)_82px_minmax(0,1.2fr)]">
              <span className="text-[9px] font-bold uppercase tracking-wide text-white/38">Receiver</span>
              <span className="text-right text-[9px] font-bold uppercase tracking-wide text-white/38">Amount</span>
              <span className="hidden text-[9px] font-bold uppercase tracking-wide text-white/38 sm:block">Wallet</span>
            </div>
            {payroll.calculation.distributions.map((row) => (
              <div key={row.accountId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(68px,82px)] gap-1.5 sm:grid-cols-[minmax(0,1fr)_82px_minmax(0,1.2fr)]">
                <div className="ledger-input flex items-center truncate">{row.accountName}</div>
                <div className="ledger-input flex items-center justify-end overflow-hidden pr-2 text-right text-[11px] tabular-nums">{money(row.total)}</div>
                <div className="ledger-input col-span-2 flex items-center truncate text-white/55 sm:col-span-1">{row.wallet || "No wallet"}</div>
              </div>
            ))}
            {!payroll.calculation.distributions.length ? <EmptyLedgerText text="Distributions calculate automatically" /> : null}
          </LedgerPanel>

          <div className="grid gap-2 md:grid-cols-[0.9fr_1.1fr]">
            <LedgerPanel title="Payroll Rules" color="text-[#4aa3ff]">
              <RuleInput label="Day Type" value={payroll.rules.dayType} onChange={(value) => payroll.setRules((current) => ({ ...current, dayType: value }))} />
              <RuleInput label="Recipient" value={payroll.rules.recipient} onChange={(value) => payroll.setRules((current) => ({ ...current, recipient: value }))} />
              <RuleInput label="Base Pay" type="number" value={String(payroll.rules.basePay)} onChange={(value) => payroll.setRules((current) => ({ ...current, basePay: Number(value || 0) }))} />
              <RuleInput label="Extra Pay" type="number" value={String(payroll.rules.extraPay)} onChange={(value) => payroll.setRules((current) => ({ ...current, extraPay: Number(value || 0) }))} />
            </LedgerPanel>
            <LedgerPanel title="Notes" color="text-[#ffd166]">
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 w-full rounded-lg border border-white/[0.08] bg-black/30 p-3 text-xs text-white outline-none focus:border-[#42e6a4]/60" placeholder="Add notes about today's payroll..." />
              <p className="text-[10px] leading-4 text-white/40">Team payroll uses active members and rules. Distributions are automatic.</p>
            </LedgerPanel>
          </div>

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-7">
            <TotalCard label="Total Expense" value={money(payroll.calculation.totalTeamPayroll)} color="text-[#ff6b78]" />
            <TotalCard label="Total Income" value={money(payroll.calculation.totalDailyIncome)} color="text-[#42e6a4]" />
            <TotalCard label="Misc Income" value={money(payroll.calculation.totalDevAllo)} color="text-[#4aa3ff]" />
            <TotalCard label="Referrer Expense" value={money(payroll.calculation.totalReferrals)} color="text-[#ff6b78]" />
            <TotalCard label="Profit" value={money(payroll.calculation.netProfit)} color="text-[#ffd166]" />
            <TotalCard label="Distributed" value={money(payroll.calculation.totalDistributed)} color="text-[#b475ff]" />
            <TotalCard label="Employees" value={String(payroll.employees.length)} color="text-[#42e6a4]" />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button onClick={shareReport} disabled={sharing || saving} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#4aa3ff]/25 bg-[#4aa3ff]/10 text-sm font-bold text-[#b8d9ff] disabled:opacity-50">
              <Image className="h-4 w-4" />
              Share Report
            </button>
            <button onClick={shareDay} disabled={sharing || saving} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#42e6a4]/25 bg-[#42e6a4]/10 text-sm font-bold text-[#b8ffe1] disabled:opacity-50">
              <Send className="h-4 w-4" />
              Send Summary
            </button>
            <button onClick={() => void saveDay()} disabled={saving || sharing} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1f8f66] text-sm font-bold text-white disabled:opacity-50">
              <Save className="h-5 w-5" />
              Save Day
            </button>
          </div>
          <p className="text-center text-xs text-white/35">All changes will be saved for {displayDate(selectedDate)}</p>
        </section>
      ) : null}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-white/45">{label}</p>
      <p className="mt-2 truncate text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-white/40">{hint}</p>
    </div>
  )
}

function TotalCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.035] p-2.5">
      <p className="truncate text-[9px] font-bold uppercase text-white/45">{label}</p>
      <p className={`mt-0.5 truncate text-base font-bold ${color}`}>{value}</p>
    </div>
  )
}

function LedgerPanel({ title, color, action, children }: { title: string; color: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className={`min-w-0 text-xs font-bold uppercase ${color}`}>{title}</h3>
        <div className="shrink-0">{action}</div>
      </div>
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  )
}

function AddMiniButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="inline-flex h-7 items-center gap-1 rounded-md border border-[#42e6a4]/20 bg-[#42e6a4]/10 px-2 text-[11px] font-bold text-[#42e6a4]">
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function WideAddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#42e6a4]/20 bg-black/20 text-xs font-bold text-[#42e6a4] transition hover:bg-[#42e6a4]/10">
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function LedgerHeader({ columns, labels }: { columns: string; labels: string[] }) {
  return (
    <div className={`grid gap-1.5 px-1 pb-0.5 ${columns}`}>
      {labels.map((label, index) => (
        <span key={`${label}-${index}`} className={`text-[9px] font-bold uppercase tracking-wide text-white/38 ${["Amount", "Income", "Expense"].includes(label) ? "pr-2 text-right" : ["Action", "Actions"].includes(label) ? "text-center" : ""}`}>{label}</span>
      ))}
    </div>
  )
}

function RowActions({ onEdit, onRemove }: { onEdit?: () => void; onRemove: () => void }) {
  return (
    <div className="flex h-8 items-center justify-center gap-1">
      {onEdit ? (
        <button onClick={onEdit} title="Edit" aria-label="Edit row" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#42e6a4]/20 bg-[#42e6a4]/10 text-[#42e6a4]">
          <Edit3 className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button onClick={onRemove} title="Delete" aria-label="Delete row" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400/20 bg-red-500/10 text-red-200">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function IconDeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Delete row" aria-label="Delete row" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400/20 bg-red-500/10 text-red-200">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}

function RuleInput({ label, value, type = "text", onChange }: { label: string; value: string; type?: "text" | "number"; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-2">
      <span className="text-[10px] font-bold uppercase text-white/45">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-md border border-white/[0.08] bg-black/30 px-2 text-xs font-semibold text-white/80 outline-none focus:border-[#42e6a4]/60" />
    </div>
  )
}

function LabeledAccountInput({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase text-white/45">{label}</span>
      {children}
    </label>
  )
}

function PayrollDatePicker({
  month,
  selectedDate,
  onMonthChange,
  onSelect,
  onClose,
}: {
  month: Date
  selectedDate: string
  onMonthChange: (date: Date) => void
  onSelect: (date: string) => void
  onClose: () => void
}) {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstWeekday = new Date(year, monthIndex, 1).getDay()
  const dayCount = new Date(year, monthIndex + 1, 0).getDate()
  const cells = Array.from({ length: firstWeekday + dayCount }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1)
  const keyForDay = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-[12vh] backdrop-blur-sm sm:pt-[16vh]" onMouseDown={onClose}>
      <div className="w-full max-w-[320px] rounded-xl border border-[#42e6a4]/25 bg-[#101513] p-3 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-bold text-white">
            {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month)}
          </h3>
          <button type="button" onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span key={day} className="py-1 text-[10px] font-bold uppercase text-white/35">{day.slice(0, 1)}</span>
          ))}
          {cells.map((day, index) => day ? (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(keyForDay(day))}
              className={`aspect-square rounded-md text-xs font-bold transition ${
                keyForDay(day) === selectedDate
                  ? "bg-[#1f8f66] text-white"
                  : "border border-white/[0.06] bg-white/[0.035] text-white/75 active:bg-[#42e6a4]/15"
              }`}
            >
              {day}
            </button>
          ) : <span key={`empty-${index}`} />)}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] text-[11px] font-bold text-white/65">Cancel</button>
          <button type="button" onClick={() => onSelect(dateKey())} className="h-8 rounded-lg bg-[#1f8f66] text-[11px] font-bold text-white">Today</button>
        </div>
      </div>
    </div>
  )
}

function EmptyLedgerText({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-white/[0.08] py-4 text-center text-xs font-semibold text-white/35">{text}</div>
}
