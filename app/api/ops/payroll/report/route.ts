import { NextResponse } from "next/server"
import { loadDailyPayrollReport } from "@/lib/payroll-daily-report"
import { renderPayrollReportHtml } from "@/lib/payroll-report-html"
import { renderPayrollReportPng } from "@/lib/payroll-report-image"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const date = String(url.searchParams.get("date") || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const format = String(url.searchParams.get("format") || "html").toLowerCase()

  const report = await loadDailyPayrollReport(date)
  if (!report) {
    return NextResponse.json({ error: "No payroll day saved for that date" }, { status: 404 })
  }

  const html = renderPayrollReportHtml(report)

  if (format === "png") {
    try {
      const png = await renderPayrollReportPng(report)
      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `inline; filename="ghost-payroll-${date}.png"`,
          "Cache-Control": "no-store",
        },
      })
    } catch (error) {
      console.error("[payroll-report] PNG render failed:", error instanceof Error ? error.message : error)
      return NextResponse.json({ error: "PNG rendering failed" }, { status: 503 })
    }
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
