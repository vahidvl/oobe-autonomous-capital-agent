import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PortfolioTracker } from '../src/state/portfolioTracker.js';
import { RiskStateStore } from '../src/state/stateStore.js';

test('RiskStateStore persists HALTED state and cooldown across restarts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oobe-state-'));
  try {
    const store1 = new RiskStateStore(tmpDir);
    const t1 = new PortfolioTracker(
      [{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 1000 }],
      { store: store1, nowMs: 1_000_000, maxDailyDrawdownBps: 500 }
    );
    t1.recordTrade([{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 1000 }], 1_010_000);
    t1.markToMarket([{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 940 }], 1_020_000);
    assert.equal(t1.getHaltState(), 'HALTED');

    // Simulate process restart with new store & tracker
    const store2 = new RiskStateStore(tmpDir);
    const t2 = new PortfolioTracker(
      [{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 940 }],
      { store: store2, nowMs: 1_030_000, maxDailyDrawdownBps: 500 }
    );
    assert.equal(t2.getHaltState(), 'HALTED');
    assert.equal(t2.getLastTradeTimestampMs(), 1_010_000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PortfolioTracker deposit/withdraw maintains 0-drawdown invariant', () => {
  const tracker = new PortfolioTracker(
    [{ mint: 'USDC', symbol: 'USDC', balanceUnits: 1000n, valueUsd: 1000 }],
    { nowMs: 1_000_000 }
  );
  tracker.recordFlow(
    1000,
    [{ mint: 'USDC', symbol: 'USDC', balanceUnits: 2000n, valueUsd: 2000 }],
    1_001_000
  );
  tracker.recordFlow(
    -1000,
    [{ mint: 'USDC', symbol: 'USDC', balanceUnits: 1000n, valueUsd: 1000 }],
    1_002_000
  );
  assert.equal(tracker.getDailyDrawdownBps(), 0);
  assert.equal(tracker.getHaltState(), 'ACTIVE');
});

test('PortfolioTracker resets daily anchor and HALTED state on UTC midnight rollover', () => {
  const day1 = Date.UTC(2026, 10, 21, 23, 50, 0);
  const day2 = Date.UTC(2026, 10, 22, 0, 5, 0);
  const tracker = new PortfolioTracker(
    [{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 1000 }],
    { nowMs: day1, maxDailyDrawdownBps: 500 }
  );
  tracker.markToMarket([{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 940 }], day1 + 1000);
  assert.equal(tracker.getHaltState(), 'HALTED');

  tracker.markToMarket([{ mint: 'SOL', symbol: 'SOL', balanceUnits: 10n, valueUsd: 940 }], day2);
  assert.equal(tracker.getHaltState(), 'ACTIVE');
  assert.equal(tracker.getDailyDrawdownBps(), 0);
});

test('RiskStateStore detects journal tampering', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oobe-tamper-'));
  try {
    const store1 = new RiskStateStore(tmpDir);
    store1.save(
      'INIT',
      {
        dayAnchorUtcMs: 0,
        anchorValueUsd: 1000,
        netFlowsUsd: 0,
        peakValueUsd: 1000,
        halt: 'ACTIVE',
        lastTradeTs: null,
      },
      1000
    );
    const journalPath = path.join(tmpDir, 'risk-journal.jsonl');
    const tampered = fs.readFileSync(journalPath, 'utf8').replace('"ACTIVE"', '"HALTED"');
    fs.writeFileSync(journalPath, tampered, 'utf8');

    const store2 = new RiskStateStore(tmpDir);
    assert.throws(() => store2.load(), /tamper detected/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
