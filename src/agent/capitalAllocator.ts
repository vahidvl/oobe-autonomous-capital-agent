import { BPS_DENOMINATOR } from '../risk/policyEngine.js';
import type { AssetPosition, RebalanceAction, TargetAllocation } from '../types.js';

/**
 * Computes deterministic portfolio rebalance actions given current positions and target weights.
 * Validates unique target mints, integer weights in [0, 10000] summing to 10000,
 * and emits full-exit SELL actions for orphan (non-target) positions.
 */
export function computeRebalancePlan(
  positions: readonly AssetPosition[],
  targets: readonly TargetAllocation[],
  minTradeThresholdUsd = 5
): RebalanceAction[] {
  const seenMints = new Set<string>();
  let totalTargetBps = 0;

  for (const t of targets) {
    if (seenMints.has(t.mint)) {
      throw new Error(`Duplicate target mint: ${t.mint}`);
    }
    seenMints.add(t.mint);

    if (!Number.isInteger(t.targetWeightBps) || t.targetWeightBps < 0 || t.targetWeightBps > BPS_DENOMINATOR) {
      throw new Error(`Invalid targetWeightBps for ${t.mint}: ${t.targetWeightBps}`);
    }
    totalTargetBps += t.targetWeightBps;
  }

  if (totalTargetBps !== BPS_DENOMINATOR) {
    throw new Error(`Target weights must sum to ${BPS_DENOMINATOR} bps, got ${totalTargetBps}`);
  }

  const totalValueUsd = positions.reduce((sum, p) => sum + p.valueUsd, 0);
  if (!Number.isFinite(totalValueUsd) || totalValueUsd <= 0) {
    throw new Error('Total portfolio value must be finite and greater than 0');
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

  // Emit full-exit SELL actions for orphan positions not in targets
  for (const pos of positions) {
    if (!seenMints.has(pos.mint) && pos.valueUsd > 0) {
      const currentWeightBps = Math.round((pos.valueUsd / totalValueUsd) * BPS_DENOMINATOR);
      const deltaUsd = Number((-pos.valueUsd).toFixed(2));
      actions.push({
        mint: pos.mint,
        symbol: pos.symbol,
        action: Math.abs(deltaUsd) >= minTradeThresholdUsd ? 'SELL' : 'HOLD',
        deltaUsd,
        currentWeightBps,
        targetWeightBps: 0,
      });
    }
  }

  return actions;
}
