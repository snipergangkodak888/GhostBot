"use client"

import { useEffect, useCallback, useRef } from "react"
import { useTelegram } from "@/components/telegram-provider"

/**
 * Hook to show the native Telegram Mini App BackButton.
 * Shows the button on mount, hides on unmount.
 * 
 * @param onBack - Callback when the back button is pressed
 * @param enabled - Whether the back button should be shown (default: true)
 */
export function useTelegramBackButton(
  onBack: () => void,
  enabled: boolean = true
) {
  const { webApp } = useTelegram()
  const callbackRef = useRef(onBack)

  // Keep callback ref fresh
  useEffect(() => {
    callbackRef.current = onBack
  }, [onBack])

  const handleBack = useCallback(() => {
    callbackRef.current()
  }, [])

  useEffect(() => {
    if (!webApp || !enabled) return

    const bb = (webApp as any).BackButton
    if (!bb) return

    bb.show()
    bb.onClick(handleBack)

    return () => {
      bb.offClick(handleBack)
      bb.hide()
    }
  }, [webApp, enabled, handleBack])
}
