import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

const require = createRequire(import.meta.url)
const modules = new Map()
const wallet = "0xc288d2b436c4ae29913c6f094fc502ff4dc3bcb6"
const sender = "0x0000000000000000000000000000000000000123"
process.env.REVENUE_EVM_WALLET = wallet
function load(path) {
  if (modules.has(path)) return modules.get(path).exports
  const module = { exports: {} }
  modules.set(path, module)
  const source = fs.readFileSync(path, "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const localRequire = (id) => {
    if (id === "@/lib/db") return { getDb: () => { throw new Error("Arc unit tests must not access a database") } }
    return id.startsWith("@/") ? load(`${id.slice(2)}.ts`) : require(id)
  }
  vm.runInNewContext(`(function(exports, require, module) { ${code}\n})(module.exports, require, module)`, { module, require: localRequire, process, Buffer, Intl, Date, URL, fetch })
  return module.exports
}
const qn = load("lib/quicknode-revenue.ts")
const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const topicAddress = (address) => `0x${address.slice(2).padStart(64, "0")}`
function log(amount = 500n, index = 1, from = sender, to = wallet, mirror = false) {
  return { address: mirror ? qn.ARC_USDC_CONTRACT : qn.ARC_USDC_SYSTEM_EMITTER, topics: [topic, topicAddress(from), topicAddress(to)], data: `0x${(amount * 10n ** (mirror ? 6n : 18n)).toString(16)}`, logIndex: `0x${index.toString(16)}`, transactionHash: "0xarc" }
}
function payload(logs, status = "0x1") {
  return { matchingTransactions: [{ hash: "0xarc", value: `0x${(500n * 10n ** 18n).toString(16)}`, from: sender, to: wallet }], matchingReceipts: [{ transactionHash: "0xarc", status, blockTimestamp: "0x6a879a33", logs }] }
}
const normalize = (data) => qn.normalizeQuickNodeRevenuePayload(data, "arc-mainnet")
assert.equal(qn.cleanWebhookChain("arc-mainnet"), "arc")
assert.equal(qn.cleanWebhookChain("arc-testnet"), null)
for (const logs of [[log()], [log(), log(500n, 2, sender, wallet, true)]]) {
  const result = normalize(payload(logs))
  assert.equal(result.receipts.length, 1)
  assert.equal(result.rejected, 0)
  const receipt = result.receipts[0]
  assert.equal(receipt.asset, "USDC")
  assert.equal(receipt.amount, 500)
  assert.equal(receipt.amountUsd, 500)
  assert.equal(receipt.decimals, 18)
  assert.equal(receipt.tokenAddress, null)
  assert.equal(receipt.blockTime, "2026-08-21T00:22:11.000Z")
  assert.equal(receipt.eventKey, normalize(payload(logs)).receipts[0].eventKey)
}
const multiple = normalize(payload([log(200n), log(200n, 2, sender, wallet, true), log(300n, 3), log(300n, 4, sender, wallet, true)]))
assert.equal(multiple.receipts.length, 2)
assert.equal(multiple.receipts.reduce((sum, receipt) => sum + receipt.amount, 0), 500)
assert.notEqual(multiple.receipts[0].eventKey, multiple.receipts[1].eventKey)
assert.equal(normalize(payload([log()], "0x0")).receipts.length, 0)
assert.equal(normalize(payload([log()], null)).receipts.length, 0)
assert.equal(normalize(payload([{ ...log(), removed: true }])).receipts.length, 0)
assert.equal(normalize(payload([{ ...log(), logIndex: undefined }])).receipts.length, 0)
assert.equal(normalize(payload([log(0n)])).receipts.length, 0)
assert.equal(normalize(payload([log(500n, 1, wallet, wallet)])).receipts.length, 0)
assert.equal(normalize(payload([log(500n, 1, sender, sender)])).receipts.length, 0)
const outgoing = normalize(payload([log(400n, 1, wallet, sender)]))
assert.equal(outgoing.receipts[0].direction, "outgoing")
assert.equal(outgoing.receipts[0].amountUsd, 400)
const partial = normalize(payload([log(500n, 2, sender, wallet, true)]))
assert.equal(partial.receipts.length, 0)
assert.equal(partial.rejected, 1)
assert.equal(normalize({ matchingTransactions: payload([]).matchingTransactions }).receipts.length, 0)
assert.equal(normalize({ data: [{ to: wallet, asset: "ETH", amount: 500, hash: "0xarc" }] }).receipts.length, 0)
const precision = normalize(payload([{ ...log(), data: `0x${(213497478n * 10n ** 12n).toString(16)}` }]))
assert.equal(precision.receipts[0].amount, 213.497478)
const projects = load("lib/revenue-projects.ts")
assert.equal(projects.cleanRevenueChain("arc"), "arc")
assert.deepEqual(Array.from(projects.DEFAULT_CHAIN_ASSETS.arc), ["USDC"])
assert.equal(projects.projectAcceptsReceipt({ chain: "arc", quoteToken: "USDC" }, normalize(payload([log()])).receipts[0]), true)
assert.equal(load("lib/revenue-explorer.ts").revenueTransactionUrl("arc", "0xabc"), "https://explorer.arc.io/tx/0xabc")
const venues = load("lib/launch-venues.ts")
assert.deepEqual(Array.from(venues.operationalVenuesForChain("arc"), (venue) => venue.id), ["uni-arc-v3", "argus"])
assert.ok(venues.operationalVenuesForChain("arc").every((venue) => venue.symbol === "USDC" && !venue.calculatorSupported))
assert.equal(load("lib/launch-math.ts").padsForChain("arc").length, 0)
const setup = load("lib/launch-setup.ts")
assert.equal(setup.launchChainConfig("arc").nativeQuoteToken, "USDC")
assert.equal(setup.launchChainIdForProject("arc"), "arc")
assert.deepEqual(Array.from(setup.launchQuoteTokensForChain("arc")), ["USDC"])
assert.ok(setup.launchChainButtons("test").flat().some((button) => button.callback_data.endsWith(":arc")))
assert.equal(setup.launchVenueButtons("test", "arc").length, 2)
for (const id of ["uni-arc-v3", "argus"]) {
  const selection = setup.launchVenueSelection(id)
  assert.equal(selection.chain, "arc")
  assert.equal(selection.quoteToken, "USDC")
  assert.equal(setup.launchSetupReady({ name: "Arc Test", launchAt: "2026-09-17T18:00:00Z", launchMethod: "sumo", referrerStatus: "none", ...selection }), true)
}
const changes = setup.launchProjectChainChanges({ chain: "solana", launchVenue: "pumpfun", quoteToken: "SOL", quoteTokenAddress: "old" }, "arc")
assert.equal(changes.launchVenue, "")
assert.equal(changes.quoteTokenAddress, "")
assert.equal(changes.quoteToken, "USDC")
assert.deepEqual(Array.from(changes.acceptedRevenueAssets), ["USDC"])
const lifecycle = load("lib/project-lifecycle.ts")
assert.equal(lifecycle.cleanLaunchProjectNameFromRequest("Alpha on Arc univ3", "Alpha on Arc univ3 launch tomorrow"), "Alpha")
for (const label of ["Uniswap V3", "univ3", "uni v3"]) {
  const inferred = lifecycle.inferLaunchConfiguration(`Schedule Alpha on Arc mainnet ${label}`)
  assert.equal(inferred.chain, "arc")
  assert.equal(inferred.launchVenue, "uni-arc-v3")
  assert.equal(inferred.quoteToken, "USDC")
}
assert.equal(lifecycle.inferLaunchConfiguration("Alpha on Argus").chain, "arc")
assert.equal(lifecycle.inferLaunchConfiguration("Alpha on Argus").launchVenue, "argus")
assert.notEqual(lifecycle.inferLaunchConfiguration("Alpha on Base Uniswap V3").launchVenue, "uni-arc-v3")
console.log("PASS: Arc USDC precision, canonical events, mirror deduplication, split transfers, failure handling, project matching, launch configuration and venue parsing.")

