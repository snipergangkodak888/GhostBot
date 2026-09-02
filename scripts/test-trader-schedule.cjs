const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const path = require("node:path")
const ts = require("typescript")

const projectRoot = path.resolve(__dirname, "..")
const originalResolve = Module._resolveFilename
Module._resolveFilename = function scheduleTestResolve(request, parent, isMain, options) {
  if (request.startsWith("@/")) request = path.join(projectRoot, request.slice(2))
  return originalResolve.call(this, request, parent, isMain, options)
}
require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  module._compile(output, filename)
}

function loadTypeScriptModule(filename, overrides = {}) {
  const source = fs.readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const loaded = new Module(filename)
  const originalLoad = loaded.require.bind(loaded)
  loaded.require = (id) => Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : originalLoad(id)
  loaded._compile(output, filename)
  return loaded.exports
}

const { compileSchedule, defaultWeekPayload, scheduleWeekStart } = require("../lib/trader-schedule.ts")
const { DEFAULT_TRADERS } = require("../lib/trader-schedule.ts")
const { renderTraderScheduleSvg } = require("../lib/trader-schedule-image.ts")

const weekStart = "2026-08-24"
const seeded = defaultWeekPayload(weekStart)
const compiled = compileSchedule(weekStart, seeded, DEFAULT_TRADERS)
assert.equal(compiled.issues.filter((issue) => issue.severity === "error").length, 0, "seed schedule must have complete admin coverage")
assert.ok(compiled.coverageSlices.length > 20, "coverage compiler should create handoff slices")
assert.ok(compiled.issues.some((issue) => issue.code === "solo_coverage"), "seed should expose solo intervals")
assert.equal(compiled.hoursByTrader.bands, 64, "weekday plus 12-hour weekend Bands shifts should be counted")
assert.equal(scheduleWeekStart(new Date("2026-08-27T17:00:00Z")), weekStart)

const missingBands = { assignments: seeded.assignments.filter((row) => row.id !== "2026-08-24-bands") }
const broken = compileSchedule(weekStart, missingBands, DEFAULT_TRADERS)
assert.ok(broken.issues.some((issue) => issue.code === "admin_gap" && issue.severity === "error"), "removing an admin shift must block publishing")

const ineligible = compileSchedule(weekStart, { assignments: [...seeded.assignments, { id: "bad-admin", traderId: "ray", date: weekStart, startMinute: 100, endMinute: 200, roles: ["admin"] }] }, DEFAULT_TRADERS)
assert.ok(ineligible.issues.some((issue) => issue.code === "admin_ineligible"), "non-admin traders cannot satisfy admin coverage")

const svg = renderTraderScheduleSvg(weekStart, 3, compiled, DEFAULT_TRADERS)
assert.match(svg, /Ghost Trader Schedule/)
assert.match(svg, /Published revision 3/)
assert.match(svg, /Saturday/)

const rosterWithTelegram = DEFAULT_TRADERS.map((row) => row.id === "ray" ? { ...row, telegramId: 123 } : row)
const telegramFormatting = loadTypeScriptModule("lib/trader-schedule-telegram.ts", {
  "@/lib/trader-schedule": require("../lib/trader-schedule.ts"),
  "@/lib/trader-schedule-store": {
    ensureTraderRoster: async () => rosterWithTelegram,
    getScheduleWeek: async () => ({ weekStart, publishedRevision: 3, published: compiled, draft: compiled }),
  },
})

Promise.all([
  telegramFormatting.formatCurrentTraderShift(new Date("2026-08-27T18:00:00Z")),
  telegramFormatting.formatTraderShiftDay("2026-08-27"),
  telegramFormatting.formatMyTraderShifts(123),
]).then(([currentText, dayText, myText]) => {
  assert.match(currentText, /Admin: Litwick/)
  assert.match(currentText, /Trading: Litwick \+ Ray/)
  assert.match(dayText, /Thursday, August 27/)
  assert.match(myText, /Ray · My shifts/)
  console.log("Trader schedule compiler tests passed")
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
