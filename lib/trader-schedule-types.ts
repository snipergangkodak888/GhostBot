export const SCHEDULE_TIME_ZONE = "America/New_York"
export const SCHEDULE_ROLES = ["admin", "trading", "lead", "launch_support", "on_call"] as const
export type ScheduleRole = typeof SCHEDULE_ROLES[number]

export type TraderProfile = {
  id: string
  displayName: string
  telegramId?: number | null
  color: string
  canCoverAdmin: boolean
  active: boolean
  targetHoursMin: number
  targetHoursMax: number
  sortOrder: number
}

export type ShiftAssignment = {
  id: string
  traderId: string
  date: string
  startMinute: number
  endMinute: number
  roles: ScheduleRole[]
  teamNote?: string
  managementNote?: string
}

export type CoverageGrade = "ideal" | "solo" | "uncovered"

export type CoverageSlice = {
  startMinute: number
  endMinute: number
  startAt: string
  endAt: string
  admins: string[]
  traders: string[]
  support: string[]
  active: string[]
  grade: CoverageGrade
}

export type ScheduleIssue = {
  severity: "error" | "warning"
  code: string
  message: string
  date?: string
  startMinute?: number
  endMinute?: number
  assignmentId?: string
  traderId?: string
}

export type SchedulePayload = {
  assignments: ShiftAssignment[]
  coverageSlices?: CoverageSlice[]
  issues?: ScheduleIssue[]
  hoursByTrader?: Record<string, number>
  compiledAt?: string
}

export type ScheduleWeek = {
  weekStart: string
  timeZone: string
  draftRevision: number
  draft: SchedulePayload
  publishedRevision: number
  published: SchedulePayload | null
  draftUpdatedBy?: number | null
  publishedBy?: number | null
  publishedAt?: string | null
  createdAt?: string
  updatedAt?: string
}
