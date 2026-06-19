"use client"

import { type FC, type PropsWithChildren, useEffect, useRef } from 'react'
import telegramAnalytics from '@telegram-apps/analytics'

/**
 * Telegram Analytics SDK integration via official NPM package.
 *
 * Required env vars:
 * - NEXT_PUBLIC_TG_ANALYTICS_TOKEN
 * - NEXT_PUBLIC_TG_ANALYTICS_APP_NAME
 */

export const TelegramAnalyticsProvider: FC<PropsWithChildren> = ({ children }) => {
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return

    const reportStatus = async (payload: Record<string, unknown>) => {
      try {
        await fetch('/api/debug/tg-analytics/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        })
      } catch {
        // Ignore network/reporting failures in production flow
      }
    }

    const token = process.env.NEXT_PUBLIC_TG_ANALYTICS_TOKEN || ''
    const appName = process.env.NEXT_PUBLIC_TG_ANALYTICS_APP_NAME || ''

    const getWebApp = () => (window as any).Telegram?.WebApp

    const waitForTelegramContext = async (timeoutMs = 2500, stepMs = 100) => {
      const started = Date.now()
      while (Date.now() - started < timeoutMs) {
        const webApp = getWebApp()
        if (webApp?.initData) return webApp
        await new Promise((resolve) => setTimeout(resolve, stepMs))
      }
      return getWebApp() || null
    }

    if (!token || !appName) {
      const statusPayload = {
        ts: Date.now(),
        sdk: 'npm',
        initialized: false,
        initCalled: false,
        initSkipped: true,
        reason: 'Missing NEXT_PUBLIC_TG_ANALYTICS_TOKEN or NEXT_PUBLIC_TG_ANALYTICS_APP_NAME',
        tokenSet: !!token,
        appNameSet: !!appName,
        page: window.location.pathname,
      }

      ;(window as any).__tgAnalyticsDebug = {
        ...(window as any).__tgAnalyticsDebug,
        ...statusPayload,
      }

      reportStatus(statusPayload)
      return
    }

    const ensureLaunchParams = (webApp: any) => {
      try {
        const existing = localStorage.getItem('launchParams') || ''
        if (existing.includes('tgWebAppData=')) return

        if (!webApp?.initData) return

        const params = new URLSearchParams()
        params.set('tgWebAppData', webApp.initData)

        const platform = webApp.platform || 'unknown'
        params.set('tgWebAppPlatform', platform)
        if (webApp.version) params.set('tgWebAppVersion', webApp.version)

        const startParam = webApp.initDataUnsafe?.start_param
        if (typeof startParam === 'string' && startParam) {
          params.set('tgWebAppStartParam', startParam)
        }

        if (webApp.themeParams && typeof webApp.themeParams === 'object') {
          params.set('tgWebAppThemeParams', JSON.stringify(webApp.themeParams))
        }

        localStorage.setItem('launchParams', params.toString())
      } catch (error) {
        ;(window as any).__tgAnalyticsDebug = {
          ...(window as any).__tgAnalyticsDebug,
          launchParamsError: error instanceof Error ? error.message : String(error),
        }
      }
    }

    const initSdk = async () => {
      try {
        const webApp = await waitForTelegramContext()

        if (!webApp?.initData) {
          const statusPayload = {
            ts: Date.now(),
            sdk: 'npm',
            initialized: false,
            initCalled: false,
            initSkipped: true,
            reason: 'Telegram WebApp initData not found (non-Telegram browser context)',
            tokenSet: !!token,
            appNameSet: !!appName,
            page: window.location.pathname,
            hasInitData: false,
            initDataLength: 0,
            hasUserId: false,
            userId: null,
            launchParamsPresent: !!(localStorage.getItem('launchParams') || ''),
            launchParamsHasTgData: (localStorage.getItem('launchParams') || '').includes('tgWebAppData='),
            ua: navigator.userAgent?.slice(0, 200) || null,
          }

          ;(window as any).__tgAnalyticsDebug = {
            ...(window as any).__tgAnalyticsDebug,
            ...statusPayload,
          }

          reportStatus(statusPayload)
          return
        }

        ensureLaunchParams(webApp)
        await telegramAnalytics.init({ token, appName })

        const launchParams = localStorage.getItem('launchParams') || ''
        const statusPayload = {
          ts: Date.now(),
          sdk: 'npm',
          initialized: true,
          initCalled: true,
          initError: null,
          tokenSet: !!token,
          appNameSet: !!appName,
          page: window.location.pathname,
          hasInitData: !!webApp?.initData,
          initDataLength: webApp?.initData?.length || 0,
          hasUserId: !!webApp?.initDataUnsafe?.user?.id,
          userId: webApp?.initDataUnsafe?.user?.id || null,
          launchParamsPresent: !!launchParams,
          launchParamsHasTgData: launchParams.includes('tgWebAppData='),
          ua: navigator.userAgent?.slice(0, 200) || null,
        }

        initializedRef.current = true
        ;(window as any).__tgAnalyticsDebug = {
          ...(window as any).__tgAnalyticsDebug,
          ...statusPayload,
        }

        reportStatus(statusPayload)
      } catch (error) {
        const launchParams = (() => {
          try {
            return localStorage.getItem('launchParams') || ''
          } catch {
            return ''
          }
        })()
        const webApp = getWebApp()
        const statusPayload = {
          ts: Date.now(),
          sdk: 'npm',
          initialized: false,
          initCalled: true,
          initError: error instanceof Error ? error.message : String(error),
          tokenSet: !!token,
          appNameSet: !!appName,
          page: window.location.pathname,
          hasInitData: !!webApp?.initData,
          initDataLength: webApp?.initData?.length || 0,
          hasUserId: !!webApp?.initDataUnsafe?.user?.id,
          userId: webApp?.initDataUnsafe?.user?.id || null,
          launchParamsPresent: !!launchParams,
          launchParamsHasTgData: launchParams.includes('tgWebAppData='),
          ua: navigator.userAgent?.slice(0, 200) || null,
        }

        ;(window as any).__tgAnalyticsDebug = {
          ...(window as any).__tgAnalyticsDebug,
          ...statusPayload,
        }

        reportStatus(statusPayload)
      }
    }

    initSdk()
  }, [])

  return <>{children}</>
}
