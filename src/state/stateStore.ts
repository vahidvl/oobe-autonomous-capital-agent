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

export interface PersistedReceipt {
  readonly idempotencyKey: string;
  readonly status: 'SIMULATED' | 'REJECTED';
  readonly reason: string;
  readonly quoteOutAmount?: string;
  readonly executedAtMs: number;
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

function appendLineSync(filePath: string, line: string): void {
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeFileSync(fd, line, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeAtomicSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

/**
 * Crash-safe, append-only hash-chained JSONL store with atomic snapshot persistence
 * and idempotent execution receipt tracking.
 */
export class RiskStateStore {
  private readonly snapshotPath: string;
  private readonly journalPath: string;
  private readonly receiptsPath: string;
  private lastHash = GENESIS_HASH;
  private seq = 0;

  constructor(stateDir: string) {
    fs.mkdirSync(stateDir, { recursive: true });
    this.snapshotPath = path.join(stateDir, 'risk-state.json');
    this.journalPath = path.join(stateDir, 'risk-journal.jsonl');
    this.receiptsPath = path.join(stateDir, 'receipts.json');
  }

  load(): PersistedRiskState | null {
    if (fs.existsSync(this.journalPath)) {
      const raw = fs.readFileSync(this.journalPath, 'utf8').trim();
      if (raw.length > 0) {
        const lines = raw.split('\n');
        let prevHash = GENESIS_HASH;
        let lastEntry: StateJournalEntry | null = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const isLastLine = i === lines.length - 1;
          let entry: StateJournalEntry;
          try {
            entry = JSON.parse(line) as StateJournalEntry;
          } catch (err) {
            // Tolerate a truncated/torn trailing line from an unclean crash
            if (isLastLine) {
              break;
            }
            throw err;
          }

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

    appendLineSync(this.journalPath, `${JSON.stringify(entry)}\n`);
    writeAtomicSync(this.snapshotPath, JSON.stringify(state, null, 2));
  }

  private loadAllReceipts(): Record<string, PersistedReceipt> {
    if (!fs.existsSync(this.receiptsPath)) return {};
    return JSON.parse(fs.readFileSync(this.receiptsPath, 'utf8')) as Record<string, PersistedReceipt>;
  }

  getReceipt(idempotencyKey: string): PersistedReceipt | null {
    const all = this.loadAllReceipts();
    return all[idempotencyKey] ?? null;
  }

  saveReceipt(receipt: PersistedReceipt): void {
    const all = this.loadAllReceipts();
    all[receipt.idempotencyKey] = receipt;
    writeAtomicSync(this.receiptsPath, JSON.stringify(all, null, 2));
  }
}
