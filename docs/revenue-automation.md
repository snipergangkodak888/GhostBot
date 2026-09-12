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

Filter EVM activity to `REVENUE_EVM_WALLET` and Solana activity to `REVENUE_SOLANA_WALLET`. Configure the same HMAC secret in QuickNode and `QUICKNODE_WEBHOOK_SECRET`. Production rejects unsigned or stale deliveries.

The normalizer accepts a single event or an array under `data`, `result`, or `events`. Each transfer should contain transaction hash/signature, from, to, amount (or raw amount plus decimals), asset symbol, block time, and event/log/instruction index. Unknown payload shapes are retained in the webhook delivery audit and are not counted as revenue.

The QuickNode management API key is needed only to create/manage streams or webhooks. It is not used by the running app and must not be committed. Rotate any key that has been pasted into chat before production setup.

## Remaining deployment inputs

- Production public app URL for QuickNode delivery targets.
- A new random `QUICKNODE_WEBHOOK_SECRET`.
- Configure the private Telegram group with `/setchat fee`; this applies Fee Inbox permissions and enables receipt alerts together.
- Treasury wallet address if outgoing treasury-transfer verification should be enabled later.
- One real sample payload from each QuickNode network to validate network-specific transfer fields before enabling production alerts.
