const langName = (l?: string) => (l === 'hinglish' ? 'Hinglish' : l === 'en' ? 'English' : l ?? '');
// Turns an AuditEvent into one plain-English journal line. Payload fields are read defensively and
// follow the shapes server/engine.ts logs, so a slightly different backend still reads sensibly.
import type { AuditEvent, CaseState } from '@shared/types';
import { actionLabel, CHANNEL_LABEL, firstName, fmtDate, fmtDateTime, fmtHours, KIND_LABEL, pct, ROOT_CAUSE_LABEL, rupees } from './format';

export interface Narration { text: string; link?: { href: string; label: string } }

type P = Record<string, unknown>;
const obj = (v: unknown): P => (v && typeof v === 'object' ? (v as P) : {});
const str = (p: P, k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
const num = (p: P, k: string): number | undefined => (typeof p[k] === 'number' ? (p[k] as number) : undefined);
const bool = (p: P, k: string): boolean | undefined => (typeof p[k] === 'boolean' ? (p[k] as boolean) : undefined);
const chan = (c?: string) => (c ? (CHANNEL_LABEL as Record<string, string>)[c] ?? c : undefined);
const cause = (c?: string) => (c ? (ROOT_CAUSE_LABEL as Record<string, string>)[c] ?? c.replace(/_/g, ' ') : 'unknown');
const kindOf = (k?: string) => (k ? ((KIND_LABEL as Record<string, string>)[k] ?? k.replace(/_/g, ' ')).toLowerCase() : 'case');
const nudge = (action?: string) => (action === 'voice_call' ? 'call' : action === 'offer_incentive' ? 'offer' : action === 'new_mandate_link' ? 'mandate link' : 'nudge');
const took = (ms?: number) => (ms === undefined ? '' : ` in ${ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}`);

export interface Candidate { type: string; channel?: string; allowed: boolean; ev: number; cost: number; failed: string[]; deferUntil?: string }
export function parseCandidates(p: P): Candidate[] {
  const raw = p.candidates;
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const o = obj(c);
    return {
      type: str(o, 'type') ?? 'unknown',
      channel: str(o, 'channel'),
      allowed: bool(o, 'allowed') ?? false,
      ev: num(o, 'ev') ?? 0,
      cost: num(o, 'cost') ?? 0,
      failed: Array.isArray(o.failed) ? (o.failed as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      deferUntil: str(o, 'deferUntil'),
    };
  });
}

