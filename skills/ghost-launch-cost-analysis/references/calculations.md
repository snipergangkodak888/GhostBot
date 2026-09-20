# Ghost calculation guide

The existing product is documented in [docs/launch-math.md](../../../docs/launch-math.md). Use it for routine reports instead of rebuilding calculations from reference images.

## Code map

- `lib/launch-reports/catalog.ts` and `catalog-evm.ts`: named profiles and launch choices.
- `prepare.ts`: validates a draft, refreshes prices and protocol settings, converts native allowances, and produces a reproducible request.
- `refresh.ts` and `refresh-*.ts`: public protocol/configuration readers with profile checks.
- `engine.ts`, `adapters-solana.ts` and `adapters-evm.ts`: ordered calculations and funding aggregation.
- `pricing.ts` and `funding.ts`: fixed native aged-wallet policy and exact conversion.
- `render.ts`: Ghost SVG, PNG and CSV exports.
- `scripts/launch-report.mjs`: portable Node command-line entry point.
- `lib/launch-reports/amm-math`: report-side copies of supplied modules, with a source manifest.

The original supplied AMM folder is unchanged. Historical research and screenshots are evidence, not current pricing policy or targets to reverse-engineer.

## Model cautions

Pump SOL and Pump USDC have different fee/reserve settings. Resolve current globals and appropriate fee tiers. Preserve migration deductions and the effective reserve produced by the supplied migration constructor; do not add virtual reserves twice. Pool tiers are selected using pre-trade FDV.

Stonkfun uses LaunchLab math. The automatic profile is its standard SOL launch. Global, platform and curve-rule accounts must agree with the public pricing response. Reward-mode transfer fees and other quote mints need their own integration. Never relabel the curve sale cap as a higher ownership target.

Raydium CPMM requires its own fee rounding and reserve accounting: protocol/fund shares leave effective reserves. Creator fee enablement is a separate launch choice. Generic retained-fee V2 arithmetic is not sufficient for this profile.

Pons uses current factory/hook terms and the supplied native graduated-pool planner. Gas reserves are operational allowances, not universal protocol fees.

Four.meme native BNB uses a verified K/T curve reconstructed from recent matching deployments and checked against exact `tryBuy` helper results. Its integer cost is the difference of two floors, not a rounded continuous approximation. Creator buy tax remains an explicit new-launch choice, separate from protocol fees. See [Four research](../../../docs/launch-math-four-native.md).

Lunch and Sushi opening geometry resolves automatically from verified native launchers. Both token orderings matter for concentrated liquidity. The Sushi profile is the supplied V1 model; V2 Moon Mode requires different geometry. See [EVM research](../../../docs/launch-reports-research-evm.md).

Generic V2/V3 profiles model user-selected new liquidity, not an arbitrary existing pool. V3 is one full-range position. LetsCash and Pools use specific verified launch strategies. Automatic Flap covers standard untaxed native BNB, its wallet cap and V2 migration; do not silently apply that profile to another chain or quote token.

## Evidence and verification

Retain the request, model/source version, protocol observations, price timestamps and exact raw amounts with the result. A fresh report refreshes public configuration; a snapshot replays captured inputs and remains dated.

Use meaningful numerical checks for inverse/forward agreement, fee rounding, thresholds, sequential state changes, migration, wallet counts and component totals. Captured network fixtures test parsing and consistency failures without relying on live services.

The scoped checks are `npm run typecheck:launch` and `npm run launch:test`. Access checks for the bot entry point are also in `scripts/test-launch-permissions.mjs`. Calculation accuracy and final PNG readability are separate checks.
