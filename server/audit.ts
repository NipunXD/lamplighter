// Append-only, hash-chained audit log. Every decision, API call, policy check and customer event lands here.
import { createHash } from 'node:crypto';
import type { AuditEvent } from './types.js';

export class AuditLog {
  readonly events: AuditEvent[] = [];
  private listeners: Array<(e: AuditEvent) => void> = [];

  append(input: Omit<AuditEvent, 'seq' | 'ts' | 'prevHash' | 'hash'>): AuditEvent {
    const prevHash = this.events.length ? this.events[this.events.length - 1].hash : 'genesis';
    const seq = this.events.length + 1;
    const ts = new Date().toISOString();
    const body = JSON.stringify({ seq, ts, ...input, prevHash });
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const e: AuditEvent = { seq, ts, ...input, prevHash, hash };
    this.events.push(e);
    for (const l of this.listeners) l(e);
    return e;
  }

  onEvent(fn: (e: AuditEvent) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  /** Recompute the chain; any edited or removed event breaks it. */
  verify(): { ok: boolean; brokenAt?: number } {
    let prev = 'genesis';
    for (const e of this.events) {
      const { hash, prevHash, ...rest } = e;
      if (prevHash !== prev) return { ok: false, brokenAt: e.seq };
      const expect = createHash('sha256').update(JSON.stringify({ ...rest, prevHash })).digest('hex').slice(0, 16);
      if (expect !== hash) return { ok: false, brokenAt: e.seq };
      prev = hash;
    }
    return { ok: true };
  }

  toJSONL(): string { return this.events.map((e) => JSON.stringify(e)).join('\n') + '\n'; }
}
