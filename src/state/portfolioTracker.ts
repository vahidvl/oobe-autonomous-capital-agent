import { BPS_DENOMINATOR } from '../risk/policyEngine.js';
import type { AssetPosition, AuditEvent } from '../types.js';

export class PortfolioTracker {
  private positions: AssetPosition[];
  private peakValueUsd: number;
  private lastTradeTimestampMs: number | null = null;
  private readonly auditLog: AuditEvent[] = [];

  constructor(initialPositions: readonly AssetPosition[]) {
    this.positions = [...initialPositions];
    this.peakValueUsd = this.getTotalValueUsd();
  }

  getPositions(): readonly AssetPosition[] {
    return this.positions;
  }

  getTotalValueUsd(): number {
    return this.positions.reduce((sum, p) => sum + p.valueUsd, 0);
  }

  getDailyDrawdownBps(): number {
    const current = this.getTotalValueUsd();
    if (this.peakValueUsd <= 0 || current >= this.peakValueUsd) {
      return 0;
    }
    return Math.round(((this.peakValueUsd - current) / this.peakValueUsd) * BPS_DENOMINATOR);
  }

  getLastTradeTimestampMs(): number | null {
    return this.lastTradeTimestampMs;
  }

  updatePositions(nextPositions: readonly AssetPosition[], timestampMs: number): void {
    this.positions = [...nextPositions];
    const total = this.getTotalValueUsd();
    if (total > this.peakValueUsd) {
      this.peakValueUsd = total;
    }
    this.lastTradeTimestampMs = timestampMs;
    this.recordEvent(timestampMs, 'TRADE_RECORDED', `Portfolio updated: $${total.toFixed(2)}`);
  }

  recordEvent(timestampMs: number, type: AuditEvent['type'], detail: string): void {
    this.auditLog.push({ timestampMs, type, detail });
  }

  getAuditLog(): readonly AuditEvent[] {
    return this.auditLog;
  }
}
