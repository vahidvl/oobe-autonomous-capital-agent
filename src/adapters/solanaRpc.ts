export interface SolanaRpcConfig {
  readonly rpcUrl: string;
  readonly timeoutMs?: number;
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
    public readonly code?: number
  ) {
    super(message);
    this.name = 'SolanaRpcError';
  }
}

export class SolanaRpcClient {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;
  private requestId = 1;

  constructor(config: SolanaRpcConfig) {
    if (!config.rpcUrl) {
      throw new Error('rpcUrl is required');
    }
    this.rpcUrl = config.rpcUrl;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.rpcUrl, {
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
        throw new SolanaRpcError(`HTTP ${response.status}: ${response.statusText}`);
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

  async getHealth(): Promise<string> {
    return this.call<string>('getHealth');
  }

  async getSlot(): Promise<number> {
    return this.call<number>('getSlot');
  }

  async getLatestBlockhash(): Promise<{ value: { blockhash: string; lastValidBlockHeight: number } }> {
    return this.call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  }
}
