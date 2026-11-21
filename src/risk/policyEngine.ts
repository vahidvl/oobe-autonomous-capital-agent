import type { PolicyDecision, RiskPolicy, TradeIntent } from '../types.js';

export const BPS_DENOMINATOR = 10_000;

export interface PortfolioRiskSnapshot {
  readonly totalValueUsd: number;
  readonly dailyDrawdownBps: number;
  readonly lastTradeTimestampMs: number | null;
}

/**
 * Deny-by-default risk policy engine for autonomous capital execution.
 */
export function evaluateTradePolicy(
  policy: RiskPolicy,
  intent: TradeIntent,
  snapshot: PortfolioRiskSnapshot
): PolicyDecision {
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
  if (snapshot.dailyDrawdownBps >= policy.maxDailyDrawdownBps) {
    return {
      approved: false,
      reason: `DENIED: daily drawdown ${snapshot.dailyDrawdownBps}bps >= limit ${policy.maxDailyDrawdownBps}bps`,
    };
  }
  if (
    snapshot.lastTradeTimestampMs !== null &&
    intent.timestampMs - snapshot.lastTradeTimestampMs < policy.cooldownMs
  ) {
    return {
      approved: false,
      reason: `DENIED: cooldown active (${policy.cooldownMs}ms required)`,
    };
  }
  if (snapshot.totalValueUsd <= 0) {
    return { approved: false, reason: 'DENIED: portfolio totalValueUsd must be positive' };
  }

  const tradeAllocationBps = Math.round((intent.amountInUsd / snapshot.totalValueUsd) * BPS_DENOMINATOR);
  if (tradeAllocationBps > policy.maxTradeAllocationBps) {
    return {
      approved: false,
      reason: `DENIED: trade allocation ${tradeAllocationBps}bps exceeds max ${policy.maxTradeAllocationBps}bps`,
    };
  }

  return { approved: true, reason: 'APPROVED' };
}
