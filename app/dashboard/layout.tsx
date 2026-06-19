"use client"

import BottomNavigation from "@/components/bottom-navigation"
import { NavbarProvider } from "@/contexts/navbar-context"
import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"

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
    }).then((res) => {
      if (!res.ok) router.replace("/telegram")
    }).catch(() => router.replace("/telegram"))
  }, [router])

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
          {children}
        </main>

        <BottomNavigation />
      </div>
    </NavbarProvider>
  )
}
