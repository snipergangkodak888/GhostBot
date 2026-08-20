import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import ts from "typescript"

const require = createRequire(import.meta.url)

function loadTypeScriptModule(path) {
  const source = fs.readFileSync(path, "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const localRequire = (id) => id === "@/lib/revenue-types"
    ? { REVENUE_CHAINS: ["ethereum", "base", "bnb", "robinhood", "solana"] }
    : require(id)
  vm.runInNewContext(`(function (exports, require, module, process, Buffer) { ${output}\n})(module.exports, require, module, process, Buffer)`, { module, require: localRequire, process, Buffer })
  return module.exports
}

process.env.REVENUE_EVM_WALLET = "0xwallet"
const parser = loadTypeScriptModule("lib/revenue-parser.ts")
const matching = loadTypeScriptModule("lib/revenue-matching.ts")
const quicknode = loadTypeScriptModule("lib/quicknode-revenue.ts")

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
assert.equal(parser.parseFeeMessage("750 USDC fee collector").feeType, "fee_collector")
assert.equal(parser.parseFeeMessage("125 USDC fee rebate").feeType, "fee_rebate")

const now = new Date().toISOString()
const receipts = [300, 100, 200].map((amount, index) => ({ _id: `r${index}`, direction: "incoming", chain: "base", asset: "USDC", amount, amountUsd: amount, status: "unclassified", allocations: [], blockTime: now }))
const match = matching.findReceiptCombination(receipts, { chain: "base", asset: "USDC", expectedAmount: 500, occurredAt: now })
assert.deepEqual(Array.from(match.receiptIds).sort(), ["r0", "r2"])

const body = JSON.stringify({ data: [{ transactionHash: "0xabc", from: "0xsender", to: "0xwallet", rawAmount: "500000000", decimals: 6, asset: "USDC", eventIndex: 0 }] })
const secret = "test-secret"
const nonce = "nonce"
const timestamp = String(Math.floor(Date.now() / 1000))
const signature = createHmac("sha256", secret).update(`${nonce}${timestamp}${body}`).digest("hex")
assert.equal(quicknode.verifyQuickNodeSignature({ body, secret, nonce, timestamp, signature }).ok, true)

const normalized = quicknode.normalizeQuickNodeRevenuePayload(JSON.parse(body), "base")
assert.equal(normalized.receipts.length, 1)
assert.equal(normalized.receipts[0].amount, 500)

console.log("Revenue automation tests passed")