export function narrate(e: AuditEvent, cs?: CaseState): Narration {
  const p = e.payload ?? {};
  const custObj = obj(p.customer);
  const name = cs ? firstName(cs.case.customer.name) : str(custObj, 'name') ? firstName(str(custObj, 'name')!) : str(p, 'customer') ?? 'the customer';
  const t = e.type;
  const amountPaise = num(p, 'amountPaise') ?? num(p, 'amount');
  switch (e.actor) {
    case 'system': {
      if (t === 'run_started') {
        const cfg = obj(p.config);
        const seed = num(cfg, 'seed') ?? num(p, 'seed');
        const size = num(cfg, 'size') ?? num(p, 'cases') ?? num(p, 'size');
        const llm = bool(p, 'llm') ?? bool(cfg, 'llm');
        const rzp = bool(p, 'razorpay') ?? bool(cfg, 'razorpay');
        const risk = num(p, 'atRiskPaise');
        const bits = [seed !== undefined ? `seed ${seed}` : '', size !== undefined ? `${size} cases` : '', risk !== undefined ? `${rupees(risk)} at risk` : '', llm === false ? 'rules only' : llm ? 'local LLM on' : '', rzp ? 'real Razorpay test orders' : rzp === false ? 'simulated orders' : ''].filter(Boolean);
        return { text: `Run started${bits.length ? ` · ${bits.join(', ')}` : ''}` };
      }
      if (t === 'run_finished') {
        const m = obj(p.metrics);
        const rec = num(m, 'recoveredPaise') ?? num(p, 'recoveredPaise');
        const risk = num(m, 'atRiskPaise') ?? num(p, 'atRiskPaise');
        const chain = obj(p.auditChain);
        return { text: `Run finished${rec !== undefined && risk !== undefined ? ` · recovered ${rupees(rec)} of ${rupees(risk)} at risk` : ''}${bool(chain, 'ok') ? ' · audit chain verified' : ''}` };
      }
      if (t === 'run_failed') return { text: `Run failed — ${str(p, 'error') ?? 'unknown error'}` };
      if (t === 'budget_set') {
        const b = num(p, 'incentiveBudgetPaise') ?? num(p, 'budgetPaise');
        return { text: b !== undefined ? `Incentive budget set to ${rupees(b)} for the week · max 3 touches, quiet hours 21:00–09:00 IST` : 'Budget and policy set' };
      }
      if (t === 'manual_override') return { text: `Operator override — ${str(p, 'note') ?? 'manual action'}` };
      break;
    }
    case 'agent':
      switch (t) {
        case 'case_opened': return { text: `Opened ${name}'s ${kindOf(str(p, 'kind') ?? cs?.case.kind)} · ${rupees(amountPaise ?? cs?.case.amountPaise ?? 0)}` };
        case 'diagnosis': {
          const conf = num(p, 'confidence');
          const src = str(p, 'source');
          return { text: `Diagnosis: ${cause(str(p, 'rootCause'))}${conf !== undefined ? ` (${pct(conf)}${src ? ` · ${src}` : ''})` : ''}${bool(p, 'llmDisagreed') ? ' — the LLM overrode the rules' : ''}` };
        }
        case 'plan': {
          const a = str(p, 'action') ?? str(p, 'type') ?? 'action';
          const src = str(p, 'source');
          const reason = str(p, 'reason') ?? str(p, 'why');
          return { text: `Plan: ${actionLabel(a, str(p, 'channel'))}${src === 'fallback' ? ' (rules fallback)' : src === 'llm' ? ' (LLM pick)' : ''}${reason ? ` — ${reason}` : ''}` };
        }
        case 'action_deferred': {
          const until = str(p, 'until') ?? str(p, 'deferUntil');
          return { text: `Deferred ${actionLabel(str(p, 'action') ?? 'the touch', str(p, 'channel'), { lower: true })} to ${until ? fmtDateTime(until) : 'the next contact window'} — ${str(p, 'reason') ?? 'quiet hours'}` };
        }
        case 'message_composed': return { text: `Composed the ${langName(str(p, 'lang'))} ${chan(str(p, 'channel')) ?? ''} message${str(p, 'source') === 'llm' ? ' with the local LLM' : str(p, 'source') === 'template' || str(p, 'source') === 'rules' ? ' from the template' : ''}`.replace(/\s+/g, ' ') };
        case 'message_sent': {
          const cost = num(p, 'costPaise');
          const viol = Array.isArray(p.violations) ? (p.violations as unknown[]).length : 0;
          return { text: `${chan(str(p, 'channel')) ?? 'Message'} ${nudge(str(p, 'action'))} sent to ${name}${str(p, 'lang') ? ` in ${langName(str(p, 'lang'))}` : ''}${num(p, 'incentivePct') ? ` with ${num(p, 'incentivePct')}% off` : ''}${cost !== undefined ? ` · cost ${rupees(cost, { decimals: true })}` : ''}${viol ? ` · ${viol} policy violation${viol > 1 ? 's' : ''}` : ''}` };
        }
        case 'call_placed': {
          const cost = num(p, 'costPaise');
          return { text: `Called ${name}${str(p, 'lang') ? ` with a ${langName(str(p, 'lang'))} script` : ''}${cost !== undefined ? ` · cost ${rupees(cost, { decimals: true })}` : ''}` };
        }
        case 'silent_retry_scheduled': {
          const at = str(p, 'at') ?? str(p, 'retryAt');
          return { text: `Silent retry scheduled${at ? ` for ${fmtDateTime(at)}` : ''} — ${str(p, 'reason') ?? cause(str(p, 'cause'))}` };
        }
        case 'silent_retry_result': {
          const ok = bool(p, 'success') ?? bool(p, 'ok');
          return { text: ok ? `Silent retry succeeded — ${str(p, 'note') ?? 'the bank accepted the debit'}` : `Silent retry failed — ${str(p, 'note') ?? 'declined again'}` };
        }
        case 'silent_retry_skipped': return { text: `Silent retry skipped — ${str(p, 'reason') ?? 'no longer applicable'}` };
        case 'escalated': return { text: `Escalated ${name}'s case to a human — ${str(p, 'reason') ?? 'needs a person'}` };
        case 'closed': return { text: `Closed ${name}'s case — ${str(p, 'reason') ?? 'stopping rule reached'}` };
        case 'recovered': {
          const n = num(p, 'touches');
          const cost = num(p, 'costPaise');
          return { text: `Recovered ${rupees(amountPaise ?? cs?.recoveredPaise ?? 0)} from ${name} (${str(p, 'via') ?? 'simulated'})${n !== undefined ? ` after ${n} touch${n === 1 ? '' : 'es'}` : ''}${cost !== undefined ? ` · spent ${rupees(cost, { decimals: true })}` : ''}` };
        }
        case 'follow_up_scheduled': {
          const at = str(p, 'at');
          return { text: `Follow-up for ${name} scheduled${at ? ` for ${fmtDateTime(at)}` : ''}${str(p, 'reason') ? ` — ${str(p, 'reason')}` : ''}` };
        }
      }
      break;
    case 'policy': {
      if (t === 'candidates_evaluated') {
        const cands = parseCandidates(p);
        const allowed = cands.filter((c) => c.allowed).length;
        const blocked = cands.filter((c) => !c.allowed && c.type !== 'close_case');
        const shown = blocked.slice(0, 3).map((c) => `${actionLabel(c.type, c.channel, { lower: true })} blocked (${c.failed.slice(0, 2).join(', ') || 'policy'})`);
        const more = blocked.length > 3 ? `, +${blocked.length - 3} more` : '';
        const deferred = cands.some((c) => c.allowed && c.deferUntil) ? ' · contact deferred to the next window' : '';
        return { text: `Policy: ${allowed} of ${cands.length} actions allowed${shown.length ? ` — ${shown.join(', ')}${more}` : ''}${deferred}` };
      }
      break;
    }
    case 'llm': {
      const ms = num(p, 'ms');
      switch (t) {
        case 'llm_diagnosis': {
          const rules = str(p, 'rulesSaid');
          const rc = str(p, 'rootCause');
          return { text: `LLM read the failure: ${cause(rc)}${num(p, 'confidence') !== undefined ? ` (${pct(num(p, 'confidence')!)})` : ''}${took(ms)}${rules && rules !== rc ? ` — rules said ${cause(rules)}` : ''}` };
        }
        case 'llm_plan': {
          const choice = p.choice;
          const choiceObj = obj(choice);
          const action = str(p, 'action') ?? str(choiceObj, 'type') ?? (typeof choice === 'string' ? choice.split(':')[0] : undefined) ?? 'an action';
          const channel = str(p, 'channel') ?? str(choiceObj, 'channel') ?? (typeof choice === 'string' && choice.includes(':') ? choice.split(':')[1] : undefined);
          const reason = str(p, 'reasoning') ?? str(p, 'reason');
          const fb = str(p, 'fallbackWouldBe');
          return { text: `LLM chose ${actionLabel(action, channel, { lower: true })}${took(ms)}${reason ? ` — ${reason}` : ''}${fb && fb !== action ? ` (rules would have picked ${actionLabel(fb, undefined, { lower: true })})` : ''}` };
        }
        case 'llm_compose': return { text: `LLM wrote the ${langName(str(p, 'lang'))} ${chan(str(p, 'channel')) ?? ''} message${num(p, 'chars') ? ` (${num(p, 'chars')} chars)` : ''}${took(ms)}`.replace(/\s+/g, ' ') };
        case 'llm_fallback': {
          const stage = str(p, 'stage');
          const used = str(p, 'used') ?? (stage === 'diagnosis' ? 'rules' : stage === 'compose' ? 'template' : 'rules');
          return { text: `LLM answer rejected${stage ? ` at ${stage}` : ''} (${str(p, 'error') ?? 'invalid'}) — used the ${used} fallback` };
        }
      }
      break;
    }
    case 'razorpay': {
      switch (t) {
        case 'order_created': {
          const url = str(p, 'payUrl');
          const purpose = str(p, 'purpose');
          return { text: `Razorpay: test order ${str(p, 'id') ?? ''}${amountPaise !== undefined ? ` for ${rupees(amountPaise)}` : ''}${purpose ? ` (${purpose.replace(/_/g, ' ')})` : ''}${str(p, 'note') ? ` — ${str(p, 'note')}` : ''}`, link: url ? { href: url, label: 'checkout' } : undefined };
        }
        case 'order_simulated': {
          const url = str(p, 'payUrl');
          return { text: `Simulated order ${str(p, 'id') ?? ''} — ${str(p, 'note') ?? 'Razorpay disabled for this run'}`, link: url ? { href: url, label: 'checkout' } : undefined };
        }
        case 'api_retry': return { text: `Razorpay: ${str(p, 'op') ?? 'API call'} failed (${str(p, 'error') ?? 'error'}) — retry #${num(p, 'attempt') ?? 1}${num(p, 'waitMs') !== undefined ? ` after ${num(p, 'waitMs')}ms` : ''}` };
        case 'api_failed': return { text: `Razorpay: ${str(p, 'op') ?? 'API call'} failed (${str(p, 'error') ?? 'error'})${str(p, 'action') ? ` — ${str(p, 'action')}` : ''}` };
        case 'api_degraded': return { text: `Razorpay degraded: ${str(p, 'note') ?? str(p, 'error') ?? 'continuing without the API'}` };
        case 'circuit_open': return { text: `Razorpay circuit breaker ${str(p, 'state') ?? 'open'} — ${str(p, 'note') ?? 'pausing API calls for a while'}` };
        case 'signature_verified': return { text: `Razorpay checkout signature verified for ${str(p, 'orderId') ?? 'the order'} · payment ${str(p, 'paymentId') ?? ''}` };
        case 'signature_rejected': return { text: `Razorpay checkout signature rejected — ${str(p, 'reason') ?? 'mismatch'}` };
        case 'payment_captured': return { text: `Razorpay captured payment ${str(p, 'paymentId') ?? ''}${amountPaise !== undefined ? ` · ${rupees(amountPaise)}` : ''}${str(p, 'method') ? ` via ${str(p, 'method')}` : ''}` };
        case 'payment_link_paid': return { text: `${name} paid${amountPaise !== undefined ? ` ${rupees(amountPaise)}` : ''} on the Razorpay checkout${str(p, 'note') ? ` — ${str(p, 'note')}` : ''}` };
      }
      break;
    }
    case 'customer': {
      switch (t) {
        case 'paid': {
          const h = num(p, 'hoursAfter');
          const note = str(p, 'note');
          const disc = num(p, 'discountPaise');
          return { text: `${name} paid${amountPaise !== undefined ? ` ${rupees(amountPaise)}` : ''}${disc ? ` (after ${rupees(disc)} off)` : ''}${note ? ` — ${note}` : h !== undefined && str(p, 'channel') ? ` · ${fmtHours(h)} after the ${chan(str(p, 'channel'))} ${nudge(str(p, 'action'))}` : h !== undefined ? ` · ${fmtHours(h)} later` : ''}` };
        }
        case 'promise_to_pay': { const at = str(p, 'payAt'); return { text: `${name} promised to pay${at ? ` by ${fmtDate(at)}` : ''}${str(p, 'note') ? ` — ${str(p, 'note')}` : ''}` }; }
        case 'stop': return { text: `${name} replied STOP — no further contact, ever${str(p, 'note') ? ` (${str(p, 'note')})` : ''}` };
        case 'complaint': return { text: `${name} complained${str(p, 'note') ? ` — ${str(p, 'note')}` : ''}` };
        case 'no_response': return { text: `No response from ${name}${str(p, 'channel') ? ` to the ${chan(str(p, 'channel'))} ${nudge(str(p, 'action'))}` : ''}${num(p, 'hoursWaited') !== undefined ? ` after ${fmtHours(num(p, 'hoursWaited')!)}` : ''}` };
      }
      break;
    }
    case 'simulator':
      return { text: `Simulator: ${str(p, 'note') ?? t}` };
  }
  return { text: `${e.actor}: ${t.replace(/_/g, ' ')}${str(p, 'note') ? ` — ${str(p, 'note')}` : str(p, 'reason') ? ` — ${str(p, 'reason')}` : ''}` };
}
