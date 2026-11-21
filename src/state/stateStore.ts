import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface PersistedRiskState {
  readonly dayAnchorUtcMs: number;
  readonly anchorValueUsd: number;
  readonly netFlowsUsd: number;
  readonly peakValueUsd: number;
  readonly halt: 'ACTIVE' | 'HALTED';
  readonly lastTradeTs: number | null;
}

export interface StateJournalEntry {
  readonly seq: number;
  readonly timestampMs: number;
  readonly event: string;
  readonly state: PersistedRiskState;
  readonly prevHash: string;
  readonly hash: string;
}

const GENESIS_HASH = '0'.repeat(64);

function computeEntryHash(
  seq: number,
  timestampMs: number,
  event: string,
  state: PersistedRiskState,
  prevHash: string
): string {
  const payload = JSON.stringify({ seq, timestampMs, event, state, prevHash });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Crash-safe, append-only hash-chained JSONL store with atomic snapshot persistence.
 */
export class RiskStateStore {
  private readonly snapshotPath: string;
  private readonly journalPath: string;
  private lastHash = GENESIS_HASH;
  private seq = 0;

  constructor(stateDir: string) {
    fs.mkdirSync(stateDir, { recursive: true });
    this.snapshotPath = path.join(stateDir, 'risk-state.json');
    this.journalPath = path.join(stateDir, 'risk-journal.jsonl');
  }

  load(): PersistedRiskState | null {
    if (fs.existsSync(this.journalPath)) {
      const raw = fs.readFileSync(this.journalPath, 'utf8').trim();
      if (raw.length > 0) {
        const lines = raw.split('\n');
        let prevHash = GENESIS_HASH;
        let lastEntry: StateJournalEntry | null = null;
        for (const line of lines) {
          const entry = JSON.parse(line) as StateJournalEntry;
          if (entry.prevHash !== prevHash) {
            throw new Error(`State journal tamper detected at seq ${entry.seq}: prevHash mismatch`);
          }
          const expected = computeEntryHash(
            entry.seq,
            entry.timestampMs,
            entry.event,
            entry.state,
            entry.prevHash
          );
          if (entry.hash !== expected) {
            throw new Error(`State journal tamper detected at seq ${entry.seq}: hash mismatch`);
          }
          prevHash = entry.hash;
          lastEntry = entry;
        }
        if (lastEntry) {
          this.lastHash = lastEntry.hash;
          this.seq = lastEntry.seq;
          return lastEntry.state;
        }
      }
    }

    if (fs.existsSync(this.snapshotPath)) {
      return JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8')) as PersistedRiskState;
    }
    return null;
  }

  save(event: string, state: PersistedRiskState, timestampMs: number): void {
    this.seq += 1;
    const hash = computeEntryHash(this.seq, timestampMs, event, state, this.lastHash);
    const entry: StateJournalEntry = {
      seq: this.seq,
      timestampMs,
      event,
      state,
      prevHash: this.lastHash,
      hash,
    };
    this.lastHash = hash;

    fs.appendFileSync(this.journalPath, `${JSON.stringify(entry)}\n`, 'utf8');

    // Atomic temp + rename for snapshot
    const tmpPath = `${this.snapshotPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.snapshotPath);
  }
}
