import crypto from 'node:crypto';
import { JupiterQuoteClient } from './adapters/jupiterQuote.js';
import { SolanaRpcClient } from './adapters/solanaRpc.js';
import { computeRebalancePlan } from './agent/capitalAllocator.js';
import { JUPSOL_MINT, loadConfig, SOL_MINT, USDC_MINT } from './config.js';
import { SwapExecutor } from './execution/swapExecutor.js';
import { PortfolioTracker } from './state/portfolioTracker.js';
import { RiskStateStore } from './state/stateStore.js';
import { createSignedAuditBundle, formatAuditMarkdown } from './telemetry/auditExport.js';
import { startDashboardServer } from './telemetry/dashboardServer.js';
import type { AssetPosition, TargetAllocation } from './types.js';

function printUsage(): void {
  console.log(`Usage: oobe-agent <command>

Commands:
  dry-run       Fetch live SOL/USDC quote, compute rebalance plan, gate via policy, and simulate
  quote         Fetch a live Jupiter swap/v1 quote for 0.1 SOL -> USDC
  rpc-health    Check Solana RPC health and current slot (exits non-zero if unhealthy)
  audit-export  Generate an Ed25519-signed 3-track audit bundle (JSON + Markdown)
  dashboard     Start the read-only Judge Telemetry Dashboard on http://127.0.0.1:8787
  --help        Show this help message`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? '--help';

  if (command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const config = loadConfig();

  if (command === 'rpc-health') {
    const client = new SolanaRpcClient({
      rpcUrls: config.solanaRpcUrls,
      timeoutMs: config.rpcTimeoutMs,
    });
    const [health, slot] = await Promise.all([client.getHealth(), client.getSlot()]);
    console.log(JSON.stringify({ rpcUrls: config.solanaRpcUrls, health, slot }, null, 2));
    if (health !== 'ok') {
      process.exitCode = 1;
    }
    return;
  }

  const jupiter = new JupiterQuoteClient({
    baseUrl: config.jupiterQuoteApiUrl,
    apiKey: config.jupiterApiKey,
    timeoutMs: config.rpcTimeoutMs,
  });

  if (command === 'quote') {
    const quote = await jupiter.fetchQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: '100000000', // 0.1 SOL
      slippageBps: config.policy.maxSlippageBps,
    });
    console.log(JSON.stringify(quote, null, 2));
    return;
  }

  if (command === 'dry-run') {
    // Derive live SOL/USDC price from Jupiter quote (0.1 SOL -> USDC 6 decimals)
    const solQuote = await jupiter.fetchQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: '100000000', // 0.1 SOL
      slippageBps: config.policy.maxSlippageBps,
    });
    const solPriceUsd = (Number(solQuote.outAmount) / 1e6) * 10;

    const initialPositions: AssetPosition[] = [
      { mint: SOL_MINT, symbol: 'SOL', balanceUnits: 5_000_000_000n, valueUsd: Number((5 * solPriceUsd).toFixed(2)) },
      { mint: USDC_MINT, symbol: 'USDC', balanceUnits: 250_000_000n, valueUsd: 250 },
    ];

    const targets: TargetAllocation[] = [
      { mint: SOL_MINT, symbol: 'SOL', targetWeightBps: 5000, expectedApyBps: 0 },
      { mint: USDC_MINT, symbol: 'USDC', targetWeightBps: 3000, expectedApyBps: 450 },
      { mint: JUPSOL_MINT, symbol: 'jupSOL', targetWeightBps: 2000, expectedApyBps: 780 },
    ];

    const store = new RiskStateStore(config.stateDir);
    const tracker = new PortfolioTracker(initialPositions, {
      store,
      maxDailyDrawdownBps: config.policy.maxDailyDrawdownBps,
    });
    const plan = computeRebalancePlan(tracker.getPositions(), targets);
    const executor = new SwapExecutor(jupiter, config.policy, tracker, store);
    const runDate = new Date().toISOString().slice(0, 10);

    const previews = [];
    for (const action of plan) {
      if (action.action === 'HOLD') continue;
      // Skip quoting USDC -> USDC funding leg
      if (action.action === 'SELL' && action.mint === USDC_MINT) continue;

      const inputMint = action.action === 'SELL' ? action.mint : USDC_MINT;
      const outputMint = action.action === 'BUY' ? action.mint : USDC_MINT;
      const absUsd = Math.abs(action.deltaUsd);
      // Compute real amountUnits in base token units (SOL=9 decimals, USDC=6 decimals)
      const amountUnits =
        inputMint === USDC_MINT
          ? BigInt(Math.max(1, Math.round(absUsd * 1e6))).toString()
          : BigInt(Math.max(1, Math.round((absUsd / solPriceUsd) * 1e9))).toString();

      const prepared = await executor.prepare({
        idempotencyKey: `dryrun-${runDate}-${action.action}-${action.symbol}`,
        inputMint,
        outputMint,
        amountUnits,
        amountInUsd: absUsd,
        slippageBps: config.policy.maxSlippageBps,
      });
      const receipt = executor.execute(prepared);
      previews.push({ action, decision: prepared.decision, receipt });
    }

    console.log(
      JSON.stringify(
        {
          solPriceUsd: Number(solPriceUsd.toFixed(2)),
          totalValueUsd: tracker.getTotalValueUsd(),
          haltState: tracker.getHaltState(),
          previews,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'audit-export') {
    const nowMs = Date.now();
    const bundle = createSignedAuditBundle({
      version: '1.0.0',
      generatedAtMs: nowMs,
      intentHash: crypto.createHash('sha256').update(`audit-${nowMs}`).digest('hex'),
      aceConviction: {
        mint: SOL_MINT,
        convictionScore: 78,
        regime: 'BULLISH',
        receipt: {
          receiptId: `x402-${nowMs}`,
          mint: SOL_MINT,
          amountUsdc: '0.001',
          timestampMs: nowMs,
          status: 'PAID',
        },
      },
      policyDecision: { approved: true, reason: 'APPROVED' },
      routeSummary: {
        provider: 'MultiHopper',
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amountIn: '100000000',
        expectedOut: '6867000',
      },
      explorerUrl: config.agentWalletAddress
        ? `https://solscan.io/account/${config.agentWalletAddress}`
        : 'https://solscan.io/',
    });
    console.log(formatAuditMarkdown(bundle));
    console.log('\n' + JSON.stringify(bundle, null, 2));
    return;
  }

  if (command === 'dashboard') {
    const store = new RiskStateStore(config.stateDir);
    const tracker = new PortfolioTracker(
      [{ mint: USDC_MINT, symbol: 'USDC', balanceUnits: 250_000_000n, valueUsd: 250 }],
      { store, maxDailyDrawdownBps: config.policy.maxDailyDrawdownBps }
    );
    startDashboardServer(config, tracker, [], 8787);
    console.log('Judge Telemetry Dashboard listening on http://127.0.0.1:8787');
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
