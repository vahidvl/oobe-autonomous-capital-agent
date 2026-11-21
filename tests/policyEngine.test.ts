import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTradePolicy, validatePolicy } from '../src/risk/policyEngine.js';
import type { RiskPolicy } from '../src/types.js';

const POLICY: RiskPolicy = {
  allowedMints: ['SOL', 'USDC', 'jupSOL'],
  maxTradeAllocationBps: 2000, // 20%
  maxDailyDrawdownBps: 500,    // 5%
  maxSlippageBps: 50,
  maxPriceImpactBps: 100,
  maxQuoteAgeMs: 15_000,
  cooldownMs: 30_000,
};

test('evaluateTradePolicy approves valid trade within all guardrails', () => {
  const decision = evaluateTradePolicy(
    POLICY,
    {
      inputMint: 'SOL',
      outputMint: 'USDC',
      amountInUsd: 200,
      slippageBps: 30,
      timestampMs: 100_000,
      priceImpactBps: 25,
      quoteFetchedAtMs: 95_000,
    },
    { totalValueUsd: 1000, dailyDrawdownBps: 100, lastTradeTimestampMs: 50_000 }
  );
  assert.equal(decision.approved, true);
  assert.equal(decision.reason, 'APPROVED');
});

test('evaluateTradePolicy fails closed on all 5 NaN/Infinity bypasses', () => {
  const baseIntent = {
    inputMint: 'SOL',
    outputMint: 'USDC',
    amountInUsd: 100,
    slippageBps: 20,
    timestampMs: 100_000,
  };
  const baseSnapshot = { totalValueUsd: 1000, dailyDrawdownBps: 0, lastTradeTimestampMs: null };

  assert.equal(evaluateTradePolicy(POLICY, { ...baseIntent, amountInUsd: Number.NaN }, baseSnapshot).approved, false);
  assert.equal(evaluateTradePolicy(POLICY, { ...baseIntent, slippageBps: Number.NaN }, baseSnapshot).approved, false);
  assert.equal(evaluateTradePolicy(POLICY, baseIntent, { ...baseSnapshot, totalValueUsd: Number.NaN }).approved, false);
  assert.equal(evaluateTradePolicy(POLICY, baseIntent, { ...baseSnapshot, dailyDrawdownBps: Number.NaN }).approved, false);
  assert.equal(
    evaluateTradePolicy(
      { ...POLICY, maxTradeAllocationBps: Number.NaN },
      { ...baseIntent, amountInUsd: 999_999 },
      baseSnapshot
    ).approved,
    false
  );
});

test('evaluateTradePolicy enforces exact allocation cap without rounding bypass', () => {
  const snapshot = { totalValueUsd: 1000, dailyDrawdownBps: 0, lastTradeTimestampMs: null };
  // 200.049 is 20.0049% of 1000 — previously rounded down to 2000 bps and bypassed
  const overCap = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 200.049, slippageBps: 20, timestampMs: 100_000 },
    snapshot
  );
  assert.equal(overCap.approved, false);
  assert.match(overCap.reason, /exceeds max 2000bps/);

  const exactCap = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 200, slippageBps: 20, timestampMs: 100_000 },
    snapshot
  );
  assert.equal(exactCap.approved, true);
});

test('evaluateTradePolicy enforces priceImpactBps, maxQuoteAgeMs, and HALTED state', () => {
  const snapshot = { totalValueUsd: 1000, dailyDrawdownBps: 0, lastTradeTimestampMs: null };
  const highImpact = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 100, slippageBps: 20, timestampMs: 100_000, priceImpactBps: 150 },
    snapshot
  );
  assert.equal(highImpact.approved, false);

  const staleQuote = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 100, slippageBps: 20, timestampMs: 100_000, quoteFetchedAtMs: 80_000 },
    snapshot,
    100_000
  );
  assert.equal(staleQuote.approved, false);

  const halted = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 100, slippageBps: 20, timestampMs: 100_000 },
    { ...snapshot, halt: 'HALTED' }
  );
  assert.equal(halted.approved, false);

  const negDrawdown = evaluateTradePolicy(
    POLICY,
    { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 100, slippageBps: 20, timestampMs: 100_000 },
    { ...snapshot, dailyDrawdownBps: -1 }
  );
  assert.equal(negDrawdown.approved, false);
  assert.equal(negDrawdown.reason, 'DENIED: negative dailyDrawdownBps');
});

test('validatePolicy throws on invalid policy fields', () => {
  assert.throws(() => validatePolicy({ ...POLICY, maxTradeAllocationBps: Number.NaN }), /Invalid policy/);
  assert.throws(() => validatePolicy({ ...POLICY, allowedMints: [] }), /allowedMints/);
});
