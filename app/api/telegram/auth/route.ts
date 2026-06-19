import { NextRequest, NextResponse } from "next/server"
import { createHmac, randomUUID } from "crypto"
import { getDb } from "@/lib/db"
import { getTeamAccess, redeemGuardInviteCode } from "@/lib/team-access"

const TG_ANALYTICS_API = "https://tganalytics.xyz"

type TelegramUserData = {
  id: number | string
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

function validateTelegramWebAppData(initData: string, botToken: string): { ok: boolean; reason?: string } {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get("hash")
    if (!hash) return { ok: false, reason: "Missing hash" }

    params.delete("hash")
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")

    const secret = createHmac("sha256", "WebAppData").update(botToken).digest()
    const calculated = createHmac("sha256", secret).update(dataCheckString).digest("hex")
    if (calculated !== hash) return { ok: false, reason: "Hash mismatch" }

    const authDate = Number(new URLSearchParams(initData).get("auth_date") || 0)
    const maxAgeSec = Number(process.env.TELEGRAM_INITDATA_MAX_AGE_SEC || 86400)
    if (authDate && Date.now() / 1000 - authDate > maxAgeSec) {
      return { ok: false, reason: "initData expired" }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Validation failed" }
  }
}

function parseUserFromInitData(initData: string): TelegramUserData | null {
  try {
    const raw = new URLSearchParams(initData).get("user")
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function sendAuthEventToTgAnalytics(params: {
  userId: number
  isNewUser: boolean
  isPremium?: boolean
  locale?: string
  startParam?: string | null
}) {
  const token = process.env.NEXT_PUBLIC_TG_ANALYTICS_TOKEN || ""
  const appName = process.env.NEXT_PUBLIC_TG_ANALYTICS_APP_NAME || ""
  if (!token || !appName) return

  const event = {
    event_name: "custom-event",
    session_id: randomUUID(),
    user_id: params.userId,
    app_name: appName,
    is_premium: !!params.isPremium,
    locale: params.locale || "en",
    platform: "telegram-webapp",
    start_param: params.startParam || undefined,
    client_timestamp: String(Date.now()),
    custom_data: {
      auth_event: params.isNewUser ? "auth_register" : "auth_login",
      is_new_user: params.isNewUser,
      source: "api/telegram/auth",
    },
  }

  try {
    await fetch(`${TG_ANALYTICS_API}/events`, {
      method: "POST",
      headers: {
        "TGA-Auth-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([event]),
    })
  } catch {}
}

export async function POST(request: NextRequest) {
  try {
    const text = await request.text()
    const body = text ? JSON.parse(text) : {}
    const initData = String(body.initData || "")
    const guardCode = String(body.guardCode || body.inviteCode || "").trim()
    const startParam = body.startParam || (initData ? new URLSearchParams(initData).get("start_param") : null)
    let userData: TelegramUserData | null = body.userData || body.user || null

    if ((!userData || !userData.id) && initData) {
      userData = parseUserFromInitData(initData)
    }

    if (!initData && process.env.NODE_ENV !== "development") {
      return NextResponse.json({ error: "Authentication required", details: "initData is required" }, { status: 401 })
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      return NextResponse.json({ error: "Telegram bot token not configured", details: "TELEGRAM_BOT_TOKEN is missing" }, { status: 500 })
    }

    if (initData) {
      const validation = validateTelegramWebAppData(initData, botToken)
      if (!validation.ok) {
        return NextResponse.json({ error: "Invalid Telegram data", details: validation.reason || "Validation failed" }, { status: 401 })
      }
    }

    if (!userData?.id) {
      return NextResponse.json({ error: "User data missing", details: "Telegram user id is required" }, { status: 400 })
    }

    const telegramId = Number(userData.id)
    if (!Number.isFinite(telegramId)) {
      return NextResponse.json({ error: "Invalid Telegram user", details: "Telegram user id is invalid" }, { status: 400 })
    }

    const now = new Date()
    const db = await getDb()
    const users = db.collection("users")
    const existing = await users.findOne({ telegramId })
    const isNewUser = !existing

    const profile = {
      telegramId,
      firstName: userData.first_name || "",
      lastName: userData.last_name || "",
      username: userData.username || "",
      languageCode: userData.language_code || "en",
      isPremium: !!userData.is_premium,
      photoUrl: userData.photo_url || existing?.photoUrl || "",
      lastLoginAt: now,
      updatedAt: now,
    }

    if (existing) {
      await users.updateOne({ telegramId }, { $set: profile })
    } else {
      await users.insertOne({
        ...profile,
        status: "active",
        isBanned: false,
        createdAt: now,
      })
    }

    const user = await users.findOne({ telegramId })
    if (user?.isBanned) {
      return NextResponse.json({ error: "User is banned", banned: true }, { status: 403 })
    }

    const access = await getTeamAccess(telegramId)
    if (!access.allowed) {
      if (access.reason === "deactivated") {
        return NextResponse.json({ error: "Your team access is deactivated", accessDenied: true }, { status: 403 })
      }
      if (!guardCode) {
        return NextResponse.json({ error: "Invite code required", inviteRequired: true }, { status: 403 })
      }
      const redeemed = await redeemGuardInviteCode({
        code: guardCode,
        telegramId,
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          username: profile.username,
          languageCode: profile.languageCode,
        },
        source: "app",
      })
      if (!redeemed.ok) {
        return NextResponse.json({ error: redeemed.error || "Invalid invite code", inviteRequired: true }, { status: 403 })
      }
    }

    void sendAuthEventToTgAnalytics({
      userId: telegramId,
      isNewUser,
      isPremium: !!userData.is_premium,
      locale: userData.language_code || "en",
      startParam,
    })

    const response = NextResponse.json({
      success: true,
      isNewUser,
      user: {
        id: user?._id,
        telegramId,
        firstName: profile.firstName,
        lastName: profile.lastName,
        username: profile.username,
        isPremium: profile.isPremium,
      },
    })

    const sessionToken = `session_${user?._id || telegramId}_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    }

    response.cookies.set("telegram_user_id", String(user?._id || telegramId), cookieOptions)
    response.cookies.set("telegram_session", sessionToken, cookieOptions)

    return response
  } catch (error) {
    return NextResponse.json(
      { error: "Authentication failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
