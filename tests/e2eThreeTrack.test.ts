import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { computeRebalancePlan } from '../src/agent/capitalAllocator.js';
import { findBestMultiHopRoute } from '../src/routing/pathfinder.js';
import { AceDataClient } from '../src/oobe/aceMcp.js';
import { evaluateTradePolicy } from '../src/risk/policyEngine.js';
import { createSignedAuditBundle, formatAuditMarkdown, verifyAuditBundle } from '../src/telemetry/auditExport.js';

test('3-track E2E: Ace Data Cloud -> Policy Engine -> Allocator -> MultiHopper -> Ed25519 Audit Bundle', async () => {
  const aceServer = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ score: 82, regime: 'BULLISH' }));
  });
  await new Promise<void>((resolve) => aceServer.listen(0, '127.0.0.1', resolve));
  const addr = aceServer.address();
  assert.ok(addr && typeof addr === 'object');

  try {
    const ace = new AceDataClient({ baseUrl: `http://127.0.0.1:${addr.port}` });
    const conviction = await ace.fetchConvictionScore('SOL', 1000);
    assert.equal(conviction.regime, 'BULLISH');

    const plan = computeRebalancePlan(
      [
        { mint: 'SOL', symbol: 'SOL', balanceUnits: 5n, valueUsd: 700 },
        { mint: 'USDC', symbol: 'USDC', balanceUnits: 300n, valueUsd: 300 },
      ],
      [
        { mint: 'SOL', symbol: 'SOL', targetWeightBps: 5000, expectedApyBps: 0 },
        { mint: 'USDC', symbol: 'USDC', targetWeightBps: 5000, expectedApyBps: 450 },
      ]
    );
    assert.equal(plan[0]?.action, 'SELL');

    const decision = evaluateTradePolicy(
      {
        allowedMints: ['SOL', 'USDC'],
        maxTradeAllocationBps: 2500,
        maxDailyDrawdownBps: 500,
        maxSlippageBps: 50,
        maxPriceImpactBps: 100,
        maxQuoteAgeMs: 15_000,
        cooldownMs: 30_000,
      },
      { inputMint: 'SOL', outputMint: 'USDC', amountInUsd: 200, slippageBps: 30, timestampMs: 2000 },
      { totalValueUsd: 1000, dailyDrawdownBps: 0, lastTradeTimestampMs: null }
    );
    assert.equal(decision.approved, true);

    const route = findBestMultiHopRoute(
      [{ id: 'p1', dex: 'Raydium', tokenA: 'SOL', tokenB: 'USDC', reserveA: 1_000_000n, reserveB: 150_000_000n, feeBps: 25 }],
      'SOL',
      'USDC',
      10_000n
    );
    assert.ok(route !== null);

    const intentHash = crypto.createHash('sha256').update('SOL->USDC:200').digest('hex');
    const bundle = createSignedAuditBundle({
      version: '1.0.0',
      generatedAtMs: 2000,
      intentHash,
      aceConviction: conviction,
      policyDecision: decision,
      routeSummary: {
        provider: 'MultiHopper',
        inputMint: 'SOL',
        outputMint: 'USDC',
        amountIn: route.amountIn.toString(),
        expectedOut: route.netAmountOut.toString(),
      },
      explorerUrl: 'https://solscan.io/tx/demo',
    });

    assert.equal(verifyAuditBundle(bundle), true);
    assert.match(formatAuditMarkdown(bundle), /Signed Audit Bundle/);
  } finally {
    aceServer.close();
  }
});
