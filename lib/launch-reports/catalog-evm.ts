import type { LaunchReportRequest, ModelPreset } from './types';
import { createGhostOperations } from './pricing';

function request(modelId: string, symbol = 'ETH'): LaunchReportRequest {
  return {
    schemaVersion: 1, modelId, title: 'Launch funding analysis',
    targetsPct: [40, 50, 60, 70, 80, 90],
    base: { symbol: 'TOKEN', decimals: 18, supply: '1000000000' },
    quote: { symbol, decimals: 18 }, terms: {},
    operations: createGhostOperations(symbol),
    termsSource: { kind: 'code-default', label: 'Supplied math snapshot. Network and operating charges are excluded until entered.' },
  };
}

const flap = request('flap', 'BNB');
flap.operations.buyerCount = 42;
flap.operations.poolBuyerCount = 2;
flap.terms = { chain: 'bsc', quoteClass: 'native', customTerms: false, curveFeeBps: 125, poolBuyTaxBps: 0, migrationRetentionBps: 0, perWalletCapPct: 2 };

const letscash = request('letscash');
letscash.terms = { configId: 1000, slippageBps: 50 };

const pools = request('pools-instant');
pools.terms = { slippageBps: 50 };

const sushi = request('sushi-launchpad');
sushi.terms = { plannedStartTick: '', reserveBps: '', tickRangeSpacings: 1, slippageBps: 50 };
sushi.termsSource = { kind: 'code-default', label: 'Automatically resolve native Sushi V1 opening geometry, protocol reserve and launch fee on Robinhood Chain.' };

function lunch(modelId: string, buyTaxBps: number) {
  const r = request(modelId);
  r.terms = { magnitude: '', tokenOrdering: 'both', buyTaxBps, slippageBps: 50 };
  r.termsSource = { kind: 'code-default', label: 'Automatically resolve opening geometry from the native lunch.fun launcher on Robinhood Chain. V4 buy tax is a creator choice.' };
  return r;
}

const four = request('fourmeme', 'BNB');
four.targetsPct = [40, 50, 60, 70, 80];
four.operations.poolBuyerCount = 2;
four.terms = { quoteClass: 'native', creatorBuyTaxBps: 0 };
four.termsSource = { kind: 'code-default', label: 'Automatically resolve the standard native BNB curve and protocol fees from Four.meme contracts.' };

export const EVM_PRESETS: Record<string, ModelPreset> = {
  flap: { label: 'Flap · curve + graduation', group: 'EVM launchpads', description: 'Supplied BNB estimate curve, per-wallet caps, refundable crossing reserve and PancakeSwap V2 graduation. Other quote tokens accept explicit curve terms.', request: flap },
  letscash: { label: 'LetsCash · V4', group: 'EVM launchpads', description: 'One-sided native launch with ten supplied factory presets and hook fee accounting.', request: letscash },
  'pools-instant': { label: 'Pools · Instant Launch', group: 'EVM launchpads', description: 'Fixed one-sided V4 strategy and exact ordered opening buys.', request: pools },
  'lunch-v3': { label: 'lunch.fun · V3', group: 'EVM launchpads', description: 'Native ETH fair-launch pool on Robinhood Chain, with automatic launcher settings.', request: lunch('lunch-v3', 0) },
  'lunch-v4-tax': { label: 'lunch.fun · V4 tax', group: 'EVM launchpads', description: 'Native ETH hooked pool with creator-selected buy tax and automatic launcher settings.', request: lunch('lunch-v4-tax', 0) },
  'lunch-v4-rewards': { label: 'lunch.fun · V4 rewards', group: 'EVM launchpads', description: 'Native ETH V4 opening math with automatic settings; holder reward routing does not alter the opening swap.', request: lunch('lunch-v4-rewards', 0) },
  'sushi-launchpad': { label: 'Sushi Launchpad · V1 model', group: 'EVM launchpads', description: 'Supplied single-range V1 model on Robinhood Chain. Reads current opening price and protocol reserve automatically; V2 Moon Mode uses different geometry.', request: sushi },
  fourmeme: { label: 'Four.meme · native BNB', group: 'EVM launchpads', description: 'Automatically verified native curve and protocol fees, with PancakeSwap V2 graduation. Creator buy tax is an explicit launch choice.', request: four },
};
