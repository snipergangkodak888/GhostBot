import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

// Static admin pages/features index
const ADMIN_PAGES = [
  { label: 'Dashboard', href: '/admin', icon: '🏠', desc: 'Operations overview' },
  { label: 'Projects', href: '/admin/projects', icon: '📁', desc: 'Project tracker' },
  { label: 'Calendar', href: '/admin/calendar', icon: '📅', desc: 'Launch calendar' },
  { label: 'Reminders', href: '/admin/reminders', icon: '🔔', desc: 'Scheduled reminders' },
  { label: 'Payroll', href: '/admin/payroll', icon: '💵', desc: 'Team compensation and payouts' },
  { label: 'Guard Team', href: '/admin/guard-team', icon: '🛡️', desc: 'Invite codes and team access control' },
  { label: 'Trader Channels', href: '/admin/channels', icon: '📡', desc: 'Telegram channels' },
  { label: 'Bot Alerts', href: '/admin/bot-alerts', icon: '🤖', desc: 'Bot and broadcast messages' },
  { label: 'Settings', href: '/admin/settings', icon: '⚙️', desc: 'Operations configuration' },
  { label: 'App Version', href: '/admin/app-version', icon: '🚀', desc: 'Version management' },
]

export async function GET(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ users: [], pages: [] })

  try {
    const pages = ADMIN_PAGES.filter(p =>
      p.label.toLowerCase().includes(q.toLowerCase()) ||
      p.desc.toLowerCase().includes(q.toLowerCase())
    )

    return NextResponse.json({
      users: [],
      pages,
    })
  } catch (error) {
    console.error('Admin search error:', error)
    return NextResponse.json({ users: [], pages: [] })
  }
}
