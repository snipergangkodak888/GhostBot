'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DollarSign, Home, Settings, Send, Rocket, ChevronDown, Radio, Clock, Database, CalendarDays, FolderKanban, Bot, Bell, Shield } from 'lucide-react'

type NavLeaf = { href: string; label: string; icon: React.ElementType; color?: string }
type NavGroup = { group: string; icon: React.ElementType; color?: string; children: NavLeaf[] }
type NavItem = NavLeaf | NavGroup

const isGroup = (item: NavItem): item is NavGroup => 'group' in item
const sectionColors = {
  home: '#2f80ff',
  projects: '#ffd43b',
  calendar: '#ff8a3d',
  reminders: '#ff4d5e',
  data: '#a855f7',
  payroll: '#42e6a4',
}
const textOn = (color: string) => color === sectionColors.projects ? '#111827' : '#ffffff'

const navItems: NavItem[] = [
  { href: '/admin', label: 'Home', icon: Home, color: sectionColors.home },
  { href: '/admin/projects', label: 'Projects', icon: FolderKanban, color: sectionColors.projects },
  { href: '/admin/calendar', label: 'Calendar', icon: CalendarDays, color: sectionColors.calendar },
  { href: '/admin/reminders', label: 'Reminders', icon: Bell, color: sectionColors.reminders },
  { href: '/admin/payroll', label: 'Payroll', icon: DollarSign, color: sectionColors.payroll },
  { href: '/admin/guard-team', label: 'Guard Team', icon: Shield, color: sectionColors.home },
  {
    group: 'Telegram Bot',
    icon: Send,
    color: sectionColors.home,
    children: [
      { href: '/admin/bot-alerts', label: 'Bot Alerts', icon: Bot, color: sectionColors.home },
      { href: '/admin/channels', label: 'Trader Channels', icon: Radio, color: sectionColors.home },
    ],
  },
  {
    group: 'Settings',
    icon: Settings,
    color: sectionColors.home,
    children: [
      { href: '/admin/settings', label: 'Settings', icon: Settings, color: sectionColors.home },
      { href: '/admin/cron', label: 'Cron Jobs', icon: Clock, color: sectionColors.home },
      { href: '/admin/backup', label: 'Backup', icon: Database, color: sectionColors.home },
      { href: '/admin/app-version', label: 'App Version', icon: Rocket, color: sectionColors.home },
    ],
  },
]

export function AdminSidebar() {
  const pathname = usePathname()

  const isChildActive = (children: NavLeaf[]) =>
    children.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const item of navItems) {
      if (isGroup(item) && isChildActive(item.children)) init[item.group] = true
    }
    return init
  })

  const toggle = (group: string) =>
    setOpenGroups(prev => ({ ...Object.fromEntries(Object.keys(prev).map(k => [k, false])), [group]: !prev[group] }))

  const leafClass = (active: boolean) =>
    `group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all flex-shrink-0 border ${
      active
        ? 'text-white font-semibold'
        : 'text-white/70 hover:text-white border-transparent hover:bg-white/10'
    }`

  return (
    <aside className="h-full">
      <div className="rounded-2xl border border-[#146efc]/20 p-3 pb-5 sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <nav className="flex md:flex-col md:gap-1.5 gap-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
          {navItems.map((item) => {
            if (isGroup(item)) {
              const groupActive = isChildActive(item.children)
              const open = openGroups[item.group] ?? false
              const Icon = item.icon
              const color = item.color || sectionColors.home
              return (
                <div key={item.group} className="md:mb-0.5">
                  <button
                    onClick={() => toggle(item.group)}
                    className={`w-full group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all flex-shrink-0 border ${
                      groupActive
                        ? 'border-transparent'
                        : 'text-white/80 hover:text-white border-transparent hover:bg-white/10'
                    }`}
                    style={groupActive ? { color, background: `${color}24` } : undefined}
                  >
                    <Icon className={`h-5 w-5 flex-shrink-0 ${groupActive ? '' : 'text-white/60 group-hover:text-white'}`} style={groupActive ? { color } : undefined} />
                    <span className="hidden md:inline whitespace-nowrap flex-1 text-left">{item.group}</span>
                    <ChevronDown className={`hidden md:block h-4 w-4 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''} ${groupActive ? '' : 'text-white/40'}`} style={groupActive ? { color } : undefined} />
                  </button>
                  {open && (
                    <div className="hidden md:flex md:flex-col gap-1 pl-4 mt-1.5 mb-1 border-l border-white/10 ml-4">
                      {item.children.map(child => {
                        const active = pathname === child.href || pathname.startsWith(child.href + '/')
                        const CIcon = child.icon
                        const childColor = child.color || color
                        const activeText = textOn(childColor)
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={leafClass(active)}
                            style={active ? { background: childColor, borderColor: `${childColor}66`, color: activeText } : undefined}
                          >
                            <CIcon className={`h-4 w-4 flex-shrink-0 ${active ? '' : 'text-white/50 group-hover:text-white'}`} style={active ? { color: activeText } : undefined} />
                            <span className="whitespace-nowrap">{child.label}</span>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                  {/* Mobile: show children always as pills */}
                  <div className="md:hidden flex gap-1">
                    {item.children.map(child => {
                      const active = pathname === child.href || pathname.startsWith(child.href + '/')
                      const CIcon = child.icon
                      const childColor = child.color || color
                      const activeText = textOn(childColor)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={leafClass(active)}
                          style={active ? { background: childColor, borderColor: `${childColor}66`, color: activeText } : undefined}
                        >
                          <CIcon className={`h-4 w-4 flex-shrink-0 ${active ? '' : 'text-white/50'}`} style={active ? { color: activeText } : undefined} />
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            }

            const active = item.href === '/admin'
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            const color = item.color || sectionColors.home
            const activeText = textOn(color)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={leafClass(active)}
                style={active ? { background: color, borderColor: `${color}66`, color: activeText } : undefined}
                title={item.label}
              >
                <Icon className={`h-5 w-5 flex-shrink-0 ${active ? '' : 'text-white/60 group-hover:text-white'}`} style={active ? { color: activeText } : undefined} />
                <span className="hidden md:inline whitespace-nowrap">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
