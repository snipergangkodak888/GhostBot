"use client"

import { TonConnectUIProvider } from '@tonconnect/ui-react'
import { ReactNode } from 'react'

interface TonConnectProviderProps {
  children: ReactNode
}

export function TonConnectProvider({ children }: TonConnectProviderProps) {
  // Get manifest URL based on environment
  const manifestUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/tonconnect-manifest.json`
    : '/tonconnect-manifest.json'

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      {children}
    </TonConnectUIProvider>
  )
}
