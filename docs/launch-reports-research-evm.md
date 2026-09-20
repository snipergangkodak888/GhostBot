# Automatic Sushi and lunch.fun launch settings

The report builder resolves opening-price parameters from the launchpad contracts. Clients do not enter ticks, reserves or contract addresses for these native ETH profiles. These refreshers only read public state; they do not submit launches or transactions.

## Sushi Launchpad V1

The supplied `sushi-launch-quote.ts` models a single one-sided position with a protocol supply reserve. It corresponds to **Sushi Launchpad V1**. The [official deployment registry](https://github.com/sushi-labs/sushi/blob/master/src/evm/config/features/launchpad-v1.ts) identifies factory `0x104f1ab42674565ec3df0bfebccc4186f72fa7ed` on Robinhood Chain, chain ID 4663.

For the native ETH profile, the refresher reads these getters at one block:

- `calculateStartTick(address)` with Robinhood WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.
- `protocolReserveBps()`, whose meaning and return type are published in the [official ABI](https://github.com/sushi-labs/sushi/blob/master/src/evm/abi/sushiLaunchpadAbi/sushiLaunchpadAbi_protocolReserveBps.ts).
- `launchFee()` for the protocol creation charge.

The [official version documentation](https://github.com/sushi-labs/sushi/blob/master/site/pages/contracts/launchpad.mdx) distinguishes V1 from the current V2 interface. The report selector therefore names V1 explicitly. Sushi V2 Moon Mode has multiple liquidity ranges and is not silently represented by the supplied V1 model. No dedicated enabled/paused flag appears in the published V1 ABI; the refresher verifies readable factory settings without claiming transaction admission.

## lunch.fun native ETH profiles

The [official lunch.fun documentation](https://www.lunch.fun/docs) publishes the native launchers, default ETH quote, fixed one-billion-token supply and absence of a creation fee. The ordinary V3 and V4 paths use different getters:

| Report model | Published launcher | Automatic read |
| --- | --- | --- |
| V3 | `0xf5Ac14e7691EF44b15b59FcC6a756e41A3E5EFd6` | `launchTickMagnitude()` |
| V4 tax / V4 rewards | `0xC783221AB1db0244203458417981B4631E80B988` | `launchTick()` and `TICK_SPACING()` |

The V4 setting was verified directly on its native launcher. It is not inferred from the separate stock-pair launcher. Native V4 always places ETH as currency0, so the launched token is currency1. V3 models both possible address orderings. The creator's V4 buy-tax choice remains a scenario input; it is not a universal factory fee.

## Verification and recorded evidence

Live verification on September 19, 2026 at 23:58 UTC returned:

| Model | Reference block | Opening parameter | Other terms |
| --- | ---: | ---: | --- |
| Sushi V1 | 67,493,737 | −200,800 | 300 bps reserve; 0.0005 ETH creation fee |
| lunch.fun V3 | 67,493,742 | 204,200 | No creation fee |
| lunch.fun V4 tax / rewards | 67,493,746 | 204,200 | Tick spacing 200; no creation fee |

All 24 default target rows calculated successfully after automatic resolution. [Saved evidence](launch-reports-evidence/evm-automatic-settings.json) includes the request, raw contract responses, block hashes, timestamps and resulting rows.

`node scripts/test-launch-evm-refresh.mjs` exercises four successful profiles and failures for the wrong chain, stale blocks, changed block hashes, malformed responses, HTTP/RPC errors, changed V4 spacing and unsupported quote currency. It uses mocked responses and does not access the network.

Refreshes pin reads to a single block, verify its hash again, enforce a 15-second request deadline and reject blocks more than 30 minutes old. Ghost commercial charges remain unchanged; verified protocol creation fees are updated separately. The original supplied AMM source files are unchanged.
