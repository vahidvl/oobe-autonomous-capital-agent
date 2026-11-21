export interface MultiHopperClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly integrationId: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface MultiHopperQuoteRequest {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly amount: string;
  readonly slippageBps: number;
}

export interface MultiHopperQuoteResponse {
  readonly quoteId: string;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inAmount: string;
  readonly outAmount: string;
  readonly feeBps: number;
  readonly integratorId: string;
}

export class MultiHopperApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'MultiHopperApiError';
  }
}

export class MultiHopperClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly integrationId: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: MultiHopperClientConfig) {
    if (!config.baseUrl || !config.apiKey || !config.integrationId) {
      throw new Error('baseUrl, apiKey, and integrationId are required');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.integrationId = config.integrationId;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async fetchQuote(req: MultiHopperQuoteRequest): Promise<MultiHopperQuoteResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const url = new URL(`${this.baseUrl}/v1/quote`);
        url.searchParams.set('inputMint', req.inputMint);
        url.searchParams.set('outputMint', req.outputMint);
        url.searchParams.set('amount', req.amount);
        url.searchParams.set('slippageBps', String(req.slippageBps));

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'X-MultiHopper-Integration-Id': this.integrationId,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = new MultiHopperApiError(
            `MultiHopper API error: ${response.status} ${response.statusText}`,
            response.status
          );
          if (response.status === 429 || response.status >= 500) {
            lastError = err;
            continue;
          }
          throw err;
        }
        return (await response.json()) as MultiHopperQuoteResponse;
      } catch (err) {
        if (err instanceof MultiHopperApiError && err.status !== undefined && err.status < 500 && err.status !== 429) {
          throw err;
        }
        lastError = err instanceof Error && err.name === 'AbortError'
          ? new MultiHopperApiError(`MultiHopper API timeout after ${this.timeoutMs}ms`)
          : err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new MultiHopperApiError(String(lastError));
  }
}
