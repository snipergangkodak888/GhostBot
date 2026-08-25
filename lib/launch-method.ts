export const LAUNCH_METHODS = [
  { id: "sumo", label: "Sumo" },
  { id: "senzu_plugin", label: "Senzu plugin" },
  { id: "other_mm_plugin", label: "Other MM plugin" },
] as const

export type LaunchMethod = (typeof LAUNCH_METHODS)[number]["id"]

export function normalizeLaunchMethod(value: unknown): LaunchMethod | "" {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (normalized === "sumo") return "sumo"
  if (["senzu", "senzu_plugin", "launch_dev_plugin", "dev_plugin"].includes(normalized)) return "senzu_plugin"
  if (["other_mm", "other_mm_plugin", "mm_plugin", "external_mm_plugin"].includes(normalized)) return "other_mm_plugin"
  return ""
}

export function inferLaunchMethod(value: unknown): LaunchMethod | "" {
  const text = String(value || "")
  if (/\b(?:senzu(?:\s+plugin)?|launch\s+dev\s+plugin|dev\s+plugin)\b/i.test(text)) return "senzu_plugin"
  if (/\b(?:other|external|third[-\s]?party)\s+mm\s+plugin\b/i.test(text)) return "other_mm_plugin"
  if (/\bsumo(?:\s+launch)?\b/i.test(text)) return "sumo"
  return ""
}

export function launchMethodLabel(value: unknown) {
  const normalized = normalizeLaunchMethod(value)
  return LAUNCH_METHODS.find((method) => method.id === normalized)?.label || "Not selected"
}
