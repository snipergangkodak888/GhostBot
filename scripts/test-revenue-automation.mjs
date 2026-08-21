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
  const localRequire = (id) => {
    if (id === "@/lib/revenue-types") return { REVENUE_CHAINS: ["ethereum", "base", "bnb", "robinhood", "solana"], REVENUE_WALLET_ROLES: ["revenue", "treasury"] }
    if (id === "@/lib/db") return { getDb: async () => { throw new Error("Database access is not used by this unit test") } }
    if (id === "@/lib/team-timezone") return { teamDateKey: () => "2026-08-20" }
    return require(id)
  }
  vm.runInNewContext(`(function (exports, require, module, process, Buffer) { ${output}\n})(module.exports, require, module, process, Buffer)`, { module, require: localRequire, process, Buffer })
  return module.exports
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
