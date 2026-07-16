"use client"

import BottomNavigation from "@/components/bottom-navigation"
import { NavbarProvider } from "@/contexts/navbar-context"
import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import { useState } from "react"

const sectionSpots = [
  { match: "/dashboard/projects", rgb: "255,212,59" },
  { match: "/dashboard/calendar", rgb: "255,138,61" },
  { match: "/dashboard/reminders", rgb: "255,77,94" },
  { match: "/dashboard/payroll", rgb: "66,230,164" },
  { match: "/dashboard/data", rgb: "168,85,247" },
  { match: "/dashboard", rgb: "47,128,255" },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const spot = sectionSpots.find((item) => pathname === item.match || pathname.startsWith(`${item.match}/`))?.rgb || "47,128,255"
  const [detectedTimeZone, setDetectedTimeZone] = useState("")
  const [showTimeZonePrompt, setShowTimeZonePrompt] = useState(false)
  const [savingTimeZone, setSavingTimeZone] = useState(false)

  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    const initData = webApp?.initData || ""
    if (!initData) {
      router.replace("/telegram")
      return
    }
    const userData = webApp?.initDataUnsafe?.user
    fetch("/api/telegram/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, userData, startParam: webApp?.initDataUnsafe?.start_param }),
    }).then(async (res) => {
      if (!res.ok) {
        router.replace("/telegram")
        return
      }
      const data = await res.json().catch(() => ({}))
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || ""
      setDetectedTimeZone(detected)
      setShowTimeZonePrompt(Boolean(detected && !data?.user?.timeZone))
    }).catch(() => router.replace("/telegram"))
  }, [router])

  const saveTimeZone = async () => {
    if (!detectedTimeZone) return
    setSavingTimeZone(true)
    const response = await fetch("/api/user/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ timeZone: detectedTimeZone }),
    }).catch(() => null)
    setSavingTimeZone(false)
    if (response?.ok) setShowTimeZonePrompt(false)
  }

  return (
    <NavbarProvider>
      <div className="min-h-screen bg-black text-white">
        <div className="fixed inset-0 pointer-events-none">
          <div
            className="absolute inset-0"
            style={{ background: `radial-gradient(circle at 50% -12%, rgba(${spot},0.22), rgba(0,0,0,0.9) 40%, #000 78%)` }}
          />
        </div>

        <div
          aria-hidden
          className="relative z-10"
          style={{ height: 'calc(10px + var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px))' }}
        />

        <main className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-32 pt-2">
          {showTimeZonePrompt ? (
            <section className="mb-4 rounded-2xl border border-[#2f80ff]/30 bg-[#2f80ff]/10 p-4">
              <p className="text-sm font-bold text-white">Use your device timezone?</p>
              <p className="mt-1 text-xs text-white/60">Reminders without an explicit timezone will use {detectedTimeZone}.</p>
              <div className="mt-3 flex gap-2">
                <button disabled={savingTimeZone} onClick={saveTimeZone} className="rounded-lg bg-[#2f80ff] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {savingTimeZone ? "Saving…" : "Use this timezone"}
                </button>
                <button onClick={() => setShowTimeZonePrompt(false)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/65">Not now</button>
              </div>
            </section>
          ) : null}
          {children}
        </main>

        <BottomNavigation />
      </div>
    </NavbarProvider>
  )
}
