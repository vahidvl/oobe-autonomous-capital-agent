import { JupiterQuoteClient } from './adapters/jupiterQuote.js';
import { SolanaRpcClient } from './adapters/solanaRpc.js';
import { computeRebalancePlan } from './agent/capitalAllocator.js';
import { evaluateTradePolicy } from './risk/policyEngine.js';
import { PortfolioTracker } from './state/portfolioTracker.js';
import type { AssetPosition, RiskPolicy, TargetAllocation } from './types.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUPSOL_MINT = 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'demo';

  if (command === 'rpc-health') {
    const rpcUrl = process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com';
    const client = new SolanaRpcClient({ rpcUrl });
    const [health, slot] = await Promise.all([client.getHealth(), client.getSlot()]);
    console.log(JSON.stringify({ rpcUrl, health, slot }, null, 2));
    return;
  }

  if (command === 'quote') {
    const jupiter = new JupiterQuoteClient();
    const quote = await jupiter.fetchQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: '100000000', // 0.1 SOL
      slippageBps: 50,
    });
    console.log(JSON.stringify(quote, null, 2));
    return;
  }

  // Interactive demo mode: Risk Policy + Rebalance Plan + Portfolio State
  const policy: RiskPolicy = {
    allowedMints: [SOL_MINT, USDC_MINT, JUPSOL_MINT],
    maxTradeAllocationBps: 2500, // 25% max per trade
    maxDailyDrawdownBps: 500,    // 5% max daily drawdown
    maxSlippageBps: 50,          // 0.50% max slippage
    cooldownMs: 30_000,
  };

  const initialPositions: AssetPosition[] = [
    { mint: SOL_MINT, symbol: 'SOL', balanceUnits: 5_000_000_000n, valueUsd: 750 },
    { mint: USDC_MINT, symbol: 'USDC', balanceUnits: 250_000_000n, valueUsd: 250 },
  ];

  const targets: TargetAllocation[] = [
    { mint: SOL_MINT, symbol: 'SOL', targetWeightBps: 5000, expectedApyBps: 0 },
    { mint: USDC_MINT, symbol: 'USDC', targetWeightBps: 3000, expectedApyBps: 450 },
    { mint: JUPSOL_MINT, symbol: 'jupSOL', targetWeightBps: 2000, expectedApyBps: 780 },
  ];

  const tracker = new PortfolioTracker(initialPositions);
  const plan = computeRebalancePlan(tracker.getPositions(), targets);
  const decision = evaluateTradePolicy(
    policy,
    {
      inputMint: SOL_MINT,
      outputMint: JUPSOL_MINT,
      amountInUsd: 200,
      slippageBps: 30,
      timestampMs: Date.now(),
    },
    {
      totalValueUsd: tracker.getTotalValueUsd(),
      dailyDrawdownBps: tracker.getDailyDrawdownBps(),
      lastTradeTimestampMs: tracker.getLastTradeTimestampMs(),
    }
  );

  console.log(JSON.stringify({ totalValueUsd: tracker.getTotalValueUsd(), plan, decision }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
