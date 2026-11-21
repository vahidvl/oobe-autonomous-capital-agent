import { BPS_DENOMINATOR } from '../risk/policyEngine.js';
import type { AssetPosition, RebalanceAction, TargetAllocation } from '../types.js';

/**
 * Computes deterministic portfolio rebalance actions given current positions and target weights.
 * Target weights must sum to 10,000 bps (100%).
 */
export function computeRebalancePlan(
  positions: readonly AssetPosition[],
  targets: readonly TargetAllocation[],
  minTradeThresholdUsd = 5
): RebalanceAction[] {
  const totalTargetBps = targets.reduce((sum, t) => sum + t.targetWeightBps, 0);
  if (totalTargetBps !== BPS_DENOMINATOR) {
    throw new Error(`Target weights must sum to ${BPS_DENOMINATOR} bps, got ${totalTargetBps}`);
  }

  const totalValueUsd = positions.reduce((sum, p) => sum + p.valueUsd, 0);
  if (totalValueUsd <= 0) {
    throw new Error('Total portfolio value must be greater than 0');
  }

  const positionMap = new Map(positions.map((p) => [p.mint, p]));
  const actions: RebalanceAction[] = [];

  for (const target of targets) {
    const current = positionMap.get(target.mint);
    const currentValueUsd = current?.valueUsd ?? 0;
    const currentWeightBps = Math.round((currentValueUsd / totalValueUsd) * BPS_DENOMINATOR);
    const targetValueUsd = (totalValueUsd * target.targetWeightBps) / BPS_DENOMINATOR;
    const deltaUsd = Number((targetValueUsd - currentValueUsd).toFixed(2));

    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (Math.abs(deltaUsd) >= minTradeThresholdUsd) {
      action = deltaUsd > 0 ? 'BUY' : 'SELL';
    }

    actions.push({
      mint: target.mint,
      symbol: target.symbol,
      action,
      deltaUsd,
      currentWeightBps,
      targetWeightBps: target.targetWeightBps,
    });
  }

  return actions;
}
