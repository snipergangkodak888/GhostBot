"use client"

import { useEffect, useState } from 'react'
import { useLanguage } from '@/contexts/language-context'

interface PublicSettings {
  platformName?: string
  logoUrl?: string
  telegramBotUsername?: string
  contactTelegram?: string
  contactEmail?: string
}

export default function LandingPage() {
  const { t } = useLanguage()
  const [settings, setSettings] = useState<PublicSettings>({})
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    
    const cached = typeof window !== 'undefined' ? localStorage.getItem('landingSettingsCache') : null
    const cacheTime = typeof window !== 'undefined' ? localStorage.getItem('landingSettingsCacheTime') : null
    
    if (cached && cacheTime) {
      const age = Date.now() - parseInt(cacheTime)
      if (age < 5 * 60 * 1000) {
        try {
          setSettings(JSON.parse(cached))
          setLoading(false)
          return
        } catch {}
      }
    }

    const load = async () => {
      try {
        const sres = await fetch('/api/public-settings', { cache: 'no-store' })
        if (sres.ok) {
          const js = await sres.json()
          const newSettings = {
            platformName: js.settings?.platformName || '8Ball',
            logoUrl: js.settings?.logoUrl || '/images/Stickers/brand.webp',
            telegramBotUsername: js.settings?.telegramBotUsername || '',
            contactTelegram: js.settings?.contactTelegram || '',
            contactEmail: js.settings?.contactEmail || ''
          }
          setSettings(newSettings)
          if (typeof window !== 'undefined') {
            localStorage.setItem('landingSettingsCache', JSON.stringify(newSettings))
            localStorage.setItem('landingSettingsCacheTime', Date.now().toString())
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const platform = settings.platformName || '8Ball'
  const logoUrl = settings.logoUrl || '/images/Stickers/brand.webp'
  const botUsername = (settings.telegramBotUsername || '').replace(/^@/, '')
  const botLink = botUsername ? `https://t.me/${botUsername}` : undefined

  if (loading || !mounted) {
    return (
      <div className="min-h-screen w-full bg-[#18181b] flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-zinc-600 to-zinc-700 flex items-center justify-center text-5xl mx-auto mb-4 shadow-xl"
            style={{ animation: 'pulse-scale 2s ease-in-out infinite' }}
          >
            🎱
          </div>
          <style jsx>{`
            @keyframes pulse-scale {
              0%, 100% { transform: scale(1); opacity: 0.8; }
              50% { transform: scale(1.1); opacity: 1; }
            }
          `}</style>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-[#18181b] text-white overflow-hidden relative">
      {/* Background gradients */}
      <div className="absolute inset-0 overflow-hidden">
        <div 
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px]"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(16,185,129,0.08) 0%, transparent 70%)',
            animation: 'pulse-glow 8s ease-in-out infinite'
          }}
        />
        <div 
          className="absolute bottom-0 left-0 right-0 h-[400px]"
          style={{
            background: 'linear-gradient(to top, rgba(16,185,129,0.03) 0%, transparent 100%)'
          }}
        />
      </div>
      
      <style jsx global>{`
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-slide-up { animation: slide-up 0.8s ease-out forwards; }
        .animate-fade-in { animation: fade-in 1s ease-out forwards; }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-400 { animation-delay: 0.4s; }
      `}</style>

      {/* Main content */}
      <div className="relative z-10 container mx-auto px-4 py-8 min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between py-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎱</span>
            <span className="text-xl font-bold tracking-tight">{platform}</span>
          </div>
          {botLink && (
            <a
              href={botLink}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 hover:bg-white/10 transition-all text-sm font-medium"
            >
              {t('launchApp', 'Launch App')} →
            </a>
          )}
        </header>

        {/* Hero Section */}
        <main className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="mb-8 animate-slide-up opacity-0 delay-100">
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-3xl bg-gradient-to-br from-zinc-600 to-zinc-700 flex items-center justify-center text-7xl md:text-8xl mx-auto shadow-2xl">
              🎱
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 animate-slide-up opacity-0 delay-200">
            <span className="block">{t('play8ballPool', 'Play 8Ball Pool')}</span>
            <span className="block bg-gradient-to-r from-emerald-400 via-white to-emerald-400 bg-clip-text text-transparent">
              {t('onTelegram', 'On Telegram')}
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 animate-slide-up opacity-0 delay-300">
            {t('landingHeroDesc', 'Challenge your friends, beat the AI, and climb the leaderboard. The ultimate billiards experience — right in your Telegram app.')}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 animate-slide-up opacity-0 delay-400">
            {botLink ? (
              <a
                href={botLink}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center justify-center gap-2 bg-white text-black px-8 py-4 rounded-full font-bold text-lg hover:bg-gray-100 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-white/20"
              >
                🎱 {t('startPlaying', 'Start Playing')}
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </a>
            ) : (
              <span className="text-gray-500 text-sm">{t('botNotConfigured', 'Bot not configured')}</span>
            )}
          </div>
        </main>

        {/* Features */}
        <section className="py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="group p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 animate-slide-up opacity-0 delay-200">
              <div className="mb-4 text-3xl">🤖</div>
              <h3 className="text-lg font-bold mb-2">{t('vsComputer', 'vs Computer')}</h3>
              <p className="text-gray-400 text-sm">{t('challengeAiAt5Levels', 'Challenge AI opponents at 5 difficulty levels')}</p>
            </div>
            <div className="group p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 animate-slide-up opacity-0 delay-300">
              <div className="mb-4 text-3xl">👥</div>
              <h3 className="text-lg font-bold mb-2">{t('twoPlayers', '2 Players')}</h3>
              <p className="text-gray-400 text-sm">{t('playWithFriendSameDevice', 'Play with a friend on the same device')}</p>
            </div>
            <div className="group p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 animate-slide-up opacity-0 delay-400">
              <div className="mb-4 text-3xl">🏆</div>
              <h3 className="text-lg font-bold mb-2">{t('leaderboardTitle', 'Leaderboard')}</h3>
              <p className="text-gray-400 text-sm">{t('competeTopSpotEarnRank', 'Compete for the top spot and earn your rank')}</p>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 text-center">
          <div className="max-w-2xl mx-auto p-8 rounded-3xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10">
            <div className="text-4xl mb-4">🎱</div>
            <h2 className="text-2xl md:text-3xl font-bold mb-4">{t('readyToBreak', 'Ready to Break?')}</h2>
            <p className="text-gray-400 mb-6">
              {t('openAppInTelegramNow', 'Open the app in Telegram and start playing now')}
            </p>
            {botLink && (
              <a
                href={botLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-white text-black px-8 py-4 rounded-full font-bold text-lg hover:bg-gray-100 transition-all hover:scale-105 active:scale-95"
              >
                Open {platform} →
              </a>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 border-t border-white/10 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-xl">🎱</span>
            <span className="font-semibold">{platform}</span>
          </div>
          <p className="text-gray-500 text-sm mb-4">
            © {new Date().getFullYear()} {platform}. All rights reserved.
          </p>
          {(settings.contactTelegram || settings.contactEmail) && (
            <div className="flex items-center justify-center gap-6 text-sm">
              {settings.contactTelegram && (
                <a href={settings.contactTelegram} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  Telegram
                </a>
              )}
              {settings.contactEmail && (
                <a href={`mailto:${settings.contactEmail}`} className="text-gray-400 hover:text-white transition-colors">
                  Email Support
                </a>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}