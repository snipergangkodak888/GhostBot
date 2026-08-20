# Revenue and payroll automation

This workflow automates evidence gathering and accounting preparation. It never signs a swap, bridge, treasury transfer, or payroll payment.

## Daily flow

1. Configure each existing project in Admin → Projects with its revenue chain, allowed quote assets, and whether the daily trading fee applies.
2. The operations cron creates one idempotent $500 daily-fee expectation for every eligible active project. Do not forward ordinary daily-fee messages; the wallet receipt is still required.
3. QuickNode watches the public revenue wallets. Every incoming and outgoing transfer is stored once by chain, transaction hash, event index, direction, asset, and wallet.
4. For liquidation or launch context, an admin forwards the standardized client message to the private Fee Inbox Telegram chat.
5. The bot parses the message deterministically. Supply percentages and privacy-swap fees are ignored. Liquidation revenue is always recalculated from the gross cashout using the project's configured percentage (default 5%).
6. Telegram never creates a project. The admin chooses an existing configured project, chooses the quote asset when needed, and confirms the expectation.
7. Receipt matching can combine several transactions. An admin accepts the suggested match or checks the exact receipts in Admin → Revenue Inbox.
8. Native-token receipts can be given a manual USD valuation. This is explicit and auditable; the system does not silently guess a historical price.
9. At the end of the day, the admin performs swaps and bridges manually. They enter the actual final Solana USDC in Revenue Inbox and preview the discrepancy.
10. Finalization is blocked until every fee expectation is resolved, every incoming receipt is classified, and every confirmed native receipt has a USD value.
11. On confirmation, the discrepancy is spread proportionally across liquidation revenue only. Daily trading, launch cash, and dev-allocation revenue remain fixed.
12. Admin → Payroll → Import Verified Revenue remains locked until reconciliation is final. It replaces only previously imported revenue rows; manually entered payroll rows and payout execution remain untouched.

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
- Telegram Fee Inbox chat ID, or run `/subscribe fees` in that private team group.
- Treasury wallet address if outgoing treasury-transfer verification should be enabled later.
- One real sample payload from each QuickNode network to validate network-specific transfer fields before enabling production alerts.
