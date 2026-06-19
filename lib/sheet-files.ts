export type SheetValues = string[][]

export function parseCsv(text: string): SheetValues {
  const rows: SheetValues = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (quoted && char === '"' && next === '"') {
      cell += '"'
      i++
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i++
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ""
      continue
    }
    cell += char
  }

  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

export function stringifyCsv(values: SheetValues) {
  return values
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "")
          return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(","),
    )
    .join("\n")
}

export function normalizeSheetValues(input: unknown): SheetValues {
  if (!Array.isArray(input)) return []
  return input.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [String(row ?? "")])
}

export function defaultSheetValues(rows = 12, cols = 6): SheetValues {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""))
}
