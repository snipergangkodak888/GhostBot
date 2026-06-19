"use client"
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminHeader } from '@/components/admin/header'
import { AdminSettingsProvider } from '@/contexts/admin-settings-context'
import { ActivityWidget } from '@/components/admin/activity-widget'
import { preloadAdminImages } from '@/hooks/use-image-preloader'
import { MAIN_LOGO_URL } from '@/lib/branding'

const sectionSpots = [
  { match: "/admin/projects", rgb: "255,212,59", hex: "#ffd43b" },
  { match: "/admin/calendar", rgb: "255,138,61", hex: "#ff8a3d" },
  { match: "/admin/reminders", rgb: "255,77,94", hex: "#ff4d5e" },
  { match: "/admin/payroll", rgb: "66,230,164", hex: "#42e6a4" },
  { match: "/admin/data", rgb: "168,85,247", hex: "#a855f7" },
  { match: "/admin", rgb: "47,128,255", hex: "#2f80ff" },
]

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const spot = sectionSpots.find((item) => pathname === item.match || pathname.startsWith(`${item.match}/`)) || sectionSpots[sectionSpots.length - 1]
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isChecking, setIsChecking] = useState(true)

  // Check auth only once on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Call bootstrap API to verify admin token
        const res = await fetch('/api/admin/bootstrap', {
          method: 'GET',
          credentials: 'include',
        })
        
        if (res.status === 401) {
          // Not authenticated, redirect to login
          router.replace('/admin/login')
          return
        }
        
        if (res.ok) {
          setIsAuthorized(true)
        } else {
          router.replace('/admin/login')
        }
      } catch (error) {
        console.error('Auth check failed:', error)
        router.replace('/admin/login')
      } finally {
        setIsChecking(false)
      }
    }

    checkAuth()
  }, [router])

  // Preload admin images on mount
  useEffect(() => {
    if (isAuthorized) {
      preloadAdminImages()
    }
  }, [isAuthorized])

  // Show loading state while checking auth
  if (isChecking) {
    return (
      <div className="min-h-screen w-full relative text-white" style={{ background: '#000000' }}>
        <div
          className="absolute inset-0 z-0"
          style={{ background: `radial-gradient(circle at center, rgba(${spot.rgb},0.16), rgba(0,0,0,0.92) 46%, #000000 70%)` }}
        />
        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-5">
            <div className="relative h-20 w-20">
              <div className="absolute inset-0 rounded-full border-2 animate-spin" style={{ borderColor: `${spot.hex}33`, borderTopColor: spot.hex }} />
              <img src={MAIN_LOGO_URL} alt="Ghost Team System" className="absolute inset-0 m-auto h-12 w-12 object-contain" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Don't render anything if not authorized (will redirect)
  if (!isAuthorized) {
    return null
  }

  return (
    <AdminSettingsProvider>
      <div className="min-h-screen w-full relative text-white">
        {/* Background is handled by parent layout's ThemeBackground */}
        <div className="relative z-10">
          <AdminHeader />
          {/* Full-width admin shell with left-pinned sidebar */}
          <div className="px-3 sm:px-4 md:px-6 py-4 md:py-6">
            <div className="flex gap-4 md:gap-6 items-start">
              {/* Left sidebar - fixed width, sticky */}
              <div className="hidden md:flex flex-col gap-3 w-64 shrink-0">
                <AdminSidebar />
                <ActivityWidget />
              </div>
              {/* Mobile/Tablet horizontal nav (keeps current sidebar behavior) */}
              <div className="md:hidden w-full">
                <AdminSidebar />
              </div>
              {/* Main content fills remaining width */}
              <main className="flex-1 min-w-0">
                {children}
              </main>
            </div>
          </div>
        </div>
      </div>
    </AdminSettingsProvider>
  )
}
