import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTradePolicy } from '../src/risk/policyEngine.js';
import type { RiskPolicy } from '../src/types.js';

const POLICY: RiskPolicy = {
  allowedMints: ['SOL', 'USDC', 'jupSOL'],
  maxTradeAllocationBps: 2000, // 20%
  maxDailyDrawdownBps: 500,    // 5%
  maxSlippageBps: 50,
  cooldownMs: 30_000,
};

test('evaluateTradePolicy approves valid trade within all guardrails', () => {
  const decision = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 150, slippageBps: 30, timestampMs: 100_000 },
    { totalValueUsd: 1000, dailyDrawdownBps: 100, lastTradeTimestampMs: 50_000 }
  );
  assert.equal(decision.approved, true);
  assert.equal(decision.reason, 'APPROVED');
});

test('evaluateTradePolicy denies unallowlisted mints, excessive allocation, drawdown, and cooldown', () => {
  const badMint = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'RUG', amountInUsd: 100, slippageBps: 20, timestampMs: 100_000 },
    { totalValueUsd: 1000, dailyDrawdownBps: 0, lastTradeTimestampMs: null }
  );
  assert.equal(badMint.approved, false);
  assert.match(badMint.reason, /not allowlisted/);

  const tooBig = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 300, slippageBps: 20, timestampMs: 100_000 },
    { totalValueUsd: 1000, dailyDrawdownBps: 0, lastTradeTimestampMs: null }
  );
  assert.equal(tooBig.approved, false);
  assert.match(tooBig.reason, /exceeds max/);

  const drawdown = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 100, slippageBps: 20, timestampMs: 100_000 },
    { totalValueUsd: 1000, dailyDrawdownBps: 500, lastTradeTimestampMs: null }
  );
  assert.equal(drawdown.approved, false);
  assert.match(drawdown.reason, /drawdown/);

  const cooldown = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 100, slippageBps: 20, timestampMs: 100_000 },
    { totalValueUsd: 1000, dailyDrawdownBps: 0, lastTradeTimestampMs: 90_000 }
  );
  assert.equal(cooldown.approved, false);
  assert.match(cooldown.reason, /cooldown/);
});