if (process.argv.includes("--live")) {
  const url = process.env.REVENUE_ARC_RPC_URL || "https://rpc.quicknode.mainnet.arc.io"
  async function rpc(method, params) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Arc RPC returned HTTP ${response.status}`)
    const body = await response.json()
    if (body.error) throw new Error(`Arc RPC ${method}: ${body.error.message}`)
    return body.result
  }
  assert.equal(Number(BigInt(await rpc("eth_chainId", []))), 5042)
  const latest = BigInt(await rpc("eth_blockNumber", []))
  const logs = await rpc("eth_getLogs", [{ fromBlock: `0x${(latest - 20n).toString(16)}`, toBlock: `0x${latest.toString(16)}`, address: qn.ARC_USDC_SYSTEM_EMITTER, topics: [topic] }])
  const sample = logs.find((entry) => entry.topics.length === 3 && BigInt(entry.data) > 0n)
  if (!sample) throw new Error("No recent Arc system transfer found; live transfer validation remains incomplete")
  const receipt = await rpc("eth_getTransactionReceipt", [sample.transactionHash])
  const transaction = await rpc("eth_getTransactionByHash", [sample.transactionHash])
  process.env.REVENUE_EVM_WALLET = `0x${sample.topics[2].slice(-40)}`
  modules.delete("lib/quicknode-revenue.ts")
  const live = load("lib/quicknode-revenue.ts").normalizeQuickNodeRevenuePayload({ matchingTransactions: [transaction], matchingReceipts: [receipt] }, "arc")
  const canonical = receipt.logs.filter((entry) => entry.address.toLowerCase() === qn.ARC_USDC_SYSTEM_EMITTER && entry.topics[0] === topic && entry.topics.slice(1).some((value) => `0x${value.slice(-40)}` === process.env.REVENUE_EVM_WALLET))
  assert.ok(live.receipts.length > 0)
  assert.equal(live.receipts.filter((entry) => entry.asset === "USDC").length, canonical.length)
  assert.ok(live.receipts.filter((entry) => entry.asset === "USDC").every((entry) => entry.amountUsd === entry.amount))
  console.log(`PASS: live Arc mainnet chain ID 5042 and ${canonical.length} canonical USDC movement(s), without saving receipts or moving funds.`)
}
