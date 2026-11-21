export type MintAddress = string;

export interface RiskPolicy {
  readonly allowedMints: readonly MintAddress[];
  /** Maximum single-trade size as basis points of total portfolio value (e.g., 2000 = 20%). */
  readonly maxTradeAllocationBps: number;
  /** Maximum daily drawdown in basis points before halting trades (e.g., 500 = 5%). */
  readonly maxDailyDrawdownBps: number;
  /** Maximum allowed slippage in basis points (e.g., 50 = 0.50%). */
  readonly maxSlippageBps: number;
  /** Maximum allowed price impact in basis points (e.g., 100 = 1.00%). */
  readonly maxPriceImpactBps: number;
  /** Maximum age of a quote in milliseconds before it is rejected as stale. */
  readonly maxQuoteAgeMs: number;
  /** Minimum milliseconds between consecutive trades. */
  readonly cooldownMs: number;
}

export interface TradeIntent {
  readonly inputMint: MintAddress;
  readonly outputMint: MintAddress;
  readonly amountInUsd: number;
  readonly slippageBps: number;
  readonly timestampMs: number;
  readonly priceImpactBps?: number;
  readonly quoteFetchedAtMs?: number;
}

export interface PolicyDecision {
  readonly approved: boolean;
  readonly reason: string;
}

export interface TargetAllocation {
  readonly mint: MintAddress;
  readonly symbol: string;
  readonly targetWeightBps: number;
  readonly expectedApyBps: number;
}

export interface AssetPosition {
  readonly mint: MintAddress;
  readonly symbol: string;
  readonly balanceUnits: bigint;
  readonly valueUsd: number;
}

export interface RebalanceAction {
  readonly mint: MintAddress;
  readonly symbol: string;
  readonly action: 'BUY' | 'SELL' | 'HOLD';
  readonly deltaUsd: number;
  readonly currentWeightBps: number;
  readonly targetWeightBps: number;
}

export interface AuditEvent {
  readonly timestampMs: number;
  readonly type:
    | 'POLICY_CHECK'
    | 'REBALANCE_PLAN'
    | 'QUOTE_FETCHED'
    | 'TRADE_RECORDED'
    | 'MARK_TO_MARKET'
    | 'FLOW_RECORDED'
    | 'HALT_TRIGGERED'
    | 'HALT_CLEARED';
  readonly detail: string;
}
