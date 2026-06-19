'use client'

import { toast } from '@/hooks/use-toast'

export async function api(input: RequestInfo | URL, init?: RequestInit & { okTitle?: string; okMsg?: string }) {
  const res = await fetch(input, init)
  if (res.status === 401) {
    toast({ title: 'Session expired', description: 'Please sign in again.' })
    if (typeof window !== 'undefined') window.location.href = '/admin/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    let msg = 'Request failed'
    try {
      const data = await res.json()
      msg = data?.error || msg
    } catch {}
    toast({ title: 'Error', description: msg })
    throw new Error(msg)
  }
  if (init?.okTitle || init?.okMsg) {
    toast({ title: init.okTitle || 'Success', description: init.okMsg })
  }
  return res
}
