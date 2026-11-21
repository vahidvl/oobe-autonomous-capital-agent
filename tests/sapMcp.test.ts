import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { SapMcpClient } from '../src/oobe/sapMcp.js';

test('SapMcpClient performs initialize handshake, captures mcp-session-id, and parses SSE frames', async () => {
  let seenSessionHeader: string | undefined;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { id: number; method: string; params?: { name?: string } };
      res.setHeader('Content-Type', 'text/event-stream');
      if (parsed.method === 'initialize') {
        res.setHeader('mcp-session-id', 'sess-abc-123');
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { protocolVersion: '2024-11-05' } })}\n\n`);
        return;
      }
      seenSessionHeader = req.headers['mcp-session-id'] as string | undefined;
      res.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: { tool: parsed.params?.name, status: 'ok' },
        })}\n\n`
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const endpointUrl = `http://127.0.0.1:${address.port}/mcp`;

  try {
    const client = new SapMcpClient({ endpointUrl });
    const res = await client.agentStart({ agentId: 'agent-1' });
    assert.equal(res.ok, true);
    assert.equal(res.tool, 'sap_agent_start');
    assert.equal(res.sessionId, 'sess-abc-123');
    assert.equal(seenSessionHeader, 'sess-abc-123');
  } finally {
    server.close();
  }
});
