"use client"

import { useEffect, useState } from "react"
import { Copy, KeyRound, Link2, Shield, Trash2, UserMinus, UserPlus, Users } from "lucide-react"
import { toast } from "sonner"

type GuardMember = {
  _id: string
  telegramId: number
  firstName?: string
  lastName?: string
  username?: string
  status?: string
  inviteCode?: string
  createdAt?: string
  activatedAt?: string
  deactivatedAt?: string
  accessRole?: "member" | "admin"
}

type GuardCode = {
  _id: string
  code: string
  status: string
  expiresAt?: string | null
  usedByTelegramId?: number
  usedAt?: string
  createdAt?: string
  accessRole?: "member" | "admin"
}

type EnrollmentGroup = {
  chatId: string
  title: string
  profile: string
  telegramMemberCount?: number | null
  discoveredCount?: number
  enrolledCount: number
  enrollmentLinkStatus: string
  enrollmentLinkExpiresAt?: string | null
}

type DiscoveredMember = {
  telegramId: number
  firstName?: string
  lastName?: string
  username?: string
  isTelegramAdmin?: boolean
  accessRole?: "member" | "admin" | null
  guardStatus?: string
  memberships?: Array<{ chatId: string; chatTitle: string; telegramStatus: string; membershipStatus: string }>
}

function dateLabel(value?: string | null) {
  if (!value) return "No date"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleString()
}

