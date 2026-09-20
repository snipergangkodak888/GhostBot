import { fetchLaunchData } from './data-fetch'
import { toFunctionSelector } from 'viem';
import type { LaunchReportRequest } from './types';
import { formatAmount } from './utils';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';
const CHAIN_ID = 4663;
const CONFIG_ID = 0;

function hexQuantity(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error(`Pons refresh returned an invalid ${field}.`);
  }
  return BigInt(value);
}

function word(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Pons refresh returned an invalid ${field} contract response.`);
  }
  return BigInt(value);
}

function bounded(value: bigint, minimum: bigint, maximum: bigint, label: string): number {
  if (value < minimum || value > maximum) throw new Error(`Pons ${label} is outside the supported range.`);
  return Number(value);
}

/** Read the fixed, native-ETH Pons config at one block. Never silently reuse stale values. */
export async function refreshPonsTerms(request: LaunchReportRequest): Promise<LaunchReportRequest> {
  if (request.modelId !== 'pons') throw new Error('The Pons refresher only accepts the Pons model.');
  if (request.quote.symbol.toUpperCase() !== 'ETH' || request.quote.decimals !== 18 || request.base.decimals !== 18) {
    throw new Error('Pons configuration 0 requires native ETH and an 18-decimal launch token.');
  }
  if (request.operations.currencySymbol.toUpperCase() !== 'ETH') {
    throw new Error('Pons operating allowances must be denominated in ETH.');
  }
  const signal = AbortSignal.timeout(15_000);
  let requestId = 0;
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const id = ++requestId;
    const response = await fetchLaunchData(RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal,
      cache: 'no-store', redirect: 'error',
    }, 'Pons launch settings');
    if (!response.ok) throw new Error(`Pons public RPC returned HTTP ${response.status}.`);
    const body = await response.text();
    if (body.length > 100_000) throw new Error('Pons public RPC response exceeded the expected size.');
    let payload: { jsonrpc?: unknown; id?: unknown; error?: { message?: unknown }; result?: unknown };
    try { payload = JSON.parse(body); } catch { throw new Error('Pons public RPC returned invalid JSON.'); }
    if (!payload || payload.jsonrpc !== '2.0' || payload.id !== id || payload.error || !('result' in payload)) {
      const reason = typeof payload?.error?.message === 'string' ? `: ${payload.error.message.slice(0, 180)}` : '';
      throw new Error(`Pons public RPC could not complete ${method}${reason}.`);
    }
    return payload.result;
  }

  const [chainRaw, blockRaw] = await Promise.all([rpc('eth_chainId', []), rpc('eth_blockNumber', [])]);
  if (hexQuantity(chainRaw, 'chain ID') !== BigInt(CHAIN_ID)) throw new Error('Pons public RPC is not on Robinhood Chain 4663.');
  const block = hexQuantity(blockRaw, 'block number');
  if (block <= 0n) throw new Error('Pons public RPC returned a zero block.');
  const blockTag = `0x${block.toString(16)}`;
  const configData = `${toFunctionSelector('getLaunchConfig(uint256)')}${CONFIG_ID.toString(16).padStart(64, '0')}`;
  const read = (to: string, data: string) => rpc('eth_call', [{ to, data }, blockTag]);
  const [configRaw, launchFeeRaw, hookFeeRaw, headerRaw] = await Promise.all([
    read(FACTORY, configData), read(FACTORY, toFunctionSelector('launchFee()')),
    read(HOOK, toFunctionSelector('hookFeeBps()')), rpc('eth_getBlockByNumber', [blockTag, false]),
  ]);
  if (typeof configRaw !== 'string' || !/^0x(?:[0-9a-fA-F]{64}){7}$/.test(configRaw)) {
    throw new Error('Pons launch configuration does not match the supported seven-field ABI.');
  }
  const words = configRaw.slice(2).match(/.{64}/g)!.map((hex) => BigInt(`0x${hex}`));
  const [supply, curveFee, phantomQuote, graduationThreshold, poolFee, tickSpacing, enabled] = words;
  if (enabled !== 1n) throw new Error('Pons launch configuration 0 is disabled.');
  if (supply <= 0n || supply > 2n ** 128n - 1n || phantomQuote <= 0n || graduationThreshold <= 0n) {
    throw new Error('Pons launch configuration has invalid supply or curve reserves.');
  }
  const curveFeeBps = bounded(curveFee, 0n, 9999n, 'curve fee');
  const poolFeePips = bounded(poolFee, 0n, 999_999n, 'pool fee');
  const spacing = bounded(tickSpacing, 1n, 32767n, 'tick spacing');
  const hookFeeBps = bounded(word(hookFeeRaw, 'hook fee'), 0n, 9999n, 'hook fee');
  const launchFee = word(launchFeeRaw, 'launch fee');
  if (!headerRaw || typeof headerRaw !== 'object' || Array.isArray(headerRaw)) throw new Error('Pons block header is unavailable.');
  const header = headerRaw as Record<string, unknown>;
  if (hexQuantity(header.number, 'header block number') !== block || typeof header.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(header.hash)) {
    throw new Error('Pons block header does not match the pinned block.');
  }
  const timestamp = hexQuantity(header.timestamp, 'block timestamp');
  if (timestamp <= 0n || timestamp > 8_640_000_000_000n) throw new Error('Pons block timestamp is outside the valid date range.');
  const ageSeconds = Date.now() / 1000 - Number(timestamp);
  if (ageSeconds > 1800 || ageSeconds < -120) throw new Error('Pons public RPC block is stale or has an invalid future timestamp. Refresh again when the endpoint is current.');
  const confirmedHeader = await rpc('eth_getBlockByNumber', [blockTag, false]);
  if (!confirmedHeader || typeof confirmedHeader !== 'object' || (confirmedHeader as Record<string, unknown>).hash !== header.hash) {
    throw new Error('The Pons reference block changed during refresh. Retry to capture one consistent snapshot.');
  }
  const blockTime = new Date(Number(timestamp) * 1000).toISOString();
  const observedAt = new Date().toISOString();
  const result = structuredClone(request);
  result.base.supply = formatAmount(supply, 18);
  result.terms = {
    ...result.terms,
    phantomQuoteWei: phantomQuote.toString(), graduationThresholdWei: graduationThreshold.toString(),
    curveFeeBps, poolFeePips, tickSpacing: spacing, hookFeeBps,
    _snapshot: {
      kind: 'public-rpc', chainId: CHAIN_ID, rpc: RPC, factory: FACTORY, hook: HOOK,
      configId: CONFIG_ID, blockNumber: block.toString(), blockHash: header.hash,
      blockTime, observedAt, configRaw, launchFeeRaw, hookFeeRaw,
    },
  };
  // The protocol creation fee changes with the factory. Ghost commercial inputs stay fixed.
  result.operations.launchFeeAmount = formatAmount(launchFee, 18);
  result.termsSource = {
    kind: 'snapshot', label: `Pons native config 0 and hook fees, Robinhood Chain block ${block}`,
    url: 'https://docs.ponsfamily.com/v2', asOf: observedAt,
  };
  return result;
}
