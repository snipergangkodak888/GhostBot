---
name: ghost-launch-cost-analysis
description: Create reproducible Ghost client launch reports using the shared launch-math product, automatic protocol settings, fixed native wallet pricing, and PNG/CSV/JSON exports.
---

# Ghost Launch Cost Analysis

Use the existing Ghost Launch Math product. Read the [product guide](../../docs/launch-math.md) for supported profiles and [calculation notes](references/calculations.md) when adapting or investigating the engine. The original supplied AMM package must remain unchanged.

## Normal report workflow

Collect the launchpad/DEX, client label, supply-control targets and genuinely configurable liquidity or launch choices. Keep aged wallets acquired, executing buyers and holder destinations separate.

Use the admin builder at `/admin/launch-math`, or initialize and generate a report through `scripts/launch-report.mjs`. Generation automatically resolves supported protocol settings and USD prices. Clients should not supply raw opening ticks, curve constants or copied quote arrays. A failed live refresh stops generation; do not silently substitute an old snapshot.

Use `--snapshot` only when explicitly reproducing captured settings. Retain their original dates and source metadata. Export the input JSON with calculated JSON/CSV and the Ghost PNG. The Telegram `/launchmath` entry point opens the builder; it does not authorize sending reports to clients.

## Funding policy

The maintained policy is in `lib/launch-reports/pricing.ts`. Default acquisition quantity is 125 aged wallets.

| Native currency | Per wallet | Default subtotal |
|---|---:|---:|
| SOL | 0.10 SOL | 12.50 SOL |
| ETH | 0.10 ETH | 12.50 ETH |
| BNB | 0.02 BNB | 2.50 BNB |

These are fixed Ghost commercial assumptions supplied by the user. Follow later explicit policy changes. For stablecoin quotes, preserve native allowances and record their conversion prices; never relabel native costs as quote-token costs.

Keep buy funding, launch charges, operating reserves, provider fees/buffers and wallet acquisition auditable. Zero operating allowances mean excluded components. Liquidity and unused reserves remain assets; funding is not synonymous with consumed fees.

## Calculation and delivery rules

- Use the shared report engine and supplied integer AMM helpers. Preserve ordered buys, rounding, taxes, migration and wallet caps. Put new verified adapters beside the copied math, never in the user's original package.
- Verify the exact chain, quote token, launch mode and protocol version. The product guide's sixteen profiles do not imply every version of each brand is supported.
- A fixed curve has supply control as its independent axis. A configurable pool can compare supply control with actual selectable liquidity. FDV is the marginal price after buys times total supply.
- Keep unsupported targets unavailable with a reason. Never label a capped 79.31% result as 80%.
- Use deterministic SVG/PNG rendering for numerical tables and the actual [Ghost logo](assets/ghost-logo.JPG). Preserve Ghost branding, legibility and concise assumptions. Image generation may supply optional decorative artwork, not calculated table values.
- Retain full-precision raw amounts, input settings, source dates and model/source versions. Run relevant targeted checks after code changes and inspect final report layout before delivery.
- Do not execute trades, acquire wallets, send external messages, deploy or install this skill globally without authorization. Report generation itself requires no extra approval.
