import type { JupiterQuoteClient, JupiterQuoteResponse } from '../adapters/jupiterQuote.js';
import { evaluateTradePolicy } from '../risk/policyEngine.js';
import type { PortfolioTracker } from '../state/portfolioTracker.js';
import type { PolicyDecision, RiskPolicy } from '../types.js';

export interface SwapRequest {
  readonly idempotencyKey: string;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amountUnits: string;
  readonly amountInUsd: number;
  readonly slippageBps: number;
}

export interface PreparedSwap {
  readonly request: SwapRequest;
  readonly quote: JupiterQuoteResponse;
  readonly decision: PolicyDecision;
  readonly preparedAtMs: number;
}

export interface ExecutionReceipt {
  readonly idempotencyKey: string;
  readonly status: 'SIMULATED' | 'REJECTED';
  readonly reason: string;
  readonly quoteOutAmount?: string;
  readonly executedAtMs: number;
}

export class SwapExecutor {
  private readonly receipts = new Map<string, ExecutionReceipt>();

  constructor(
    private readonly jupiter: JupiterQuoteClient,
    private readonly policy: RiskPolicy,
    private readonly tracker: PortfolioTracker
  ) {}

  async prepare(req: SwapRequest, nowMs: number = Date.now()): Promise<PreparedSwap> {
    const quote = await this.jupiter.fetchQuote(
      {
        inputMint: req.inputMint,
        outputMint: req.outputMint,
        amount: req.amountUnits,
        slippageBps: req.slippageBps,
      },
      nowMs
    );

    const decision = evaluateTradePolicy(
      this.policy,
      {
        inputMint: req.inputMint,
        outputMint: req.outputMint,
        amountInUsd: req.amountInUsd,
        slippageBps: req.slippageBps,
        timestampMs: nowMs,
        priceImpactBps: quote.priceImpactBps,
        quoteFetchedAtMs: quote.fetchedAtMs,
      },
      {
        totalValueUsd: this.tracker.getTotalValueUsd(),
        dailyDrawdownBps: this.tracker.getDailyDrawdownBps(),
        lastTradeTimestampMs: this.tracker.getLastTradeTimestampMs(),
        halt: this.tracker.getHaltState(),
      },
      nowMs
    );

    this.tracker.recordEvent(
      nowMs,
      'POLICY_CHECK',
      `${req.idempotencyKey}: ${decision.approved ? 'APPROVED' : decision.reason}`
    );

    return {
      request: req,
      quote,
      decision,
      preparedAtMs: nowMs,
    };
  }

  execute(prepared: PreparedSwap, nowMs: number = Date.now()): ExecutionReceipt {
    const existing = this.receipts.get(prepared.request.idempotencyKey);
    if (existing) {
      return existing;
    }

    const receipt: ExecutionReceipt = prepared.decision.approved
      ? {
          idempotencyKey: prepared.request.idempotencyKey,
          status: 'SIMULATED',
          reason: 'APPROVED_DRY_RUN',
          quoteOutAmount: prepared.quote.outAmount,
          executedAtMs: nowMs,
        }
      : {
          idempotencyKey: prepared.request.idempotencyKey,
          status: 'REJECTED',
          reason: prepared.decision.reason,
          executedAtMs: nowMs,
        };

    this.receipts.set(prepared.request.idempotencyKey, receipt);
    return receipt;
  }
}
