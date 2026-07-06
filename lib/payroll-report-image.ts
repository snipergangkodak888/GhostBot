import type { PayrollDailyReport } from "@/lib/payroll-daily-report"
import { renderPayrollReportSvg, PAYROLL_REPORT_WIDTH } from "@/lib/payroll-report-svg"
import { existsSync } from "node:fs"

export { PAYROLL_REPORT_WIDTH }

function payrollReportFontFiles() {
  const candidates = [
    String(process.env.PAYROLL_REPORT_FONT_PATH || "").trim(),
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ].filter(Boolean)

  return candidates.filter((path, index) => candidates.indexOf(path) === index && existsSync(path))
}

export async function renderPayrollReportPng(report: PayrollDailyReport): Promise<Buffer> {
  const svg = renderPayrollReportSvg(report)
  const { Resvg } = await import("@resvg/resvg-js")
  const fontFiles = payrollReportFontFiles()

  const resvg = new Resvg(svg, {
    font: {
      fontFiles,
      defaultFontFamily: "Arial",
      sansSerifFamily: "Arial",
      defaultFontSize: 11,
    },
  })
  return Buffer.from(resvg.render().asPng())
}

export async function renderPayrollReportImage(report: PayrollDailyReport) {
  return renderPayrollReportPng(report)
}
