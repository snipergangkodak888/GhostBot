import { toFunctionSelector } from 'viem';
import type { LaunchReportRequest } from './types';
import { formatAmount } from './utils';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const SUSHI_V1 = '0x104f1ab42674565ec3df0bfebccc4186f72fa7ed';
const LUNCH_V3 = '0xf5Ac14e7691EF44b15b59FcC6a756e41A3E5EFd6';
const LUNCH_V4 = '0xC783221AB1db0244203458417981B4631E80B988';

function quantity(raw: unknown, label: string): bigint {
  if (typeof raw !== 'string' || !/^0x[\da-fA-F]{1,64}$/.test(raw)) throw new Error(`Invalid ${label} from Robinhood public RPC.`);
  return BigInt(raw);
}
function word(raw: unknown, label: string): bigint {
  if (typeof raw !== 'string' || !/^0x[\da-fA-F]{64}$/.test(raw)) throw new Error(`Invalid ${label} contract response.`);
  return BigInt(raw);
}
function int24(raw: unknown, label: string): number {
  const unsigned = word(raw, label);
  const signed = unsigned >= 2n ** 255n ? unsigned - 2n ** 256n : unsigned;
  if (signed < -(2n ** 23n) || signed >= 2n ** 23n) throw new Error(`${label} is not a canonical int24.`);
  return Number(signed);
}
function nativeRequest(request: LaunchReportRequest): void {
  if (request.quote.symbol.toUpperCase() !== 'ETH' || request.quote.decimals !== 18 || request.base.decimals !== 18 || request.operations.currencySymbol.toUpperCase() !== 'ETH') {
    throw new Error('Automatic settings for this launchpad use its native ETH profile on Robinhood Chain.');
  }
}

