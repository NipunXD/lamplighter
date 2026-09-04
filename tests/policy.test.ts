import { describe, it, expect } from 'vitest';
import { DEFAULT_POLICY, evaluateCandidates, fallbackChoice, isQuietHours, nextContactWindow, baselineAction, matchCandidate } from '../server/policy.js';
import type { CaseState, Diagnosis, RevenueCase } from '../server/types.js';
import { istHour } from '../server/time.js';

const DAY = '2026-09-07T05:30:00.000Z'; // 11:00 IST
const NIGHT = '2026-09-07T17:30:00.000Z'; // 23:00 IST

function mkCase(over: Partial<RevenueCase> = {}): RevenueCase {
  return {
    id: 'case_test', kind: 'failed_payment', amountPaise: 199900, currency: 'INR', createdAt: '2026-09-06T05:30:00.000Z',
    merchant: { name: 'Saanjh & Co.', category: 'tea' }, description: 'Dusk Candle Trio', attemptsBefore: 1, razorpay: {},
    customer: { id: 'cust_1', name: 'Meera Nair', phone: '+919000090000', email: 'meera@example.test', lang: 'hinglish', segment: 'regular', city: 'Pune', channels: { whatsapp: true, sms: true, email: true, voice: true }, dnd: false, ltvPaise: 500000, pastFailures: 0 },
    ...over,
  };
}
function mkState(c: RevenueCase, over: Partial<CaseState> = {}): CaseState {
  return { case: c, status: 'open', touches: [], incentiveUsed: false, recoveredPaise: 0, costPaise: 0, doNotContact: false, complained: false, razorpay: {}, ...over };
}
const diag = (rootCause: Diagnosis['rootCause']): Diagnosis => ({ rootCause, confidence: 0.9, reasoning: 'test', source: 'rules' });
const ctx = (state: CaseState, d: Diagnosis, now = DAY, budget = 10_000_00) => ({ now, state, diagnosis: d, budgetLeftPaise: budget, policy: DEFAULT_POLICY });

describe('clock', () => {
  it('reads IST hours', () => { expect(istHour(DAY)).toBe(11); expect(istHour(NIGHT)).toBe(23); });
  it('detects quiet hours and defers to 09:00 IST', () => {
    expect(isQuietHours(DAY, DEFAULT_POLICY)).toBe(false);
    expect(isQuietHours(NIGHT, DEFAULT_POLICY)).toBe(true);
    expect(istHour(nextContactWindow(NIGHT, DEFAULT_POLICY))).toBe(9);
  });
});

