import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRebalancePlan } from '../src/agent/capitalAllocator.js';
import { PortfolioTracker } from '../src/state/portfolioTracker.js';
import type { AssetPosition, TargetAllocation } from '../src/types.js';

test('computeRebalancePlan computes deterministic BUY/SELL/HOLD actions and exits orphan positions', () => {
  const positions: AssetPosition[] = [
    { mint: 'SOL', symbol: 'SOL', balanceUnits: 5n, valueUsd: 600 },
    { mint: 'USDC', symbol: 'USDC', balanceUnits: 300n, valueUsd: 300 },
    { mint: 'ORPHAN', symbol: 'ORPHAN', balanceUnits: 100n, valueUsd: 100 },
  ];
  const targets: TargetAllocation[] = [
    { mint: 'SOL', symbol: 'SOL', targetWeightBps: 5000, expectedApyBps: 0 },
    { mint: 'USDC', symbol: 'USDC', targetWeightBps: 3000, expectedApyBps: 450 },
    { mint: 'jupSOL', symbol: 'jupSOL', targetWeightBps: 2000, expectedApyBps: 780 },
  ];

  const plan = computeRebalancePlan(positions, targets);
  assert.equal(plan.length, 4);
  assert.equal(plan[0]?.action, 'SELL');
  assert.equal(plan[0]?.deltaUsd, -100);
  assert.equal(plan[1]?.action, 'HOLD');
  assert.equal(plan[2]?.action, 'BUY');
  assert.equal(plan[2]?.deltaUsd, 200);
  assert.equal(plan[3]?.mint, 'ORPHAN');
  assert.equal(plan[3]?.action, 'SELL');
  assert.equal(plan[3]?.deltaUsd, -100);
});

test('computeRebalancePlan rejects duplicate target mints and negative/non-integer weights', () => {
  const positions: AssetPosition[] = [{ mint: 'SOL', symbol: 'SOL', balanceUnits: 5n, valueUsd: 1000 }];
  assert.throws(
    () =>
      computeRebalancePlan(positions, [
        { mint: 'SOL', symbol: 'SOL', targetWeightBps: 5000, expectedApyBps: 0 },
        { mint: 'SOL', symbol: 'SOL', targetWeightBps: 5000, expectedApyBps: 0 },
      ]),
    /Duplicate target mint/
  );
  assert.throws(
    () =>
      computeRebalancePlan(positions, [
        { mint: 'SOL', symbol: 'SOL', targetWeightBps: 15000, expectedApyBps: 0 },
        { mint: 'USDC', symbol: 'USDC', targetWeightBps: -5000, expectedApyBps: 0 },
      ]),
    /Invalid targetWeightBps/
  );
});

test('PortfolioTracker tracks drawdown and audit log', () => {
  const tracker = new PortfolioTracker([
    { mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 1000 },
  ]);
  assert.equal(tracker.getDailyDrawdownBps(), 0);

  tracker.markToMarket([{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 950 }], 12345);
  assert.equal(tracker.getDailyDrawdownBps(), 500);
  assert.equal(tracker.getLastTradeTimestampMs(), null);
  assert.equal(tracker.getAuditLog().length, 1);
});
