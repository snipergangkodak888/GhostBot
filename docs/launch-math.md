# Ghost Launch Math

Ghost Launch Math creates client launch-funding reports from the supplied AMM calculations. The web builder, Telegram image flow and command-line generator share one calculation engine and the same Ghost rendering. A new report automatically retrieves supported protocol settings and current conversion prices; clients do not need to enter an opening tick, curve constant or quote table.

The builder ships through Ghost's existing application deployment at `/admin/launch-math`. The earlier example images and delivery archive were cleared; research evidence remains available.

## Everyday workflow

1. Sign in as a Ghost administrator and open **Launch Math** at `/admin/launch-math`.
2. Choose the launchpad or DEX. A client name is optional. The standard supply comparisons, 125 aged wallets and venue operating allowances are already included.
3. For a new pool, keep the displayed standard liquidity comparison or tap a single pool amount. This is the money supplied before token purchases.
4. Tap **Generate report**. Ghost retrieves supported current protocol settings and prices, then scrolls to the results. Progress appears beside the button; failed requests have a visible retry action.
5. Tap **Download image** to share the report. CSV and JSON are also available. Exports use the configuration captured when the report was generated.

**Customize report · optional** contains report titles, different supply percentages, the wallet count, saved setups and imports. **Advanced launch settings · optional** contains allocation, taxes, operating allowances and technical settings. Most reports need neither section. Defaults describe the named launch profile, not every launch mode or network offered by that brand.

Each supply percentage is the share of total token supply held after purchases, including any retained allocation in the setup. MC (market cap) is the value of all tokens at the modeled price after purchases. Total funding includes launch funding, the aged-wallet budget and injection / MM liquidity; pool liquidity and unused reserves remain assets. These definitions also appear beside the web results.

## Quick reports in Telegram

1. Open the internal Ghost bot and send `/launchmath`, or tap **Launch Math**. `/launchcalc` opens the same flow.
2. Choose **Solana**, **BNB**, **Robinhood** or **DEX examples**, then choose a venue.
3. Keep the displayed standard settings and tap **Generate image**. Pool examples also let you choose from the standard liquidity amounts.
4. Ghost checks current settings, calculates the report and displays an inline photo in the same conversation. Tap to view it or forward it directly. The original PNG remains available from the web builder. Temporary data failures retry automatically.

The bot uses the same standard supply comparisons, 125-wallet default and fixed wallet prices as the web tool. There are no curve constants, opening ticks or quote tables to enter. For a client name or a custom setup, use the web builder.

This flow is available to active enrolled team members in direct messages or configured launch, trade and management groups. The detailed web builder retains the normal administrator login. Queued report jobs and duplicate protection prevent repeat taps or webhook delivery from starting the same job twice. Generating a report does not buy wallets or execute a launch; the existing launch workflow remains separate.

Saved setups in the builder belong to that browser. Export settings as JSON for a portable copy, then import the file when preparing another report. Changing the inputs requires generating a new report before exporting its results. Technical source details are available for audit; they are not part of the normal client input workflow.

## Funding policy

The standard aged-wallet prices are fixed in `lib/launch-reports/pricing.ts`:

| Native currency | Price per aged wallet | Default quantity | Acquisition subtotal |
|---|---:|---:|---:|
| SOL | 0.10 SOL | 125 | 12.50 SOL |
| ETH | 0.10 ETH | 125 | 12.50 ETH |
| BNB | 0.02 BNB | 125 | 2.50 BNB |

Aged wallets acquired, executing buyers and funded holder destinations are separate counts. For USDC or USDT funding, native wallet and operating allowances retain their native policy values and convert using recorded USD prices, rounding each amount upward to the quote token's smallest unit. They are not relabeled as stablecoin amounts.

Buy funding, launch fees, operating reserves, provider fees/buffers and aged-wallet acquisition remain separate in the calculation data. Operating allowances are editable planning assumptions, not universal network charges. A zero allowance means that component is excluded. Liquidity and unused reserves remain assets; total required funding is not the same as fees permanently spent.

### Injection / MM liquidity

Every newly generated report adds Ghost's trading-capital reserve as its own line item. **Total = launch funding + aged wallets + injection / MM liquidity.** This reserve is held separately from the initial pool liquidity; it does not execute additional buys, raise the modeled MC, or receive an extra launch-funding provider fee.

