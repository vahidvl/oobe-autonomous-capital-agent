import http from 'node:http';
import type { AppConfig } from '../config.js';
import type { AceReceipt } from '../oobe/aceMcp.js';
import type { PortfolioTracker } from '../state/portfolioTracker.js';

export interface DashboardSnapshot {
  readonly config: {
    readonly rpcUrls: readonly string[];
    readonly maxTradeAllocationBps: number;
    readonly maxDailyDrawdownBps: number;
    readonly maxSlippageBps: number;
    readonly maxPriceImpactBps: number;
  };
  readonly portfolio: {
    readonly totalValueUsd: number;
    readonly dailyDrawdownBps: number;
    readonly haltState: 'ACTIVE' | 'HALTED';
  };
  readonly aceReceipts: readonly AceReceipt[];
}

export function startDashboardServer(
  config: AppConfig,
  tracker: PortfolioTracker,
  aceReceipts: readonly AceReceipt[],
  port = 8787
): http.Server {
  const snapshot: DashboardSnapshot = {
    config: {
      rpcUrls: config.solanaRpcUrls,
      maxTradeAllocationBps: config.policy.maxTradeAllocationBps,
      maxDailyDrawdownBps: config.policy.maxDailyDrawdownBps,
      maxSlippageBps: config.policy.maxSlippageBps,
      maxPriceImpactBps: config.policy.maxPriceImpactBps,
    },
    portfolio: {
      totalValueUsd: tracker.getTotalValueUsd(),
      dailyDrawdownBps: tracker.getDailyDrawdownBps(),
      haltState: tracker.getHaltState(),
    },
    aceReceipts,
  };

  const server = http.createServer((req, res) => {
    if (req.url === '/api/telemetry') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(snapshot, null, 2));
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>OOBE Capital Agent Telemetry</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem;">
  <h1>OOBE Autonomous Capital Agent — Judge Telemetry</h1>
  <p><strong>Halt State:</strong> ${snapshot.portfolio.haltState} | <strong>Total Value:</strong> $${snapshot.portfolio.totalValueUsd.toFixed(2)} | <strong>Drawdown:</strong> ${snapshot.portfolio.dailyDrawdownBps} bps</p>
  <h2>Risk Policy</h2>
  <pre>${JSON.stringify(snapshot.config, null, 2)}</pre>
  <h2>Ace Data Cloud Receipts (${snapshot.aceReceipts.length})</h2>
  <pre>${JSON.stringify(snapshot.aceReceipts, null, 2)}</pre>
</body>
</html>`);
  });

  server.listen(port, '127.0.0.1');
  return server;
}