describe('policy engine', () => {
  it('never retries a hard decline silently', () => {
    const cands = evaluateCandidates(ctx(mkState(mkCase()), diag('card_hard_decline')));
    const retry = cands.find((k) => k.action.type === 'wait_and_retry')!;
    expect(retry.allowed).toBe(false);
    expect(retry.checks.find((k) => k.rule === 'no_retry_on_hard_decline')!.passed).toBe(false);
  });
  it('defers customer touches at night but still allows them', () => {
    const cands = evaluateCandidates(ctx(mkState(mkCase()), diag('upi_timeout'), NIGHT));
    const wa = cands.find((k) => k.action.type === 'send_payment_link' && k.action.channel === 'whatsapp')!;
    expect(wa.allowed).toBe(true);
    expect(wa.deferUntil && istHour(wa.deferUntil)).toBe(9);
  });
  it('blocks SMS and voice for DND customers, keeps WhatsApp/email', () => {
    const c = mkCase({ customer: { ...mkCase().customer, dnd: true } });
    const cands = evaluateCandidates(ctx(mkState(c), diag('upi_timeout')));
    expect(cands.find((k) => k.action.channel === 'sms')!.allowed).toBe(false);
    expect(cands.find((k) => k.action.type === 'voice_call')!.allowed).toBe(false);
    expect(cands.find((k) => k.action.channel === 'whatsapp')!.allowed).toBe(true);
  });
  it('stops after max touches and closes small cases instead of escalating', () => {
    const c = mkCase({ amountPaise: 49900 });
    const touches = [1, 2, 3].map((i) => ({ at: `2026-09-0${i}T05:30:00.000Z`, action: 'send_payment_link' as const, channel: 'whatsapp' as const, costPaise: 80 }));
    const cands = evaluateCandidates(ctx(mkState(c, { touches }), diag('upi_timeout')));
    expect(cands.filter((k) => k.allowed).map((k) => k.action.type)).toEqual(['close_case']);
    expect(fallbackChoice(cands).action.type).toBe('close_case');
  });
  it('escalates a high-value exhausted case', () => {
    const c = mkCase({ amountPaise: 899900 });
    const touches = [1, 2, 3].map((i) => ({ at: `2026-09-0${i}T05:30:00.000Z`, action: 'send_payment_link' as const, channel: 'whatsapp' as const, costPaise: 80 }));
    const cands = evaluateCandidates(ctx(mkState(c, { touches }), diag('upi_timeout')));
    expect(fallbackChoice(cands).action.type).toBe('escalate_human');
  });
  it('honours STOP: only escalate/close remain', () => {
    const cands = evaluateCandidates(ctx(mkState(mkCase(), { doNotContact: true }), diag('upi_timeout')));
    expect(cands.filter((k) => k.allowed).every((k) => ['close_case', 'escalate_human'].includes(k.action.type))).toBe(true);
  });
  it('routes dispute risk to humans only', () => {
    const cands = evaluateCandidates(ctx(mkState(mkCase()), diag('dispute_risk')));
    expect(cands.filter((k) => k.allowed).map((k) => k.action.type).sort()).toEqual(['close_case', 'escalate_human']);
  });
  it('gates incentives: not on first touch, not below min amount, not for funds problems, never twice', () => {
    const first = evaluateCandidates(ctx(mkState(mkCase()), diag('checkout_abandoned'))).find((k) => k.action.type === 'offer_incentive')!;
    expect(first.allowed).toBe(false);
    const touched = mkState(mkCase(), { touches: [{ at: '2026-09-05T05:30:00.000Z', action: 'send_payment_link', channel: 'whatsapp', costPaise: 80 }] });
    const second = evaluateCandidates(ctx(touched, diag('checkout_abandoned'))).find((k) => k.action.type === 'offer_incentive')!;
    expect(second.allowed).toBe(true);
    const funds = evaluateCandidates(ctx(touched, diag('insufficient_funds'))).find((k) => k.action.type === 'offer_incentive')!;
    expect(funds.checks.find((k) => k.rule === 'incentive_cause_fit')!.passed).toBe(false);
    const used = evaluateCandidates(ctx({ ...touched, incentiveUsed: true }, diag('checkout_abandoned'))).find((k) => k.action.type === 'offer_incentive')!;
    expect(used.allowed).toBe(false);
  });
  it('respects the incentive budget', () => {
    const touched = mkState(mkCase(), { touches: [{ at: '2026-09-05T05:30:00.000Z', action: 'send_payment_link', channel: 'whatsapp', costPaise: 80 }] });
    const k = evaluateCandidates(ctx(touched, diag('checkout_abandoned'), DAY, 0)).find((k) => k.action.type === 'offer_incentive')!;
    expect(k.allowed).toBe(false);
  });
  it('requires a minimum amount for voice calls', () => {
    const small = evaluateCandidates(ctx(mkState(mkCase({ amountPaise: 49900 })), diag('upi_timeout'))).find((k) => k.action.type === 'voice_call')!;
    expect(small.allowed).toBe(false);
  });
  it('validates LLM choices against approved candidates only', () => {
    const cands = evaluateCandidates(ctx(mkState(mkCase()), diag('card_hard_decline')));
    expect(matchCandidate(cands, { type: 'wait_and_retry' })).toBeNull();
    expect(matchCandidate(cands, { type: 'send_payment_link', channel: 'whatsapp' })).not.toBeNull();
  });
  it('baseline counts the rules it breaks', () => {
    const c = mkCase({ customer: { ...mkCase().customer, dnd: true } });
    const { violations } = baselineAction(ctx(mkState(c), diag('card_hard_decline'), NIGHT));
    expect(violations.map((v) => v.rule)).toEqual(expect.arrayContaining(['dnd_registry', 'quiet_hours']));
  });
});
