"use client"
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'
import { APP_NAME, MAIN_LOGO_URL } from '@/lib/branding'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [platformName, setPlatformName] = useState<string>('')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const res = await fetch('/api/public-settings', { credentials: 'include', headers: { 'Content-Type': 'application/json' } })
        const json = await res.json().catch(() => ({}))
        if (active) setPlatformName(json?.settings?.platformName || '')
      } catch {}
    }
    load()
    return () => { active = false }
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Login failed')
      }
  toast({ title: 'Welcome back', description: 'Login successful.' })
  if (typeof window !== 'undefined') window.location.href = '/admin'
    } catch (err: any) {
  setError(err.message)
  toast({ title: 'Login error', description: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full relative flex flex-col items-center justify-center bg-black p-4 sm:p-6">
      {/* Theme Background is provided by parent admin layout */}
      
      {/* Logo above card */}
      <div className="mb-6 flex flex-col items-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-[#146efc]/25 bg-[#146efc]/10">
          <img src={MAIN_LOGO_URL} alt={platformName || APP_NAME} className="w-16 h-16 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
      </div>

      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-[#146efc]/25 bg-white/[0.045] p-6 shadow-2xl shadow-[#146efc]/10 backdrop-blur-xl sm:p-8">
        {/* Key Icon */}
        <div className="flex justify-center mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[#146efc]/25 bg-[#146efc]/10 text-[#146efc]">
            <span className="text-2xl">↯</span>
          </div>
        </div>
        <h1 className="text-center text-xl sm:text-2xl font-extrabold text-white">Admin Login</h1>
        <p className="text-center text-gray-400 mt-1 text-xs sm:text-sm">Manage {platformName || 'your platform'}</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="w-full rounded-lg bg-[#146efc]/5 border border-[#146efc]/20 px-3 py-2 text-white outline-none focus:border-[#146efc] transition-colors" />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required className="w-full rounded-lg bg-[#146efc]/5 border border-[#146efc]/20 px-3 py-2 text-white outline-none focus:border-[#146efc] transition-colors" />
          </div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <button disabled={loading} className="w-full font-bold py-2.5 rounded-xl disabled:opacity-60 transition-all text-white" style={{ background: '#146efc' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
