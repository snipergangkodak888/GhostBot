"use client"
import { useEffect, useState } from 'react'
import { api } from '@/lib/client-fetch'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from '@/components/ui/skeleton'
import { Send, Users, Megaphone, Radio, Clock, CheckCircle, XCircle, Info, ChevronDown, ChevronUp } from 'lucide-react'

type PushTarget = 'bot_users' | 'channels' | 'both'

interface BroadcastHistory {
  _id: string
  message: {
    text: string
    mediaEnabled?: boolean
    mediaType?: string
    fileId?: string
    inlineButtons?: Array<{ text: string; url: string }>
  }
  target: PushTarget
  successCount: number
  failCount: number
  createdAt: string
}

let _pushHistoryCache: BroadcastHistory[] = []
let _pushHistoryLoaded = false

export default function AdminPushPage() {
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!_pushHistoryLoaded)
  const [pushTarget, setPushTarget] = useState<PushTarget>('both')
  const [showNote, setShowNote] = useState(false)
  
  // Message settings
  const [msgEnabledMedia, setMsgEnabledMedia] = useState<boolean>(false)
  const [msgMediaType, setMsgMediaType] = useState<'photo'|'video'>('photo')
  const [msgFileId, setMsgFileId] = useState<string>('')
  const [msgText, setMsgText] = useState<string>('')
  const [msgButtons, setMsgButtons] = useState<Array<{ text: string; url: string; order: number }>>([])
  
  // History
  const [history, setHistory] = useState<BroadcastHistory[]>(_pushHistoryCache)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)

  const fetchHistory = async () => {
    try {
      const res = await api(`/api/admin/broadcast?page=${historyPage}&limit=5`)
      const data = await res.json().catch(() => ({}))
      const broadcasts = Array.isArray(data) ? data : Array.isArray(data?.broadcasts) ? data.broadcasts : []
      if (Array.isArray(broadcasts)) {
        _pushHistoryCache = broadcasts
        _pushHistoryLoaded = true
        setHistory(broadcasts)
        setHistoryTotal(data.pagination?.total || 0)
      }
    } catch (e) {
      console.error('Failed to fetch history:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [historyPage])

  const send = async () => {
    if (!msgText.trim()) {
      toast.error('Please enter message text')
      return
    }
    
    setSaving(true)
    
    const messageData = {
      mediaEnabled: msgEnabledMedia,
      mediaType: msgMediaType,
      fileId: msgFileId,
      text: msgText,
      inlineButtons: msgButtons
        .filter((b) => b && typeof b.text === 'string' && b.text.trim() && typeof b.url === 'string' && b.url.trim())
        .map((b) => ({ text: b.text.trim(), url: b.url.trim(), order: Number.isFinite(b.order) ? b.order : 0 })),
    }

    try {
      const res = await api('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageData, target: pushTarget })
      })
      const data = await res.json()
      if (data.success) {
        const targetLabel = pushTarget === 'bot_users' ? 'bot users' : 
                           pushTarget === 'channels' ? 'channels' : 
                           'channels and bot users'
        toast.success(`Message pushed to ${data.count || 0} ${targetLabel}`)
        
        // Clear fields after successful push
        setMsgText('')
        setMsgFileId('')
        setMsgButtons([])
        setMsgEnabledMedia(false)
        
        // Refresh history
        fetchHistory()
      } else {
        toast.error(data.error || 'Failed to send message')
      }
    } catch (e) {
      toast.error('Failed to broadcast message')
    }
    
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-7 w-56 bg-white/10 rounded-xl" />
          <div className="h-4 w-72 bg-white/10 rounded" />
        </div>
        {/* Compose card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 space-y-4">
          <div className="h-5 w-32 bg-white/10 rounded-lg" />
          <div className="flex gap-3">
            <div className="h-10 w-36 bg-white/10 rounded-xl" />
            <div className="h-10 w-28 bg-white/10 rounded-xl" />
          </div>
          <div className="h-32 w-full bg-white/10 rounded-xl" />
          <div className="h-10 w-full bg-white/10 rounded-xl" />
        </div>
        {/* Broadcast history */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 space-y-4">
          <div className="h-5 w-28 bg-white/10 rounded-lg" />
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-start justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-3/4" />
                  <div className="h-3 bg-white/10 rounded w-1/2" />
                </div>
                <div className="flex gap-3 flex-shrink-0 ml-4">
                  <div className="h-3 w-10 bg-white/10 rounded" />
                  <div className="h-3 w-10 bg-white/10 rounded" />
                  <div className="h-3 w-20 bg-white/10 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">
          Push Message
        </h1>
        <p className="text-gray-400 text-sm">Send broadcast messages to users and channels</p>
      </div>

      {/* Info Note - Collapsible */}
      <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 overflow-hidden">
        <button
          onClick={() => setShowNote(!showNote)}
          className="w-full p-4 flex items-center justify-between hover:bg-blue-500/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-400" />
            <span className="text-sm font-semibold text-blue-300">Broadcasting Requirements</span>
          </div>
          {showNote ? (
            <ChevronUp className="h-4 w-4 text-blue-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-blue-400" />
          )}
        </button>
        {showNote && (
          <div className="px-4 pb-4">
            <div className="text-sm text-blue-200/80">
              <ul className="space-y-1.5 list-disc list-inside text-blue-200/70">
                <li><span className="font-medium text-blue-200">Bot Users:</span> Messages are sent directly to users who have started a conversation with the bot</li>
                <li><span className="font-medium text-blue-200">Channels:</span> Bot must be an <span className="text-yellow-300">admin</span> with "Post messages" permission</li>
                <li><span className="font-medium text-blue-200">Groups:</span> Bot must be a <span className="text-yellow-300">member</span> of the group to send messages</li>
              </ul>
              <p className="mt-2 text-xs text-blue-300/60">Configure channels in the Channels page before broadcasting.</p>
            </div>
          </div>
        )}
      </div>

      {/* Push Target Selector */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-6">
        <h2 className="text-lg font-bold mb-4">Push Target</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Bot Users Only */}
          <button
            type="button"
            onClick={() => setPushTarget('bot_users')}
            style={pushTarget === 'bot_users' ? { borderColor: '#146efc', backgroundColor: 'rgba(20,110,252,0.1)' } : {}}
            className={`p-4 rounded-lg border transition-all text-left ${
              pushTarget === 'bot_users'
                ? 'border-[#146efc]'
                : 'border-white/10 bg-white/5 hover:bg-white/[0.07]'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                pushTarget === 'bot_users' ? 'bg-[#146efc]/20' : 'bg-white/5'
              }`}>
                <Users className={`w-5 h-5`} style={pushTarget === 'bot_users' ? { color: '#146efc' } : { color: '#9ca3af' }} />
              </div>
              <div>
                <span className="font-semibold block" style={pushTarget === 'bot_users' ? { color: '#146efc' } : { color: 'white' }}>Bot Users Only</span>
                <p className="text-xs text-gray-400">Send directly to users via bot chat</p>
              </div>
            </div>
          </button>

          {/* Channels/Groups Only */}
          <button
            type="button"
            onClick={() => setPushTarget('channels')}
            style={pushTarget === 'channels' ? { borderColor: '#146efc', backgroundColor: 'rgba(20,110,252,0.1)' } : {}}
            className={`p-4 rounded-lg border transition-all text-left ${
              pushTarget === 'channels'
                ? 'border-[#146efc]'
                : 'border-white/10 bg-white/5 hover:bg-white/[0.07]'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                pushTarget === 'channels' ? 'bg-[#146efc]/20' : 'bg-white/5'
              }`}>
                <Megaphone className={`w-5 h-5`} style={pushTarget === 'channels' ? { color: '#146efc' } : { color: '#9ca3af' }} />
              </div>
              <div>
                <span className="font-semibold block" style={pushTarget === 'channels' ? { color: '#146efc' } : { color: 'white' }}>Channels & Groups</span>
                <p className="text-xs text-gray-400">Post to configured channels only</p>
              </div>
            </div>
          </button>

          {/* Both */}
          <button
            type="button"
            onClick={() => setPushTarget('both')}
            style={pushTarget === 'both' ? { borderColor: '#146efc', backgroundColor: 'rgba(20,110,252,0.1)' } : {}}
            className={`p-4 rounded-lg border transition-all text-left ${
              pushTarget === 'both'
                ? 'border-[#146efc]'
                : 'border-white/10 bg-white/5 hover:bg-white/[0.07]'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                pushTarget === 'both' ? 'bg-[#146efc]/20' : 'bg-white/5'
              }`}>
                <Radio className={`w-5 h-5`} style={pushTarget === 'both' ? { color: '#146efc' } : { color: '#9ca3af' }} />
              </div>
              <div>
                <span className="font-semibold block" style={pushTarget === 'both' ? { color: '#146efc' } : { color: 'white' }}>Both</span>
                <p className="text-xs text-gray-400">Send to users and channels</p>
              </div>
            </div>
          </button>
        </div>
      </div>
      
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-6 space-y-6">
        {/* Message Content */}
        <div>
          <h2 className="text-lg font-bold mb-4">Message Content</h2>
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-gray-300">Attach photo/video</span>
                  <p className="text-xs text-gray-500 mt-0.5">Toggle to send media with your message.</p>
                </div>
                <Switch
                  checked={msgEnabledMedia}
                  onCheckedChange={setMsgEnabledMedia}
                />
              </div>
            </div>
            
            {msgEnabledMedia && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Media Type</label>
                  <Select value={msgMediaType} onValueChange={(v: any) => setMsgMediaType(v)}>
                    <SelectTrigger className="h-11 bg-white/5 border-white/10 text-white">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="photo">Photo</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">Choose the media type when attached.</p>
                </div>
                <div className="sm:col-span-2 space-y-2">
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Media URL</label>
                  <input
                    value={msgFileId}
                    onChange={(e) => setMsgFileId(e.target.value)}
                    autoComplete="off"
                    className="w-full h-11 rounded-lg bg-white/5 border border-white/10 px-4 focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-white/50 transition-all"
                    placeholder="https://example.com/image.jpg"
                  />
                  <p className="text-xs text-gray-500">Paste the direct URL of the photo/video to send.</p>
                </div>
              </div>
            )}
            
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Message Text</label>
              <textarea
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                rows={4}
                autoComplete="off"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-white/50 transition-all"
                placeholder="Enter the message text here... (supports HTML formatting)"
              />
              <p className="text-xs text-gray-500 mt-1">Supports HTML tags: &lt;b&gt;bold&lt;/b&gt;, &lt;i&gt;italic&lt;/i&gt;, &lt;a href=&quot;...&quot;&gt;link&lt;/a&gt;</p>
            </div>

            {/* Inline Buttons Manager */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-gray-300">Inline Buttons</label>
                <button
                  onClick={() => setMsgButtons((prev) => [...prev, { text: 'View', url: '', order: 0 }])}
                  className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 hover:bg-white/20 text-white transition-all text-xs font-semibold"
                >
                  Add Button
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">Buttons appear under the message in Telegram. Provide a label and a https:// link.</p>
              <div className="space-y-2">
                {[...msgButtons].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((btn, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-white/5 border border-white/10 rounded-lg p-3">
                    <div className="col-span-4">
                      <input
                        value={btn.text}
                        onChange={(e) => {
                          const val = e.target.value
                          setMsgButtons((prev) => prev.map((b, i) => i === idx ? { ...b, text: val } : b))
                        }}
                        autoComplete="off"
                        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                        placeholder="Button label"
                      />
                    </div>
                    <div className="col-span-6">
                      <input
                        value={btn.url}
                        onChange={(e) => {
                          const val = e.target.value
                          setMsgButtons((prev) => prev.map((b, i) => i === idx ? { ...b, url: val } : b))
                        }}
                        autoComplete="off"
                        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                        placeholder="https://example.com"
                      />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <button
                        onClick={() => setMsgButtons((prev) => prev.filter((_, i) => i !== idx))}
                        className="px-2 py-2 rounded-lg bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 transition-all text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {msgButtons.length === 0 && (
                  <div className="text-xs text-gray-500">No buttons added.</div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-6">
          <button 
            disabled={saving || !msgText.trim()} 
            onClick={send} 
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#146efc', color: '#ffffff' }}
          >
            {saving ? 'Sending…' : <><Send size={16} /> Send Push Message</>}
          </button>
        </div>
      </div>

      {/* Broadcast History */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-6">
        <h2 className="text-lg font-bold mb-4">Broadcast History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-gray-400 border-b border-white/10">
              <tr>
                <th className="py-3 font-semibold">Message</th>
                <th className="py-3 font-semibold">Target</th>
                <th className="py-3 font-semibold">Sent At</th>
                <th className="py-3 font-semibold text-right">Results</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {history.map((item) => (
                <tr key={item._id} className="hover:bg-white/5 transition-colors">
                  <td className="py-3">
                    <p className="truncate max-w-[300px] text-white">{item.message.text}</p>
                    {item.message.inlineButtons && item.message.inlineButtons.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">{item.message.inlineButtons.length} button(s)</p>
                    )}
                  </td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      item.target === 'bot_users' ? 'bg-purple-500/20 text-purple-400' :
                      item.target === 'channels' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-white/20 text-white'
                    }`}>
                      {item.target === 'bot_users' ? 'Users' : item.target === 'channels' ? 'Channels' : 'Both'}
                    </span>
                  </td>
                  <td className="py-3 text-gray-400">
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <span className="flex items-center gap-1 text-white">
                        <CheckCircle size={14} />
                        {item.successCount}
                      </span>
                      {item.failCount > 0 && (
                        <span className="flex items-center gap-1 text-red-400">
                          <XCircle size={14} />
                          {item.failCount}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">No broadcasts sent yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {historyTotal > 5 && (
          <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-white/10">
            <div className="text-gray-400 text-xs">
              Total: <span className="text-white font-semibold">{historyTotal}</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                disabled={historyPage <= 1} 
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} 
                className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                ← Prev
              </button>
              <span className="text-xs text-gray-400">Page {historyPage}</span>
              <button 
                disabled={historyPage * 5 >= historyTotal} 
                onClick={() => setHistoryPage((p) => p + 1)} 
                className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
