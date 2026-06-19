"use client"

import { useEffect, useState } from 'react'

export default function SimplePage() {
  const [tgInfo, setTgInfo] = useState<any>(null)
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const tg = (window as any).Telegram?.WebApp
      if (tg) {
        tg.ready()
        setTgInfo({
          version: tg.version,
          platform: tg.platform,
          user: tg.initDataUnsafe?.user?.first_name || 'No user'
        })
      }
    }
  }, [])
  
  return (
    <div style={{ padding: '20px', color: 'white', backgroundColor: 'black', minHeight: '100vh' }}>
      <h1>✅ App is Working!</h1>
      <p>Timestamp: {new Date().toISOString()}</p>
      {tgInfo && (
        <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#222', borderRadius: '8px' }}>
          <h2>Telegram Info:</h2>
          <p>Version: {tgInfo.version}</p>
          <p>Platform: {tgInfo.platform}</p>
          <p>User: {tgInfo.user}</p>
        </div>
      )}
      <button 
        onClick={() => window.location.href = '/telegram'}
        style={{
          marginTop: '20px',
          padding: '10px 20px',
          backgroundColor: '#22c55e',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer'
        }}
      >
        Go to Auth Page
      </button>
    </div>
  )
}
