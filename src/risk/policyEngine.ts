import type { PolicyDecision, RiskPolicy, TradeIntent } from '../types.js';

export const BPS_DENOMINATOR = 10_000;

export interface PortfolioRiskSnapshot {
  readonly totalValueUsd: number;
  readonly dailyDrawdownBps: number;
  readonly lastTradeTimestampMs: number | null;
  readonly halt?: 'ACTIVE' | 'HALTED';
}

export function validatePolicy(policy: RiskPolicy): void {
  if (!Array.isArray(policy.allowedMints) || policy.allowedMints.length === 0) {
    throw new Error('Invalid policy: allowedMints must be a non-empty array');
  }
  const fields: Array<[string, number, number, number]> = [
    ['maxTradeAllocationBps', policy.maxTradeAllocationBps, 1, BPS_DENOMINATOR],
    ['maxDailyDrawdownBps', policy.maxDailyDrawdownBps, 1, BPS_DENOMINATOR],
    ['maxSlippageBps', policy.maxSlippageBps, 0, BPS_DENOMINATOR - 1],
    ['maxPriceImpactBps', policy.maxPriceImpactBps, 0, BPS_DENOMINATOR - 1],
    ['maxQuoteAgeMs', policy.maxQuoteAgeMs, 1, Number.MAX_SAFE_INTEGER],
    ['cooldownMs', policy.cooldownMs, 0, Number.MAX_SAFE_INTEGER],
  ];
  for (const [name, val, min, max] of fields) {
    if (!Number.isFinite(val) || val < min || val > max) {
      throw new Error(`Invalid policy: ${name} (${val}) must be finite in [${min}, ${max}]`);
    }
  }
}

/**
 * Deny-by-default risk policy engine for autonomous capital execution.
 * Fails closed on any non-finite numeric input.
 */
export function evaluateTradePolicy(
  policy: RiskPolicy,
  intent: TradeIntent,
  snapshot: PortfolioRiskSnapshot,
  nowMs: number = intent.timestampMs
): PolicyDecision {
  const numericInputs = [
    intent.amountInUsd,
    intent.slippageBps,
    intent.timestampMs,
    nowMs,
    snapshot.totalValueUsd,
    snapshot.dailyDrawdownBps,
    policy.maxTradeAllocationBps,
    policy.maxDailyDrawdownBps,
    policy.maxSlippageBps,
    policy.maxPriceImpactBps,
    policy.maxQuoteAgeMs,
    policy.cooldownMs,
  ];
  if (!numericInputs.every(Number.isFinite)) {
    return { approved: false, reason: 'DENIED: non-finite numeric input' };
  }
  if (snapshot.lastTradeTimestampMs !== null && !Number.isFinite(snapshot.lastTradeTimestampMs)) {
    return { approved: false, reason: 'DENIED: non-finite lastTradeTimestampMs' };
  }
  if (intent.priceImpactBps !== undefined && !Number.isFinite(intent.priceImpactBps)) {
    return { approved: false, reason: 'DENIED: non-finite priceImpactBps' };
  }
  if (intent.quoteFetchedAtMs !== undefined && !Number.isFinite(intent.quoteFetchedAtMs)) {
    return { approved: false, reason: 'DENIED: non-finite quoteFetchedAtMs' };
  }

  if (snapshot.halt === 'HALTED') {
    return { approved: false, reason: 'DENIED: risk circuit breaker is HALTED' };
  }
  if (intent.amountInUsd <= 0) {
    return { approved: false, reason: 'DENIED: amountInUsd must be positive' };
  }
  if (intent.inputMint === intent.outputMint) {
    return { approved: false, reason: 'DENIED: inputMint and outputMint must differ' };
  }
  if (!policy.allowedMints.includes(intent.inputMint)) {
    return { approved: false, reason: `DENIED: inputMint ${intent.inputMint} not allowlisted` };
  }
  if (!policy.allowedMints.includes(intent.outputMint)) {
    return { approved: false, reason: `DENIED: outputMint ${intent.outputMint} not allowlisted` };
  }
  if (intent.slippageBps < 0 || intent.slippageBps > policy.maxSlippageBps) {
    return {
      approved: false,
      reason: `DENIED: slippageBps ${intent.slippageBps} exceeds cap ${policy.maxSlippageBps}`,
    };
  }
  if (intent.priceImpactBps !== undefined && (intent.priceImpactBps < 0 || intent.priceImpactBps > policy.maxPriceImpactBps)) {
    return {
      approved: false,
      reason: `DENIED: priceImpactBps ${intent.priceImpactBps} exceeds cap ${policy.maxPriceImpactBps}`,
    };
  }
  if (intent.quoteFetchedAtMs !== undefined) {
    const quoteAgeMs = nowMs - intent.quoteFetchedAtMs;
    if (quoteAgeMs < 0 || quoteAgeMs > policy.maxQuoteAgeMs) {
      return {
        approved: false,
        reason: `DENIED: quote age ${quoteAgeMs}ms exceeds maxQuoteAgeMs ${policy.maxQuoteAgeMs}ms`,
      };
    }
  }
  if (snapshot.dailyDrawdownBps < 0 || snapshot.dailyDrawdownBps >= policy.maxDailyDrawdownBps) {
    return {
      approved: false,
      reason: `DENIED: daily drawdown ${snapshot.dailyDrawdownBps}bps >= limit ${policy.maxDailyDrawdownBps}bps`,
    };
  }
  if (
    snapshot.lastTradeTimestampMs !== null &&
    nowMs - snapshot.lastTradeTimestampMs < policy.cooldownMs
  ) {
    return {
      approved: false,
      reason: `DENIED: cooldown active (${policy.cooldownMs}ms required)`,
    };
  }
  if (snapshot.totalValueUsd <= 0) {
    return { approved: false, reason: 'DENIED: portfolio totalValueUsd must be positive' };
  }

  // Exact cross-multiplication to prevent rounding bypass at the allocation cap boundary
  if (intent.amountInUsd * BPS_DENOMINATOR > policy.maxTradeAllocationBps * snapshot.totalValueUsd) {
    return {
      approved: false,
      reason: `DENIED: trade allocation exceeds max ${policy.maxTradeAllocationBps}bps`,
    };
  }

  return { approved: true, reason: 'APPROVED' };
}
