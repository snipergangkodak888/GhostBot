import { NextRequest, NextResponse } from 'next/server'
import { runLaunchReportJobs } from '@/lib/launch-report-jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(req: NextRequest) {
  const expected = process.env.GHOSTBOT_INTERNAL_CRON_KEY
  if (!expected || req.headers.get('x-ghostbot-internal-cron') !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runLaunchReportJobs())
}
