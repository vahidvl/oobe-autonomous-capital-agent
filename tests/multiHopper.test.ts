import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { MultiHopperApiError, MultiHopperClient } from '../src/adapters/multiHopperClient.js';
import { type AmmPool, computeConstantProductSwap, computeMultiHopperFeeShare } from '../src/math/amm.js';
import { findBestMultiHopRoute } from '../src/routing/pathfinder.js';

test('AMM math and MultiHopper 50% integrator share are exact', () => {
  const pool: AmmPool = {
    id: 'p1',
    dex: 'Raydium',
    tokenA: 'SOL',
    tokenB: 'USDC',
    reserveA: 1_000_000n,
    reserveB: 150_000_000n,
    feeBps: 25,
  };
  const swap = computeConstantProductSwap(pool, 'SOL', 10_000n);
  assert.equal(swap.amountOut, 1_481_472n);

  const share = computeMultiHopperFeeShare(1_000_000n, 50);
  assert.equal(share.protocolFeeAmount, 5_000n);
  assert.equal(share.integratorShareAmount, 2_500n);
});

test('findBestMultiHopRoute selects optimal 2-hop route', () => {
  const pools: AmmPool[] = [
    { id: 'direct', dex: 'Raydium', tokenA: 'SOL', tokenB: 'BONK', reserveA: 10_000n, reserveB: 100_000n, feeBps: 30 },
    { id: 'h1', dex: 'Orca', tokenA: 'SOL', tokenB: 'USDC', reserveA: 1_000_000n, reserveB: 150_000_000n, feeBps: 25 },
    { id: 'h2', dex: 'Orca', tokenA: 'USDC', tokenB: 'BONK', reserveA: 150_000_000n, reserveB: 3_000_000_000n, feeBps: 25 },
  ];
  const route = findBestMultiHopRoute(pools, 'SOL', 'BONK', 5_000n);
  assert.ok(route !== null);
  assert.equal(route.hops.length, 2);
});

test('MultiHopperClient sends Bearer + Integration-Id headers', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['authorization'], 'Bearer k1');
    assert.equal(req.headers['x-multihopper-integration-id'], 'int-1');
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/v1/quote')) {
      res.end(JSON.stringify({ quoteId: 'q1', inputMint: 'SOL', outputMint: 'USDC', inAmount: '100', outAmount: '15000', feeBps: 50, integratorId: 'int-1' }));
    } else {
      res.statusCode = 400;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  try {
    const client = new MultiHopperClient({ baseUrl: `http://127.0.0.1:${addr.port}`, apiKey: 'k1', integrationId: 'int-1' });
    const q = await client.fetchQuote({ inputMint: 'SOL', outputMint: 'USDC', amount: '100', slippageBps: 50 });
    assert.equal(q.quoteId, 'q1');

    const bad = new MultiHopperClient({ baseUrl: `http://127.0.0.1:${addr.port}/bad`, apiKey: 'k1', integrationId: 'int-1' });
    await assert.rejects(() => bad.fetchQuote({ inputMint: 'SOL', outputMint: 'USDC', amount: '100', slippageBps: 50 }), MultiHopperApiError);
  } finally {
    server.close();
  }
});
