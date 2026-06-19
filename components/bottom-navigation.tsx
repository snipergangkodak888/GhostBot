"use client"

import { memo, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useNavbar } from "@/contexts/navbar-context"
import { MAIN_LOGO_URL } from "@/lib/branding"

const iconUrl = (name: string, color: string) => `https://api.iconify.design/${name}.svg?color=${encodeURIComponent(color)}`

const navItems = [
  { href: "/dashboard", label: "Home", icon: "line-md:home-md", color: "#2f80ff" },
  { href: "/dashboard/projects", label: "Projects", icon: "line-md:folder-multiple", color: "#ffd43b" },
  { href: "/dashboard/calendar", label: "Calendar", icon: "line-md:calendar", color: "#ff8a3d" },
  { href: "/dashboard/reminders", label: "Reminders", icon: "line-md:bell-alert-loop", color: "#ff4d5e" },
  { href: "/dashboard/payroll", label: "Payroll", icon: "payroll-dollar", color: "#42e6a4" },
]

function BottomNavigation() {
  const pathname = usePathname()
  const router = useRouter()
  const { isNavbarVisible } = useNavbar()
  const [optimisticPath, setOptimisticPath] = useState(pathname)

  useEffect(() => {
    setOptimisticPath(pathname)
  }, [pathname])

  useEffect(() => {
    navItems.forEach((item) => router.prefetch(item.href))
  }, [router])

  const isRouteActive = (href: string) => {
    if (href === "/dashboard") return optimisticPath === "/dashboard"
    return optimisticPath === href || optimisticPath.startsWith(`${href}/`)
  }

  const activeIndex = navItems.findIndex(({ href }) => isRouteActive(href))
  const activeColor = navItems[Math.max(activeIndex, 0)]?.color || "#2f80ff"

  return (
    <div
      className={`fixed bottom-5 left-0 right-0 z-50 flex justify-center px-3 pointer-events-none transition-transform duration-300 ease-out ${
        isNavbarVisible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <nav className="pointer-events-auto relative grid w-[min(94vw,390px)] grid-cols-5 items-stretch overflow-hidden rounded-2xl border border-white/[0.08] bg-black/78 p-1 shadow-[0_-8px_30px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 left-1 rounded-xl transition-all duration-200 ease-out"
          style={{
            width: "calc((100% - 8px) / 5)",
            transform: `translate3d(${Math.max(activeIndex, 0) * 100}%, 0, 0)`,
            opacity: activeIndex === -1 ? 0 : 1,
            background: `${activeColor}26`,
          }}
        />
        {navItems.map(({ href, label, icon, color }) => {
          const isActive = isRouteActive(href)
          return (
            <Link
              key={href}
              href={href}
              prefetch
              scroll={false}
              onClick={() => setOptimisticPath(href)}
              className="relative z-10 flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl"
            >
              {icon === "payroll-dollar" ? (
                <span
                  aria-hidden
                  className={`payroll-dollar-pop grid h-5 w-5 place-items-center text-lg font-black leading-none transition-opacity ${isActive ? "opacity-100" : "opacity-45"}`}
                  style={{ color }}
                >
                  $
                </span>
              ) : (
                <img
                  src={href === "/dashboard" ? MAIN_LOGO_URL : iconUrl(icon, color)}
                  className={`h-5 w-5 object-contain transition-opacity ${isActive ? "opacity-100" : "opacity-45"}`}
                  alt=""
                />
              )}
              <span className={`max-w-full truncate text-[9px] font-semibold ${isActive ? "text-white" : "text-white/40"}`} style={isActive ? { color } : undefined}>
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export default memo(BottomNavigation)
