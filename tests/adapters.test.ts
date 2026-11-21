import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { JupiterQuoteClient, JupiterQuoteError } from '../src/adapters/jupiterQuote.js';
import { SolanaRpcClient, SolanaRpcError } from '../src/adapters/solanaRpc.js';

test('SolanaRpcClient handles real HTTP JSON-RPC server responses and errors', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { id: number; method: string };
      res.setHeader('Content-Type', 'application/json');
      if (parsed.method === 'getHealth') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'ok' }));
      } else {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32601, message: 'Method not found' },
          })
        );
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const rpcUrl = `http://127.0.0.1:${address.port}`;

  try {
    const client = new SolanaRpcClient({ rpcUrl, timeoutMs: 2000 });
    const health = await client.getHealth();
    assert.equal(health, 'ok');

    await assert.rejects(() => client.getSlot(), SolanaRpcError);
  } finally {
    server.close();
  }
});

test('JupiterQuoteClient parses quote response and handles HTTP errors', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.includes('inputMint=SOL')) {
      res.end(
        JSON.stringify({
          inputMint: 'SOL',
          inAmount: '100000000',
          outputMint: 'USDC',
          outAmount: '15000000',
          otherAmountThreshold: '14925000',
          swapMode: 'ExactIn',
          slippageBps: 50,
          priceImpactPct: '0.01',
        })
      );
    } else {
      res.statusCode = 400;
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const client = new JupiterQuoteClient({ baseUrl });
    const quote = await client.fetchQuote({
      inputMint: 'SOL',
      outputMint: 'USDC',
      amount: '100000000',
      slippageBps: 50,
    });
    assert.equal(quote.outAmount, '15000000');

    await assert.rejects(
      () =>
        client.fetchQuote({
          inputMint: 'BAD',
          outputMint: 'USDC',
          amount: '100',
          slippageBps: 50,
        }),
      JupiterQuoteError
    );
  } finally {
    server.close();
  }
});
