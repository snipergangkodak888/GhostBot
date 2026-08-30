export function reminderText(reminder: any) {
  return String(reminder?.text || reminder?.title || reminder?.message || "").trim()
}

export function reminderWriteText(input: any) {
  return String(input?.text || input?.title || input?.message || "").trim()
}
