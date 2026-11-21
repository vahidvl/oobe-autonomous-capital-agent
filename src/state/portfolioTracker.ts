import { BPS_DENOMINATOR } from '../risk/policyEngine.js';
import type { AssetPosition, AuditEvent } from '../types.js';
import { type PersistedRiskState, RiskStateStore } from './stateStore.js';

export function utcDayStartMs(timestampMs: number): number {
  const d = new Date(timestampMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export class PortfolioTracker {
  private positions: AssetPosition[];
  private state: PersistedRiskState;
  private readonly store: RiskStateStore | null;
  private readonly maxDailyDrawdownBps: number;
  private readonly auditLog: AuditEvent[] = [];

  constructor(
    initialPositions: readonly AssetPosition[],
    options: { store?: RiskStateStore; nowMs?: number; maxDailyDrawdownBps?: number } = {}
  ) {
    this.positions = [...initialPositions];
    this.store = options.store ?? null;
    this.maxDailyDrawdownBps = options.maxDailyDrawdownBps ?? 500;
    const nowMs = options.nowMs ?? Date.now();
    const initialTotal = this.getTotalValueUsd();

    const restored = this.store?.load() ?? null;
    if (restored) {
      this.state = restored;
    } else {
      this.state = {
        dayAnchorUtcMs: utcDayStartMs(nowMs),
        anchorValueUsd: initialTotal,
        netFlowsUsd: 0,
        peakValueUsd: initialTotal,
        halt: 'ACTIVE',
        lastTradeTs: null,
      };
      this.store?.save('INIT', this.state, nowMs);
    }
  }

  getPositions(): readonly AssetPosition[] {
    return this.positions;
  }

  getTotalValueUsd(): number {
    return this.positions.reduce((sum, p) => sum + p.valueUsd, 0);
  }

  getHaltState(): 'ACTIVE' | 'HALTED' {
    return this.state.halt;
  }

  getDailyDrawdownBps(): number {
    const current = this.getTotalValueUsd();
    // Flow-adjusted peak: peakValueUsd already tracks deposits/withdrawals
    if (this.state.peakValueUsd <= 0 || current >= this.state.peakValueUsd) {
      return 0;
    }
    return Math.round(((this.state.peakValueUsd - current) / this.state.peakValueUsd) * BPS_DENOMINATOR);
  }

  getLastTradeTimestampMs(): number | null {
    return this.state.lastTradeTs;
  }

  private maybeRolloverUtcDay(nowMs: number): void {
    const todayUtc = utcDayStartMs(nowMs);
    if (todayUtc > this.state.dayAnchorUtcMs) {
      const current = this.getTotalValueUsd();
      this.state = {
        ...this.state,
        dayAnchorUtcMs: todayUtc,
        anchorValueUsd: current,
        netFlowsUsd: 0,
        peakValueUsd: current,
        halt: 'ACTIVE',
      };
      this.store?.save('UTC_ROLLOVER', this.state, nowMs);
    }
  }

  /**
   * Pure mark-to-market revaluation: does NOT update lastTradeTs or emit TRADE_RECORDED.
   */
  markToMarket(nextPositions: readonly AssetPosition[], nowMs: number): void {
    this.maybeRolloverUtcDay(nowMs);
    this.positions = [...nextPositions];
    const total = this.getTotalValueUsd();
    let nextPeak = this.state.peakValueUsd;
    if (total > nextPeak) {
      nextPeak = total;
    }
    this.state = { ...this.state, peakValueUsd: nextPeak };

    const drawdown = this.getDailyDrawdownBps();
    if (drawdown >= this.maxDailyDrawdownBps && this.state.halt !== 'HALTED') {
      this.state = { ...this.state, halt: 'HALTED' };
      this.recordEvent(nowMs, 'HALT_TRIGGERED', `Drawdown ${drawdown}bps >= ${this.maxDailyDrawdownBps}bps`);
      this.store?.save('HALT_TRIGGERED', this.state, nowMs);
      return;
    }

    this.recordEvent(nowMs, 'MARK_TO_MARKET', `Portfolio MTM: $${total.toFixed(2)}`);
    this.store?.save('MARK_TO_MARKET', this.state, nowMs);
  }

  /**
   * Records external capital deposit (+) or withdrawal (-), adjusting anchor and peak
   * so normal withdrawals never trigger false drawdown halts.
   */
  recordFlow(deltaUsd: number, nextPositions: readonly AssetPosition[], nowMs: number): void {
    this.maybeRolloverUtcDay(nowMs);
    this.positions = [...nextPositions];
    const nextAnchor = Math.max(0, this.state.anchorValueUsd + deltaUsd);
    const nextPeak = Math.max(0, this.state.peakValueUsd + deltaUsd);
    this.state = {
      ...this.state,
      anchorValueUsd: nextAnchor,
      peakValueUsd: nextPeak,
      netFlowsUsd: this.state.netFlowsUsd + deltaUsd,
    };
    this.recordEvent(nowMs, 'FLOW_RECORDED', `Flow ${deltaUsd >= 0 ? '+' : ''}$${deltaUsd.toFixed(2)}`);
    this.store?.save('FLOW_RECORDED', this.state, nowMs);
  }

  /**
   * Records an executed trade, updating lastTradeTs and audit log.
   */
  recordTrade(nextPositions: readonly AssetPosition[], nowMs: number, detail?: string): void {
    this.maybeRolloverUtcDay(nowMs);
    this.positions = [...nextPositions];
    const total = this.getTotalValueUsd();
    const nextPeak = total > this.state.peakValueUsd ? total : this.state.peakValueUsd;
    this.state = {
      ...this.state,
      peakValueUsd: nextPeak,
      lastTradeTs: nowMs,
    };
    this.recordEvent(nowMs, 'TRADE_RECORDED', detail ?? `Trade recorded: $${total.toFixed(2)}`);
    this.store?.save('TRADE_RECORDED', this.state, nowMs);
  }

  clearHalt(nowMs: number, operatorReason = 'operator_reset'): void {
    this.state = { ...this.state, halt: 'ACTIVE' };
    this.recordEvent(nowMs, 'HALT_CLEARED', operatorReason);
    this.store?.save('HALT_CLEARED', this.state, nowMs);
  }

  recordEvent(timestampMs: number, type: AuditEvent['type'], detail: string): void {
    this.auditLog.push({ timestampMs, type, detail });
  }

  getAuditLog(): readonly AuditEvent[] {
    return this.auditLog;
  }
}
