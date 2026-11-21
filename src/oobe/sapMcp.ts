export interface SapMcpConfig {
  readonly endpointUrl?: string;
  readonly apiKey?: string | null;
  readonly timeoutMs?: number;
}

export interface SapToolCallResult {
  readonly ok: boolean;
  readonly tool: string;
  readonly sessionId: string | null;
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

function parseSseOrJson(contentType: string, body: string): { result?: unknown; error?: { message: string } } {
  if (contentType.includes('text/event-stream')) {
    const lines = body.split(/\r?\n/);
    let lastParsed: { result?: unknown; error?: { message: string } } | null = null;
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        lastParsed = JSON.parse(data) as { result?: unknown; error?: { message: string } };
      }
    }
    if (!lastParsed) {
      throw new SapMcpError('Empty SSE stream from SAP MCP server');
    }
    return lastParsed;
  }
  return JSON.parse(body) as { result?: unknown; error?: { message: string } };
}

/**
 * Streamable HTTP MCP client for OOBE Synapse Agent Protocol (SAP).
 * Supports `initialize` -> `mcp-session-id` handshake and both SSE and JSON responses.
 */
export class SapMcpClient {
  private readonly endpointUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private requestId = 1;

  constructor(config: SapMcpConfig = {}) {
    this.endpointUrl = (config.endpointUrl ?? 'https://mcp.sap.oobeprotocol.ai/mcp').replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? null;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
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
      if (this.sessionId) {
        headers['mcp-session-id'] = this.sessionId;
      }

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.requestId++,
          method,
          params,
        }),
        signal: controller.signal,
      });

      const returnedSessionId = response.headers.get('mcp-session-id');
      if (returnedSessionId) {
        this.sessionId = returnedSessionId;
      }

      if (!response.ok) {
        throw new SapMcpError(`SAP MCP HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      const contentType = response.headers.get('content-type') ?? 'application/json';
      const text = await response.text();
      const payload = parseSseOrJson(contentType, text);
      if (payload.error) {
        throw new SapMcpError(`SAP MCP error: ${payload.error.message}`);
      }
      return payload.result;
    } catch (err) {
      if (err instanceof SapMcpError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SapMcpError(`SAP MCP timeout after ${this.timeoutMs}ms (${method})`);
      }
      throw new SapMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize(clientInfo = { name: 'oobe-autonomous-capital-agent', version: '1.0.0' }): Promise<unknown> {
    return this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo,
    });
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<SapToolCallResult> {
    if (!this.sessionId) {
      await this.initialize();
    }
    const result = await this.rpc('tools/call', { name: tool, arguments: args });
    return { ok: true, tool, sessionId: this.sessionId, result };
  }

  agentStart(args: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_agent_start', args);
  }

  skillsBundle(args: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_skills_bundle', args);
  }

  prepareMandate(args: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_prepare_mandate', args);
  }

  previewTransaction(args: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_preview_transaction', args);
  }

  signTransaction(args: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_sign_transaction', args);
  }

  submitSignedTransaction(args: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_submit_signed_transaction', args);
  }

  auditRecord(args: Record<string, unknown>): Promise<SapToolCallResult> {
    return this.callTool('sap_audit_record', args);
  }
}
