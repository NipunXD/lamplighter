// Run state: a snapshot plus the audit journal, updated by folding RunEvents. Incoming events are
// batched on a short timer (not rAF, which never fires in a hidden tab) so a fast stream never causes a render storm.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEvent, RunEvent, RunSnapshot } from '@shared/types';

export interface RunState {
  snapshot: RunSnapshot | null;
  journal: AuditEvent[];
  auditByCase: Map<string, AuditEvent[]>;
  error?: string;
}
export const JOURNAL_CAP = 900;
export const EMPTY_STATE: RunState = { snapshot: null, journal: [], auditByCase: new Map() };

export function applyBatch(prev: RunState, evs: RunEvent[]): RunState {
  let snapshot = prev.snapshot;
  let journal = prev.journal;
  let byCase = prev.auditByCase;
  let error = prev.error;
  let journalCloned = false;
  let mapCloned = false;
  let cases: RunSnapshot['cases'] | null = null; // cloned lazily, once per batch
  const addAudit = (e: AuditEvent) => {
    if (e.actor === 'simulator') return; // internal notes; the UI ignores them
    if (!journalCloned) { journal = journal.slice(); journalCloned = true; }
    journal.push(e);
    if (journal.length > JOURNAL_CAP) journal.splice(0, journal.length - JOURNAL_CAP);
    if (e.caseId) {
      if (!mapCloned) { byCase = new Map(byCase); mapCloned = true; }
      const list = byCase.get(e.caseId);
      if (list && list[list.length - 1]?.seq === e.seq) return;
      byCase.set(e.caseId, list ? [...list, e] : [e]);
    }
  };
  for (const ev of evs) {
    switch (ev.type) {
      case 'snapshot':
        snapshot = ev.snapshot;
        cases = null;
        journal = [];
        journalCloned = true;
        byCase = new Map();
        mapCloned = true;
        error = undefined;
        for (const e of ev.snapshot.auditTail) addAudit(e);
        break;
      case 'tick':
        if (snapshot) snapshot = { ...snapshot, simNow: ev.simNow, metrics: ev.metrics, lamplighter: ev.lamplighter };
        break;
      case 'case':
        if (snapshot) {
          if (!cases) cases = snapshot.cases.slice();
          const idx = cases.findIndex((c) => c.case.id === ev.state.case.id);
          if (idx >= 0) cases[idx] = ev.state; else cases.push(ev.state);
          snapshot = { ...snapshot, cases };
        }
        break;
      case 'audit':
        addAudit(ev.event);
        if (snapshot) snapshot = { ...snapshot, auditCount: Math.max(snapshot.auditCount + 1, ev.event.seq) };
        break;
      case 'lamplighter':
        if (snapshot) snapshot = { ...snapshot, lamplighter: ev.lamplighter };
        break;
      case 'done':
        if (snapshot) snapshot = { ...snapshot, status: 'done', metrics: ev.metrics, baseline: ev.baseline ?? snapshot.baseline };
        break;
      case 'error':
        error = ev.error;
        if (snapshot) snapshot = { ...snapshot, status: 'failed', error: ev.error };
        break;
    }
  }
  return { snapshot, journal, auditByCase: byCase, error };
}

export function useRunStore() {
  const [state, setState] = useState<RunState>(EMPTY_STATE);
  const queue = useRef<RunEvent[]>([]);
  const raf = useRef<number | null>(null); // pending flush timer
  const flush = useCallback(() => {
    raf.current = null;
    const evs = queue.current;
    queue.current = [];
    if (evs.length) setState((s) => applyBatch(s, evs));
  }, []);
  const ingest = useCallback((ev: RunEvent) => {
    queue.current.push(ev);
    if (raf.current == null) raf.current = window.setTimeout(flush, 16);
  }, [flush]);
  const reset = useCallback(() => {
    queue.current = [];
    if (raf.current != null) window.clearTimeout(raf.current);
    raf.current = null;
    setState(EMPTY_STATE);
  }, []);
  useEffect(() => () => { if (raf.current != null) window.clearTimeout(raf.current); }, []);
  return { state, ingest, reset };
}
