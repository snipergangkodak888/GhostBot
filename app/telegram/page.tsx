"use client"

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MAIN_LOGO_URL } from "@/lib/branding"

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string
        initDataUnsafe?: { user?: Record<string, unknown> }
        ready?: () => void
        expand?: () => void
      }
    }
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function parseInitDataUser(initData: string) {
  try {
    const params = new URLSearchParams(initData)
    const rawUser = params.get("user")
    return rawUser ? JSON.parse(rawUser) : null
  } catch {
    return null
  }
}

function TelegramLoginContent() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState("")
  const [inviteRequired, setInviteRequired] = useState(false)
  const [guardCode, setGuardCode] = useState("")
  const [loading, setLoading] = useState(true)
  const [authContext, setAuthContext] = useState<{ initData: string; userData: any; startParam?: string | null } | null>(null)

  const fallbackInitData = useMemo(() => params.get("initData") || "", [params])

  const authenticate = async (context: { initData: string; userData: any; startParam?: string | null }, code = "") => {
      const startedAt = Date.now()
      setLoading(true)
      setError("")
      try {
        const response = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...context, guardCode: code }),
        })
        const data = await readJsonResponse(response)

        if (!response.ok || data?.success === false) {
        if (data?.inviteRequired) {
          setInviteRequired(true)
          setError(data?.error || "Invite code required")
          return
        }
          setError(data?.error || "Telegram login failed")
          return
        }

        const wait = Math.max(0, 650 - (Date.now() - startedAt))
        window.setTimeout(() => {
        router.replace("/dashboard")
        }, wait)
      } catch (err) {
      setError(err instanceof Error ? err.message : "Telegram login failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const run = async () => {
      const webApp = window.Telegram?.WebApp
      webApp?.ready?.()
      webApp?.expand?.()

      const initData = webApp?.initData || fallbackInitData
      const telegramUser = webApp?.initDataUnsafe?.user || parseInitDataUser(initData)

      if (!initData) {
        setError("Invalid Telegram data")
        setLoading(false)
        return
      }

      const context = { initData, userData: telegramUser, startParam: webApp?.initDataUnsafe?.start_param }
      setAuthContext(context)
      authenticate(context)
    }

    run()
  }, [fallbackInitData, router])

  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    if (!authContext) return
    authenticate(authContext, guardCode)
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(20,110,252,0.22),rgba(0,0,0,0.9)_46%,#000_76%)]" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <img src={MAIN_LOGO_URL} alt="Ghost" className="h-28 w-28 object-contain" />
        {inviteRequired ? (
          <form onSubmit={submitCode} className="mt-8 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
            <h1 className="text-lg font-bold text-white">Enter Guard Code</h1>
            <p className="mt-1 text-sm text-white/45">Ask the admin for your one-time access code.</p>
            <input
              value={guardCode}
              onChange={(event) => setGuardCode(event.target.value.toUpperCase())}
              placeholder="GHOST-XXXXXXXX"
              className="mt-4 h-11 w-full rounded-xl border border-white/[0.08] bg-black px-3 text-center font-mono text-sm font-bold text-white outline-none focus:border-[#2f80ff]/70"
            />
            <button disabled={loading} className="mt-3 h-11 w-full rounded-xl bg-[#2f80ff] text-sm font-bold text-white disabled:opacity-50">
              Unlock Access
            </button>
          </form>
        ) : null}
        {error ? <p className="mt-6 text-sm font-semibold text-white">{error}</p> : null}
      </div>
    </div>
  )
}

export default function TelegramLoginPage() {
  return (
    <Suspense fallback={null}>
      <TelegramLoginContent />
    </Suspense>
  )
}
