import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import ts from "typescript"

const require = createRequire(import.meta.url)

function loadTypeScriptModule(path, overrides = {}) {
  const source = fs.readFileSync(path, "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const localRequire = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id]
    if (id === "@/lib/revenue-types") return {
      REVENUE_CHAINS: ["ethereum", "base", "bnb", "robinhood", "solana"],
      REVENUE_WALLET_ROLES: ["revenue", "treasury"],
      isGlobalRevenueFeeType: (value) => ["fee_rebate", "sumo_ref_claim"].includes(String(value || "")),
    }
    if (id === "@/lib/db") return { getDb: async () => { throw new Error("Database access is not used by this unit test") } }
    if (id === "@/lib/team-timezone") return { teamDateKey: () => "2026-08-20" }
    return require(id)
  }
  vm.runInNewContext(`(function (exports, require, module, process, Buffer) { ${output}\n})(module.exports, require, module, process, Buffer)`, { module, require: localRequire, process, Buffer })
  return module.exports
}

function memoryDb(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, docs]) => [name, docs.map((doc) => structuredClone(doc))]))
  let nextId = 1
  const matches = (doc, filter = {}) => Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key]
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (Array.isArray(expected.$in)) return expected.$in.includes(actual)
      return false
    }
    return String(actual) === String(expected)
  })
  const collection = (name) => {
    if (!collections.has(name)) collections.set(name, [])
    const docs = collections.get(name)
    return {
      findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
      find: (filter = {}) => {
        let found = docs.filter((doc) => matches(doc, filter))
        const cursor = {
          sort(spec) {
            const [key, direction] = Object.entries(spec)[0]
            found = found.sort((a, b) => (a[key] > b[key] ? 1 : -1) * direction)
            return cursor
          },
          limit(count) {
            found = found.slice(0, Number(count || 0))
            return cursor
          },
          async toArray() { return found },
        }
        return cursor
      },
      insertOne: async (doc) => {
        const saved = { ...structuredClone(doc), _id: doc._id || `memory-${nextId++}` }
        docs.push(saved)
        return { insertedId: saved._id }
      },
      updateOne: async (filter, update) => {
        const doc = docs.find((row) => matches(row, filter))
        if (doc && update.$set) Object.assign(doc, structuredClone(update.$set))
        return { matchedCount: doc ? 1 : 0 }
      },
      deleteOne: async (filter) => {
        const index = docs.findIndex((row) => matches(row, filter))
        if (index < 0) return { deletedCount: 0 }
        docs.splice(index, 1)
        return { deletedCount: 1 }
      },
    }
  }
  return { collection, collections }
}

const evmWallet = "0x00000000000000000000000000000000000000aa"
const evmSender = "0x00000000000000000000000000000000000000bb"
const solanaWallet = "FPTgwwoMC4Qdc3DvDdz8PaNovn6hkQAdPH2nGRfsxiHh"
const treasuryWallet = "7u6Wj3VCLYfqW4qDw6jn4sGtNM5uv6CNX7FFiuhJomiA"
process.env.REVENUE_EVM_WALLET = evmWallet
process.env.REVENUE_SOLANA_WALLET = solanaWallet
process.env.REVENUE_SOLANA_TREASURY_WALLET = treasuryWallet
const parser = loadTypeScriptModule("lib/revenue-parser.ts")
const matching = loadTypeScriptModule("lib/revenue-matching.ts")
const quicknode = loadTypeScriptModule("lib/quicknode-revenue.ts")
const consolidation = loadTypeScriptModule("lib/revenue-consolidation.ts")
const consolidationCandidates = loadTypeScriptModule("lib/revenue-consolidation-candidates.ts")
const pricing = loadTypeScriptModule("lib/revenue-pricing.ts")
const explorer = loadTypeScriptModule("lib/revenue-explorer.ts")
const dust = loadTypeScriptModule("lib/revenue-dust.ts")
const allocations = loadTypeScriptModule("lib/revenue-allocations.ts")
const revenuePayroll = loadTypeScriptModule("lib/revenue-payroll.ts")
const payrollMisc = loadTypeScriptModule("lib/payroll-misc.ts")

