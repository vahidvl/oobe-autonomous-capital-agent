import { validatePolicy } from './risk/policyEngine.js';
import type { RiskPolicy } from './types.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const JUPSOL_MINT = 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v';

export interface AppConfig {
  readonly solanaRpcUrls: readonly string[];
  readonly agentWalletAddress: string | null;
  readonly jupiterQuoteApiUrl: string;
  readonly jupiterApiKey: string | null;
  readonly rpcTimeoutMs: number;
  readonly stateDir: string;
  readonly policy: RiskPolicy;
}

function parseIntEnv(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed)) {
    throw new Error(`Invalid integer config for ${name}: "${raw}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rpcRaw = env['SOLANA_RPC_URL']?.trim() || 'https://api.mainnet-beta.solana.com';
  const solanaRpcUrls = rpcRaw
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (solanaRpcUrls.length === 0) {
    throw new Error('SOLANA_RPC_URL must contain at least one URL');
  }

  const wallet = env['AGENT_WALLET_ADDRESS']?.trim() || '';
  const agentWalletAddress =
    wallet.length > 0 && !wallet.startsWith('<') ? wallet : null;

  const jupiterQuoteApiUrl =
    env['JUPITER_QUOTE_API_URL']?.trim() || 'https://lite-api.jup.ag/swap/v1/quote';
  const jupiterApiKey = env['JUPITER_API_KEY']?.trim() || null;

  const rpcTimeoutMs = parseIntEnv(env['RPC_TIMEOUT_MS'], 8000, 'RPC_TIMEOUT_MS');
  if (rpcTimeoutMs <= 0) {
    throw new Error(`RPC_TIMEOUT_MS must be > 0, got ${rpcTimeoutMs}`);
  }

  const allowedRaw = env['ALLOWED_MINTS']?.trim();
  const allowedMints = allowedRaw
    ? allowedRaw.split(',').map((m) => m.trim()).filter((m) => m.length > 0)
    : [SOL_MINT, USDC_MINT, JUPSOL_MINT];

  const policy: RiskPolicy = {
    allowedMints,
    maxTradeAllocationBps: parseIntEnv(env['MAX_TRADE_ALLOCATION_BPS'], 2000, 'MAX_TRADE_ALLOCATION_BPS'),
    maxDailyDrawdownBps: parseIntEnv(env['MAX_DAILY_DRAWDOWN_BPS'], 500, 'MAX_DAILY_DRAWDOWN_BPS'),
    maxSlippageBps: parseIntEnv(env['MAX_SLIPPAGE_BPS'], 50, 'MAX_SLIPPAGE_BPS'),
    maxPriceImpactBps: parseIntEnv(env['MAX_PRICE_IMPACT_BPS'], 100, 'MAX_PRICE_IMPACT_BPS'),
    maxQuoteAgeMs: parseIntEnv(env['MAX_QUOTE_AGE_MS'], 15_000, 'MAX_QUOTE_AGE_MS'),
    cooldownMs: parseIntEnv(env['COOLDOWN_MS'], 30_000, 'COOLDOWN_MS'),
  };

  validatePolicy(policy);

  return {
    solanaRpcUrls,
    agentWalletAddress,
    jupiterQuoteApiUrl,
    jupiterApiKey,
    rpcTimeoutMs,
    stateDir: env['STATE_DIR']?.trim() || '.agent-state',
    policy,
  };
}
