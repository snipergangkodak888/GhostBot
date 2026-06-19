import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  cookies().set('admin_token', '', { httpOnly: true, path: '/', maxAge: 0 })
  return NextResponse.json({ ok: true })
}
