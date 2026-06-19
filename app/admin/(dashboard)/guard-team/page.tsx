"use client"

import { useEffect, useState } from "react"
import { Copy, KeyRound, Shield, Trash2, UserMinus, UserPlus } from "lucide-react"
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
}

type GuardCode = {
  _id: string
  code: string
  status: string
  expiresAt?: string | null
  usedByTelegramId?: number
  usedAt?: string
  createdAt?: string
}

function dateLabel(value?: string | null) {
  if (!value) return "No date"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleString()
}

export default function GuardTeamPage() {
  const [members, setMembers] = useState<GuardMember[]>([])
  const [codes, setCodes] = useState<GuardCode[]>([])
  const [loading, setLoading] = useState(true)
  const [daysValid, setDaysValid] = useState("7")
  const [latestCode, setLatestCode] = useState("")

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/guard-team", { cache: "no-store", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      setMembers(Array.isArray(data.members) ? data.members : [])
      setCodes(Array.isArray(data.codes) ? data.codes : [])
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
      body: JSON.stringify({ action: "create-code", daysValid: Number(daysValid || 7) }),
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
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">New Invite Code</h2>
            <p className="mt-1 text-xs text-white/40">Give this code to one team member. It works once only.</p>
          </div>
          <label className="w-full sm:w-40">
            <span className="mb-1 block text-xs font-semibold uppercase text-white/40">Valid days</span>
            <input value={daysValid} onChange={(event) => setDaysValid(event.target.value)} type="number" min="1" className="h-10 w-full rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none focus:border-[#2f80ff]/70" />
          </label>
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
                <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Telegram</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {members.map((member) => (
                  <tr key={member._id}>
                    <td className="px-4 py-3 font-semibold text-white">{[member.firstName, member.lastName].filter(Boolean).join(" ") || member.username || "Unnamed"}</td>
                    <td className="px-4 py-3 text-white/50">{member.username ? `@${member.username}` : member.telegramId}</td>
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