- Solana venues: 30 SOL through $500,000 post-buy MC, then proportional to MC (60 SOL at $1m).
- EVM venues: 1.3 ETH through $300,000 MC, linearly increasing to 2 ETH at $500,000 and $10,000 worth of ETH at $1m. The $1m anchor has a 2 ETH minimum so a rising ETH price cannot make larger launches require a smaller reserve. Above $1m, scale proportionally from that anchor (normally 1% of MC).
- BNB and stablecoin reports convert the reference reserve into their report currency using captured USD exchange rates. Native amounts round upward to the currency's smallest unit.

These are Ghost planning assumptions, not protocol-required fees or guarantees. The request stores `ghost-injection-v1` and its dated reference FX so exports reproduce exactly. Legacy snapshots without that field retain their original totals and explicitly show that the MM reserve was excluded; fresh generation applies the current policy. MC is modeled post-buy price multiplied by total token supply. Existing internal JSON `fdvQuote`/`fdvUsd` fields remain compatible; client labels and CSV headers use MC.

## Supported profiles

The catalogue covers the sixteen report entries below. Coverage refers to these specific models and launch profiles, not every product version sharing the same brand name.

| Model ID | Practical scope |
|---|---|
| `pumpfun` | Native SOL bonding curve and graduated PumpSwap pool; current global settings and dynamic fee tiers. |
| `pumpfun-custom` | Mainnet USDC, six decimals; current Pump whitelist, stablecoin fee tiers and conversion of SOL operating/migration funding. Other quote tokens are not the automatic profile. |
| `launchlab` | LaunchLab using Stonkfun's current standard SOL launch profile. |
| `stonkfun` | The same standard SOL LaunchLab profile, identified as Stonkfun. Reward mode and other quote profiles require separate verified integration. |
| `pons` | Pons V2 on Robinhood Chain, including curve, graduated pool and creator/hook fees. |
| `raydium-cpmm` | Chosen SOL liquidity with current CPMM configuration 0 and creator fees disabled. |
| `uniswap-v2` | A new constant-product pool with chosen liquidity, allocation and fee; assumes no transfer tax. |
| `uniswap-v3` | A new single full-range position with chosen liquidity and supported fee; does not simulate an arbitrary existing multi-range pool. |
| `flap` | Standard native BNB launch on BNB Chain, untaxed token, 2% per-wallet cap and V2 migration; current Portal settings and matching launch profiles. |
| `letscash` | Native V4 launches using the ten supplied factory presets, verified against the factory. |
| `pools-instant` | Native instant-launch strategy with verified fixed launch settings. |
| `lunch-v3` | Native ETH V3 on Robinhood Chain; opening geometry comes from the launcher automatically. |
| `lunch-v4-tax` | Native ETH V4 on Robinhood Chain; automatic opening geometry and creator-selected buy tax. |
| `lunch-v4-rewards` | Native ETH V4 opening calculations; holder reward routing does not change the opening swap geometry. |
| `sushi-launchpad` | The supplied native ETH **V1** single-range model on Robinhood Chain; opening geometry, protocol reserve and launch fee are retrieved automatically. V2 Moon Mode has different geometry. |
| `fourmeme` | Standard native BNB curve and PancakeSwap V2 migration; two matching current launches and exact helper quotes verify the profile. Creator buy tax is a launch choice. Stablecoin, stock and alternate launch modes are outside this profile. |

Supply control includes an explicitly chosen retained allocation where the model supports it. The MC column is total token supply multiplied by the marginal price after the ordered buys, rather than circulating market cap. Targets outside a model's supported curve or pool range remain unavailable with a reason; a capped result is never relabeled as a larger target.

## Current reports and reproducible snapshots

Normal generation refreshes protocol settings and supported USD prices. Temporary throttling and server/network failures are retried; Solana reads also fail over to another provider. Telegram keeps a temporarily blocked calculation in its durable queue for up to three attempts and tells the requester that it is retrying. Invalid protocol layouts, changed account owners and consistency failures still stop generation immediately. Ghost does not substitute old settings when all live sources fail.

### Production data connections

