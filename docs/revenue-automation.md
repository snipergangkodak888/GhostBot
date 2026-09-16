# Revenue and payroll automation

This workflow automates evidence gathering and accounting preparation. It never signs a swap, bridge, treasury transfer, or payroll payment.

## Daily flow

1. Configure each existing project in Admin → Projects with its chain, trading-pair quote token, **accepted revenue assets** (for example `SOL, USDC`), and whether the daily trading fee applies. The accepted assets do not change the trading pair. Existing projects retain their previous asset settings until explicitly edited.
2. The operations cron creates one idempotent $500 daily-fee expectation for every eligible active project. Do not forward ordinary daily-fee messages; the wallet receipt is still required.
3. QuickNode watches the public revenue wallets. Every incoming and outgoing transfer is stored once by chain, transaction hash, event index, direction, asset, and wallet.
4. For liquidation or launch context, an admin forwards the standardized client message to the private Fee Inbox Telegram chat.
5. The bot parses the message deterministically. Supply percentages and privacy-swap fees are ignored. Liquidation revenue is always recalculated from the gross cashout using the project's configured percentage (default 5%).
6. Telegram never creates a project. The admin chooses an existing configured project, chooses the received asset only when the message is ambiguous, and confirms the expectation. Project search distinguishes inactive projects, missing chain configuration, and unsupported receipt assets.
7. Receipt matching can combine several transactions. Telegram and Admin → Revenue Inbox show the individual transaction links, combined available amount, expected amount, shortfall/excess, and arrival span before an admin accepts the batch. Receipts may arrive before or after the cashout message. Use **Search receipts** to refresh a waiting card.
   Test, duplicate, or mistaken fee entries can be ignored; a legitimately uncollected expected fee can be explicitly waived. Either action releases any reserved receipt.
8. Native-token receipts can be given a manual USD valuation. This is explicit and auditable; the system does not silently guess a historical price.
9. At the end of the day, the admin performs swaps and bridges manually. They enter the actual final Solana USDC in Revenue Inbox and preview the discrepancy.
10. Finalization is blocked until every fee expectation is resolved, every incoming receipt is classified, and every confirmed native receipt has a USD value.
11. On confirmation, the discrepancy is spread proportionally across liquidation revenue only. Daily trading, launch cash, and dev-allocation revenue remain fixed.
12. Admin → Payroll → Import Verified Revenue remains locked until reconciliation is final. It replaces only previously imported revenue rows; manually entered payroll rows and payout execution remain untouched.

## Repeat forwards and receipt batches

- Re-forwarding the same original cashout in the fee chat reopens its existing expectation, proposal, or confirmed result. Original sender metadata, original timestamp, and case-preserved content distinguish it from an unrelated cashout of the same amount. Telegram's hidden-source metadata does not identify the project.
- Creation uses a stable ID and a database insert-only operation, so simultaneous delivery/retry cannot overwrite an existing fee. Pre-existing forwards are recognized by original date and exact normalized content within the same fee chat. Without original metadata, only retries of the same destination message are safely deduplicated; a copied/edited message is not guaranteed to match.
- The matcher searches same-day, same-chain, same-asset receipts, prioritizing nearby arrivals. It considers time clusters (20-minute gaps) as well as the wider day's receipts; up to 250 eligible candidates and 50 parts per proposed fee. Search is bounded, not exhaustive for arbitrarily large or ambiguous batches.
- A proposal is only a suggestion: timing and totals cannot prove attribution through privacy services. Normal amount tolerance is 0.5% (with the existing USD-target minimum of $2). An admin must accept the batch. Over-tolerance or ambiguous cases can be reviewed with exact receipt selection in the app.
- Treasury receipts, internal movements, pending consolidation legs, reserved/allocated receipts, and mixed token contracts cannot be combined as new revenue.
- Daily receipt-first classification supports any configured accepted revenue asset, reuses the day's scheduled fee, and preserves the fixed $500 amount with a separate actual-receipt variance. It does not add another daily fee.

## QuickNode delivery setup

Create one signed wallet webhook/stream per network. Point each delivery at the same endpoint with a chain query:

