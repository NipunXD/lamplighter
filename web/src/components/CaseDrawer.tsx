// Case drawer: what happened, the diagnosis, what the policy allowed, every touch, and the outcome.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEvent, CaseState } from '@shared/types';
import { actionLabel, CHANNEL_LABEL, fmtDateTime, fmtHours, hoursBetween, KIND_COLOR, KIND_LABEL, pct, ROOT_CAUSE_LABEL, RULE_LABEL, rupees, SEGMENT_LABEL, STATUS_LABEL } from '../format';
import { parseCandidates } from '../narrate';

interface Props {
  st: CaseState | null;
  audit: AuditEvent[];
  open: boolean;
  canAct: boolean;
  onClose(): void;
  onStop(): Promise<{ ok: boolean }>;
  onPaid(): Promise<{ ok: boolean; via?: string }>;
}

export function CaseDrawer({ st, audit, open, canAct, onClose, onStop, onPaid }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<'stop' | 'paid' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open, st?.case.id]);
  useEffect(() => { setResult(null); }, [st?.case.id]);

  const candidates = useMemo(() => {
    const last = [...audit].reverse().find((e) => e.actor === 'policy' && e.type === 'candidates_evaluated');
    return last ? { at: last.simTs, list: parseCandidates(last.payload ?? {}) } : null;
  }, [audit]);

  if (!st) return <aside className={`drawer${open ? ' open' : ''}`} aria-hidden="true" />;
  const c = st.case;
  const terminal = st.status === 'recovered' || st.status === 'escalated' || st.status === 'closed';
  const act = async (which: 'stop' | 'paid') => {
    setBusy(which);
    setResult(null);
    try {
      if (which === 'stop') { const r = await onStop(); setResult(r.ok ? 'STOP recorded: the case is closed and the customer will never be contacted again.' : 'Could not record STOP (case already settled?).'); }
      else { const r = await onPaid(); setResult(r.ok ? `Marked paid via ${r.via ?? 'simulated'}${r.via === 'razorpay' ? ' (a captured payment was found on the Razorpay order)' : ' (manual override, audited)'}.` : 'Could not mark paid (case already settled?).'); }
    } catch (e) { setResult(`Failed: ${(e as Error).message}`); }
    setBusy(null);
  };
  const days = c.daysOverdue !== undefined ? c.daysOverdue : undefined;
  const sentLangs = new Map(audit.filter((e) => e.type === 'message_sent' || e.type === 'call_placed').map((e) => [e.simTs, String(e.payload?.lang ?? c.customer.lang)]));

  return (
    <aside className={`drawer${open ? ' open' : ''}`} role="dialog" aria-modal="false" aria-label={`Case: ${c.customer.name}`}>
      <div className="drawer-head">
        <div style={{ minWidth: 0 }}>
          <h2>{c.customer.name}</h2>
          <div className="sub">{c.customer.city} · {SEGMENT_LABEL[c.customer.segment]} · {c.customer.lang === 'hinglish' ? 'Hinglish' : 'English'} · {c.description}</div>
          <div className="tags">
            <span className="tag kind" style={{ background: KIND_COLOR[c.kind] }}>{KIND_LABEL[c.kind]}</span>
            <span className={`tag status-${st.status}`}>{STATUS_LABEL[st.status]}</span>
            {c.customer.dnd && <span className="tag dnd">DND registry</span>}
            {st.doNotContact && <span className="tag dnd">do not contact</span>}
            {st.complained && <span className="tag dnd">complained</span>}
            <span className="tag mono">{c.id.slice(0, 12)}…</span>
          </div>
        </div>
        <div className="amount">{rupees(c.amountPaise)}</div>
        <button ref={closeRef} type="button" className="close" onClick={onClose} aria-label="close">×</button>
      </div>

      <div className="drawer-body">
        <section className="dsec">
          <h4><span className="n">1</span>What happened</h4>
          <p>{c.description} · created {fmtDateTime(c.createdAt)} · {c.attemptsBefore} attempt{c.attemptsBefore === 1 ? '' : 's'} before we stepped in{days !== undefined ? ` · ${days} days overdue` : ''}.</p>
          {c.failure ? (
            <div className="mono block">{`code:   ${c.failure.code}\nreason: ${c.failure.reason}\nsource: ${c.failure.source} · step: ${c.failure.step} · method: ${c.failure.method}\n${c.failure.description}`}</div>
          ) : (
            <div className="mono block">{c.kind === 'overdue_invoice' ? `invoice ${c.razorpay.invoiceId ?? ''} · ${days ?? 0} days overdue` : `order ${c.razorpay.orderId ?? ''} · checkout never completed`}</div>
          )}
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>channels</dt><dd>{(Object.keys(c.customer.channels) as Array<keyof typeof c.customer.channels>).filter((k) => c.customer.channels[k]).map((k) => CHANNEL_LABEL[k]).join(', ') || 'none'}</dd>
            <dt>lifetime value</dt><dd>{rupees(c.customer.ltvPaise)} · {c.customer.pastFailures} past failure{c.customer.pastFailures === 1 ? '' : 's'}</dd>
            {(c.razorpay.orderId || c.razorpay.subscriptionId || c.razorpay.invoiceId) && <><dt>original entity</dt><dd className="mono">{c.razorpay.orderId ?? c.razorpay.subscriptionId ?? c.razorpay.invoiceId}</dd></>}
            {st.razorpay.recoveryOrderId && <><dt>recovery order</dt><dd className="mono">{st.razorpay.recoveryOrderId}{st.razorpay.payUrl && <> · <a href={st.razorpay.payUrl} target="_blank" rel="noreferrer">checkout page</a></>}</dd></>}
            {st.razorpay.paymentId && <><dt>payment</dt><dd className="mono">{st.razorpay.paymentId}</dd></>}
            {st.apiFailures ? <><dt>API failures</dt><dd>{st.apiFailures}</dd></> : null}
          </dl>
        </section>

        <section className="dsec">
          <h4><span className="n">2</span>Diagnosis</h4>
          {st.diagnosis ? (
            <>
              <p><b>{ROOT_CAUSE_LABEL[st.diagnosis.rootCause]}</b> <span className="muted">· source: {st.diagnosis.source}</span></p>
              <div className="conf"><span>confidence</span><div className="bar"><i style={{ '--p': st.diagnosis.confidence } as React.CSSProperties} /></div><b>{pct(st.diagnosis.confidence)}</b></div>
              <p className="muted">{st.diagnosis.reasoning}</p>
              {st.diagnosis.llmDisagreed && <div className="note">The local LLM disagreed with the rules and its reading was kept: it parsed the raw bank message, which the rules layer deliberately does not.</div>}
            </>
          ) : <p className="muted">Not diagnosed yet — the lamplighter hasn't reached this house.</p>}
        </section>

        <section className="dsec">
          <h4><span className="n">3</span>What the policy allowed{candidates && <span className="muted" style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 400 }}>· evaluated {fmtDateTime(candidates.at)}</span>}</h4>
          {candidates ? (
            <ul className="cands">
              {candidates.list.map((k, i) => (
                <li key={i} className={`cand${k.allowed ? '' : ' blocked'}`}>
                  <span className={k.allowed ? 'ok' : 'no'}>{k.allowed ? '✓' : '✗'}</span>
                  <span className="lbl">{actionLabel(k.type, k.channel)}</span>
                  <span className="ev">EV {rupees(k.ev)} · cost {rupees(k.cost, { decimals: true })}</span>
                  {k.failed.length > 0 && <span className="rules">{k.failed.map((r) => <span key={r} className="rule" title={RULE_LABEL[r] ?? r}>{r}</span>)}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="muted">No policy evaluation yet.</p>}
        </section>

        <section className="dsec">
          <h4><span className="n">4</span>Touches <span className="muted" style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 400 }}>· {st.touches.length} of max 3 customer-facing</span></h4>
          {st.touches.length ? st.touches.map((t, i) => (
            <div key={i} className="touch">
              <div className="th">
                <b>{actionLabel(t.action, t.channel)}</b>
                <time>{fmtDateTime(t.at)}</time>
                {t.channel && t.channel !== 'voice' && <span className="muted">{sentLangs.get(t.at) ?? c.customer.lang}</span>}
                <span className="muted">cost {rupees(t.costPaise, { decimals: true })}</span>
                {t.payUrl && <a href={t.payUrl} target="_blank" rel="noreferrer" title={t.orderId}>{t.orderId?.startsWith('order_sim') ? 'simulated checkout' : 'Razorpay checkout'}</a>}
              </div>
              {t.message && <div className={`msg${t.channel === 'whatsapp' ? ' wa' : ''}`}>{t.message}</div>}
              {t.action === 'wait_and_retry' && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>No customer contact: the saved instrument is debited again when the bank should say yes.</div>}
            </div>
          )) : <p className="muted">No touches yet.</p>}
          {st.nextActionAt && !terminal && <p className="muted">Next action at {fmtDateTime(st.nextActionAt)}.</p>}
        </section>

        <section className="dsec">
          <h4><span className="n">5</span>Outcome</h4>
          {st.status === 'recovered' && <div className="outcome recovered">Recovered {rupees(st.recoveredPaise)} via {st.recoveredVia ?? 'simulated'}{st.recoveredAt ? ` · ${fmtDateTime(st.recoveredAt)}` : ''}{st.recoveredAt && st.touches[0] ? ` · ${fmtHours(hoursBetween(st.touches[0].at, st.recoveredAt))} after the first touch` : ''}{st.incentiveUsed ? ' · 10% incentive used' : ''}</div>}
          {st.status === 'escalated' && <div className="outcome escalated">Escalated to a human — {st.escalationReason ?? 'reason not recorded'}</div>}
          {st.status === 'closed' && <div className="outcome closed">Closed — {st.closeReason ?? 'stopping rule reached'}{st.doNotContact ? ' · never contact again' : ''}</div>}
          {!terminal && <div className="outcome pending">{st.status === 'awaiting_customer' ? 'Waiting on the customer.' : st.status === 'scheduled' ? 'Scheduled: the lamplighter decided to wait.' : 'Open: not yet worked.'} Spent {rupees(st.costPaise, { decimals: true })} so far.</div>}
          {st.lastError && <p className="muted mono" style={{ fontSize: 11 }}>last error: {st.lastError}</p>}
        </section>
      </div>

      <div className="actions">
        <button type="button" className="btn" disabled={!canAct || terminal || busy !== null} onClick={() => act('stop')}>{busy === 'stop' ? '…' : 'Customer replies STOP'}</button>
        <button type="button" className="btn" disabled={!canAct || terminal || busy !== null} onClick={() => act('paid')}>{busy === 'paid' ? '…' : 'Mark paid'}</button>
        <span className="hint">{result ?? (!canAct ? 'Start a run to simulate customer events.' : terminal ? 'Settled: no further actions.' : 'Simulate the customer from here; both are audited.')}</span>
      </div>
    </aside>
  );
}