Set `LAUNCH_REPORT_SOLANA_RPC_URL` in Railway to the authenticated Solana mainnet RPC URL from the existing QuickNode account. This is a server secret. `LAUNCH_REPORT_SOLANA_RPC_FALLBACK_URL` optionally supplies a second private provider; fixed PublicNode and Solana endpoints are final backups. The report and logs retain only a safe provider label, never a credential-bearing URL. Concurrent identical Solana reads share one request; completed results are not cached as current data. Provider cooldowns respect `Retry-After`.

This RPC connection is separate from the existing QuickNode wallet webhooks: those push signed revenue/treasury transfers into `/api/webhooks/quicknode/revenue`, while Launch Math asks for current program settings. Adding the report connection does not alter wallet subscriptions or their signing secret.

Report jobs retain attempt counts, scheduled retry times and sanitized failure details. Railway logs emit single-line `retry-scheduled`, `failed`, `delivery-failed` and `complete` events with the job ID and venue. A successful delivery records Telegram's message ID. Only failed live-data reads automatically retry; an uncertain image delivery never automatically resends and risks a duplicate.

The exported JSON retains the full input configuration, pricing observations, source metadata, model version and exact raw amounts. It is the portable audit record. An explicit snapshot calculation uses those captured settings without network access; its original source dates continue to matter. A snapshot reproduces a prior calculation, not a promise that the old protocol settings remain current.

New chains, protocol versions and nonstandard launch modes need a verified adapter/profile before they can be offered automatically. Raw technical inputs are not a substitute for that integration in the client workflow.

## Command-line use

Use Node with the project's installed dependencies; Bun is not required.

```sh
node scripts/launch-report.mjs list
node scripts/launch-report.mjs init pumpfun --out /tmp/ghost-input.json
node scripts/launch-report.mjs generate /tmp/ghost-input.json --out /tmp/ghost-client-report
```

Edit the generated input's client name, targets and planning choices as needed. `generate` refreshes the supported live inputs by default. The output folder contains `input.json`, `report.json`, `report.csv`, `report.svg` and `report.png`.

To reproduce captured inputs without network requests:

```sh
node scripts/launch-report.mjs generate /tmp/ghost-client-report/input.json --snapshot --out /tmp/ghost-client-report-copy
```

Existing files are protected. Choose a new output folder or explicitly supply `--overwrite` when replacing an earlier export. For an incomplete profile, `--snapshot` cannot invent the missing protocol settings: first generate a current report successfully.

## Implementation and verification

The original supplied `amm-math` folder is unchanged. Byte-identical report-side copies are under `lib/launch-reports/amm-math`; the source manifest, adapters, refreshers, funding policy and rendering live outside that math directory, in `lib/launch-reports`. The engine preserves integer accounting and ordered buys. PNGs are deterministic renderings of the calculated table.

Run `npm run typecheck:launch` and `npm run launch:test` for the scoped checks. The suite covers numerical behavior, captured protocol responses, automatic preparation, API access controls, exports and CLI round trips. Telegram permission checks also run in `node scripts/test-launch-permissions.mjs`. The report flow uses the shared calculation and PNG rendering functions; it does not use the previous standalone launch calculator.

Run `npm run bot:test:launch-reports` for menu, permissions, duplicate handling, delivery retries, webhook authentication and worker recovery checks. These tests capture outgoing Telegram calls; they do not message the team. `npm run launch:test:live` checks all 16 catalog entries against current public sources, verifies exact funding totals and renders every PNG into a temporary directory. The September 20, 2026 check passed all 127 default scenarios; availability remains dependent on the public sources at generation time.

Telegram generation is stored in the existing document database as `launchReportJobs`. The application wakes the worker immediately and its internal ten-second poll recovers queued work after a restart. Conditional database updates prevent concurrent workers from claiming the same job. Failed image delivery reuses the saved report; an unconfirmed delivery asks the user to check the chat before retrying. A fresh report uses a new menu and current inputs. The worker checks team access both before calculation and before delivery.

Production webhook requests require Telegram's secret header. Both webhook setup routes register the derived credential; a deployment introducing this requirement must first register it with the existing webhook destination while preserving pending updates. The setup routes require administrator authentication in production.

Detailed protocol evidence is in [Four.meme native research](launch-math-four-native.md) and [EVM launch research](launch-reports-research-evm.md).
