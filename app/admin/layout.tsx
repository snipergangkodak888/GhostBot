"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

const sectionSpots = [
  { match: "/admin/projects", rgb: "255,212,59" },
  { match: "/admin/calendar", rgb: "255,138,61" },
  { match: "/admin/reminders", rgb: "255,77,94" },
  { match: "/admin/payroll", rgb: "66,230,164" },
  { match: "/admin/data", rgb: "168,85,247" },
  { match: "/admin", rgb: "47,128,255" },
]

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const spot = sectionSpots.find((item) => pathname === item.match || pathname.startsWith(`${item.match}/`))?.rgb || "47,128,255"

  // Add admin-body class to allow text selection in admin pages
  useEffect(() => {
    document.body.classList.add('admin-body')
    return () => {
      document.body.classList.remove('admin-body')
    }
  }, [])

  // Minimal wrapper for /admin so /admin/login is clean.
  // Dashboard pages use the grouped layout in /admin/(dashboard)/layout.tsx
  return (
    <div className="min-h-screen w-full relative text-white" style={{ background: '#000000' }}>
      <div
        className="absolute inset-0 z-0"
        style={{ background: `radial-gradient(circle at 20% 0%, rgba(${spot},0.18), transparent 34%), #000000` }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
