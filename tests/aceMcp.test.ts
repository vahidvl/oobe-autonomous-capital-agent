import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { AceDataClient, AceDataError } from '../src/oobe/aceMcp.js';

test('AceDataClient handles x402 payment challenge, validates [0,100] bounds, and tracks >=5 paid receipts', async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const mint = url.searchParams.get('mint') ?? '';
    if (mint === 'BAD_SCORE') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ score: 150 }));
      return;
    }

    if (!req.headers['x-402-receipt']) {
      res.statusCode = 402;
      res.setHeader('x-402-amount-usdc', '0.001');
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ score: 78, regime: 'BULLISH' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const client = new AceDataClient({ baseUrl });
    for (let i = 0; i < 5; i++) {
      const res = await client.fetchConvictionScore(`MINT_${i}`, 1000 + i);
      assert.equal(res.convictionScore, 78);
      assert.equal(res.regime, 'BULLISH');
      assert.equal(res.receipt.status, 'PAID');
    }
    assert.equal(client.getPaidCount(), 5);
    assert.equal(client.getReceipts().length, 5);

    await assert.rejects(() => client.fetchConvictionScore('BAD_SCORE'), AceDataError);
  } finally {
    server.close();
  }
});
