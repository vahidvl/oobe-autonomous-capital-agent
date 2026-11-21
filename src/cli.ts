import { JupiterQuoteClient } from './adapters/jupiterQuote.js';
import { SolanaRpcClient } from './adapters/solanaRpc.js';
import { computeRebalancePlan } from './agent/capitalAllocator.js';
import { JUPSOL_MINT, loadConfig, SOL_MINT, USDC_MINT } from './config.js';
import { SwapExecutor } from './execution/swapExecutor.js';
import { PortfolioTracker } from './state/portfolioTracker.js';
import { RiskStateStore } from './state/stateStore.js';
import type { AssetPosition, TargetAllocation } from './types.js';

function printUsage(): void {
  console.log(`Usage: oobe-agent <command>

Commands:
  dry-run      Fetch live SOL/USDC quote, compute rebalance plan, gate via policy, and simulate
  quote        Fetch a live Jupiter swap/v1 quote for 0.1 SOL -> USDC
  rpc-health   Check Solana RPC health and current slot (exits non-zero if unhealthy)
  --help       Show this help message`);
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
    const executor = new SwapExecutor(jupiter, config.policy, tracker);

    const previews = [];
    for (const action of plan) {
      if (action.action === 'HOLD') continue;
      const prepared = await executor.prepare({
        idempotencyKey: `dryrun-${action.symbol}-${Date.now()}`,
        inputMint: action.action === 'SELL' ? action.mint : USDC_MINT,
        outputMint: action.action === 'BUY' ? action.mint : USDC_MINT,
        amountUnits: '10000000',
        amountInUsd: Math.abs(action.deltaUsd),
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

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