assert.equal(explorer.revenueTransactionUrl("ethereum", "0xabc"), "https://etherscan.io/tx/0xabc")
assert.equal(explorer.revenueTransactionUrl("base", "0xabc"), "https://basescan.org/tx/0xabc")
assert.equal(explorer.revenueTransactionUrl("bnb", "0xabc"), "https://bscscan.com/tx/0xabc")
assert.equal(explorer.revenueTransactionUrl("robinhood", "0xabc"), "https://robinhoodchain.blockscout.com/tx/0xabc")
assert.equal(explorer.revenueTransactionUrl("solana", "sol-signature"), "https://solscan.io/tx/sol-signature")
assert.equal(dust.isRevenueReceiptDust({ direction: "incoming", amountUsd: 0.99 }, 1), true)
assert.equal(dust.isRevenueReceiptDust({ direction: "incoming", amountUsd: 1 }, 1), false)
assert.equal(dust.isRevenueReceiptDust({ direction: "outgoing", amountUsd: 0.01 }, 1), false)
assert.equal(dust.isRevenueReceiptDust({ direction: "incoming", amountUsd: null }, 1), false)

const partiallyAllocated = { amount: 0.716913, amountUsd: 501.59, allocations: [{ amount: 0.71464044, amountUsd: 500 }] }
assert.equal(allocations.receiptAllocatedAmount(partiallyAllocated), 0.71464044)
assert.ok(Math.abs(allocations.receiptAvailableAmount(partiallyAllocated) - 0.00227256) < 1e-12)
assert.ok(Math.abs(allocations.receiptAvailableUsd(partiallyAllocated) - 1.59) < 0.01)
assert.doesNotThrow(() => allocations.validateClassifiedAmount(0.00227256, allocations.receiptAvailableAmount(partiallyAllocated), "BNB"))
assert.throws(() => allocations.validateClassifiedAmount(0.716913, allocations.receiptAvailableAmount(partiallyAllocated), "BNB"), /Only 0.00227256 BNB remains available/)

const dailyOver = allocations.fixedFeeReceiptMetrics([{ amount: 0.716913, amountUsd: 501.59, allocations: [] }], 500)
assert.equal(dailyOver.withinTolerance, true)
assert.equal(dailyOver.actualReceivedUsd, 501.59)
assert.equal(dailyOver.conversionVarianceUsd, 1.59)
const dailyUnder = allocations.fixedFeeReceiptMetrics([{ amount: 5.140664, amountUsd: 489.51, allocations: [] }], 500)
assert.equal(dailyUnder.withinTolerance, true)
assert.equal(dailyUnder.actualReceivedUsd, 489.51)
assert.equal(dailyUnder.conversionVarianceUsd, -10.49)
assert.equal(allocations.fixedFeeReceiptMetrics([{ amount: 1, amountUsd: 450, allocations: [] }], 500).withinTolerance, false)

const receiptFirstDb = memoryDb({
  revenueReceipts: [{ _id: "sumo-receipt", date: "2026-08-23", provider: "manual", direction: "incoming", chain: "ethereum", asset: "ETH", amount: 0.2, amountUsd: 500, status: "unclassified", allocations: [], blockTime: "2026-08-23T12:00:00.000Z", createdAt: "2026-08-23T12:00:00.000Z" }],
})
const receiptFirstService = loadTypeScriptModule("lib/revenue-service.ts", {
  "@/lib/db": { getDb: async () => receiptFirstDb },
  "@/lib/team-timezone": { dateKeyInTimeZone: () => "2026-08-23", teamDateKey: () => "2026-08-23" },
  "@/lib/revenue-matching": matching,
  "@/lib/revenue-parser": parser,
  "@/lib/revenue-projects": { projectFeeConfig: () => ({ chain: "", quoteAssets: [], dailyTradingFeeEnabled: false, dailyTradingFeeUsd: 500 }) },
  "@/lib/revenue-types": { isGlobalRevenueFeeType: (value) => ["fee_rebate", "sumo_ref_claim"].includes(String(value || "")) },
  "@/lib/revenue-consolidation": { getConsolidation: async () => null },
  "@/lib/revenue-consolidation-candidates": { listConsolidationCandidates: async () => [] },
  "@/lib/revenue-pricing": { valueRevenueReceipt: async (receipt) => receipt },
  "@/lib/revenue-payroll": revenuePayroll,
  "@/lib/revenue-allocations": allocations,
})
const classifiedSumo = await receiptFirstService.classifyReceiptAsRevenue({ receiptId: "sumo-receipt", feeType: "sumo_ref_claim" })
assert.equal(classifiedSumo.status, "confirmed")
assert.equal(classifiedSumo.projectId, null)
assert.equal(receiptFirstDb.collections.get("revenueReceipts")[0].status, "allocated")
assert.equal(receiptFirstDb.collections.get("revenueFeeEvents").length, 1)
await receiptFirstService.undoManualRevenueClassification(classifiedSumo._id)
assert.equal(receiptFirstDb.collections.get("revenueFeeEvents").length, 0)
assert.equal(receiptFirstDb.collections.get("revenueReceipts")[0].status, "unclassified")
assert.equal(receiptFirstDb.collections.get("revenueFeeAudit")[0].action, "undo_manual_classification")

