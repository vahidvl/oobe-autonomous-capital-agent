export interface JupiterQuoteConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string | null;
  readonly timeoutMs?: number;
}

export interface JupiterQuoteRequest {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amount: string;
  readonly slippageBps: number;
}

export interface JupiterQuoteResponse {
  readonly inputMint: string;
  readonly inAmount: string;
  readonly outputMint: string;
  readonly outAmount: string;
  readonly otherAmountThreshold: string;
  readonly swapMode: string;
  readonly slippageBps: number;
  readonly priceImpactPct: string;
  readonly priceImpactBps: number;
  readonly fetchedAtMs: number;
  readonly contextSlot?: number;
}

export class JupiterQuoteError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'JupiterQuoteError';
  }
}

function assertBigIntString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new JupiterQuoteError(`Invalid Jupiter quote field ${field}: expected unsigned integer string`);
  }
  return value;
}

export class JupiterQuoteClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(config: JupiterQuoteConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://lite-api.jup.ag/swap/v1/quote').replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? null;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async fetchQuote(req: JupiterQuoteRequest, nowMs: number = Date.now()): Promise<JupiterQuoteResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('inputMint', req.inputMint);
      url.searchParams.set('outputMint', req.outputMint);
      url.searchParams.set('amount', req.amount);
      url.searchParams.set('slippageBps', String(req.slippageBps));

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new JupiterQuoteError(
          `Jupiter Quote API error: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const inputMint = typeof raw['inputMint'] === 'string' ? raw['inputMint'] : req.inputMint;
      const outputMint = typeof raw['outputMint'] === 'string' ? raw['outputMint'] : req.outputMint;
      if (inputMint !== req.inputMint || outputMint !== req.outputMint) {
        throw new JupiterQuoteError(
          `Mint mismatch in Jupiter quote: expected ${req.inputMint}->${req.outputMint}, got ${inputMint}->${outputMint}`
        );
      }
      const inAmount = assertBigIntString(raw['inAmount'], 'inAmount');
      const outAmount = assertBigIntString(raw['outAmount'], 'outAmount');
      const otherAmountThreshold = assertBigIntString(raw['otherAmountThreshold'], 'otherAmountThreshold');
      const swapMode = typeof raw['swapMode'] === 'string' ? raw['swapMode'] : 'ExactIn';
      const slippageBps = typeof raw['slippageBps'] === 'number' ? raw['slippageBps'] : req.slippageBps;

      const impactRaw = raw['priceImpactPct'];
      const impactNum = typeof impactRaw === 'string' || typeof impactRaw === 'number' ? Number(impactRaw) : Number.NaN;
      if (!Number.isFinite(impactNum)) {
        throw new JupiterQuoteError('Invalid Jupiter quote field priceImpactPct: expected finite number');
      }
      // Jupiter priceImpactPct is a decimal ratio in [0, 1] (e.g. "0.01" = 1% = 100 bps, "0.5" = 50% = 5000 bps)
      const priceImpactBps = Math.max(0, Math.round(Math.abs(impactNum) * 10_000));
      const contextSlot = typeof raw['contextSlot'] === 'number' ? raw['contextSlot'] : undefined;

      return {
        inputMint,
        inAmount,
        outputMint,
        outAmount,
        otherAmountThreshold,
        swapMode,
        slippageBps,
        priceImpactPct: String(impactRaw),
        priceImpactBps,
        fetchedAtMs: nowMs,
        ...(contextSlot !== undefined ? { contextSlot } : {}),
      };
    } catch (err) {
      if (err instanceof JupiterQuoteError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new JupiterQuoteError(`Jupiter Quote API timeout after ${this.timeoutMs}ms`);
      }
      throw new JupiterQuoteError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