- `/api/webhooks/quicknode/revenue?chain=ethereum`
- `/api/webhooks/quicknode/revenue?chain=base`
- `/api/webhooks/quicknode/revenue?chain=bnb`
- `/api/webhooks/quicknode/revenue?chain=robinhood`
- `/api/webhooks/quicknode/revenue?chain=solana`
- `/api/webhooks/quicknode/revenue?chain=arc` (`arc-mainnet`, chain ID 5042)

Filter EVM activity to `REVENUE_EVM_WALLET` and Solana activity to `REVENUE_SOLANA_WALLET`. Configure the same HMAC secret in QuickNode and `QUICKNODE_WEBHOOK_SECRET`. Production rejects unsigned or stale deliveries.

The normalizer accepts a single event or an array under `data`, `result`, or `events`. Each transfer should contain transaction hash/signature, from, to, amount (or raw amount plus decimals), asset symbol, block time, and event/log/instruction index. Unknown payload shapes are retained in the webhook delivery audit and are not counted as revenue.

### Arc mainnet

Arc uses the same EVM revenue wallet, QuickNode `evmWalletFilter` template, and signed delivery secret. Native USDC has **18 decimals**, while its ERC-20 interface has **6 decimals**. They represent one balance, not two assets.

Revenue receipt/fee/delivery lookups apply known scalar filters in Supabase before the API response cap and paginate by document ID when necessary. This prevents missing records beyond the first 1,000. New receipts use stable event-derived IDs with insert-only conflict handling, so simultaneous retries cannot duplicate a receipt or reset its allocations. Legacy receipt IDs are still recognized by event key. No existing accounting rows are rewritten by this change.

After deployment, `node scripts/setup-arc-webhook.mjs` checks for an existing listener; add `--apply` to create one only when absent. Supply `QUICKNODE_API_KEY`, `QUICKNODE_WEBHOOK_SECRET`, `REVENUE_EVM_WALLET`, and `REVENUE_WEBHOOK_BASE_URL` through the environment. The script refuses to overwrite a conflicting listener and checks that the deployed endpoint advertises Arc support. It never prints secrets. Do not commit these variables or store the management key in the runtime app.

For Arc, only complete `matchingReceipts` from the wallet template are supported. Successful receipt logs from the EIP-7708 system emitter `0xfffffffffffffffffffffffffffffffffffffffe` are the canonical USDC movements. They cover both native sends and ERC-20 sends (including internal contract transfers). The mirrored `Transfer` from `0x3600000000000000000000000000000000000000` and transaction `value` are not credited again. Failed, removed, incomplete, and unknown-shaped deliveries cannot create revenue; rejected payloads remain in the existing delivery audit. Gas is not a transfer event and does not become incoming revenue.

USDC is valued at the existing accounting convention of $1 per unit. Classification, split-receipt matching, dust suppression, internal consolidation review, reconciliation, and payroll import use the existing workflow. This does not automatically classify privacy bridges or execute payments. History before listener activation is not automatically backfilled.

Arc launch scheduling supports **Uniswap V3** (`uni-arc-v3`) and **Argus** (`argus`), with USDC as the default quote. These are calendar/setup venues, not capital-calculator models. Natural-language requests support `Arc univ3`, `Arc Uniswap V3`, and `Argus`; explicit chain selection prevents selecting another chain's Uniswap venue. No database migration is needed for the document-backed project records.

Validation: `npm run arc:test` exercises deterministic normalization and launch setup; `npm run arc:test -- --live` additionally reads current Arc mainnet logs and checks actual system-event receipts without moving funds or saving revenue. `npm run bot:test:launch` exercises scheduling in the isolated test database only.

References: [Arc USDC system events](https://docs.arc.io/arc/references/usdc-system-events), [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses), [Arc RPC endpoints](https://docs.arc.io/arc/references/rpc-endpoints).

The QuickNode management API key is needed only to create/manage streams or webhooks. It is not used by the running app and must not be committed. Rotate any key that has been pasted into chat before production setup.

## Remaining deployment inputs

- Production public app URL for QuickNode delivery targets.
- A new random `QUICKNODE_WEBHOOK_SECRET`.
- Configure the private Telegram group with `/setchat fee`; this applies Fee Inbox permissions and enables receipt alerts together.
- Treasury wallet address if outgoing treasury-transfer verification should be enabled later.
- One real sample payload from each QuickNode network to validate network-specific transfer fields before enabling production alerts.