const lifecycleFeeDb = memoryDb({
  opsProjects: [{ _id: "kolcoin", name: "KOLcoin", status: "active", chain: "solana", quoteToken: "SOL", dailyTradingFeeEnabled: true, dailyTradingFeeUsd: 500, dailyFeeStartDate: "2026-08-25" }],
})
const lifecycleFeeService = loadTypeScriptModule("lib/revenue-service.ts", {
  "@/lib/db": { getDb: async () => lifecycleFeeDb },
  "@/lib/team-timezone": { dateKeyInTimeZone: () => "2026-08-24", teamDateKey: () => "2026-08-24" },
  "@/lib/revenue-matching": matching,
  "@/lib/revenue-parser": parser,
  "@/lib/revenue-projects": { projectFeeConfig: (project) => ({ chain: project.chain, quoteToken: project.quoteToken, quoteAssets: [project.quoteToken], dailyTradingFeeEnabled: project.dailyTradingFeeEnabled, dailyTradingFeeUsd: project.dailyTradingFeeUsd, liquidationFeeEnabled: true, liquidationFeePercentage: 5, launchFeeUsd: 1000 }) },
  "@/lib/revenue-types": { isGlobalRevenueFeeType: (value) => ["fee_rebate", "sumo_ref_claim"].includes(String(value || "")) },
  "@/lib/revenue-consolidation": { getConsolidation: async () => null },
  "@/lib/revenue-consolidation-candidates": { listConsolidationCandidates: async () => [] },
  "@/lib/revenue-pricing": { valueRevenueReceipt: async (receipt) => receipt },
  "@/lib/revenue-payroll": revenuePayroll,
  "@/lib/revenue-allocations": allocations,
})
assert.equal((await lifecycleFeeService.ensureDailyTradingFeeExpectations("2026-08-24")).created, 0)
assert.equal((await lifecycleFeeService.ensureDailyTradingFeeExpectations("2026-08-25")).created, 1)
assert.equal(lifecycleFeeDb.collections.get("revenueFeeEvents")[0].quoteAsset, "SOL")
assert.equal(lifecycleFeeDb.collections.get("revenueFeeEvents")[0].expectedUsd, 500)

const payrollAggregation = revenuePayroll.aggregateRevenueFeesForPayroll([
  { _id: "rebate-sol", feeType: "fee_rebate", chain: "solana", recognizedUsd: 100 },
  { _id: "rebate-bnb", feeType: "fee_rebate", chain: "bnb", recognizedUsd: 250 },
  { _id: "sumo-sol", feeType: "sumo_ref_claim", chain: "solana", recognizedUsd: 400 },
  { _id: "sumo-eth", feeType: "sumo_ref_claim", chain: "ethereum", recognizedUsd: 125 },
  { _id: "dev-wagie", feeType: "dev_allocation", projectId: "wagie", chain: "bnb", recognizedUsd: 75 },
], "2026-08-23")
assert.deepEqual(JSON.parse(JSON.stringify(payrollAggregation.devAllocations)), [
  { category: "fee_rebate", income: 350, sourceFeeEventIds: ["rebate-sol", "rebate-bnb"] },
  { category: "sumo_ref_claim", income: 525, sourceFeeEventIds: ["sumo-sol", "sumo-eth"] },
  { projectId: "wagie", category: "dev_allocation", income: 75, sourceFeeEventIds: ["dev-wagie"] },
])
assert.equal(payrollMisc.normalizeMiscIncomeCategory("sumo claim"), "sumo_ref_claim")
assert.equal(payrollMisc.miscIncomeProjectDisabled("sumo_ref_claim"), true)
assert.equal(payrollMisc.validateDevAllocations([{ category: "sumo_ref_claim", income: 500 }, { category: "sumo_ref_claim", income: 100 }]).length, 1)

