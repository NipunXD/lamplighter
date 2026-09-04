// The ledger: big numbers first, then the policy-shaped counters and a compact "vs naive retry" row.
import type { CSSProperties } from 'react';
import type { RunMetrics } from '@shared/types';
import { KIND_COLOR, KIND_LABEL, KIND_ORDER, pct, rupees } from '../format';
import type { RunPhase } from './TopBar';

interface Props { metrics: RunMetrics | null; baseline?: RunMetrics; previewAtRisk: number; previewCount: number; phase: RunPhase }

function costPerRupee(x: number): string {
  if (!x) return '—';
  return `₹${x.toFixed(x < 0.01 ? 3 : 2)}`;
}

export function Ledger({ metrics: m, baseline: b, previewAtRisk, previewCount, phase }: Props) {
  const atRisk = m?.atRiskPaise ?? previewAtRisk;
  const recovered = m?.recoveredPaise ?? 0;
  const rate = atRisk ? recovered / atRisk : 0;
  const stat = (value: string | number, label: string, tone?: 'warn' | 'good') => (
    <div className={`stat${tone ? ` ${tone}` : ''}`}><b>{value}</b><span>{label}</span></div>
  );
  return (
    <section className="card ledger" aria-label="Ledger">
      <div className="eyebrow"><span>Ledger · {m?.cases ?? previewCount} lanterns</span><span className={phase === 'running' ? 'live' : ''}>{phase === 'idle' ? 'before the run' : phase === 'running' ? 'live' : phase === 'done' ? 'final' : 'failed'}</span></div>
      <div className="big">
        <span className="big-num">{rupees(recovered)}</span>
        <span className="big-of">recovered of {rupees(atRisk)} at risk</span>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={Math.round(rate * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ '--p': rate } as CSSProperties} /></div>
      <div className="stats">
        {stat(m ? pct(m.recoveryRate) : '—', 'recovered by value')}
        {stat(m ? `${pct(m.recoveryRateCases)} · ${m.recoveredCases}` : '—', 'recovered by cases')}
        {stat(m ? costPerRupee(m.costPerRecoveredRupee) : '—', 'cost per ₹1 recovered')}
        {stat(m ? m.touchesPerCase.toFixed(1) : '—', 'touches per case')}
        {stat(m?.escalated ?? '—', 'escalated to humans')}
        {stat(m?.closed ?? '—', 'closed')}
        {stat(m?.complaints ?? '—', 'complaints', m && m.complaints > 0 ? 'warn' : undefined)}
        {stat(m?.stopRequests ?? '—', 'STOP requests')}
        {stat(m ? rupees(m.incentiveSpentPaise) : '—', 'incentive spent')}
        {stat(m?.deferredForQuietHours ?? '—', 'deferred for quiet hours')}
        {stat(m?.realRazorpayOrders ?? '—', 'real Razorpay orders')}
        {stat(m?.realRazorpayPaid ?? '—', 'paid on Razorpay checkout', m && m.realRazorpayPaid > 0 ? 'good' : undefined)}
      </div>
      {m && b && (
        <div className="vs" title="Naive retry: an SMS link every 24h, three times, at any hour, ignoring DND and STOP">
          <b>vs naive retry</b>
          <span>recovered <em>agent</em> <span className={m.recoveredPaise >= b.recoveredPaise ? 'win' : 'lose'}>{rupees(m.recoveredPaise)}</span> <em>vs</em> {rupees(b.recoveredPaise)}</span>
          <span>complaints <span className={m.complaints <= b.complaints ? 'win' : 'lose'}>{m.complaints}</span> <em>vs</em> {b.complaints}</span>
          <span>policy violations <span className="win">{m.policyViolations}</span> <em>vs</em> {b.policyViolations}</span>
        </div>
      )}
      <div className="kinds">
        {KIND_ORDER.map((k) => {
          const bk = m?.byKind?.[k];
          const risk = bk?.atRiskPaise ?? 0;
          const rec = bk?.recoveredPaise ?? 0;
          return (
            <div key={k} className="kind">
              <div className="kind-label"><i style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]}s</div>
              <div className="bar mini"><i style={{ '--p': risk ? rec / risk : 0, background: KIND_COLOR[k] } as CSSProperties} /></div>
              <div className="kind-num">{bk ? `${rupees(rec)} / ${rupees(risk)}` : '—'}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
