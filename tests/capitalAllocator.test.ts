import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRebalancePlan } from '../src/agent/capitalAllocator.js';
import { PortfolioTracker } from '../src/state/portfolioTracker.js';
import type { AssetPosition, TargetAllocation } from '../src/types.js';

test('computeRebalancePlan computes deterministic BUY/SELL/HOLD actions', () => {
  const positions: AssetPosition[] = [
    { mint: 'SOL', symbol: 'SOL', balanceUnits: 5n, valueUsd: 700 },
    { mint: 'USDC', symbol: 'USDC', balanceUnits: 300n, valueUsd: 300 },
  ];
  const targets: TargetAllocation[] = [
    { mint: 'SOL', symbol: 'SOL', targetWeightBps: 5000, expectedApyBps: 0 },
    { mint: 'USDC', symbol: 'USDC', targetWeightBps: 3000, expectedApyBps: 450 },
    { mint: 'jupSOL', symbol: 'jupSOL', targetWeightBps: 2000, expectedApyBps: 780 },
  ];

  const plan = computeRebalancePlan(positions, targets);
  assert.equal(plan.length, 3);
  assert.equal(plan[0]?.action, 'SELL');
  assert.equal(plan[0]?.deltaUsd, -200);
  assert.equal(plan[1]?.action, 'HOLD');
  assert.equal(plan[2]?.action, 'BUY');
  assert.equal(plan[2]?.deltaUsd, 200);
});

test('PortfolioTracker tracks drawdown and audit log', () => {
  const tracker = new PortfolioTracker([
    { mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 1000 },
  ]);
  assert.equal(tracker.getDailyDrawdownBps(), 0);

  tracker.updatePositions([{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 950 }], 12345);
  assert.equal(tracker.getDailyDrawdownBps(), 500);
  assert.equal(tracker.getLastTradeTimestampMs(), 12345);
  assert.equal(tracker.getAuditLog().length, 1);
});