const swapLegs = quicknode.classifyDeterministicInternalMovements([
  { _id: "swap-out", chain: "solana", walletRole: "revenue", wallet: solanaWallet, direction: "outgoing", transactionHash: "swap-tx", asset: "SOL", amount: 13.1501, amountUsd: 1254.67, status: "unclassified", allocations: [] },
  { _id: "swap-in", chain: "solana", walletRole: "revenue", wallet: solanaWallet, direction: "incoming", transactionHash: "swap-tx", asset: "USDC", amount: 1252.426666, amountUsd: 1252.426666, status: "unclassified", allocations: [] },
])
assert.ok(swapLegs.every((receipt) => receipt.status === "internal"))
assert.ok(swapLegs.every((receipt) => receipt.autoClassification === "same_transaction_swap"))
assert.ok(swapLegs.every((receipt) => receipt.notificationSuppressedReason === "internal_swap"))

const sameAssetTransfer = quicknode.classifyDeterministicInternalMovements([
  { chain: "solana", walletRole: "revenue", wallet: solanaWallet, direction: "outgoing", transactionHash: "same-asset", asset: "USDC", amount: 500, status: "unclassified", allocations: [] },
  { chain: "solana", walletRole: "revenue", wallet: solanaWallet, direction: "incoming", transactionHash: "same-asset", asset: "USDC", amount: 500, status: "unclassified", allocations: [] },
])
assert.ok(sameAssetTransfer.every((receipt) => receipt.status === "unclassified"))

const candidateReceipts = [
  { _id: "eth-out", direction: "outgoing", chain: "robinhood", asset: "ETH", amountUsd: 479.2 },
  { _id: "bnb-out", direction: "outgoing", chain: "bnb", asset: "BNB", amountUsd: 1351.42 },
  { _id: "sol-out", direction: "outgoing", chain: "solana", asset: "SOL", amountUsd: 1254.67 },
  { _id: "privacy-in-1", direction: "incoming", chain: "solana", asset: "USDC", amount: 476.952981, amountUsd: 476.952981 },
  { _id: "privacy-in-2", direction: "incoming", chain: "solana", asset: "USDC", amount: 1348.834899, amountUsd: 1348.834899 },
  { _id: "swap-in", direction: "incoming", chain: "solana", asset: "USDC", amount: 1252.426666, amountUsd: 1252.426666 },
]
const candidateMetrics = consolidationCandidates.consolidationCandidateMetrics(candidateReceipts, {
  sourceReceiptIds: ["eth-out", "bnb-out"],
  destinationReceiptIds: ["privacy-in-1", "privacy-in-2"],
  swapReceiptIds: ["sol-out", "swap-in"],
})
assert.equal(candidateMetrics.sourceUsd, 3085.29)
assert.equal(candidateMetrics.destinationUsd, 3078.21)
assert.equal(candidateMetrics.estimatedCostUsd, 7.08)
assert.equal(candidateMetrics.confidence, "high")

const candidateDb = memoryDb({
  revenueReceipts: [
    { _id: "source", date: "2026-08-20", chain: "bnb", walletRole: "revenue", direction: "outgoing", asset: "BNB", amount: 1.92, amountUsd: 1351.42, status: "unclassified", allocations: [], blockTime: "2026-08-20T12:00:00.000Z", createdAt: "2026-08-20T12:00:00.000Z" },
    { _id: "destination", date: "2026-08-20", chain: "solana", walletRole: "revenue", direction: "incoming", asset: "USDC", amount: 1348.834899, amountUsd: 1348.834899, status: "unclassified", allocations: [], blockTime: "2026-08-20T12:00:20.000Z", createdAt: "2026-08-20T12:00:20.000Z" },
  ],
})
const candidateState = loadTypeScriptModule("lib/revenue-consolidation-candidates.ts", { "@/lib/db": { getDb: async () => candidateDb } })
const sourceRecorded = await candidateState.recordPotentialConsolidation(candidateDb.collections.get("revenueReceipts")[0])
assert.equal(sourceRecorded.candidate.status, "collecting")
assert.equal(sourceRecorded.shouldNotify, false)
const destinationRecorded = await candidateState.recordPotentialConsolidation(candidateDb.collections.get("revenueReceipts")[1])
assert.equal(destinationRecorded.candidate.status, "suggested")
assert.equal(destinationRecorded.shouldNotify, true)
assert.equal(destinationRecorded.suppressRevenueNotification, true)
assert.equal(candidateDb.collections.get("revenueReceipts")[1].notificationSuppressedReason, "consolidation_candidate")
await candidateState.releaseConsolidationCandidateNotificationClaim(destinationRecorded.candidate._id)
assert.equal(candidateDb.collections.get("revenueConsolidationCandidates")[0].notificationClaimedAt, null)
candidateDb.collections.get("revenueReceipts").push({ _id: "destination-retry", date: "2026-08-20", chain: "solana", walletRole: "revenue", direction: "incoming", asset: "USDC", amount: 0.5, amountUsd: 0.5, status: "unclassified", allocations: [], blockTime: "2026-08-20T12:00:30.000Z", createdAt: "2026-08-20T12:00:30.000Z" })
const destinationRetry = await candidateState.recordPotentialConsolidation(candidateDb.collections.get("revenueReceipts")[2])
assert.equal(destinationRetry.shouldNotify, true)
await candidateState.markConsolidationCandidateNotified(destinationRecorded.candidate._id)
candidateDb.collections.get("revenueReceipts").push({ _id: "destination-later", date: "2026-08-20", chain: "solana", walletRole: "revenue", direction: "incoming", asset: "USDC", amount: 0.25, amountUsd: 0.25, status: "unclassified", allocations: [], blockTime: "2026-08-20T12:00:40.000Z", createdAt: "2026-08-20T12:00:40.000Z" })
const destinationLater = await candidateState.recordPotentialConsolidation(candidateDb.collections.get("revenueReceipts")[3])
assert.equal(destinationLater.shouldNotify, false)
await candidateState.confirmConsolidationCandidate(destinationRecorded.candidate._id, 12345)
assert.ok(candidateDb.collections.get("revenueReceipts").every((receipt) => receipt.status === "internal"))
assert.equal(candidateDb.collections.get("revenueConsolidationCandidates")[0].status, "confirmed")
assert.equal(candidateDb.collections.get("revenueConsolidationCandidates")[0].confirmedByTelegramId, 12345)

