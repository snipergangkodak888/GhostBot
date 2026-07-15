import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const db = await getDb()
  const groups = await db.collection("opsHostedGroups").find({ status: "active" }).sort({ title: 1 }).toArray()
  return NextResponse.json({
    groups: groups
      .filter((group: any) => String(group.chatId || "").trim())
      .map((group: any) => ({
        chatId: String(group.chatId),
        title: String(group.title || group.chatId),
        type: String(group.type || "group"),
      })),
  })
}
