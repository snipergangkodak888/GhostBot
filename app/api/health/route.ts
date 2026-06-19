import { NextResponse } from 'next/server'
import { supabaseConfig } from '@/lib/supabase'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    backend: {
      provider: 'supabase',
      configured: Boolean(supabaseConfig.url && (supabaseConfig.hasServiceRoleKey || supabaseConfig.hasAnonKey)),
      poolConnection: supabaseConfig.hasPoolConnection,
    },
  })
}