const telegramCalls = []
const revenueTelegram = loadTypeScriptModule("lib/revenue-telegram.ts", {
  "@/lib/db": { getDb: async () => memoryDb() },
  "@/lib/chat-subscriptions": { getSubscribedChats: async () => [{ chatId: "-100123", kind: "group", label: "Fees" }] },
  "@/lib/telegram-bot": {
    getTelegramBotToken: async () => "test-token",
    telegramApi: async (_token, method, body) => { telegramCalls.push({ method, body }); return { ok: true } },
  },
  "@/lib/revenue-projects": {
    CHAIN_LABELS: { ethereum: "Ethereum Mainnet", base: "Base", bnb: "BNB Smart Chain", robinhood: "Robinhood Chain", solana: "Solana" },
    projectFeeConfig: () => ({ chain: "solana", quoteAssets: ["SOL"], dailyTradingFeeEnabled: true, dailyTradingFeeUsd: 500 }),
  },
  "@/lib/revenue-explorer": { revenueTransactionUrl: (_chain, hash) => `https://explorer.test/${hash}` },
})
await revenueTelegram.notifyFeeInboxReceipt({ _id: "receipt-1", chain: "solana", direction: "incoming", asset: "SOL", amount: 5, amountUsd: 489.51, transactionHash: "tx-1", status: "unclassified" })
const receiptNotification = telegramCalls.at(-1).body
assert.match(receiptNotification.text, /New revenue-wallet receipt/)
assert.equal(receiptNotification.reply_markup.inline_keyboard[0][0].callback_data, "receipt:classify:receipt-1")
assert.equal(receiptNotification.reply_markup.inline_keyboard[0][1].callback_data, "fee:internal:receipt-1")
assert.ok(receiptNotification.reply_markup.inline_keyboard.flat().filter((button) => button.callback_data).every((button) => Buffer.byteLength(button.callback_data) <= 64))
await revenueTelegram.notifyConsolidationCandidate({ _id: "batch-1", sourceReceiptIds: ["source"], destinationReceiptIds: ["destination"], swapReceiptIds: [], sourceUsd: 500, destinationUsd: 496, estimatedCostUsd: 4, confidence: "high", receipts: [] })
const batchNotification = telegramCalls.at(-1).body
assert.match(batchNotification.text, /Possible internal consolidation/)
assert.equal(batchNotification.reply_markup.inline_keyboard[0][0].callback_data, "consol:view:batch-1")
assert.ok(Buffer.byteLength(`receipt:type:${"x".repeat(24)}:sumo_ref_claim`) <= 64)

const liquidation = parser.parseFeeMessage(`Cashout Summary:\nA total of 212,574 USDC was withdrawn from the MM balance\n200,050 USDC was sent here.\n12,524 USDC was taken for our 5% liquidations fee + privacy swap fee.`)
assert.equal(liquidation.feeType, "liquidation")
assert.equal(liquidation.grossAmount, 212574)
assert.equal(liquidation.expectedUsd, 10628.7)