async function beginSnapshot() {
  let id = 0;
  const signal = AbortSignal.timeout(15_000);
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const requestId = ++id;
    const response = await fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal, cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error(`Robinhood public RPC returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 100_000) throw new Error('Robinhood public RPC response exceeded the expected size.');
    let body: { id?: unknown; jsonrpc?: unknown; error?: unknown; result?: unknown };
    try { body = JSON.parse(text); } catch { throw new Error('Robinhood public RPC returned invalid JSON.'); }
    if (!body || body.id !== requestId || body.jsonrpc !== '2.0' || body.error || !('result' in body)) throw new Error(`Robinhood public RPC could not complete ${method}.`);
    return body.result;
  }
  const [chain, number] = await Promise.all([rpc('eth_chainId', []), rpc('eth_blockNumber', [])]);
  if (quantity(chain, 'chain ID') !== BigInt(CHAIN_ID)) throw new Error('Launch settings RPC is not on Robinhood Chain 4663.');
  const block = quantity(number, 'block number');
  if (block <= 0n) throw new Error('Launch settings RPC returned a zero block.');
  const blockTag = `0x${block.toString(16)}`;
  const value = await rpc('eth_getBlockByNumber', [blockTag, false]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Launch settings block header is unavailable.');
  const header = value as Record<string, unknown>;
  if (quantity(header.number, 'header block number') !== block || typeof header.hash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(header.hash)) throw new Error('Launch settings block header does not match the pinned block.');
  const timestamp = quantity(header.timestamp, 'block timestamp');
  const age = Date.now() / 1000 - Number(timestamp);
  if (timestamp <= 0n || age > 1800 || age < -120) throw new Error('Launch settings RPC is stale or has an invalid future timestamp.');
  const reads: Record<string, unknown> = {};
  async function read(address: string, signature: string, addressArgument?: string): Promise<unknown> {
    const data = toFunctionSelector(signature) + (addressArgument ? addressArgument.slice(2).toLowerCase().padStart(64, '0') : '');
    const result = await rpc('eth_call', [{ to: address, data }, blockTag]);
    reads[`${address}:${signature}`] = result;
    return result;
  }
  async function finish(extra: Record<string, unknown>) {
    const final = await rpc('eth_getBlockByNumber', [blockTag, false]);
    if (!final || typeof final !== 'object' || (final as Record<string, unknown>).hash !== header.hash) throw new Error('The launch settings block changed during refresh. Retry for a consistent snapshot.');
    return {
      ...extra, kind: 'public-rpc', chainId: CHAIN_ID, rpc: RPC,
      blockNumber: block.toString(), blockHash: header.hash,
      blockTime: new Date(Number(timestamp) * 1000).toISOString(), observedAt: new Date().toISOString(), reads,
    };
  }
  return { read, finish };
}

/** The supplied single-range/reserve model is Sushi V1, not Sushi V2 Moon Mode. */
export async function refreshSushiTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.modelId !== 'sushi-launchpad') throw new Error('The Sushi refresher requires the Sushi Launchpad model.');
  nativeRequest(request);
  const snapshot = await beginSnapshot();
  const [tickRaw, reserveRaw, feeRaw] = await Promise.all([
    snapshot.read(SUSHI_V1, 'calculateStartTick(address)', WETH),
    snapshot.read(SUSHI_V1, 'protocolReserveBps()'), snapshot.read(SUSHI_V1, 'launchFee()'),
  ]);
  const plannedStartTick = int24(tickRaw, 'Sushi opening tick');
  const reserveBps = word(reserveRaw, 'Sushi protocol reserve');
  if (Math.abs(plannedStartTick) >= 887_000 || plannedStartTick % 200 !== 0) throw new Error('Sushi opening tick is outside the supplied model’s supported range.');
  if (reserveBps >= 10_000n) throw new Error('Sushi protocol reserve leaves no tradable launch supply.');
  const launchFee = word(feeRaw, 'Sushi launch fee');
  const metadata = await snapshot.finish({ protocolVersion: 'Sushi Launchpad V1', factory: SUSHI_V1, quoteToken: WETH, sourceUrl: 'https://github.com/sushi-labs/sushi/blob/master/src/evm/config/features/launchpad-v1.ts' });
  const result = structuredClone(request);
  result.base.supply = '1000000000';
  result.terms = { ...result.terms, plannedStartTick, reserveBps: Number(reserveBps), _snapshot: metadata };
  result.operations.launchFeeAmount = formatAmount(launchFee, 18);
  result.termsSource = { kind: 'snapshot', asOf: metadata.observedAt, url: 'https://github.com/sushi-labs/sushi/blob/master/site/pages/contracts/launchpad.mdx', label: `Sushi Launchpad V1 native settings, Robinhood Chain block ${metadata.blockNumber}` };
  return result;
}

/** Resolve each native lunch.fun branch from its own published launcher. */
export async function refreshLunchTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (!['lunch-v3', 'lunch-v4-tax', 'lunch-v4-rewards'].includes(request.modelId)) throw new Error('The lunch.fun refresher requires a lunch.fun model.');
  nativeRequest(request);
  const v3 = request.modelId === 'lunch-v3';
  const launcher = v3 ? LUNCH_V3 : LUNCH_V4;
  const getter = v3 ? 'launchTickMagnitude()' : 'launchTick()';
  const snapshot = await beginSnapshot();
  const [tickRaw, spacingRaw] = await Promise.all([
    snapshot.read(launcher, getter), v3 ? Promise.resolve(null) : snapshot.read(launcher, 'TICK_SPACING()'),
  ]);
  const magnitude = int24(tickRaw, 'lunch.fun opening tick');
  if (magnitude <= 0 || magnitude >= 887_200 || magnitude % 200 !== 0) throw new Error('lunch.fun opening geometry is outside the supplied model’s supported range.');
  if (!v3 && word(spacingRaw, 'lunch.fun tick spacing') !== 200n) throw new Error('lunch.fun tick spacing changed; the supplied model must be reviewed.');
  const metadata = await snapshot.finish({ protocolVersion: v3 ? 'lunch.fun V3 native' : 'lunch.fun V4 native', factory: launcher, parameterGetter: getter, quoteToken: v3 ? WETH : '0x0000000000000000000000000000000000000000', sourceUrl: 'https://www.lunch.fun/docs', launchFeeSource: 'Official lunch.fun docs: no launch fee' });
  const result = structuredClone(request);
  result.base.supply = '1000000000';
  result.terms = { ...result.terms, magnitude, tokenOrdering: v3 ? 'both' : 'token1', _snapshot: metadata };
  if (v3) result.terms.buyTaxBps = 0;
  // The creator's V4 buy-tax choice and all Ghost business allowances are preserved.
  result.operations.launchFeeAmount = '0';
  result.termsSource = { kind: 'snapshot', asOf: metadata.observedAt, url: 'https://www.lunch.fun/docs', label: `lunch.fun ${v3 ? 'V3' : 'V4'} native launcher, Robinhood Chain block ${metadata.blockNumber}` };
  return result;
}
