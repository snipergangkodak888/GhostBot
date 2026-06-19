import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { createAdminToken } from '@/lib/auth'

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })

    const db = await getDb()
    let admin = await db.collection('admins').findOne({ email }, { projection: { email: 1, password: 1, role: 1 } })

    if (!admin) {
      const adminCount = await db.collection('admins').countDocuments({})
      const seedEmail = process.env.ADMIN_EMAIL
      const seedPassword = process.env.ADMIN_PASSWORD

      if (
        adminCount === 0 &&
        seedEmail &&
        seedPassword &&
        String(email).trim().toLowerCase() === seedEmail.trim().toLowerCase() &&
        password === seedPassword
      ) {
        const hashedPassword = await bcrypt.hash(seedPassword, 10)
        const result = await db.collection('admins').insertOne({
          email: seedEmail.trim(),
          password: hashedPassword,
          role: 'admin',
          createdAt: new Date(),
        })
        admin = {
          _id: result.insertedId,
          email: seedEmail.trim(),
          password: hashedPassword,
          role: 'admin',
        }
      }
    }

    if (!admin) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    const ok = await bcrypt.compare(password, admin.password)
    if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })

    const token = await createAdminToken({ sub: String(admin._id), email, role: 'admin' })
    const url = new URL(req.url)
    const isHttps = url.protocol === 'https:'
    cookies().set('admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 60 * 60 * 8,
    })

    // Record login history
    try {
      const ua = req.headers.get('user-agent') || ''
      const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        req.headers.get('x-real-ip') ||
        'unknown'

      // Parse browser and OS from UA
      const getBrowser = (ua: string) => {
        if (/Edg\//.test(ua)) return 'Edge'
        if (/OPR\/|Opera/.test(ua)) return 'Opera'
        if (/Chrome\//.test(ua)) return 'Chrome'
        if (/Firefox\//.test(ua)) return 'Firefox'
        if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari'
        return 'Unknown'
      }
      const getOS = (ua: string) => {
        if (/Windows NT 10/.test(ua)) return 'Windows 10/11'
        if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1'
        if (/Windows/.test(ua)) return 'Windows'
        if (/Mac OS X/.test(ua)) return 'macOS'
        if (/Android/.test(ua)) return 'Android'
        if (/iPhone|iPad/.test(ua)) return 'iOS'
        if (/Linux/.test(ua)) return 'Linux'
        return 'Unknown'
      }
      const getDevice = (ua: string) => {
        if (/iPhone/.test(ua)) return 'iPhone'
        if (/iPad/.test(ua)) return 'iPad'
        if (/Android/.test(ua) && /Mobile/.test(ua)) return 'Android Phone'
        if (/Android/.test(ua)) return 'Android Tablet'
        if (/Mobile/.test(ua)) return 'Mobile'
        return 'Desktop'
      }

      await db.collection('adminLoginHistory').insertOne({
        email,
        ip,
        browser: getBrowser(ua),
        os: getOS(ua),
        device: getDevice(ua),
        userAgent: ua,
        loginAt: new Date(),
      })
    } catch {
      // Non-critical — don't fail the login
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Login failed' }, { status: 500 })
  }
}