const launch = parser.parseFeeMessage("We just removed $1K usd and 1% of supply for the tge fee")
assert.equal(launch.feeType, "launch")
assert.equal(launch.expectedUsd, 1000)
assert.equal(launch.ignoredSupplyPercentage, 1)

const daily = parser.parseFeeMessage("we just withdrew 500$ for the daily trading fee")
assert.equal(daily.feeType, "daily_trading")
assert.equal(daily.expectedUsd, 500)

assert.equal(parser.parseFeeMessage("2.5 SOL dev allocation").feeType, "dev_allocation")
assert.equal(parser.parseFeeMessage("$400 dev allocation for prime").expectedUsd, 400)
assert.equal(parser.parseFeeMessage("750 USDC fee collector").feeType, "fee_collector")
assert.equal(parser.parseFeeMessage("125 USDC fee rebate").feeType, "fee_rebate")
assert.equal(parser.parseFeeMessage("Claimed 900 USDC from the Sumo ref claim").feeType, "sumo_ref_claim")
const exactMmRevenue = parser.parseFeeMessage("We have taken $725 from the MM balance")
assert.equal(exactMmRevenue.feeType, "other")
assert.equal(exactMmRevenue.expectedUsd, 725)
assert.equal(exactMmRevenue.expectedAssetAmount, null)

const exactAssetMmRevenue = parser.parseFeeMessage("We took 2.5 SOL from the market maker balance")
assert.equal(exactAssetMmRevenue.feeType, "other")
assert.equal(exactAssetMmRevenue.expectedAssetAmount, 2.5)
assert.equal(exactAssetMmRevenue.grossAsset, "SOL")

const now = new Date().toISOString()
const receipts = [300, 100, 200].map((amount, index) => ({ _id: `r${index}`, direction: "incoming", chain: "base", asset: "USDC", amount, amountUsd: amount, status: "unclassified", allocations: [], blockTime: now }))
const match = matching.findReceiptCombination(receipts, { chain: "base", asset: "USDC", expectedAmount: 500, occurredAt: now })
assert.deepEqual(Array.from(match.receiptIds).sort(), ["r0", "r2"])

const eventTime = new Date("2026-08-21T12:40:00.000Z")
const privacyReceipts = Array.from({ length: 10 }, (_, index) => ({
  _id: `privacy-${index}`,
  direction: "incoming",
  chain: "bnb",
  asset: "BNB",
  amount: 0.05,
  amountUsd: 72.5,
  status: "unclassified",
  allocations: [],
  date: "2026-08-21",
  blockTime: new Date(eventTime.getTime() - (40 - index) * 60_000).toISOString(),
}))
const noiseReceipts = Array.from({ length: 120 }, (_, index) => ({
  _id: `noise-${index}`,
  direction: "incoming",
  chain: "bnb",
  asset: "BNB",
  amount: 0.001,
  amountUsd: 3.141,
  status: "unclassified",
  allocations: [],
  date: "2026-08-21",
  blockTime: new Date(eventTime.getTime() - (index + 1) * 5 * 60_000).toISOString(),
}))
const privacyMatch = matching.findReceiptCombination([...noiseReceipts, ...privacyReceipts], { chain: "bnb", asset: "BNB", expectedUsd: 725, occurredAt: eventTime.toISOString(), date: "2026-08-21" })
assert.equal(privacyMatch.receiptIds.length, 10)
assert.deepEqual(Array.from(privacyMatch.receiptIds).sort(), privacyReceipts.map((receipt) => receipt._id).sort())
assert.equal(privacyMatch.total, 725)

const body = JSON.stringify({ data: [{ transactionHash: "0xabc", from: evmSender, to: evmWallet, rawAmount: "500000000", decimals: 6, asset: "USDC", eventIndex: 0 }] })
const secret = "test-secret"
const nonce = "nonce"
const timestamp = String(Math.floor(Date.now() / 1000))
const signature = createHmac("sha256", secret).update(`${nonce}${timestamp}${body}`).digest("hex")
assert.equal(quicknode.verifyQuickNodeSignature({ body, secret, nonce, timestamp, signature }).ok, true)

const normalized = quicknode.normalizeQuickNodeRevenuePayload(JSON.parse(body), "base")
assert.equal(normalized.receipts.length, 1)
assert.equal(normalized.receipts[0].amount, 500)

