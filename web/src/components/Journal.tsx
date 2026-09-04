// The journal: the audit trail narrated in plain English, newest at the bottom, filter by actor,
// and a hash-chain badge that asks the server to re-verify the chain.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { AuditEvent, CaseState } from '@shared/types';
import { fmtDate, fmtTime, istDayIndex } from '../format';
import { narrate } from '../narrate';

const ACTORS = ['agent', 'policy', 'llm', 'razorpay', 'customer', 'system'] as const;
type Actor = (typeof ACTORS)[number];
const RENDER_CAP = 320;

interface Props {
  events: AuditEvent[];
  casesById: Map<string, CaseState>;
  auditCount: number;
  hasRun: boolean;
  onOpenCase(id: string): void;
  onVerify(): Promise<{ ok: boolean; brokenAt?: number }>;
}

export function Journal({ events, casesById, auditCount, hasRun, onOpenCase, onVerify }: Props) {
  const [filters, setFilters] = useState<Set<Actor>>(() => new Set(ACTORS));
  const [pinned, setPinned] = useState(true);
  const [verify, setVerify] = useState<{ state: 'idle' | 'checking' | 'ok' | 'broken'; at?: number }>({ state: 'idle' });
  const feedRef = useRef<HTMLOListElement>(null);

  const shown = useMemo(() => {
    const f = filters.size === ACTORS.length ? events : events.filter((e) => filters.has(e.actor as Actor));
    return f.length > RENDER_CAP ? f.slice(-RENDER_CAP) : f;
  }, [events, filters]);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [shown, pinned]);

  const onScroll = (e: UIEvent<HTMLOListElement>) => {
    const el = e.currentTarget;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };
  const toggle = (a: Actor) => setFilters((s) => {
    const n = new Set(s);
    if (n.has(a)) { if (n.size > 1) n.delete(a); } else n.add(a);
    return n;
  });
  const runVerify = async () => {
    setVerify({ state: 'checking' });
    try {
      const r = await onVerify();
      setVerify(r.ok ? { state: 'ok' } : { state: 'broken', at: r.brokenAt });
    } catch { setVerify({ state: 'broken' }); }
    window.setTimeout(() => setVerify((v) => (v.state === 'ok' ? { state: 'idle' } : v)), 3000);
  };

  const rows: ReactNode[] = [];
  let lastDay = -1;
  for (const e of shown) {
    const day = istDayIndex(e.simTs);
    if (day !== lastDay) { rows.push(<li key={`day-${day}`} className="jday">{fmtDate(e.simTs)}</li>); lastDay = day; }
    const cs = e.caseId ? casesById.get(e.caseId) : undefined;
    const n = narrate(e, cs);
    rows.push(
      <li key={e.seq} className={`jl${e.caseId ? ' clickable' : ''}`} onClick={e.caseId ? () => onOpenCase(e.caseId!) : undefined} title={e.caseId ? `open ${cs?.case.customer.name ?? 'case'}` : undefined}>
        <span className={`actor actor-${e.actor}`}>{e.actor}</span>
        <time dateTime={e.simTs}>{fmtTime(e.simTs)}</time>
        <span className="txt">
          {n.text}
          {n.link && <> (<a href={n.link.href} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>{n.link.label}</a>)</>}
        </span>
      </li>,
    );
  }

  return (
    <section className="card journal" aria-label="Journal">
      <div className="journal-head">
        <h2>Journal</h2>
        <div className="chips" role="group" aria-label="filter by actor">
          {ACTORS.map((a) => <button key={a} type="button" className={`chip actor-${a}`} aria-pressed={filters.has(a)} onClick={() => toggle(a)}>{a}</button>)}
        </div>
        <button type="button" className={`chain ${verify.state}`} onClick={runVerify} disabled={!hasRun || verify.state === 'checking'} title="Recompute the hash chain on the server">
          {verify.state === 'checking' ? 'verifying…' : verify.state === 'ok' ? '✓ chain intact' : verify.state === 'broken' ? `✗ chain broken${verify.at ? ` at #${verify.at}` : ''}` : `audit chain ✓ ${auditCount} events`}
        </button>
      </div>
      <ol className="feed" ref={feedRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {rows.length ? rows : <li className="feed-empty">Nothing yet. Every diagnosis, policy check, Razorpay call and customer reply will be narrated here, hash-chained and in IST.</li>}
      </ol>
      {!pinned && rows.length > 0 && <button type="button" className="to-bottom" onClick={() => { setPinned(true); const el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }}>↓ newest</button>}
    </section>
  );
}
