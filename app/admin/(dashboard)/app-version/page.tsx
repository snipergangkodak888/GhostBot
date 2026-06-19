'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Settings2, Save, Rocket, Zap, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/client-fetch'

function ReleaseUpdateButton() {
  const [releasing, setReleasing] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)

  useEffect(() => {
    api('/api/admin/release-update').then(r => r.json()).then(data => {
      if (typeof data?.version === 'number') setCurrentVersion(data.version)
    }).catch(() => {})
  }, [])

  const handleRelease = async () => {
    setReleasing(true)
    try {
      const res = await api('/api/admin/release-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data?.version) {
        setCurrentVersion(data.version)
        toast.success(`Cache cleared! New version: v${data.version}. Users will fetch fresh assets on next open.`)
      }
    } catch {
      toast.error('Failed to release update')
    } finally {
      setReleasing(false)
    }
  }

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
      <div className="flex-1">
        <p className="text-sm text-gray-200">
          Current asset version: <span className="font-mono font-bold text-yellow-400">v{currentVersion ?? '…'}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">After clicking, all users will get a fresh splash &amp; assets on next app open.</p>
      </div>
      <Button
        onClick={handleRelease}
        disabled={releasing}
        className="bg-yellow-500 hover:bg-yellow-400 text-black font-semibold shrink-0"
      >
        {releasing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
        {releasing ? 'Releasing…' : 'Release Update'}
      </Button>
    </div>
  )
}

export default function AppVersionPage() {
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    try {
      const res = await api('/api/admin/settings')
      const json = await res.json()
      const s = json.settings || {}
      setAppVersion(s.appVersion || '1.0.0')
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api('/api/admin/settings', { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          appVersion,
        }) 
      })
      toast.success('App version updated!')
    } catch (err: any) {
      toast.error('Failed to save app version')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl animate-pulse">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-52 bg-white/10 rounded-xl" />
            <div className="h-4 w-72 bg-white/10 rounded" />
          </div>
          <div className="h-10 w-32 bg-white/10 rounded-xl" />
        </div>
        {/* Card 1 — Current App Version */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 space-y-4">
          <div className="h-6 w-44 bg-white/10 rounded-lg" />
          <div className="h-4 w-full bg-white/10 rounded" />
          <div className="h-12 w-full bg-white/10 rounded-xl" />
          <div className="h-14 w-full bg-white/[0.05] rounded-xl border border-white/10" />
        </div>
        {/* Card 2 — Release Asset Update */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 space-y-4">
          <div className="h-6 w-48 bg-white/10 rounded-lg" />
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-40 bg-white/10 rounded" />
              <div className="h-8 w-16 bg-white/10 rounded-lg" />
            </div>
            <div className="h-10 w-36 bg-white/10 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Rocket className="h-6 w-6" />
          App Version Control
        </h1>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#146efc', color: '#ffffff' }}
        >
          {saving ? 'Saving...' : (
            <>
              <Save className="h-4 w-4" />
              Save Changes
            </>
          )}
        </button>
      </div>

      <Card className="border-white/10 bg-white/[0.035] backdrop-blur-xl p-6">
        <div className="space-y-4">
          <div className="space-y-2 focus-within:text-white transition-colors">
            <Label className="text-gray-200 text-base">Current App Version</Label>
            <Input 
              value={appVersion} 
              onChange={(e) => setAppVersion(e.target.value)} 
              placeholder="e.g. 1.0.0"
              className="bg-white/5 border-white/10 text-white text-lg py-6"
            />
            <p className="text-sm text-gray-400 mt-2">
              Increase this version string to force all users to update their local cache on the splash screen. Users with a cached version lower than this will see an "Update Available" trap.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <span className="text-sm text-red-400 font-medium">⚠️ Warning:</span>
            <p className="text-xs text-red-300/80 mt-1">
              Updating the version will clear local storage and cache for all active users running a previous version, requiring them to re-download the app assets.
            </p>
          </div>
        </div>
      </Card>

      <Card className="border-white/10 bg-white/[0.035] backdrop-blur-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-400" /> Release Asset Update
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Forces all users to re-download cached assets (splash screen, images, etc.) on their next app open.
          Use this after deploying a new version or updating app images.
        </p>
        <ReleaseUpdateButton />
      </Card>
    </div>
  )
}
