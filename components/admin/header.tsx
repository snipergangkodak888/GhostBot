"use client"
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Settings, LogOut, User, X, ChevronRight, Clock, Monitor, Smartphone, Globe, Pencil, Shield, KeyRound, Mail, Eye, EyeOff, Check, Loader2 } from 'lucide-react'
import { useAdminSettings } from '@/contexts/admin-settings-context'
import { APP_NAME, MAIN_LOGO_URL } from '@/lib/branding'

type SearchPage = { label: string; href: string; icon: string; desc: string }
type SearchUser = { id: string; telegramId: number; label: string; photoUrl: string | null }
type SearchResult = { users: SearchUser[]; pages: SearchPage[] }

type LoginEvent = {
  _id: string
  email: string
  ip: string
  browser: string
  os: string
  device: string
  userAgent: string
  loginAt: string
}

export function AdminHeader() {
  const router = useRouter()
  const { settings } = useAdminSettings()
  const platformName = settings.platformName || APP_NAME
  const logoUrl = MAIN_LOGO_URL

  // ── Search ──────────────────────────────────────────────
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      const term = q.trim()
      if (!term) { setResults(null); return }
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal, credentials: 'include' })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        setResults({
          users: Array.isArray(data?.users) ? data.users : [],
          pages: Array.isArray(data?.pages) ? data.pages : [],
        })
      } catch {}
    }, 220)
    return () => { ctrl.abort(); clearTimeout(timer) }
  }, [q])

  const hasResults = useMemo(() => {
    const users = Array.isArray(results?.users) ? results.users : []
    const pages = Array.isArray(results?.pages) ? results.pages : []
    return users.length > 0 || pages.length > 0
  }, [results])

  // Close search on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // ── Settings bubble ──────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // ── Login History modal ──────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<LoginEvent[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const openHistory = async () => {
    setSettingsOpen(false)
    setHistoryOpen(true)
    if (history.length) return
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/admin/login-history', { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      setHistory(Array.isArray(json?.history) ? json.history : [])
    } catch {}
    setHistoryLoading(false)
  }

  // ── Edit Admin modal ─────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false)
  const [editEmail, setEditEmail] = useState('')
  const [editCurrentPw, setEditCurrentPw] = useState('')
  const [editNewPw, setEditNewPw] = useState('')
  const [editConfirmPw, setEditConfirmPw] = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editSuccess, setEditSuccess] = useState('')

  const openEditAdmin = async () => {
    setSettingsOpen(false)
    setEditError('')
    setEditSuccess('')
    setEditCurrentPw('')
    setEditNewPw('')
    setEditConfirmPw('')
    setEditOpen(true)
    try {
      const res = await fetch('/api/admin/profile', { credentials: 'include' })
      const json = await res.json()
      if (json.email) setEditEmail(json.email)
    } catch {}
  }

  const handleSaveAdmin = async () => {
    setEditError('')
    setEditSuccess('')
    if (editNewPw && editNewPw !== editConfirmPw) {
      setEditError('New passwords do not match')
      return
    }
    if (!editCurrentPw) {
      setEditError('Current password is required')
      return
    }
    setEditSaving(true)
    try {
      const body: Record<string, string> = { currentPassword: editCurrentPw }
      if (editEmail) body.newEmail = editEmail
      if (editNewPw) body.newPassword = editNewPw
      const res = await fetch('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setEditError(json.error || 'Update failed'); return }
      const parts = []
      if (json.emailChanged) parts.push('email')
      if (json.passwordChanged) parts.push('password')
      setEditSuccess(`Updated successfully: ${parts.join(' & ')}`)
      setEditCurrentPw('')
      setEditNewPw('')
      setEditConfirmPw('')
    } catch {
      setEditError('Network error, try again')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Logout ───────────────────────────────────────────────
  const handleLogout = async () => {
    try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }) } finally {
      if (typeof window !== 'undefined') window.location.href = '/admin/login'
    }
  }

  const formatDate = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {/* ── Header bar ───────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-[#146efc]/20 backdrop-blur-2xl" style={{ background: 'rgba(255,255,255,0.045)' }}>
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">

          {/* Logo + name */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#146efc]/25 bg-[#146efc]/10">
              <img src={logoUrl} alt={platformName || 'logo'} width={32} height={32} className="w-7 h-7 object-contain" />
            </span>
            <span className="font-bold tracking-wide text-sm text-white hidden sm:block">{platformName || 'Dashboard'}</span>
          </div>

          {/* Search */}
          <div ref={searchRef} className="flex-1 max-w-xl relative">
            <div className="flex items-center gap-2 border border-[#146efc]/20 rounded-xl px-3 py-2 transition-colors focus-within:border-[#146efc]/70" style={{ background: 'rgba(20,110,252,0.08)' }}>
              <Search className="h-4 w-4 text-[#8db8ff] shrink-0" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setSearchOpen(true) }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search users, pages, features…"
                autoComplete="off"
                className="bg-transparent outline-none text-sm text-white placeholder:text-gray-500 w-full"
              />
              {q && (
                <button onClick={() => { setQ(''); setResults(null) }} className="text-gray-500 hover:text-white transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Dropdown */}
            {searchOpen && hasResults && (
              <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl border border-white/10 backdrop-blur-2xl p-2 z-50 max-h-96 overflow-y-auto shadow-2xl" style={{ background: 'rgba(22,24,30,0.94)' }}>

                {/* Pages */}
                {results!.pages.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider px-2 py-1">Pages & Features</p>
                    {results!.pages.map(p => (
                      <button
                        key={p.href}
                        onClick={() => { router.push(p.href); setSearchOpen(false); setQ('') }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors group"
                      >
                        <span className="text-lg w-7 text-center">{p.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white">{p.label}</p>
                          <p className="text-xs text-gray-500 truncate">{p.desc}</p>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-gray-600 group-hover:text-gray-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Users */}
                {results!.users.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider px-2 py-1">Users</p>
                    {results!.users.map(u => (
                      <button
                        key={u.id}
                        onClick={() => { router.push('/admin/payroll'); setSearchOpen(false); setQ('') }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors group"
                      >
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
                          {u.photoUrl
                            ? <img src={u.photoUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            : <User className="h-4 w-4 text-gray-400" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{u.label}</p>
                          {u.telegramId && <p className="text-xs text-gray-500">ID: {u.telegramId}</p>}
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-gray-600 group-hover:text-gray-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right buttons */}
          <div className="flex items-center gap-2 shrink-0">

            {/* Settings bubble */}
            <div ref={settingsRef} className="relative">
              <button
                className="p-2 rounded-xl border border-[#146efc]/40 hover:opacity-90 transition-opacity"
                style={{ background: '#146efc' }}
                onClick={() => setSettingsOpen(v => !v)}
              >
                <Settings className="h-4 w-4 text-white" />
              </button>

              {settingsOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl border border-white/10 backdrop-blur-2xl p-1.5 z-50 shadow-2xl" style={{ background: 'rgba(20,20,20,0.97)' }}>
                  <button
                    onClick={openEditAdmin}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#146efc22' }}>
                      <Pencil className="h-3.5 w-3.5" style={{ color: '#146efc' }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Edit Admin</p>
                      <p className="text-[10px] text-gray-500">Change email & password</p>
                    </div>
                  </button>

                  <div className="h-px bg-white/8 my-1" />

                  <button
                    onClick={openHistory}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/15">
                      <Clock className="h-3.5 w-3.5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Login History</p>
                      <p className="text-[10px] text-gray-500">IP, device & browser</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Logout */}
            <button
              className="p-2 rounded-xl border border-white/15 hover:bg-white/10 transition-colors"
              style={{ background: 'rgba(255,255,255,0.07)' }}
              onClick={handleLogout}
              title="Logout"
            >
              <LogOut className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Login History Modal ───────────────────────────── */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(20px)' }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-500/15">
                  <Shield className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Login History</h2>
                  <p className="text-xs text-gray-500">All admin login sessions</p>
                </div>
              </div>
              <button onClick={() => setHistoryOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-16 text-gray-500">No login records yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/8 text-xs text-gray-500 uppercase tracking-wider">
                      <th className="text-left px-5 py-3 font-medium">Date & Time</th>
                      <th className="text-left px-5 py-3 font-medium">IP Address</th>
                      <th className="text-left px-5 py-3 font-medium">Device</th>
                      <th className="text-left px-5 py-3 font-medium">Browser</th>
                      <th className="text-left px-5 py-3 font-medium">OS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={h._id} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${i === 0 ? 'bg-[#146efc]/5' : ''}`}>
                        <td className="px-5 py-3">
                          <span className="text-white font-medium">{formatDate(h.loginAt)}</span>
                          {i === 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: '#146efc22', color: '#146efc' }}>Latest</span>}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs text-gray-300 bg-white/5 px-2 py-1 rounded-lg">{h.ip}</span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5 text-gray-300">
                            {h.device?.toLowerCase().includes('mobile') || h.device?.toLowerCase().includes('phone') || h.device?.toLowerCase().includes('iphone') || h.device?.toLowerCase().includes('ipad')
                              ? <Smartphone className="h-3.5 w-3.5 text-gray-500" />
                              : <Monitor className="h-3.5 w-3.5 text-gray-500" />
                            }
                            {h.device || '—'}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5 text-gray-300">
                            <Globe className="h-3.5 w-3.5 text-gray-500" />
                            {h.browser || '—'}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-400">{h.os || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-white/8 flex items-center justify-between">
              <p className="text-xs text-gray-500">{history.length} records shown</p>
              <button onClick={() => setHistoryOpen(false)} className="text-xs px-4 py-1.5 rounded-lg border border-white/15 text-gray-300 hover:text-white hover:bg-white/8 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Edit Admin Modal ────────────────────────────── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.055)', backdropFilter: 'blur(20px)' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#146efc22' }}>
                  <KeyRound className="h-4 w-4" style={{ color: '#146efc' }} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Edit Admin</h2>
                  <p className="text-xs text-gray-500">Update your credentials</p>
                </div>
              </div>
              <button onClick={() => setEditOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <div className="px-5 py-5 space-y-4">

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email Address
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none border border-white/10 focus:border-white/25 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.06)' }}
                  placeholder="admin@example.com"
                  autoComplete="off"
                />
              </div>

              <div className="h-px bg-white/8" />

              {/* New password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" /> New Password <span className="text-gray-600">(leave blank to keep current)</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={editNewPw}
                    onChange={e => setEditNewPw(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 pr-10 text-sm text-white outline-none border border-white/10 focus:border-white/25 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                    placeholder="New password (min 6 chars)"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowNewPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm new password */}
              {editNewPw && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-400">Confirm New Password</label>
                  <input
                    type="password"
                    value={editConfirmPw}
                    onChange={e => setEditConfirmPw(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none border transition-colors ${editConfirmPw && editConfirmPw !== editNewPw ? 'border-red-500/50' : 'border-white/10 focus:border-white/25'}`}
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                    placeholder="Repeat new password"
                    autoComplete="new-password"
                  />
                </div>
              )}

              <div className="h-px bg-white/8" />

              {/* Current password (required to confirm) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" /> Current Password <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={editCurrentPw}
                    onChange={e => setEditCurrentPw(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 pr-10 text-sm text-white outline-none border border-white/10 focus:border-white/25 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                    placeholder="Required to confirm changes"
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={() => setShowCurrentPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Error / Success */}
              {editError && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <X className="h-4 w-4 shrink-0" /> {editError}
                </div>
              )}
              {editSuccess && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm" style={{ background: '#146efc15', borderColor: '#146efc40', color: '#146efc' }}>
                  <Check className="h-4 w-4 shrink-0" /> {editSuccess}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/8 flex items-center justify-end gap-2">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-xl text-sm text-gray-300 border border-white/10 hover:bg-white/8 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSaveAdmin}
                disabled={editSaving || !editCurrentPw}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: '#146efc', color: '#ffffff' }}
              >
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
