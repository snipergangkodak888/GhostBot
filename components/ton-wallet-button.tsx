"use client"

import { TonConnectButton, useTonAddress, useTonConnectUI } from '@tonconnect/ui-react'
import { useEffect } from 'react'

export function TonWalletButton() {
  const address = useTonAddress()
  const [tonConnectUI] = useTonConnectUI()

  useEffect(() => {
    if (address) {
      console.log('TON Wallet connected:', address)
      // You can track this connection event or save it to your backend
    }
  }, [address])

  return (
    <div className="flex items-center gap-2">
      <TonConnectButton />
      {address && (
        <span className="text-xs text-gray-400">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
      )}
    </div>
  )
}