export default function GuardTeamPage() {
  const [members, setMembers] = useState<GuardMember[]>([])
  const [codes, setCodes] = useState<GuardCode[]>([])
  const [enrollmentGroups, setEnrollmentGroups] = useState<EnrollmentGroup[]>([])
  const [discoveredMembers, setDiscoveredMembers] = useState<DiscoveredMember[]>([])
  const [loading, setLoading] = useState(true)
  const [daysValid, setDaysValid] = useState("7")
  const [latestCode, setLatestCode] = useState("")
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member")

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/guard-team", { cache: "no-store", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      setMembers(Array.isArray(data.members) ? data.members : [])
      setCodes(Array.isArray(data.codes) ? data.codes : [])
      setEnrollmentGroups(Array.isArray(data.groups) ? data.groups : [])
      setDiscoveredMembers(Array.isArray(data.discoveredMembers) ? data.discoveredMembers : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const createCode = async () => {
    const res = await fetch("/api/admin/guard-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "create-code", daysValid: Number(daysValid || 7), accessRole: inviteRole }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || "Invite code was not created")
      return
    }
    setLatestCode(data.code?.code || "")
    toast.success("Invite code created")
    load()
  }

  const updateMemberRole = async (id: string, accessRole: "member" | "admin") => {
    const res = await fetch("/api/admin/guard-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "update-member-role", id, accessRole }),
    })
    if (!res.ok) return toast.error("Member role was not updated")
    toast.success(`Member is now ${accessRole === "admin" ? "an admin" : "a standard member"}`)
    load()
  }

  const grantDiscoveredAccess = async (telegramId: number, accessRole: "member" | "admin") => {
    const res = await fetch("/api/admin/guard-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "grant-discovered-access", telegramId, accessRole }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(data.error || "Guard access was not updated")
    toast.success(`Guard access granted as ${accessRole}`)
    load()
  }

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code).catch(() => {})
    toast.success("Code copied")
  }

  const deactivateMember = async (id: string) => {
    if (!confirm("Deactivate this member and block app/bot access?")) return
    const res = await fetch("/api/admin/guard-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "deactivate-member", id }),
    })
    if (!res.ok) {
      toast.error("Member was not deactivated")
      return
    }
    toast.success("Member deactivated")
    load()
  }

  const deleteCode = async (id: string) => {
    if (!confirm("Delete this invite code?")) return
    const res = await fetch("/api/admin/guard-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "delete-code", id }),
    })
    if (!res.ok) {
      toast.error("Code was not deleted")
      return
    }
    toast.success("Code deleted")
    load()
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-[#2f80ff]/25 bg-[#2f80ff]/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#2f80ff]/20 text-[#8db8ff]"><Shield className="h-5 w-5" /></span>
          <div>
            <h1 className="text-2xl font-bold text-white">Guard Team</h1>
            <p className="mt-1 text-sm text-white/45">Invite members with one-time codes and control bot/app access.</p>
          </div>
        </div>
        <button onClick={createCode} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#2f80ff]/40 bg-[#2f80ff] px-4 text-sm font-bold text-white">
          <UserPlus className="h-4 w-4" />
          Add Member
        </button>
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-200"><Link2 className="h-5 w-5" /></span>
          <div>
            <h2 className="text-sm font-bold text-white">Telegram Group Enrollment</h2>
            <p className="mt-1 text-xs text-white/40">Run /setchat in a group to create its verified enrollment button. Use /guardlink refresh or /guardlink revoke to manage it.</p>
          </div>
        </div>
        {enrollmentGroups.length === 0 ? <Empty text="No configured Telegram groups yet" /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {enrollmentGroups.map((group) => (
              <article key={group.chatId} className="rounded-xl border border-white/[0.08] bg-black/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{group.title}</p>
                    <p className="mt-1 text-xs uppercase text-white/35">{group.profile}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${group.enrollmentLinkStatus === "active" ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-200"}`}>{group.enrollmentLinkStatus}</span>
                </div>
                <p className="mt-4 text-sm text-white/65"><span className="font-bold text-white">{group.enrolledCount}</span> enrolled{group.telegramMemberCount == null ? "" : ` of ${group.telegramMemberCount} Telegram members`}</p>
                <p className="mt-1 text-xs text-white/35">{group.discoveredCount || 0} members discovered by the bot</p>
                <p className="mt-1 text-xs text-white/35">Link expires: {dateLabel(group.enrollmentLinkExpiresAt)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#2f80ff]/15 text-[#8db8ff]"><Users className="h-5 w-5" /></span>
          <div>
            <h2 className="text-sm font-bold text-white">Telegram Team Directory</h2>
            <p className="mt-1 text-xs text-white/40">Members verified by an enrollment link, administrator sync, membership update, or group activity. Telegram administrators are never promoted automatically.</p>
          </div>
        </div>
        {discoveredMembers.length === 0 ? <Empty text="No Telegram members discovered yet" /> : (
          <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase text-white/40">
                <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Groups</th><th className="px-4 py-3">Telegram</th><th className="px-4 py-3">Guard status</th><th className="px-4 py-3">Guard role</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {discoveredMembers.map((member) => (
                  <tr key={member.telegramId}>
                    <td className="px-4 py-3"><p className="font-semibold text-white">{[member.firstName, member.lastName].filter(Boolean).join(" ") || member.username || member.telegramId}</p><p className="mt-1 text-xs text-white/35">{member.username ? `@${member.username}` : member.telegramId}</p></td>
                    <td className="px-4 py-3 text-xs text-white/55">
                      {(member.memberships || []).length ? <div className="space-y-1">{(member.memberships || []).map((membership) => <p key={`${membership.chatId}:${membership.telegramStatus}`}>{membership.chatTitle} · {membership.membershipStatus}</p>)}</div> : "No group"}
                    </td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${member.isTelegramAdmin ? "bg-purple-500/15 text-purple-200" : "bg-white/[0.06] text-white/55"}`}>{member.isTelegramAdmin ? "Administrator" : "Member"}</span></td>
                    <td className="px-4 py-3 text-xs text-white/55">{String(member.guardStatus || "not_enrolled").replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">
                      <select value={member.accessRole || "none"} onChange={(event) => event.target.value !== "none" && grantDiscoveredAccess(member.telegramId, event.target.value as "member" | "admin")} className="h-9 rounded-lg border border-white/[0.08] bg-black px-2 text-xs font-semibold text-white">
                        <option value="none" disabled>No access</option>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">New Invite Code</h2>
            <p className="mt-1 text-xs text-white/40">Give this code to one team member. It works once only.</p>
          </div>
          <div className="flex w-full gap-3 sm:w-auto">
            <label className="w-full sm:w-40">
              <span className="mb-1 block text-xs font-semibold uppercase text-white/40">Valid days</span>
              <input value={daysValid} onChange={(event) => setDaysValid(event.target.value)} type="number" min="1" className="h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#2f80ff]/70" />
            </label>
            <label className="w-full sm:w-44">
              <span className="mb-1 block text-xs font-semibold uppercase text-white/40">Access role</span>
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "member" | "admin")} className="h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#2f80ff]/70">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
        </div>
        {latestCode ? (
          <button onClick={() => copyCode(latestCode)} className="flex w-full items-center justify-between rounded-xl border border-[#2f80ff]/30 bg-[#2f80ff]/10 p-4 text-left">
            <span>
              <span className="block text-xs font-semibold uppercase text-white/40">Latest code</span>
              <span className="mt-1 block font-mono text-xl font-bold text-[#8db8ff]">{latestCode}</span>
            </span>
            <Copy className="h-5 w-5 text-[#8db8ff]" />
          </button>
        ) : (
          <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-center text-sm text-white/35">Click Add Member to generate a code</div>
        )}
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <h2 className="mb-4 text-sm font-bold text-white">Team Members</h2>
        {loading ? <Empty text="Loading members..." /> : members.length === 0 ? <Empty text="No team members yet" /> : (
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase text-white/40">
                <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Telegram</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {members.map((member) => (
                  <tr key={member._id}>
                    <td className="px-4 py-3 font-semibold text-white">{[member.firstName, member.lastName].filter(Boolean).join(" ") || member.username || "Unnamed"}</td>
                    <td className="px-4 py-3 text-white/50">{member.username ? `@${member.username}` : member.telegramId}</td>
                    <td className="px-4 py-3">
                      <select value={member.accessRole || "member"} disabled={member.status !== "active"} onChange={(event) => updateMemberRole(member._id, event.target.value as "member" | "admin")} className="h-9 rounded-lg border border-white/[0.08] bg-black px-2 text-xs font-semibold text-white disabled:opacity-40">
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${member.status === "active" ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200"}`}>{member.status || "active"}</span></td>
                    <td className="px-4 py-3 text-white/45">{dateLabel(member.activatedAt || member.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button disabled={member.status !== "active"} onClick={() => deactivateMember(member._id)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 text-xs font-bold text-red-200 disabled:opacity-40">
                        <UserMinus className="h-4 w-4" />
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <h2 className="mb-4 text-sm font-bold text-white">Codes History</h2>
        {codes.length === 0 ? <Empty text="No codes yet" /> : (
          <div className="grid gap-3 xl:grid-cols-2">
            {codes.map((item) => (
              <article key={item._id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-base font-bold text-white">{item.code}</p>
                    <p className="mt-1 text-xs text-white/40">Expires: {dateLabel(item.expiresAt)}</p>
                    {item.usedByTelegramId ? <p className="mt-1 text-xs text-white/40">Used by {item.usedByTelegramId} on {dateLabel(item.usedAt)}</p> : null}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === "unused" ? "bg-blue-500/15 text-blue-200" : item.status === "used" ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200"}`}>{item.status}</span>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => copyCode(item.code)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-bold text-white"><Copy className="h-4 w-4" />Copy</button>
                  <button onClick={() => deleteCode(item._id)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 text-xs font-bold text-red-200"><Trash2 className="h-4 w-4" />Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-sm text-white/40">{text}</div>
}
