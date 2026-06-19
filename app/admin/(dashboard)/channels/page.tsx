"use client"
import { useEffect, useState } from 'react'
import { api } from '@/lib/client-fetch'
import { toast } from 'sonner'
import { Trash2, Edit2, Check, X, Plus, Radio, Info, ChevronDown, ChevronUp } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

interface Channel {
  _id: string
  name: string
  chatId: string
  isActive: boolean
}

let _channelsCache: Channel[] = []
let _channelsLoaded = false

export default function AdminChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>(_channelsCache)
  const [loading, setLoading] = useState(!_channelsLoaded)
  const [showNote, setShowNote] = useState(false)
  
  // Form state
  const [newName, setNewName] = useState('')
  const [newChatId, setNewChatId] = useState('')
  const [adding, setAdding] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editChatId, setEditChatId] = useState('')

  const fetchChannels = async () => {
    try {
      const res = await api('/api/admin/channels')
      const data = await res.json().catch(() => ({}))
      const nextChannels = Array.isArray(data) ? data : Array.isArray(data?.channels) ? data.channels : []
      if (Array.isArray(nextChannels)) {
        _channelsCache = nextChannels
        _channelsLoaded = true
        setChannels(nextChannels)
      }
    } catch (e) {
      toast.error('Failed to load channels')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchChannels()
  }, [])

  const addChannel = async () => {
    if (!newName.trim() || !newChatId.trim()) return
    setAdding(true)
    try {
      await api('/api/admin/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, chatId: newChatId, isActive: true }),
        okTitle: 'Channel added'
      })
      setNewName('')
      setNewChatId('')
      fetchChannels()
    } catch (e) {
      // error handled by api wrapper usually, or toast
    } finally {
      setAdding(false)
    }
  }

  const toggleChannel = async (channel: Channel) => {
    try {
      // Optimistic update
      setChannels(prev => (Array.isArray(prev) ? prev : []).map(c => c._id === channel._id ? { ...c, isActive: !c.isActive } : c))
      
      await api('/api/admin/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: channel._id, isActive: !channel.isActive })
      })
    } catch (e) {
      toast.error('Failed to update channel')
      fetchChannels() // revert
    }
  }

  const deleteChannel = async (id: string) => {
    if (!confirm('Are you sure you want to delete this channel?')) return
    try {
      setChannels(prev => (Array.isArray(prev) ? prev : []).filter(c => c._id !== id))
      await api(`/api/admin/channels?id=${id}`, { method: 'DELETE' })
      toast.success('Channel deleted')
    } catch (e) {
      toast.error('Failed to delete channel')
      fetchChannels()
    }
  }

  const startEdit = (channel: Channel) => {
    setEditingId(channel._id)
    setEditName(channel.name)
    setEditChatId(channel.chatId)
  }

  const saveEdit = async () => {
    if (!editingId) return
    try {
      await api('/api/admin/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: editingId, name: editName, chatId: editChatId }),
        okTitle: 'Channel updated'
      })
      setEditingId(null)
      fetchChannels()
    } catch (e) {
      // error
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-7 w-44 bg-white/10 rounded-xl" />
          <div className="h-4 w-80 bg-white/10 rounded" />
        </div>
        {/* Add channel form card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 space-y-4">
          <div className="h-5 w-32 bg-white/10 rounded-lg" />
          <div className="grid sm:grid-cols-12 gap-3">
            <div className="sm:col-span-4 h-10 bg-white/10 rounded-xl" />
            <div className="sm:col-span-6 h-10 bg-white/10 rounded-xl" />
            <div className="sm:col-span-2 h-10 bg-white/10 rounded-xl" />
          </div>
        </div>
        {/* Channel list rows */}
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5 rounded-2xl border border-white/10 bg-white/[0.035]">
              <div className="space-y-1.5">
                <div className="h-4 w-36 bg-white/10 rounded" />
                <div className="h-3 w-24 bg-white/10 rounded" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-6 w-11 bg-white/10 rounded-full" />
                <div className="w-8 h-8 bg-white/10 rounded-lg" />
                <div className="w-8 h-8 bg-white/10 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">
          Telegram Channels & Groups
        </h1>
        <p className="text-gray-400 text-sm">Manage destinations for broadcast messages</p>
      </div>

      {/* Info Note - Collapsible */}
      <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 overflow-hidden">
        <button
          onClick={() => setShowNote(!showNote)}
          className="w-full p-4 flex items-center justify-between hover:bg-blue-500/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-400" />
            <span className="text-sm font-semibold text-blue-300">How Chat IDs Work</span>
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
                <li><span className="font-medium text-blue-200">Channels & Supergroups:</span> Start with <code className="px-1.5 py-0.5 rounded bg-blue-500/20 font-mono text-xs">-100</code> (e.g., <code className="px-1.5 py-0.5 rounded bg-blue-500/20 font-mono text-xs">-1001234567890</code>)</li>
                <li><span className="font-medium text-blue-200">Regular Groups:</span> Start with <code className="px-1.5 py-0.5 rounded bg-blue-500/20 font-mono text-xs">-</code> (e.g., <code className="px-1.5 py-0.5 rounded bg-blue-500/20 font-mono text-xs">-123456789</code>)</li>
                <li><span className="font-medium text-blue-200">Private Chats:</span> Just the user ID (e.g., <code className="px-1.5 py-0.5 rounded bg-blue-500/20 font-mono text-xs">123456789</code>)</li>
              </ul>
              <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <p className="text-yellow-300 font-medium">⚠️ Important:</p>
                <p className="text-yellow-200/70 mt-1">The bot must be <span className="text-yellow-200 font-medium">added as admin</span> in channels (with "Post messages" permission), or as a <span className="text-yellow-200 font-medium">member</span> in groups to send messages.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add New Channel */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-6">
        <h2 className="text-lg font-bold mb-4">Add New Destination</h2>
        <div className="grid sm:grid-cols-12 gap-4 items-end">
          <div className="sm:col-span-4">
            <label className="block text-xs font-semibold text-gray-400 mb-1">Name (Internal)</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-white/50"
              placeholder="e.g. VIP Channel"
            />
          </div>
          <div className="sm:col-span-6">
            <label className="block text-xs font-semibold text-gray-400 mb-1">Telegram Chat ID</label>
            <input
              value={newChatId}
              onChange={(e) => setNewChatId(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-white/50"
              placeholder="e.g. -100123456789"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              onClick={addChannel}
              disabled={adding || !newName || !newChatId}
              className="w-full py-2 rounded-lg text-[#ffffff] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 hover:opacity-90"
              style={{ background: '#146efc' }}
            >
              {adding ? 'Adding...' : <><Plus size={16} /> Add</>}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {channels.length === 0 ? (
          <div className="text-center text-gray-500 py-10 bg-white/5 rounded-xl border border-white/5">
            No channels added yet. Add one above to start broadcasting.
          </div>
        ) : (
          channels.map(channel => (
            <div key={channel._id} className="group flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all">
              {editingId === channel._id ? (
                <div className="flex-1 grid sm:grid-cols-12 gap-4 items-center mr-4">
                  <div className="sm:col-span-4">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded bg-black/20 border border-white/20 px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-6">
                    <input
                      value={editChatId}
                      onChange={(e) => setEditChatId(e.target.value)}
                      className="w-full rounded bg-black/20 border border-white/20 px-2 py-1 text-sm font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2 flex gap-2">
                    <button onClick={saveEdit} className="p-1.5 rounded bg-white/20 text-white hover:bg-white/30"><Check size={16} /></button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"><X size={16} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-white">{channel.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${channel.isActive ? 'bg-white/20 text-white' : 'bg-gray-500/20 text-gray-400'}`}>
                      {channel.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono mt-1">{channel.chatId}</p>
                </div>
              )}

              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={channel.isActive} onChange={() => toggleChannel(channel)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-white/20 border border-white/10 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/30 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white after:shadow-sm"></div>
                </label>
                
                <div className="h-6 w-px bg-white/10 mx-1"></div>

                <button onClick={() => startEdit(channel)} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                  <Edit2 size={16} />
                </button>
                <button onClick={() => deleteChannel(channel._id)} className="p-2 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
