// The week in review: where the money went, over time, against the naive cron. Plain SVG, one axis per chart,
// fixed categorical colours that match the town, text in ink tokens.
import { useMemo } from 'react';
import type { CaseKind, CaseState, RunMetrics, RunSnapshot, TimelinePoint } from '@shared/types';
import { KIND_COLOR, KIND_LABEL, ROOT_CAUSE_LABEL, rupees } from '../format';

const OUT = { recovered: '#e0962c', escalated: '#5b6fa0', closed: '#9a8f96' } as const;
const KINDS: CaseKind[] = ['failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'];
const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', timeZone: 'Asia/Kolkata' });
const istHourOf = (iso: string) => { const d = new Date(iso); return ((d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440) / 60; };

function Timeline({ agent, cron, simStart }: { agent: TimelinePoint[]; cron?: TimelinePoint[]; simStart: string }) {
  const W = 640, H = 220, L = 56, R = 16, T = 14, B = 34;
  const n = agent.length;
  if (n < 2) return <p className="rv-empty">The timeline fills in as the week runs.</p>;
  const cronPts = cron && cron.length >= 2 ? cron.slice(0, n) : undefined;
  const maxY = Math.max(1, ...agent.map((p) => p.recoveredPaise), ...(cronPts ?? []).map((p) => p.recoveredPaise));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (pts: TimelinePoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.recoveredPaise).toFixed(1)}`).join(' ');
  // quiet-hour bands (21:00–09:00 IST) merged into runs
  const bands: Array<[number, number]> = [];
  agent.forEach((p, i) => { const h = istHourOf(p.t); const q = h >= 21 || h < 9; if (q) { const last = bands[bands.length - 1]; if (last && last[1] === i - 1) last[1] = i; else bands.push([i, i]); } });
  const days = agent.filter((p, i) => i % 24 === 0);
  const ticks = [0, 0.5, 1].map((f) => f * maxY);
  return (
    <svg className="rv-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative recovered rupees over the window, agent versus naive cron">
      {bands.map(([a, b], i) => <rect key={i} className="rv-quiet" x={x(a)} y={T} width={Math.max(1, x(b) - x(a))} height={H - T - B} fill="#2b2230" opacity="0.06" />)}
      {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#2b2230" opacity="0.12" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#7a6a72">{rupees(v)}</text></g>)}
      {days.map((p, i) => <text key={i} x={x(i * 24)} y={H - 12} textAnchor="middle" fontSize="10" fill="#7a6a72">{dayLabel(p.t)}</text>)}
      {cronPts && <path d={path(cronPts)} fill="none" stroke="#9a8f96" strokeWidth="2" strokeLinejoin="round" />}
      <path d={path(agent)} fill="none" stroke="#e0962c" strokeWidth="2.4" strokeLinejoin="round" />
      <g className="rv-legend" fontSize="11" fill="#2b2230">
        <rect x={L} y={T - 8} width="14" height="3" fill="#e0962c" /><text x={L + 20} y={T - 4}>Lamplighter</text>
        {cronPts && <><rect x={L + 110} y={T - 8} width="14" height="3" fill="#9a8f96" /><text x={L + 130} y={T - 4}>naive cron</text></>}
        <rect x={L + 220} y={T - 9} width="10" height="6" fill="#2b2230" opacity="0.12" /><text x={L + 236} y={T - 4}>quiet hours</text>
      </g>
      <text x={x(n - 1) - 4} y={y(agent[agent.length - 1].recoveredPaise) - 6} textAnchor="end" fontSize="11" fontWeight="700" fill="#2b2230">{rupees(agent[agent.length - 1].recoveredPaise)}</text>
    </svg>
  );
}

function Stacked({ rows }: { rows: Array<{ label: string; recovered: number; escalated: number; closed: number; other: number; note: string; colour?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.recovered + r.escalated + r.closed + r.other));
  return (
    <div className="rv-table">
      {rows.map((r) => {
        const total = r.recovered + r.escalated + r.closed + r.other;
        const seg = (n: number, fill: string, key: string) => n > 0 ? <div key={key} style={{ width: `${(n / max) * 100}%`, background: fill, marginRight: 2 }} /> : null;
        return (
          <div className="row" key={r.label}>
            <span className="lbl">{r.colour && <i className="sw" style={{ background: r.colour }} />}{r.label} <small className="muted">{total}</small></span>
            <div className="track" style={{ display: 'flex', height: 10 }}>{seg(r.recovered, OUT.recovered, 'r')}{seg(r.escalated, OUT.escalated, 'e')}{seg(r.closed, OUT.closed, 'c')}{seg(r.other, '#e9d8bf', 'o')}</div>
            <span className="val">{r.note}</span>
          </div>
        );
      })}
    </div>
  );
}

function Multiples({ m, b }: { m: RunMetrics; b: RunMetrics }) {
  const items: Array<{ label: string; a: number; c: number; fmt: (v: number) => string; lowerBetter?: boolean }> = [
    { label: 'recovered', a: m.recoveredPaise, c: b.recoveredPaise, fmt: (v) => rupees(v) },
    { label: 'touches / case', a: m.touchesPerCase, c: b.touchesPerCase, fmt: (v) => v.toFixed(2), lowerBetter: true },
    { label: 'complaints', a: m.complaints, c: b.complaints, fmt: (v) => String(v), lowerBetter: true },
    { label: 'policy violations', a: m.policyViolations, c: b.policyViolations, fmt: (v) => String(v), lowerBetter: true },
    { label: 'spend', a: m.costPaise, c: b.costPaise, fmt: (v) => rupees(v), lowerBetter: true },
  ];
  return (
    <div className="rv-multiples">
      {items.map((it) => {
        const max = Math.max(it.a, it.c, 1e-9);
        const win = it.lowerBetter ? it.a <= it.c : it.a >= it.c;
        return (
          <div className="rv-mini" key={it.label}>
            <div className="lbl">{it.label}</div>
            <div className="track" style={{ display: 'grid', gap: 4 }}>
              <div style={{ height: 8, width: `${(it.a / max) * 100}%`, background: '#e0962c', borderRadius: 2 }} />
              <div style={{ height: 8, width: `${(it.c / max) * 100}%`, background: '#9a8f96', borderRadius: 2 }} />
            </div>
            <div className="val"><b className={win ? 'good' : 'warn'}>{it.fmt(it.a)}</b> <span className="muted">vs {it.fmt(it.c)}</span></div>
          </div>
        );
      })}
    </div>
  );
}

export function WeekInReview({ snapshot, onClose, live }: { snapshot: RunSnapshot; onClose: () => void; live?: boolean }) {
  const m = snapshot.metrics; const b = snapshot.baseline;
  const byKind = useMemo(() => KINDS.map((k) => {
    const cs = snapshot.cases.filter((c) => c.case.kind === k);
    const cnt = (s: CaseState['status']) => cs.filter((c) => c.status === s).length;
    const rec = cs.filter((c) => c.status === 'recovered').reduce((t, c) => t + c.recoveredPaise, 0);
    const risk = cs.reduce((t, c) => t + c.case.amountPaise, 0);
    return { label: KIND_LABEL[k], colour: KIND_COLOR[k], recovered: cnt('recovered'), escalated: cnt('escalated'), closed: cnt('closed'), other: cs.length - cnt('recovered') - cnt('escalated') - cnt('closed'), note: `${rupees(rec)} of ${rupees(risk)}` };
  }), [snapshot.cases]);
  const byCause = useMemo(() => {
    const map = new Map<string, { recovered: number; escalated: number; closed: number; other: number; rec: number }>();
    for (const c of snapshot.cases) {
      const k = c.diagnosis?.rootCause ?? 'undiagnosed';
      const e = map.get(k) ?? { recovered: 0, escalated: 0, closed: 0, other: 0, rec: 0 };
      if (c.status === 'recovered') { e.recovered++; e.rec += c.recoveredPaise; } else if (c.status === 'escalated') e.escalated++; else if (c.status === 'closed') e.closed++; else e.other++;
      map.set(k, e);
    }
    return [...map.entries()].sort((x, y) => (y[1].recovered + y[1].escalated + y[1].closed + y[1].other) - (x[1].recovered + x[1].escalated + x[1].closed + x[1].other))
      .map(([k, e]) => ({ label: (ROOT_CAUSE_LABEL as Record<string, string>)[k] ?? k, recovered: e.recovered, escalated: e.escalated, closed: e.closed, other: e.other, note: rupees(e.rec) }));
  }, [snapshot.cases]);
  const d = m.diagnosis;
  const take = b
    ? `${live ? 'So far' : 'Over the window'} the agent recovered ${rupees(m.recoveredPaise)} (${pctOf(m.recoveredPaise, m.atRiskPaise)} of ${rupees(m.atRiskPaise)}) against ${rupees(b.recoveredPaise)} for a naive cron on the same customers, with ${m.touchesPerCase.toFixed(2)} touches per case instead of ${b.touchesPerCase.toFixed(2)}, ${m.complaints} complaint${m.complaints === 1 ? '' : 's'} instead of ${b.complaints}, and ${m.policyViolations} policy violations instead of ${b.policyViolations}.`
    : `${live ? 'So far' : 'Over the window'} the agent recovered ${rupees(m.recoveredPaise)} (${pctOf(m.recoveredPaise, m.atRiskPaise)} of ${rupees(m.atRiskPaise)}) with ${m.touchesPerCase.toFixed(2)} touches per case and ${m.complaints} complaint${m.complaints === 1 ? '' : 's'}.`;
  const tile = (v: string, l: string, sub?: string) => (
    <div className="rv-tile" style={{ display: 'grid', gap: 3, alignContent: 'start' }}>
      <b className="num" style={{ display: 'block', fontSize: 22, lineHeight: 1.1 }}>{v}</b>
      <span className="lbl" style={{ display: 'block', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.75 }}>{l}</span>
      {sub && <span className="sub muted" style={{ display: 'block', fontSize: 11 }}>{sub}</span>}
    </div>
  );
  return (
    <section className="review" aria-label="The week in review">
      <header className="review-head">
        <div><h2>The week in review</h2><p className="sub muted">Saanjh &amp; Co. · {m.cases} lanterns · {live ? 'live, still running' : 'final'}</p></div>
        <button type="button" className="close" onClick={onClose} aria-label="Close review">×</button>
      </header>
      <div className="review-body">
        <p className="rv-take">{take}</p>
        <div className="rv-tiles">
          {tile(rupees(m.recoveredPaise), `recovered of ${rupees(m.atRiskPaise)}`, b ? `naive cron: ${rupees(b.recoveredPaise)}` : undefined)}
          {tile(`${m.recoveredCases} / ${m.cases}`, 'cases recovered', b ? `naive cron: ${b.recoveredCases}` : undefined)}
          {tile(String(m.complaints), 'complaints', b ? `naive cron: ${b.complaints}` : undefined)}
          {tile(String(m.policyViolations), 'policy violations', b ? `naive cron: ${b.policyViolations}` : undefined)}
        </div>
        <div className="rv-card"><div className="rv-card-head"><h3>Recovery over time</h3><span className="muted">cumulative ₹ · shaded bands are quiet hours (21:00–09:00 IST)</span></div>
          <Timeline agent={snapshot.timeline ?? []} cron={snapshot.baselineTimeline} simStart={snapshot.simStart} /></div>
        <div className="rv-grid">
          <div className="rv-card"><div className="rv-card-head"><h3>By kind</h3><span className="muted"><i className="sw" style={{ background: OUT.recovered }} /> recovered <i className="sw" style={{ background: OUT.escalated }} /> escalated <i className="sw" style={{ background: OUT.closed }} /> closed</span></div><Stacked rows={byKind} /></div>
          <div className="rv-card"><div className="rv-card-head"><h3>By root cause</h3><span className="muted">recovered ₹ at the end of each row</span></div><Stacked rows={byCause} /></div>
        </div>
        <div className="rv-grid">
          {b && <div className="rv-card"><div className="rv-card-head"><h3>Agent vs naive cron</h3><span className="muted">same seeded customers</span></div><Multiples m={m} b={b} /></div>}
          <div className="rv-card"><div className="rv-card-head"><h3>Diagnosis &amp; reliability</h3></div>
            <div className="rv-strip">
              {tile(d.n ? pctOf(d.rulesCorrect, d.n) : '—', 'rules-only accuracy')}
              {tile(d.n ? pctOf(d.finalCorrect, d.n) : '—', 'with local model', `${d.llmOverrides} overrides · ${d.llmOverridesCorrect} correct`)}
              {tile(String(m.llmCalls), 'model calls', `${m.llmFallbacks} fallbacks · ${m.llmAvgMs} ms avg`)}
              {tile(String(m.realRazorpayOrders), 'Razorpay orders', `${m.realRazorpayPaid} paid via Checkout · ${m.razorpayRetries} retries`)}
              {tile(String(m.deferredForQuietHours), 'deferred for quiet hours')}
              {tile(String(snapshot.auditCount), 'audit events', 'hash-chained')}
            </div>
          </div>
        </div>
        <p className="sub muted">Customers are simulated with hidden state the agent never reads; recovered means the simulated customer paid inside the window, or a real Razorpay Checkout payment was verified.</p>
      </div>
    </section>
  );
}
