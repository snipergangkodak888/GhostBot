# Ghost Launch Math

Ghost Launch Math creates client launch-funding reports from the supplied AMM calculations. The web builder, Telegram entry point and command-line generator share one calculation engine and the same Ghost rendering. A new report automatically retrieves supported protocol settings and current conversion prices; clients do not need to enter an opening tick, curve constant or quote table.

The builder ships through Ghost's existing application deployment at `/admin/launch-math`. The earlier example images and delivery archive were cleared; research evidence remains available.

## Everyday workflow

1. Sign in as a Ghost administrator and open **Launch Math** at `/admin/launch-math`.
2. Choose the launchpad or DEX, client/report name and supply-control targets. For a configurable pool, choose the initial liquidity amounts to compare.
3. Review the number of aged wallets, executing buyers, operating allowances and any creator-controlled tax or allocation choices. These are launch decisions rather than protocol research inputs.
4. Generate the report. Ghost retrieves the selected protocol's supported live configuration and prices, calculates ordered buys, and records the sources and observation times.
5. Review the funding table, scope notes and unavailable rows, then export **PNG**, **CSV** or **JSON**. An export uses the configuration captured when that report was generated.

The Telegram command `/launchmath` opens the builder for an administrator with launch access. The web page still requires the normal administrator login. The command does not send a report to clients, buy wallets or execute a launch, and the existing launch workflow remains available separately.

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

Supply control includes an explicitly chosen retained allocation where the model supports it. The FDV column is total token supply multiplied by the marginal price after the ordered buys, rather than circulating market cap. Targets outside a model's supported curve or pool range remain unavailable with a reason; a capped result is never relabeled as a larger target.

## Current reports and reproducible snapshots

Normal generation refreshes protocol settings and supported USD prices. A failed public RPC, protocol response, price lookup or consistency check stops generation. Ghost does not silently replace a failed current lookup with old configuration. Retry once the source is available.

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

Run `npm run typecheck:launch` and `npm run launch:test` for the scoped checks. The suite covers numerical behavior, captured protocol responses, automatic preparation, API access controls, exports and CLI round trips. The Telegram entry-point checks also run in `node scripts/test-launch-permissions.mjs`.

Detailed protocol evidence is in [Four.meme native research](launch-math-four-native.md) and [EVM launch research](launch-reports-research-evm.md).
