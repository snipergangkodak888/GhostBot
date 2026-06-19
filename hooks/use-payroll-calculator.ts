"use client"

import { useMemo, useState } from "react"
import {
  calculatePayrollLedger,
  type ClientIncomeInput,
  type DevAllocationInput,
  type PayrollAccount,
  type PayrollProject,
  type TeamPayrollInput,
} from "@/lib/payroll-ledger"

export type PayrollLedgerDraft = {
  teamPayroll?: TeamPayrollInput[]
  clientIncome?: ClientIncomeInput[]
  devAllocations?: DevAllocationInput[]
  rules?: PayrollRules
}

export type PayrollRules = {
  dayType: string
  recipient: string
  basePay: number
  extraPay: number
}

const defaultRules: PayrollRules = {
  dayType: "Launch Days",
  recipient: "Launch Team Base",
  basePay: 150,
  extraPay: 50,
}

const firstAccountId = (accounts: PayrollAccount[], type: PayrollAccount["type"]) =>
  String(accounts.find((account) => account.type === type)?._id || accounts.find((account) => account.type === type)?.id || "")

const firstProjectId = (projects: PayrollProject[]) =>
  String(projects[0]?._id || projects[0]?.id || "")

export function usePayrollCalculator(accounts: PayrollAccount[], projects: PayrollProject[] = []) {
  const employees = useMemo(() => accounts.filter((account) => account.type === "EMPLOYEE"), [accounts])
  const clients = useMemo(() => accounts.filter((account) => account.type === "CLIENT"), [accounts])
  const referrers = useMemo(() => accounts.filter((account) => account.type === "REFERRER"), [accounts])
  const treasury = useMemo(() => accounts.filter((account) => account.type === "SYSTEM_TREASURY"), [accounts])

  const [teamPayroll, setTeamPayroll] = useState<TeamPayrollInput[]>([])
  const [clientIncome, setClientIncome] = useState<ClientIncomeInput[]>([])
  const [devAllocations, setDevAllocations] = useState<DevAllocationInput[]>([])
  const [rules, setRules] = useState<PayrollRules>(defaultRules)

  const calculation = useMemo(
    () => calculatePayrollLedger({ accounts, projects, teamPayroll, clientIncome, devAllocations, basePay: rules.basePay, chartPay: rules.extraPay }),
    [accounts, projects, teamPayroll, clientIncome, devAllocations, rules.basePay, rules.extraPay],
  )

  const loadTemplate = () => {
    setTeamPayroll(employees.map((account) => ({ accountId: String(account._id || account.id), status: "active", projectIds: [] })))
    setClientIncome(projects.length ? [{ projectId: firstProjectId(projects), incomeType: "trading", income: 0 }] : [])
    setDevAllocations(projects.length ? [{ projectId: firstProjectId(projects), income: 0 }] : [])
  }

  const loadDraft = (draft?: PayrollLedgerDraft | null) => {
    setTeamPayroll(Array.isArray(draft?.teamPayroll) ? draft.teamPayroll : [])
    setClientIncome(Array.isArray(draft?.clientIncome) ? draft.clientIncome : [])
    setDevAllocations(Array.isArray(draft?.devAllocations) ? draft.devAllocations : [])
    setRules({ ...defaultRules, ...(draft?.rules || {}) })
  }

  const addTeamRow = () => setTeamPayroll((rows) => [...rows, { accountId: firstAccountId(accounts, "EMPLOYEE"), status: "active", projectIds: [] }])
  const addClientIncomeRow = () => setClientIncome((rows) => [...rows, { projectId: firstProjectId(projects), incomeType: "trading", income: 0 }])
  const addDevAllocationRow = () => setDevAllocations((rows) => [...rows, { projectId: firstProjectId(projects), income: 0 }])

  const updateTeamRow = (index: number, patch: Partial<TeamPayrollInput>) =>
    setTeamPayroll((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))

  const updateClientIncomeRow = (index: number, patch: Partial<ClientIncomeInput>) =>
    setClientIncome((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))

  const updateDevAllocationRow = (index: number, patch: Partial<DevAllocationInput>) =>
    setDevAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))

  const removeTeamRow = (index: number) => setTeamPayroll((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
  const removeClientIncomeRow = (index: number) => setClientIncome((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
  const removeDevAllocationRow = (index: number) => setDevAllocations((rows) => rows.filter((_, rowIndex) => rowIndex !== index))

  return {
    employees,
    clients,
    referrers,
    treasury,
    teamPayroll,
    clientIncome,
    devAllocations,
    rules,
    calculation,
    setRules,
    loadTemplate,
    loadDraft,
    addTeamRow,
    addClientIncomeRow,
    addDevAllocationRow,
    updateTeamRow,
    updateClientIncomeRow,
    updateDevAllocationRow,
    removeTeamRow,
    removeClientIncomeRow,
    removeDevAllocationRow,
  }
}
