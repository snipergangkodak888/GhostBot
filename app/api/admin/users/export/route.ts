import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyAdminToken } from '@/lib/auth'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const adminToken = cookies().get('admin_token')?.value
    const admin = await verifyAdminToken(adminToken || '')
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const db = await getDb()
    
    // Fetch all users
    const users = await db.collection('users').find({}).toArray()
    
    // CSV Header matching typical CRM imports (First Name, Last Name, Email/Username, External ID, Joined, Status)
    const header = [
      'Telegram ID',
      'First Name',
      'Last Name',
      'Username',
      'Is Premium',
      'Joined Date',
      'Last Online',
      'Energy / Coins',
      'Referrals Count',
      'Is Banned'
    ]

    const csvRows = [header.join(',')]

    for (const user of users) {
      // Clean up strings to avoid CSV injection or broken delimiters
      const cleanString = (str: string | null | undefined) => {
        if (!str) return '""'
        return `"${String(str).replace(/"/g, '""')}"`
      }

      const row = [
        cleanString(user.telegramId),
        cleanString(user.firstName),
        cleanString(user.lastName),
        cleanString(user.username),
        user.isPremium ? 'Yes' : 'No',
        user.createdAt ? cleanString(new Date(user.createdAt).toISOString()) : '""',
        user.lastOnline ? cleanString(new Date(user.lastOnline).toISOString()) : '""',
        user.energy ?? user.spinBalance ?? 0,
        user.referralsCount ?? 0,
        user.isBanned ? 'Yes' : 'No'
      ]

      csvRows.push(row.join(','))
    }

    const csvString = csvRows.join('\n')

    return new NextResponse(csvString, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="users_export_${new Date().toISOString().split('T')[0]}.csv"`
      }
    })

  } catch (error: any) {
    console.error('Users CSV export error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
