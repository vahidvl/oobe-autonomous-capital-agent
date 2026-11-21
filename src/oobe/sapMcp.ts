export interface SapMcpConfig {
  readonly endpointUrl?: string;
  readonly apiKey?: string | null;
  readonly timeoutMs?: number;
}

export interface SapToolCallResult {
  readonly ok: boolean;
  readonly tool: string;
  readonly result: unknown;
}

export class SapMcpError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'SapMcpError';
  }
}

/**
 * Streamable HTTP MCP client for OOBE Synapse Agent Protocol (SAP).
 */
export class SapMcpClient {
  private readonly endpointUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private requestId = 1;

  constructor(config: SapMcpConfig = {}) {
    this.endpointUrl = (config.endpointUrl ?? 'https://mcp.sap.oobeprotocol.ai/mcp').replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? null;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  private async callTool(tool: string, args: Record<string, unknown>): Promise<SapToolCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.requestId++,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SapMcpError(`SAP MCP HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      const payload = (await response.json()) as { result?: unknown; error?: { message: string } };
      if (payload.error) {
        throw new SapMcpError(`SAP MCP error: ${payload.error.message}`);
      }

      return { ok: true, tool, result: payload.result };
    } catch (err) {
      if (err instanceof SapMcpError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SapMcpError(`SAP MCP timeout after ${this.timeoutMs}ms (${tool})`);
      }
      throw new SapMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async start(agentId: string): Promise<SapToolCallResult> {
    return this.callTool('sap_session_start', { agentId });
  }

  async readiness(walletAddress: string): Promise<SapToolCallResult> {
    return this.callTool('sap_readiness_check', { walletAddress });
  }

  async finalize(sessionId: string, summary: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_session_finalize', { sessionId, summary });
  }
}
