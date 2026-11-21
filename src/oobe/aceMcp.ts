export interface AceDataConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string | null;
  readonly timeoutMs?: number;
}

export interface AceReceipt {
  readonly receiptId: string;
  readonly mint: string;
  readonly amountUsdc: string;
  readonly timestampMs: number;
  readonly status: 'PAID' | 'FREE';
}

export interface AceConvictionResult {
  readonly mint: string;
  readonly convictionScore: number; // [0, 100]
  readonly regime: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  readonly receipt: AceReceipt;
}

export class AceDataError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AceDataError';
  }
}

/**
 * Ace Data Cloud x402 client for token/market conviction scoring and paid receipt tracking.
 */
export class AceDataClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly receipts: AceReceipt[] = [];
  private paidCount = 0;

  constructor(config: AceDataConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://api.acedata.cloud').replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? null;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  getPaidCount(): number {
    return this.paidCount;
  }

  getReceipts(): readonly AceReceipt[] {
    return this.receipts;
  }

  async fetchConvictionScore(mint: string, nowMs: number = Date.now()): Promise<AceConvictionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl}/v1/solana/conviction?mint=${encodeURIComponent(mint)}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      let response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      let receiptStatus: 'PAID' | 'FREE' = 'FREE';
      let amountUsdc = '0';
      let receiptId = `ace-free-${nowMs}-${this.receipts.length + 1}`;

      if (response.status === 402) {
        amountUsdc = response.headers.get('x-402-amount-usdc') ?? '0.001';
        receiptId = `x402-${nowMs}-${this.paidCount + 1}`;
        receiptStatus = 'PAID';
        this.paidCount += 1;

        response = await fetch(url, {
          method: 'GET',
          headers: {
            ...headers,
            'x-402-receipt': receiptId,
          },
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        throw new AceDataError(`Ace Data Cloud HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      const raw = (await response.json()) as { score?: unknown; regime?: unknown };
      const score = typeof raw.score === 'number' ? raw.score : Number(raw.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        throw new AceDataError(`Invalid conviction score from Ace Data Cloud: ${String(raw.score)}`);
      }

      const regime: AceConvictionResult['regime'] =
        score >= 65 ? 'BULLISH' : score <= 35 ? 'BEARISH' : 'NEUTRAL';

      const receipt: AceReceipt = {
        receiptId,
        mint,
        amountUsdc,
        timestampMs: nowMs,
        status: receiptStatus,
      };
      this.receipts.push(receipt);

      return {
        mint,
        convictionScore: score,
        regime,
        receipt,
      };
    } catch (err) {
      if (err instanceof AceDataError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AceDataError(`Ace Data Cloud timeout after ${this.timeoutMs}ms`);
      }
      throw new AceDataError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
