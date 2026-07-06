import type { PayrollDailyReport } from "@/lib/payroll-daily-report"
import { renderPayrollReportSvg } from "@/lib/payroll-report-svg"

export function renderPayrollReportHtml(report: PayrollDailyReport) {
  const svg = renderPayrollReportSvg(report)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GHOST Daily Income + Expenses — ${report.displayDate}</title>
  <style>
    body { margin: 0; background: #ececec; display: flex; justify-content: center; padding: 24px; }
  </style>
</head>
<body>${svg}</body>
</html>`
}
