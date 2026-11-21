export interface SolanaRpcConfig {
  readonly rpcUrl?: string;
  readonly rpcUrls?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly baseBackoffMs?: number;
}

export interface JsonRpcResponse<T> {
  readonly jsonrpc: string;
  readonly id: number;
  readonly result?: T;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

export class SolanaRpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'SolanaRpcError';
  }
}

export class SolanaRpcClient {
  private readonly rpcUrls: readonly string[];
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private requestId = 1;

  constructor(config: SolanaRpcConfig) {
    const urls = config.rpcUrls && config.rpcUrls.length > 0
      ? config.rpcUrls
      : config.rpcUrl
        ? [config.rpcUrl]
        : [];
    if (urls.length === 0) {
      throw new Error('At least one rpcUrl is required');
    }
    this.rpcUrls = urls;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseBackoffMs = config.baseBackoffMs ?? 250;
  }

  private async callUrl<T>(url: string, method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.requestId++,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SolanaRpcError(`HTTP ${response.status}: ${response.statusText}`, undefined, response.status);
      }

      const payload = (await response.json()) as JsonRpcResponse<T>;
      if (payload.error) {
        throw new SolanaRpcError(payload.error.message, payload.error.code);
      }
      if (payload.result === undefined) {
        throw new SolanaRpcError(`Missing result for RPC method ${method}`);
      }
      return payload.result;
    } catch (err) {
      if (err instanceof SolanaRpcError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SolanaRpcError(`Solana RPC timeout after ${this.timeoutMs}ms (${method})`);
      }
      throw new SolanaRpcError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executes an idempotent JSON-RPC read with bounded exponential backoff + full jitter
   * and ordered failover across configured RPC endpoints.
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let lastError: unknown;
    for (const url of this.rpcUrls) {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          return await this.callUrl<T>(url, method, params);
        } catch (err) {
          lastError = err;
          // Do not retry deterministic JSON-RPC application errors (e.g. -32601 Method not found)
          if (err instanceof SolanaRpcError && err.code !== undefined) {
            throw err;
          }
          const isRetryableHttp =
            !(err instanceof SolanaRpcError) ||
            err.status === undefined ||
            err.status === 429 ||
            err.status >= 500;
          if (!isRetryableHttp) {
            throw err;
          }
          if (attempt < this.maxRetries - 1) {
            const maxDelay = this.baseBackoffMs * 2 ** attempt;
            const jitterDelay = Math.floor(Math.random() * maxDelay);
            await new Promise((r) => setTimeout(r, jitterDelay));
          }
        }
      }
    }
    throw lastError instanceof Error ? lastError : new SolanaRpcError(String(lastError));
  }

  async getHealth(): Promise<string> {
    return this.call<string>('getHealth');
  }

  async getSlot(commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Promise<number> {
    return this.call<number>('getSlot', [{ commitment }]);
  }

  async getBalance(pubkey: string, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Promise<{ value: number }> {
    return this.call<{ value: number }>('getBalance', [pubkey, { commitment }]);
  }

  async getTokenAccountsByOwner(
    ownerPubkey: string,
    programId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  ): Promise<{ value: unknown[] }> {
    return this.call<{ value: unknown[] }>('getTokenAccountsByOwner', [
      ownerPubkey,
      { programId },
      { encoding: 'jsonParsed' },
    ]);
  }

  async getRecentPrioritizationFees(): Promise<Array<{ slot: number; prioritizationFee: number }>> {
    return this.call<Array<{ slot: number; prioritizationFee: number }>>('getRecentPrioritizationFees', []);
  }

  async getLatestBlockhash(): Promise<{ value: { blockhash: string; lastValidBlockHeight: number } }> {
    return this.call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  }
}
