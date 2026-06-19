"use client"

import { useState } from "react"
import { Database, Download, Upload, AlertTriangle, CheckCircle2 } from "lucide-react"

export default function BackupPage() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const handleExport = async () => {
    setIsExporting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/backup')
      if (!res.ok) {
        throw new Error('Failed to export data')
      }
      
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `database_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      
      setMessage({ type: 'success', text: 'Backup downloaded successfully.' })
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Export failed.' })
    } finally {
      setIsExporting(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const file = e.target.files[0]
    
    if (!confirm('WARNING: Importing a backup will overwrite existing data. Are you sure you want to proceed?')) {
      e.target.value = ''
      return
    }

    setIsImporting(true)
    setMessage(null)
    try {
      const text = await file.text()
      let data
      try {
        data = JSON.parse(text)
      } catch (err) {
        throw new Error('Invalid JSON file')
      }

      const res = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to import data')
      }

      setMessage({ type: 'success', text: 'Backup imported successfully.' })
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Import failed.' })
    } finally {
      setIsImporting(false)
      e.target.value = ''
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Database Backup & Restore</h1>
        <p className="text-gray-400">Export the entire database to a JSON file or restore from a previous backup.</p>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-green-500/10 border border-green-500/20 text-green-400'}`}>
          {message.type === 'error' ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          <p className="text-sm font-medium">{message.text}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[#146efc]/10 rounded-lg">
              <Download className="h-5 w-5 text-[#146efc]" />
            </div>
            <h2 className="text-lg font-semibold text-white">Export Backup</h2>
          </div>
          <p className="text-sm text-gray-400 mb-6">
            Download a complete snapshot of all collections and documents currently in the database.
          </p>
          <button
            onClick={handleExport}
            disabled={isExporting || isImporting}
            className="w-full py-3 bg-[#146efc] text-black font-semibold rounded-xl hover:bg-[#146efc]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
          >
            {isExporting ? (
              <>
                <div className="h-4 w-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              'Download Backup File'
            )}
          </button>
        </div>

        <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <Upload className="h-5 w-5 text-red-500" />
            </div>
            <h2 className="text-lg font-semibold text-white">Import Backup</h2>
          </div>
          <p className="text-sm text-gray-400 mb-6">
            Restore the database from a JSON backup file. <span className="text-red-400 font-medium">This will remove and replace existing data.</span>
          </p>
          <div className="relative">
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              disabled={isExporting || isImporting}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <button
              disabled={isExporting || isImporting}
              className="w-full py-3 border-2 border-red-500/30 text-red-400 font-semibold rounded-xl hover:bg-red-500/10 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {isImporting ? (
                <>
                  <div className="h-4 w-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                  Importing...
                </>
              ) : (
                'Select JSON File to Restore'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
