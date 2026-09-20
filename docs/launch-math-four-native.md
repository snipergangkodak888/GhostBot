# Four.meme automatic native launch inputs

Ghost resolves the standard native BNB launch profile automatically. It does not require a client to supply a deployed token, opening price, curve constant, or table of quotes. The supplied `amm-math` package remains unchanged.

## Public contract discovery

The resolver reads finalized BNB Chain state through `https://bsc-rpc.publicnode.com`:

- TokenManager2: `0x5c952063c7fc8610FFDB798152D69F0B9550762b`.
- Helper3: `0xF251F83e40a78868FcfA3FA4599Dad6494E46034`.
- `_tokenCount()` and `_tokens(index)` enumerate recent deployments.
- `_tokenInfos(token)` supplies curve K, current virtual token reserve T, supply, offers, funds, and raise ceiling.
- `_tokenInfoEx1s(token)` excludes anti-sniper fee settings.
- `getTokenInfo(token)` independently checks the manager, quote currency, inventory, protocol fee, and minimum fee.
- `_launchFee()` supplies the current protocol creation charge.

The resolver searches up to 96 recent registry entries and requires two distinct active native BNB launches to agree on the same curve shape and fees. It admits only a 1-billion-token supply with 800 million offered on the curve. It reconstructs the opening virtual reserve as `current T + tokens already sold`. Existing cumulative funds must match that reconstruction.

The profile is verified using five `tryBuy` queries on each reference token: atomic dust, one token, half the remaining inventory, one atom below completion, and completion. Any changed rounding or fee result stops refresh. All reads use one finalized block; its number, hash, timestamp, reference addresses, ten successful quote checks, and a response hash are included in the saved report request. A stale or wrong-chain response is rejected.

## Verified arithmetic

For K and T returned by TokenManager2, buying A token atoms costs:

```
curve cost = floor(K × 10^18 / (T − A)) − floor(K × 10^18 / T)
protocol fee = max(floor(curve cost × fee basis points / 10000), minimum fee)
```

The two divisions must remain separate. Combining them into one fraction produces incorrect one-wei differences. After an ordered purchase, T decreases by A; protocol fees are paid separately and do not increase curve reserves.

This report-side formula was derived from contract state and independently compared with 36 public Helper3 quotes across four native curve states, including full inventory and amounts above the cap. The automated resolver repeats ten checks for every refresh. It is not inferred from the old example images.

The recorded fixture at finalized block **122889400**, timestamp **2026-09-19 23:59:06 UTC**, has:

| Field | Atomic value |
|---|---:|
| K | 6620379057293150682482642147 |
| Opening T | 1073972602739726027397260273 |
| Offered tokens | 800000000000000000000000000 |
| Raise ceiling | 18000000000000000000 |
| Protocol fee | 100 basis points |
| Minimum fee | 0 |

With those terms, the full curve costs **17.999999998119999994 BNB before fees**, rather than a rounded 18 BNB. Per-wallet fees retain their own integer rounding.

After the curve sells out, the report uses the original package's Four.meme 2% migration rule and V2 graduated-pool functions. It applies the original 2% refundable funding allowance only to the crossing purchase. At exactly 80% control, the displayed FDV is the migrated pool's opening FDV.

## Tax choice and scope

The default is a new untaxed launch. Reference tokens can be TaxToken9 deployments: only their shared curve geometry and protocol fee are borrowed, and their creator taxes are never inherited. An explicit creator buy-tax choice follows the published TaxToken8/9 behavior: quote-side tax during the curve and output-token tax after migration. Helper3's baseline cost/protocol-fee values must not be mistaken for those additional creator taxes.

Automatic discovery currently covers the direct native BNB standard curve. ERC-20 quote routing, stablecoin/stock quote hops, anti-sniper launches, and alternate supply profiles are separate configurations and are rejected by this resolver.

Sources: [official integration guide](https://github.com/four-meme-community/fourmeme-docs/blob/main/docs/integration-guide.md), [TokenManager2 interface](https://github.com/four-meme-community/fourmeme-docs/blob/main/contracts/interfaces/ITokenManager2.sol), [Helper3 interface](https://github.com/four-meme-community/fourmeme-docs/blob/main/contracts/interfaces/ITokenManagerHelper3.sol), and [official tax guide](https://github.com/four-meme-community/fourmeme-docs/blob/main/docs/tax-guide.md).

Regression verification: `node scripts/test-launch-report-four.mjs`. The recorded public RPC fixture is `scripts/fixtures/launch-reports/four-native-rpc.json`; tests never send transactions or require a wallet.