// Literal minimized form of the live QuickNode evmWalletFilter transaction payload.
const evmNative = quicknode.normalizeQuickNodeRevenuePayload({
  matchingReceipts: null,
  matchingTransactions: [{
    to: evmWallet,
    from: evmSender,
    hash: "0xnative",
    value: "0x0de0b6b3a7640000",
    blockNumber: "0x10",
    blockTimestamp: "0x6a879a33",
    transactionIndex: "0x1",
  }],
}, "ethereum")
assert.equal(evmNative.receipts.length, 1)
assert.equal(evmNative.rejected, 0)
assert.equal(evmNative.receipts[0].asset, "ETH")
assert.equal(evmNative.receipts[0].amount, 1)
assert.equal(evmNative.receipts[0].direction, "incoming")
assert.equal(evmNative.receipts[0].counterparty, evmSender)
assert.equal(evmNative.receipts[0].blockTime, "2026-08-21T00:22:11.000Z")

// Literal minimized form of the live QuickNode evmWalletFilter receipt payload.
const addressTopic = (address) => `0x${address.slice(2).padStart(64, "0")}`
const erc20Topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const evmUsdc = quicknode.normalizeQuickNodeRevenuePayload({
  matchingTransactions: null,
  matchingReceipts: [{
    from: evmSender,
    to: "0x00000000000000000000000000000000000000cc",
    status: "0x1",
    transactionHash: "0xusdc",
    blockNumber: "0x11",
    logs: [{
      address: "0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913",
      topics: [erc20Topic, addressTopic(evmSender), addressTopic(evmWallet)],
      data: "0x000000000000000000000000000000000000000000000000000000001dcd6500",
      logIndex: "0x3",
      blockNumber: "0x11",
      blockTimestamp: "0x6a879a33",
      transactionHash: "0xusdc",
    }],
  }],
}, "base")
assert.equal(evmUsdc.receipts.length, 1)
assert.equal(evmUsdc.rejected, 0)
assert.equal(evmUsdc.receipts[0].asset, "USDC")
assert.equal(evmUsdc.receipts[0].amount, 500)
assert.equal(evmUsdc.receipts[0].amountUsd, 500)
assert.equal(evmUsdc.receipts[0].tokenAddress, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")

const unknownToken = quicknode.normalizeQuickNodeRevenuePayload({
  matchingTransactions: null,
  matchingReceipts: [{
    status: "0x1",
    transactionHash: "0xspam",
    logs: [{
      address: "0x00000000000000000000000000000000000000dd",
      topics: [erc20Topic, addressTopic(evmSender), addressTopic(evmWallet)],
      data: "0x1",
      logIndex: "0x4",
      transactionHash: "0xspam",
    }],
  }],
}, "ethereum")
assert.equal(unknownToken.receipts.length, 0)
assert.equal(unknownToken.rejected, 1)

const unrelatedLogs = Array.from({ length: 50 }, (_, index) => ({
  address: "0x00000000000000000000000000000000000000dd",
  topics: [erc20Topic, addressTopic(evmSender), addressTopic(`0x${String(index + 100).padStart(40, "0")}`)],
  data: "0x1",
  logIndex: `0x${index.toString(16)}`,
  transactionHash: "0xspam-batch",
}))
const noisyUnknownToken = quicknode.normalizeQuickNodeRevenuePayload({
  matchingTransactions: null,
  matchingReceipts: [{ status: "0x1", transactionHash: "0xspam-batch", logs: [...unrelatedLogs, unknownToken ? {
    address: "0x00000000000000000000000000000000000000dd",
    topics: [erc20Topic, addressTopic(evmSender), addressTopic(evmWallet)],
    data: "0x1",
    logIndex: "0xff",
    transactionHash: "0xspam-batch",
  } : null].filter(Boolean) }],
}, "robinhood")
assert.equal(noisyUnknownToken.receipts.length, 0)
assert.equal(noisyUnknownToken.rejected, 1)

const valuedUsdc = await pricing.valueRevenueReceipt({ asset: "USDC", amount: 321.45, blockTime: now })
assert.equal(valuedUsdc.amountUsd, 321.45)
assert.equal(valuedUsdc.priceUsd, 1)
assert.equal(valuedUsdc.priceSource, "stablecoin")

// Literal minimized form of the live QuickNode solanaWalletFilter block payload.
const solana = quicknode.normalizeQuickNodeRevenuePayload([{
  block: { slot: 440576613, blockTime: 1787272012 },
  transactions: [{
    wallets: [solanaWallet],
    raw: {
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1_000_000_000, 0],
        postBalances: [999_995_000, 2_000_000_000],
        preTokenBalances: [{
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          owner: solanaWallet,
          accountIndex: 1,
          uiTokenAmount: { amount: "0", decimals: 6, uiAmount: 0, uiAmountString: "0" },
        }],
        postTokenBalances: [{
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          owner: solanaWallet,
          accountIndex: 1,
          uiTokenAmount: { amount: "500000000", decimals: 6, uiAmount: 500, uiAmountString: "500" },
        }],
      },
      transaction: {
        message: { accountKeys: [{ pubkey: evmSender }, { pubkey: solanaWallet }] },
        signatures: ["sol-signature"],
      },
    },
  }],
}], "solana")
assert.equal(solana.receipts.length, 2)
assert.equal(solana.rejected, 0)
assert.deepEqual(Array.from(solana.receipts.map((receipt) => [receipt.asset, receipt.amount])), [["SOL", 2], ["USDC", 500]])
assert.ok(solana.receipts.every((receipt) => receipt.direction === "incoming"))
assert.equal(solana.receipts.find((receipt) => receipt.asset === "USDC").amountUsd, 500)

