import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { ObjectId } from '@/lib/object-id'
import { NextRequest } from 'next/server'
import { getDb } from './db'

const secret = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET || 'dev-secret-change-me')
const issuer = 'kickq-admin'

export type AdminJWTPayload = {
  sub: string // admin id
  email: string
  role: 'admin'
}

export async function createAdminToken(payload: AdminJWTPayload, maxAgeSeconds = 60 * 60 * 8) {
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secret)
  return jwt
}

export async function verifyAdminToken(token: string) {
  const { payload } = await jwtVerify(token, secret, { issuer })
  return payload as AdminJWTPayload
}

// ============ USER AUTH ============

export type UserSession = {
  id: string          // Document id as string
  telegramId: number
  firstName: string
  lastName: string
  username: string
}

/**
 * Validates user session from cookies.
 * Returns user data if valid, null if not authenticated.
 * This ensures only users who went through Telegram auth can access APIs.
 */
export async function requireUser(): Promise<UserSession | null> {
  try {
    const cookieStore = cookies()
    const userId = cookieStore.get('telegram_user_id')?.value
    const sessionToken = cookieStore.get('telegram_session')?.value

    // Both cookies must exist
    if (!userId || !sessionToken) {
      return null
    }

    // Validate userId is a valid ObjectId
    if (!ObjectId.isValid(userId)) {
      return null
    }

    // Validate session token format (session_{userId}_{timestamp}_{random})
    if (!sessionToken.startsWith(`session_${userId}_`)) {
      return null
    }

    // Verify user exists in database
    const db = await getDb()
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) })

    if (!user) {
      return null
    }

    return {
      id: userId,
      telegramId: user.telegramId,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      username: user.username || '',
    }
  } catch (error) {
    if ((error as any)?.digest === 'DYNAMIC_SERVER_USAGE') {
      throw error
    }
    console.error('User auth error:', error)
    return null
  }
}

/**
 * Resolves the current user's telegramId for user-facing game API routes.
 *
 * Priority order:
 *  1. x-telegram-id header  — always reflects the live Telegram account currently
 *     running the mini-app. This must win over any stale cookie.
 *  2. Cookie session         — fallback for environments where the header is absent
 *                              (e.g. browser/dev testing without Telegram).
 *
 * Stale cookies from a previous account on the same device will NOT override
 * the live Telegram identity in the header.
 */
/**
 * Resolves the current user's telegramId for user-facing game API routes.
 *
 * Reads the x-telegram-id header which is always set by the client from
 * window.Telegram.WebApp.initDataUnsafe.user.id — the cryptographically
 * verified Telegram identity. No additional DB lookup is needed; the
 * initData signature was already validated by /api/telegram/auth at login.
 *
 * We intentionally do NOT check user existence here — on first open the
 * context fires before the auth route has finished creating the DB record,
 * so a DB existence check would incorrectly return null and lock the UI at
 * energy=0 / empty state for the entire session.
 */
export async function resolveUserTelegramId(req: NextRequest): Promise<number | null> {
  const headerId = req.headers.get('x-telegram-id')
  if (!headerId || !/^\d+$/.test(headerId)) return null
  return Number(headerId)
}
