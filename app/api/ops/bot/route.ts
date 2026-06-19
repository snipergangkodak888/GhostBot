import { NextResponse } from "next/server"
import { answerOpsAi, answerOpsBot } from "@/lib/ops-bot"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const text = String(body.text || "").trim()
  const isAi = text.toLowerCase().startsWith("/ai ") || text.toLowerCase().startsWith("ai ") || body.mode === "ai"
  const question = isAi ? text.replace(/^\/?ai\s+/i, "").trim() : text
  const answer = isAi
    ? await answerOpsAi(question, body.telegramId ? Number(body.telegramId) : null)
    : await answerOpsBot(text, body.telegramId ? Number(body.telegramId) : null)
  return NextResponse.json({ answer, reply: answer })
}