const failedSolana = quicknode.normalizeQuickNodeRevenuePayload([{
  block: { slot: 1, blockTime: 1787272012 },
  transactions: [{ wallets: [solanaWallet], raw: { meta: { err: { InstructionError: [0, "Custom"] } }, transaction: { signatures: ["failed"] } } }],
}], "solana")
assert.equal(failedSolana.receipts.length, 0)
assert.equal(failedSolana.rejected, 1)

const treasuryIncoming = quicknode.normalizeQuickNodeRevenuePayload([{
  block: { slot: 440576614, blockTime: 1787272013 },
  transactions: [{
    wallets: [treasuryWallet],
    raw: {
      meta: {
        err: null,
        preBalances: [1_000_000, 1_000_000],
        postBalances: [995_000, 1_000_000],
        preTokenBalances: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", owner: treasuryWallet, accountIndex: 1, uiTokenAmount: { amount: "0", decimals: 6 } }],
        postTokenBalances: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", owner: treasuryWallet, accountIndex: 1, uiTokenAmount: { amount: "1000000000", decimals: 6 } }],
      },
      transaction: { message: { accountKeys: [{ pubkey: evmSender }, { pubkey: treasuryWallet }] }, signatures: ["treasury-signature"] },
    },
  }],
}], "solana", "treasury")
assert.equal(treasuryIncoming.walletRole, "treasury")
assert.equal(treasuryIncoming.receipts.length, 1)
assert.equal(treasuryIncoming.receipts[0].wallet, treasuryWallet)
assert.equal(treasuryIncoming.receipts[0].walletRole, "treasury")
assert.equal(treasuryIncoming.receipts[0].status, "internal")
assert.equal(treasuryIncoming.receipts[0].asset, "USDC")
assert.equal(treasuryIncoming.receipts[0].amount, 1000)
assert.equal(treasuryIncoming.receipts[0].amountUsd, 1000)

const treasuryOutgoing = quicknode.normalizeQuickNodeRevenuePayload([{
  block: { slot: 440576615, blockTime: 1787272014 },
  transactions: [{
    wallets: [treasuryWallet],
    raw: {
      meta: {
        err: null,
        preBalances: [1_000_000],
        postBalances: [995_000],
        preTokenBalances: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", owner: treasuryWallet, accountIndex: 0, uiTokenAmount: { amount: "1000000000", decimals: 6 } }],
        postTokenBalances: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", owner: treasuryWallet, accountIndex: 0, uiTokenAmount: { amount: "500000000", decimals: 6 } }],
      },
      transaction: { message: { accountKeys: [{ pubkey: treasuryWallet }] }, signatures: ["payroll-signature"] },
    },
  }],
}], "solana", "treasury")
assert.equal(treasuryOutgoing.receipts.length, 0)
assert.equal(treasuryOutgoing.rejected, 0)

assert.equal(consolidation.consolidationPairMatches(
  { chain: "solana", asset: "USDC", direction: "outgoing", transactionHash: "same-tx", amount: 1000, walletRole: "revenue" },
  { chain: "solana", asset: "USDC", direction: "incoming", transactionHash: "same-tx", amount: 1000, walletRole: "treasury" },
), true)
assert.equal(consolidation.consolidationPairMatches(
  { chain: "solana", asset: "USDC", direction: "outgoing", transactionHash: "tx-a", amount: 1000, walletRole: "revenue" },
  { chain: "solana", asset: "USDC", direction: "incoming", transactionHash: "tx-b", amount: 1000, walletRole: "treasury" },
), false)

console.log("Revenue automation tests passed")
