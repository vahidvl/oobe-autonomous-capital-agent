export interface JupiterQuoteConfig {
  readonly baseUrl?: string;
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

export class JupiterQuoteClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: JupiterQuoteConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://quote-api.jup.ag/v6/quote').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async fetchQuote(req: JupiterQuoteRequest): Promise<JupiterQuoteResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('inputMint', req.inputMint);
      url.searchParams.set('outputMint', req.outputMint);
      url.searchParams.set('amount', req.amount);
      url.searchParams.set('slippageBps', String(req.slippageBps));

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new JupiterQuoteError(
          `Jupiter Quote API error: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      return (await response.json()) as JupiterQuoteResponse;
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
