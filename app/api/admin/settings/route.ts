import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyAdminToken } from '@/lib/auth'

const AI_BASE_URLS = new Set(['https://api.openai.com/v1', 'https://openrouter.ai/api/v1'])

function normalizeAiModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : ''
  if (!model || model === 'gpt-4o-mini') return 'gpt-5.4-mini'
  return model
}

async function requireAdmin() {
  const token = cookies().get('admin_token')?.value
  if (!token) return null
  try {
    return await verifyAdminToken(token)
  } catch {
    return null
  }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const rows = await db.collection('settings').find({}).toArray()
  const settings = rows.reduce((acc: Record<string, unknown>, s: any) => {
    acc[s.key] = s.value
    return acc
  }, {})
  return NextResponse.json({ settings, ...settings })
}

export async function POST(req: Request) {
  return PATCH(req)
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const db = await getDb()
  const ops = [] as Array<Promise<any>>

  if (typeof body.maintenanceMode === 'boolean') {
    ops.push(db.collection('settings').updateOne({ key: 'maintenanceMode' }, { $set: { value: body.maintenanceMode } }, { upsert: true }))
  }
  if (typeof body.landingPageEnabled === 'boolean') {
    ops.push(db.collection('settings').updateOne({ key: 'landingPageEnabled' }, { $set: { value: body.landingPageEnabled } }, { upsert: true }))
  }
  if (typeof body.platformName === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'platformName' }, { $set: { value: body.platformName } }, { upsert: true }))
  }
  if (typeof body.appVersion === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'appVersion' }, { $set: { value: body.appVersion } }, { upsert: true }))
  }
  if (typeof body.logoUrl === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'logoUrl' }, { $set: { value: body.logoUrl } }, { upsert: true }))
  }
  if (typeof body.apiFootballKey === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'apiFootballKey' }, { $set: { value: body.apiFootballKey } }, { upsert: true }))
  }
  if (typeof body.telegramBotUsername === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'telegramBotUsername' }, { $set: { value: body.telegramBotUsername } }, { upsert: true }))
  }
  if (typeof body.telegramAnalyticsToken === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'telegramAnalyticsToken' }, { $set: { value: body.telegramAnalyticsToken } }, { upsert: true }))
  }
  if (body.openAi && typeof body.openAi === 'object') {
    const existing = await db.collection('settings').findOne({ key: 'openAi' })
    const current = existing?.value && typeof existing.value === 'object' ? existing.value : {}
    const incomingKey = typeof body.openAi.apiKey === 'string' ? body.openAi.apiKey.trim() : ''
    const incomingBaseUrl = typeof body.openAi.baseUrl === 'string' ? body.openAi.baseUrl.trim().replace(/\/+$/, '') : ''
    const currentBaseUrl = typeof (current as any).baseUrl === 'string' ? String((current as any).baseUrl).trim().replace(/\/+$/, '') : ''
    const normalized = {
      enabled: body.openAi.enabled !== false,
      apiKey: incomingKey || String((current as any).apiKey || ''),
      model: normalizeAiModel(body.openAi.model),
      baseUrl: AI_BASE_URLS.has(incomingBaseUrl) ? incomingBaseUrl : AI_BASE_URLS.has(currentBaseUrl) ? currentBaseUrl : 'https://api.openai.com/v1',
    }
    ops.push(db.collection('settings').updateOne({ key: 'openAi' }, { $set: { value: normalized } }, { upsert: true }))
  }
  if (typeof body.tonConnectEnabled === 'boolean') {
    ops.push(db.collection('settings').updateOne({ key: 'tonConnectEnabled' }, { $set: { value: body.tonConnectEnabled } }, { upsert: true }))
  }
  // NOWPayments settings
  if (body.nowPayments && typeof body.nowPayments === 'object') {
    const normalized = {
      enabled: !!body.nowPayments.enabled,
      apiKey: typeof body.nowPayments.apiKey === 'string' ? body.nowPayments.apiKey.trim() : '',
      merchantId: typeof body.nowPayments.merchantId === 'string' ? body.nowPayments.merchantId.trim() : '',
      ipnSecret: typeof body.nowPayments.ipnSecret === 'string' ? body.nowPayments.ipnSecret.trim() : '',
      sandbox: !!body.nowPayments.sandbox,
      currencies: Array.isArray(body.nowPayments.currencies) ? body.nowPayments.currencies : ['btc', 'eth', 'usdttrc20', 'ton']
    }
    ops.push(db.collection('settings').updateOne({ key: 'nowPayments' }, { $set: { value: normalized } }, { upsert: true }))
  }
  // Contact settings
  if (typeof body.contactTelegram === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'contactTelegram' }, { $set: { value: body.contactTelegram } }, { upsert: true }))
  }
  if (typeof body.contactEmail === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'contactEmail' }, { $set: { value: body.contactEmail } }, { upsert: true }))
  }
  if (typeof body.playUrl === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'playUrl' }, { $set: { value: body.playUrl } }, { upsert: true }))
  }
  // Star price setting
  if (typeof body.starPriceUsd === 'number') {
    ops.push(db.collection('settings').updateOne({ key: 'starPriceUsd' }, { $set: { value: body.starPriceUsd } }, { upsert: true }))
  }
  // Show TON price badges setting
  if (typeof body.showTonPriceBadges === 'boolean') {
    ops.push(db.collection('settings').updateOne({ key: 'showTonPriceBadges' }, { $set: { value: body.showTonPriceBadges } }, { upsert: true }))
  }
  // Promo wins ticker settings
  if (typeof body.showPromoWinsTicker === 'boolean') {
    ops.push(db.collection('settings').updateOne({ key: 'showPromoWinsTicker' }, { $set: { value: body.showPromoWinsTicker } }, { upsert: true }))
  }
  if (typeof body.fakePromoWinsTicker === 'boolean') {
    ops.push(db.collection('settings').updateOne({ key: 'fakePromoWinsTicker' }, { $set: { value: body.fakePromoWinsTicker } }, { upsert: true }))
  }
  // Game card settings (legacy single card — kept for backwards compat)
  if (typeof body.gameCardBgUrl === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'gameCardBgUrl' }, { $set: { value: body.gameCardBgUrl.trim() } }, { upsert: true }))
  }
  if (typeof body.gameCardTitle === 'string') {
    ops.push(db.collection('settings').updateOne({ key: 'gameCardTitle' }, { $set: { value: body.gameCardTitle.trim() } }, { upsert: true }))
  }
  // Play cards array (new multi-card system)
  if (Array.isArray(body.playCards)) {
    const normalized = body.playCards.map((card: any) => ({
      id: typeof card.id === 'string' ? card.id : String(Date.now()),
      title: typeof card.title === 'string' ? card.title.trim() : 'VIVATBET Merge',
      bgUrl: typeof card.bgUrl === 'string' ? card.bgUrl.trim() : '',
      matchCost: typeof card.matchCost === 'number' ? card.matchCost : 0,
      adminFee: typeof card.adminFee === 'number' ? card.adminFee : 0,
      winnerMedals: typeof card.winnerMedals === 'number' ? card.winnerMedals : 10,
      loserMedals: typeof card.loserMedals === 'number' ? card.loserMedals : 0,
      active: card.active !== false,
    }))
    ops.push(db.collection('settings').updateOne({ key: 'playCards' }, { $set: { value: normalized } }, { upsert: true }))
    // Keep legacy fields in sync with first active card
    const firstActive = normalized.find((c: any) => c.active)
    if (firstActive) {
      ops.push(db.collection('settings').updateOne({ key: 'gameCardBgUrl' }, { $set: { value: firstActive.bgUrl } }, { upsert: true }))
      ops.push(db.collection('settings').updateOne({ key: 'gameCardTitle' }, { $set: { value: firstActive.title } }, { upsert: true }))
    }
  }
  if (body.startMessage && typeof body.startMessage === 'object') {
    const normalized = { ...body.startMessage }
    // sanitize mediaType
    if (normalized.mediaType !== 'video') normalized.mediaType = 'photo'
    // normalize inline buttons
    try {
      const btns = Array.isArray((normalized as any).inlineButtons) ? (normalized as any).inlineButtons : []
      const clean = btns
        .filter((b: any) => b && typeof b.text === 'string' && b.text.trim() && typeof b.url === 'string' && b.url.trim())
        .map((b: any) => ({
          text: String(b.text).trim(),
          url: String(b.url).trim(),
          order: Number.isFinite(b.order) ? b.order : parseInt(b.order) || 0,
        }))
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
      ;(normalized as any).inlineButtons = clean
    } catch {}
    ops.push(db.collection('settings').updateOne({ key: 'startMessage' }, { $set: { value: normalized } }, { upsert: true }))
  }
  if (body.spinWheel && typeof body.spinWheel === 'object') {
    const fixedKeys = new Set(['free_prediction','discount_percent','try_again','discount_amount'])
    const defaults: Record<string, any> = {
      free_prediction: { id: 'free_prediction', key: 'free_prediction', label: '1 Free Prediction', enabled: true, amount: 1, weight: 10 },
      discount_percent: { id: 'discount_percent', key: 'discount_percent', label: '10% Discount', enabled: true, percent: 10, weight: 10 },
      try_again: { id: 'try_again', key: 'try_again', label: 'Try Next Time', enabled: true, weight: 60 },
      discount_amount: { id: 'discount_amount', key: 'discount_amount', label: '$25 Discount', enabled: true, amount: 25, weight: 20 },
    }
    const incoming = body.spinWheel || {}
    const map: Record<string, any> = {}
    for (const r of (incoming.rewards || [])) {
      if (r?.key && fixedKeys.has(r.key)) map[r.key] = r
    }
    const rewards = Array.from(fixedKeys).map((k) => {
      const r = map[k] || {}
      const d = defaults[k]
      return {
        ...d,
        id: typeof r.id === 'string' ? r.id : d.id,
        label: typeof r.label === 'string' ? r.label : d.label,
        enabled: r.enabled ?? d.enabled,
        weight: typeof r.weight === 'number' ? r.weight : d.weight,
        amount: typeof r.amount === 'number' ? r.amount : d.amount,
        percent: typeof r.percent === 'number' ? r.percent : d.percent,
      }
    })
    const normalized = {
      enabled: !!incoming.enabled,
      timerHours: typeof incoming.timerHours === 'number' ? incoming.timerHours : 24,
      spinsPerPeriod: typeof incoming.spinsPerPeriod === 'number' ? incoming.spinsPerPeriod : 1,
      rewards,
    }
    ops.push(db.collection('settings').updateOne({ key: 'spinWheel' }, { $set: { value: normalized } }, { upsert: true }))
  }
  // Save free predictions settings
  if (body.freePredictions && typeof body.freePredictions === 'object') {
    ops.push(db.collection('settings').updateOne({ key: 'freePredictions' }, { $set: { value: body.freePredictions } }, { upsert: true }))
  }
  // Save daily free prediction settings
  if (body.dailyFreePrediction && typeof body.dailyFreePrediction === 'object') {
    const normalized = { ...body.dailyFreePrediction }
    if (normalized.fixtureId !== undefined && normalized.fixtureId !== null) {
      normalized.fixtureId = String(normalized.fixtureId)
    }
    console.log('💾 Saving dailyFreePrediction:', normalized)
    ops.push(
      db
        .collection('settings')
        .updateOne(
          { key: 'dailyFreePrediction' },
          { $set: { value: normalized } },
          { upsert: true }
        )
    )
  }

  // Save game mode settings (for airdrop app)
  if (body.gameMode && typeof body.gameMode === 'object') {
    const validModes = ['idle', 'mine', 'hold']
    const normalized = {
      activeMode: validModes.includes(body.gameMode.activeMode) ? body.gameMode.activeMode : 'idle',
      idleEnabled: !!body.gameMode.idleEnabled,
      mineEnabled: !!body.gameMode.mineEnabled,
      holdEnabled: !!body.gameMode.holdEnabled,
    }
    ops.push(db.collection('settings').updateOne({ key: 'gameMode' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save airdrop settings
  if (body.airdropSettings && typeof body.airdropSettings === 'object') {
    const normalized = {
      tokenName: typeof body.airdropSettings.tokenName === 'string' ? body.airdropSettings.tokenName : 'DROP',
      tokenSymbol: typeof body.airdropSettings.tokenSymbol === 'string' ? body.airdropSettings.tokenSymbol : 'DROP',
      withdrawalFeeEnabled: !!body.airdropSettings.withdrawalFeeEnabled,
      withdrawalFee: typeof body.airdropSettings.withdrawalFee === 'number' ? body.airdropSettings.withdrawalFee : 0,
      minimumWithdrawal: typeof body.airdropSettings.minimumWithdrawal === 'number' ? body.airdropSettings.minimumWithdrawal : 1000,
      conversionRate: typeof body.airdropSettings.conversionRate === 'number' ? body.airdropSettings.conversionRate : 1,
    }
    ops.push(db.collection('settings').updateOne({ key: 'airdropSettings' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save referral settings
  if (body.referralSettings && typeof body.referralSettings === 'object') {
    const normalized = {
      enabled: body.referralSettings.enabled !== false,
      signupRewardEnabled: body.referralSettings.signupRewardEnabled !== false,
      commissionEnabled: body.referralSettings.commissionEnabled !== false,
      commissionFromPurchases: !!body.referralSettings.commissionFromPurchases,
      rewardPerReferral: typeof body.referralSettings.rewardPerReferral === 'number' ? body.referralSettings.rewardPerReferral : 500,
      referrerBonusPercent: typeof body.referralSettings.referrerBonusPercent === 'number' ? body.referralSettings.referrerBonusPercent : 10,
      spinPercentage: typeof body.referralSettings.spinPercentage === 'number' ? Math.min(100, Math.max(0, body.referralSettings.spinPercentage)) : 10,
      rewardType: body.referralSettings.rewardType === 'percentage' ? 'percentage' : 'fixed',
      rewardValue: typeof body.referralSettings.rewardValue === 'number' ? body.referralSettings.rewardValue : 100,
      rewardToken: typeof body.referralSettings.rewardToken === 'string' ? body.referralSettings.rewardToken : 'spins',
    }
    ops.push(db.collection('settings').updateOne({ key: 'referralSettings' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save ad networks settings
  if (body.adNetworks && typeof body.adNetworks === 'object') {
    const normalized = {
      adsgram: {
        enabled: !!body.adNetworks.adsgram?.enabled,
        rewardPerAd: typeof body.adNetworks.adsgram?.rewardPerAd === 'number' ? body.adNetworks.adsgram.rewardPerAd : 50,
        blockId: typeof body.adNetworks.adsgram?.blockId === 'string' ? body.adNetworks.adsgram.blockId : '',
      },
      onclicka: {
        enabled: !!body.adNetworks.onclicka?.enabled,
        rewardPerAd: typeof body.adNetworks.onclicka?.rewardPerAd === 'number' ? body.adNetworks.onclicka.rewardPerAd : 50,
        zoneId: typeof body.adNetworks.onclicka?.zoneId === 'string' ? body.adNetworks.onclicka.zoneId : '',
      },
      adsonar: {
        enabled: !!body.adNetworks.adsonar?.enabled,
        rewardPerAd: typeof body.adNetworks.adsonar?.rewardPerAd === 'number' ? body.adNetworks.adsonar.rewardPerAd : 50,
        blockId: typeof body.adNetworks.adsonar?.blockId === 'string' ? body.adNetworks.adsonar.blockId : '',
      },
      callbackSecret: typeof body.adNetworks.callbackSecret === 'string' ? body.adNetworks.callbackSecret : '',
    }
    ops.push(db.collection('settings').updateOne({ key: 'adNetworks' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save Stars Payment settings
  if (body.starsPayment && typeof body.starsPayment === 'object') {
    const normalized = {
      enabled: !!body.starsPayment.enabled,
      packagesOnly: !!body.starsPayment.packagesOnly,
      pricePerSpin: typeof body.starsPayment.pricePerSpin === 'number' ? body.starsPayment.pricePerSpin : 1,
      packages: Array.isArray(body.starsPayment.packages) ? body.starsPayment.packages.map((pkg: any) => ({
        id: typeof pkg.id === 'string' ? pkg.id : String(Date.now()),
        spins: typeof pkg.spins === 'number' ? pkg.spins : 0,
        priceStars: typeof pkg.priceStars === 'number' ? pkg.priceStars : 0,
        active: pkg.active !== false
      })) : []
    }
    ops.push(db.collection('settings').updateOne({ key: 'starsPayment' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save TON Connect manifest settings
  if (body.tonConnectManifest && typeof body.tonConnectManifest === 'object') {
    const normalized = {
      url: typeof body.tonConnectManifest.url === 'string' ? body.tonConnectManifest.url.trim() : '',
      name: typeof body.tonConnectManifest.name === 'string' ? body.tonConnectManifest.name.trim() : '',
      iconUrl: typeof body.tonConnectManifest.iconUrl === 'string' ? body.tonConnectManifest.iconUrl.trim() : '',
      termsOfUseUrl: typeof body.tonConnectManifest.termsOfUseUrl === 'string' ? body.tonConnectManifest.termsOfUseUrl.trim() : '',
      privacyPolicyUrl: typeof body.tonConnectManifest.privacyPolicyUrl === 'string' ? body.tonConnectManifest.privacyPolicyUrl.trim() : '',
    }
    ops.push(db.collection('settings').updateOne({ key: 'tonConnectManifest' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save animation icons
  if (body.animationIcons && typeof body.animationIcons === 'object') {
    const normalized = {
      earnIcon: typeof body.animationIcons.earnIcon === 'string' ? body.animationIcons.earnIcon : '',
      leaderboardIcon: typeof body.animationIcons.leaderboardIcon === 'string' ? body.animationIcons.leaderboardIcon : '',
      collectionIcon: typeof body.animationIcons.collectionIcon === 'string' ? body.animationIcons.collectionIcon : '',
      referralsIcon: typeof body.animationIcons.referralsIcon === 'string' ? body.animationIcons.referralsIcon : '',
      homeIcon: typeof body.animationIcons.homeIcon === 'string' ? body.animationIcons.homeIcon : '',
      tasksIcon: typeof body.animationIcons.tasksIcon === 'string' ? body.animationIcons.tasksIcon : '',
      walletIcon: typeof body.animationIcons.walletIcon === 'string' ? body.animationIcons.walletIcon : '',
      spinIcon: typeof body.animationIcons.spinIcon === 'string' ? body.animationIcons.spinIcon : '',
      giftIcon: typeof body.animationIcons.giftIcon === 'string' ? body.animationIcons.giftIcon : '',
    }
    ops.push(db.collection('settings').updateOne({ key: 'animationIcons' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save theme settings
  if (body.themeSettings && typeof body.themeSettings === 'object') {
    const normalized = {
      galaxy: {
        landingPage: !!body.themeSettings.galaxy?.landingPage,
        miniApp: !!body.themeSettings.galaxy?.miniApp,
        brandingIntro: !!body.themeSettings.galaxy?.brandingIntro,
        adminPanel: !!body.themeSettings.galaxy?.adminPanel,
        lowDensity: !!body.themeSettings.galaxy?.lowDensity,
      },
      galaxyMono: {
        landingPage: !!body.themeSettings.galaxyMono?.landingPage,
        miniApp: !!body.themeSettings.galaxyMono?.miniApp,
        brandingIntro: !!body.themeSettings.galaxyMono?.brandingIntro,
        adminPanel: !!body.themeSettings.galaxyMono?.adminPanel,
        lowDensity: !!body.themeSettings.galaxyMono?.lowDensity,
      }
    }
    console.log('📦 [settings] Saving themeSettings:', JSON.stringify(normalized))
    ops.push(db.collection('settings').updateOne({ key: 'themeSettings' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save crypto payments settings
  if (body.cryptoPayments && typeof body.cryptoPayments === 'object') {
    const normalized = {
      enabled: !!body.cryptoPayments.enabled,
      provider: body.cryptoPayments.provider === 'paykassa' ? 'paykassa' : 'nowpayments',
      nowpaymentsEnabled: !!body.cryptoPayments.nowpaymentsEnabled,
      paykassaEnabled: !!body.cryptoPayments.paykassaEnabled,
      nowpayments: {
        apiKey: typeof body.cryptoPayments.nowpayments?.apiKey === 'string' ? body.cryptoPayments.nowpayments.apiKey.trim() : '',
        ipnSecret: typeof body.cryptoPayments.nowpayments?.ipnSecret === 'string' ? body.cryptoPayments.nowpayments.ipnSecret.trim() : '',
        sandbox: !!body.cryptoPayments.nowpayments?.sandbox
      },
      paykassa: {
        merchantId: typeof body.cryptoPayments.paykassa?.merchantId === 'string' ? body.cryptoPayments.paykassa.merchantId.trim() : '',
        apiKey: typeof body.cryptoPayments.paykassa?.apiKey === 'string' ? body.cryptoPayments.paykassa.apiKey.trim() : '',
        secretKey: typeof body.cryptoPayments.paykassa?.secretKey === 'string' ? body.cryptoPayments.paykassa.secretKey.trim() : ''
      },
      enabledCurrencies: typeof body.cryptoPayments.enabledCurrencies === 'object' ? body.cryptoPayments.enabledCurrencies : {},
      currencyMinAmounts: typeof body.cryptoPayments.currencyMinAmounts === 'object' ? body.cryptoPayments.currencyMinAmounts : {}
    }
    ops.push(db.collection('settings').updateOne({ key: 'cryptoPayments' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Save spin pricing settings
  if (body.spinPricing && typeof body.spinPricing === 'object') {
    const normalized = {
      pricePerSpin: typeof body.spinPricing.pricePerSpin === 'number' ? body.spinPricing.pricePerSpin : 0.04,
      usePackagesOnly: !!body.spinPricing.usePackagesOnly,
      packages: Array.isArray(body.spinPricing.packages) ? body.spinPricing.packages.map((pkg: any) => ({
        id: typeof pkg.id === 'string' ? pkg.id : String(Date.now()),
        spins: typeof pkg.spins === 'number' ? pkg.spins : 0,
        priceUsd: typeof pkg.priceUsd === 'number' ? pkg.priceUsd : 0,
        active: pkg.active !== false
      })) : []
    }
    ops.push(db.collection('settings').updateOne({ key: 'spinPricing' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Cron secret
  if (typeof body.cronSecret === 'string') {
    const val = body.cronSecret.trim()
    ops.push(db.collection('settings').updateOne({ key: 'cronSecret' }, { $set: { value: val } }, { upsert: true }))
  }

  // Spawn weights (game item generation chances, levels 1-5)
  if (body.spawnWeights && typeof body.spawnWeights === 'object') {
    const normalized: Record<string, number> = {}
    for (const level of [1, 2, 3, 4, 5]) {
      const w = Number(body.spawnWeights[level] ?? body.spawnWeights[String(level)])
      normalized[String(level)] = Number.isFinite(w) && w >= 0 ? w : 0
    }
    ops.push(db.collection('settings').updateOne({ key: 'spawnWeights' }, { $set: { value: normalized } }, { upsert: true }))
  }

  // Merge item definitions (emoji, name, canSpawn per level 1-8)
  if (Array.isArray(body.mergeItemDefs)) {
    const normalized = body.mergeItemDefs
      .filter((d: any) => d && Number(d.level) >= 1 && Number(d.level) <= 8)
      .map((d: any) => ({
        level: Number(d.level),
        emoji: String(d.emoji || '').slice(0, 8),
        ...(d.iconUrl ? { iconUrl: String(d.iconUrl).slice(0, 500) } : {}),
        name: String(d.name || '').slice(0, 40),
        canSpawn: !!d.canSpawn,
        spawnWeight: Math.max(0, Number(d.spawnWeight) || 0),
        prizeType: (d.prizeType === 'energy' || d.prizeType === 'promo_code' || d.prizeType === 'unlock_board_slot') ? d.prizeType : 'none',
        prizeAmount: Math.max(0, Number(d.prizeAmount) || 0),
      }))
    ops.push(db.collection('settings').updateOne({ key: 'mergeItemDefs' }, { $set: { value: normalized } }, { upsert: true }))
  }

  if (typeof body.spawnPrice === 'number') {
    ops.push(db.collection('settings').updateOne({ key: 'spawnPrice' }, { $set: { value: Math.max(1, body.spawnPrice) } }, { upsert: true }))
  }

  await Promise.all(ops)

  // Google Analytics
  if (body.googleAnalytics && typeof body.googleAnalytics === 'object') {
    await db.collection('settings').updateOne(
      { key: 'googleAnalytics' },
      { $set: { value: {
        enabled: !!body.googleAnalytics.enabled,
        trackingId: typeof body.googleAnalytics.trackingId === 'string' ? body.googleAnalytics.trackingId.trim() : ''
      }}},
      { upsert: true }
    )
  }

  // Verify the save by reading back
  const savedSetting = await db.collection('settings').findOne({ key: 'dailyFreePrediction' })
  console.log('✅ Verified saved dailyFreePrediction:', savedSetting?.value)
  
  return NextResponse.json({ ok: true })
}
