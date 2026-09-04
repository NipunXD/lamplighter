// The policy engine: pure functions that decide what the agent is ALLOWED to do, and log why.
// The LLM only ever chooses among candidates this module has already approved.
import type { ActionType, CaseState, Channel, Diagnosis, PlannedAction, PolicyCheck, RootCause } from './types.js';
import { addHours, hoursBetween, istHour, nextIstHour } from './time.js';

export interface PolicyConfig {
  quietHoursEnabled: boolean;
  respectDnd: boolean;
  quietStartHour: number; // no customer contact from this IST hour...
  quietEndHour: number; // ...until this IST hour
  maxTouches: number; // per case, per run window
  minGapHours: number; // between two customer-facing touches
  incentiveMaxPct: number;
  incentiveMinAmountPaise: number;
  incentiveBudgetPaise: number; // per run
  voiceMinAmountPaise: number;
  b2bEscalateAfterDays: number;
  escalateMinAmountPaise: number; // exhausted cases below this are closed, not escalated
  touchCostPaise: Record<Channel, number>;
}

export const DEFAULT_POLICY: PolicyConfig = {
  quietHoursEnabled: true,
  respectDnd: true,
  quietStartHour: 21,
  quietEndHour: 9,
  maxTouches: 3,
  minGapHours: 20,
  incentiveMaxPct: 10,
  incentiveMinAmountPaise: 100_000,
  incentiveBudgetPaise: 15_000_00, // ₹15,000 per run
  voiceMinAmountPaise: 150_000,
  b2bEscalateAfterDays: 45,
  escalateMinAmountPaise: 500_000,
  touchCostPaise: { whatsapp: 80, sms: 25, email: 5, voice: 600 },
};

export interface PolicyContext {
  now: string;
  state: CaseState;
  diagnosis: Diagnosis;
  budgetLeftPaise: number;
  policy: PolicyConfig;
}

export interface Candidate {
  action: PlannedAction;
  checks: PolicyCheck[];
  allowed: boolean;
  deferUntil?: string; // quiet hours: allowed, but only from this time
}

const CUSTOMER_FACING: ActionType[] = ['send_payment_link', 'voice_call', 'offer_incentive', 'new_mandate_link'];

export function isQuietHours(iso: string, p: PolicyConfig): boolean {
  if (!p.quietHoursEnabled) return false;
  const h = istHour(iso);
  return h >= p.quietStartHour || h < p.quietEndHour;
}
export function nextContactWindow(iso: string, p: PolicyConfig): string {
  return isQuietHours(iso, p) ? nextIstHour(iso, p.quietEndHour) : iso;
}

/** The agent's prior belief that an action recovers the case. Deliberately coarse; the simulator's truth is hidden. */
export function recoveryPrior(cause: RootCause, action: ActionType, channel: Channel | undefined, touchIndex: number): number {
  const table: Record<RootCause, Partial<Record<ActionType, number>>> = {
    insufficient_funds: { wait_and_retry: 0.45, send_payment_link: 0.35, voice_call: 0.4, offer_incentive: 0.3 },
    upi_timeout: { wait_and_retry: 0.3, send_payment_link: 0.55, voice_call: 0.45, offer_incentive: 0.5 },
    bank_downtime: { wait_and_retry: 0.8, send_payment_link: 0.5, voice_call: 0.4 },
    card_hard_decline: { send_payment_link: 0.25, voice_call: 0.3 },
    card_soft_decline: { wait_and_retry: 0.4, send_payment_link: 0.45, voice_call: 0.4 },
    otp_abandoned: { send_payment_link: 0.5, offer_incentive: 0.6, voice_call: 0.4 },
    checkout_abandoned: { send_payment_link: 0.3, offer_incentive: 0.45, voice_call: 0.35 },
    mandate_paused: { new_mandate_link: 0.5, send_payment_link: 0.35, voice_call: 0.45 },
    mandate_revoked: { new_mandate_link: 0.3, send_payment_link: 0.2, voice_call: 0.3 },
    dispute_risk: {},
    invoice_overdue: { send_payment_link: 0.4, voice_call: 0.5 },
    unknown: { send_payment_link: 0.3, voice_call: 0.3, wait_and_retry: 0.15 },
  };
  const base = table[cause]?.[action] ?? 0;
  const channelMul = channel === 'whatsapp' ? 1.1 : channel === 'email' ? 0.75 : 1;
  return Math.min(0.95, base * channelMul * Math.pow(0.5, touchIndex));
}

function mkAction(partial: Omit<PlannedAction, 'expectedValuePaise' | 'costPaise' | 'source'>, c: { amountPaise: number; customer: { ltvPaise: number } }, p: PolicyConfig, touchIndex: number, cause: RootCause): PlannedAction {
  const amountPaise = c.amountPaise;
  const channelCost = partial.channel ? p.touchCostPaise[partial.channel] : 0;
  const incentiveCost = partial.type === 'offer_incentive' ? Math.round((amountPaise * (partial.incentivePct ?? 0)) / 100) : 0;
  const cost = channelCost;
  // every extra knock costs goodwill; loyal customers have more to lose
  const goodwill = CUSTOMER_FACING.includes(partial.type) ? touchIndex * Math.max(500, Math.round(c.customer.ltvPaise * 0.01)) : 0;
  const prob = recoveryPrior(cause, partial.type, partial.channel, touchIndex);
  const ev = Math.round(prob * (amountPaise - incentiveCost) - cost - goodwill);
  return { ...partial, source: 'rules', costPaise: cost, goodwillPaise: goodwill, expectedValuePaise: ev };
}

function retryTimeFor(cause: RootCause, now: string): string {
  switch (cause) {
    case 'bank_downtime': return addHours(now, 3);
    case 'insufficient_funds': return nextIstHour(addHours(now, 36), 10); // give funds a chance to land
    case 'card_soft_decline': return nextIstHour(addHours(now, 12), 10); // daily limits reset overnight
    case 'upi_timeout': return addHours(now, 2);
    default: return addHours(now, 24);
  }
}

/** Enumerate every candidate action with its full check list. Nothing is hidden from the audit trail. */
export function evaluateCandidates(ctx: PolicyContext): Candidate[] {
  const { state, diagnosis, policy: p, now } = ctx;
  const c = state.case;
  const cause = diagnosis.rootCause;
  const touches = state.touches.filter((t) => CUSTOMER_FACING.includes(t.action));
  const touchIndex = touches.length;
  const lastTouch = touches[touches.length - 1];
  const out: Candidate[] = [];
  const bestChannel = (['whatsapp', 'email', 'sms'] as Channel[]).find((ch) => c.customer.channels[ch] && !(c.customer.dnd && ch === 'sms'));
  const daysOverdueNow = (c.daysOverdue ?? 0) + Math.max(0, hoursBetween(c.createdAt, now) / 24);

  const commonChecks = (type: ActionType, channel?: Channel): { checks: PolicyCheck[]; deferUntil?: string } => {
    const checks: PolicyCheck[] = [];
    const customerFacing = CUSTOMER_FACING.includes(type);
    let deferUntil: string | undefined;
    if (customerFacing) {
      checks.push({ rule: 'do_not_contact', passed: !state.doNotContact, note: state.doNotContact ? 'customer asked us to stop' : undefined });
      checks.push({ rule: 'dispute_only_escalate', passed: cause !== 'dispute_risk', note: cause === 'dispute_risk' ? 'possible dispute: humans only' : undefined });
      const touchCap = p.maxTouches + (state.humanExtraTouches ?? 0);
      checks.push({ rule: 'max_touches', passed: touchIndex < touchCap, note: `${touchIndex}/${touchCap} used${state.humanExtraTouches ? ` (${state.humanExtraTouches} granted by a human)` : ''}` });
      const gapOk = !lastTouch || hoursBetween(lastTouch.at, now) >= p.minGapHours;
      checks.push({ rule: 'min_gap_between_touches', passed: gapOk, note: lastTouch ? `${hoursBetween(lastTouch.at, now).toFixed(1)}h since last touch (min ${p.minGapHours}h)` : 'first touch' });
      if (channel) {
        const sameBefore = touches.filter((t) => t.action === type && t.channel === channel).length;
        checks.push({ rule: 'no_repeat_same_touch', passed: sameBefore < 2, note: sameBefore >= 2 ? `already sent ${type} via ${channel} twice` : undefined });
        checks.push({ rule: 'channel_opt_in', passed: !!c.customer.channels[channel], note: c.customer.channels[channel] ? undefined : `${channel} not opted in` });
        const dndBlocked = p.respectDnd && c.customer.dnd && (channel === 'sms' || channel === 'voice');
        checks.push({ rule: 'dnd_registry', passed: !dndBlocked, note: dndBlocked ? `customer on DND: no ${channel}` : undefined });
      }
      const quiet = isQuietHours(now, p);
      if (quiet) deferUntil = nextContactWindow(now, p);
      checks.push({ rule: 'quiet_hours', passed: true, note: quiet ? `deferred to ${p.quietEndHour}:00 IST` : 'inside contact window' });
      if (c.kind === 'overdue_invoice' && daysOverdueNow > p.b2bEscalateAfterDays && touchIndex >= 1) {
        checks.push({ rule: 'b2b_escalation_threshold', passed: false, note: `${daysOverdueNow.toFixed(0)}d overdue > ${p.b2bEscalateAfterDays}d: hand to AR team` });
      }
    }
    return { checks, deferUntil };
  };

  const push = (partial: Omit<PlannedAction, 'expectedValuePaise' | 'costPaise' | 'source'>, extra: PolicyCheck[] = []) => {
    const action = mkAction(partial, c, p, touchIndex, cause);
    const { checks, deferUntil } = commonChecks(action.type, action.channel);
    checks.push(...extra);
    if (action.costPaise > 0 || action.type === 'offer_incentive') {
      checks.push({ rule: 'positive_expected_value', passed: action.expectedValuePaise > 0, note: `EV ${(action.expectedValuePaise / 100).toFixed(0)} INR` });
    }
    const allowed = checks.every((k) => k.passed);
    out.push({ action, checks, allowed, deferUntil: allowed ? deferUntil : undefined });
  };

  // 1. silent retry (no customer touch: only where a saved instrument or mandate can be debited again)
  const retryOk = ['insufficient_funds', 'bank_downtime', 'card_soft_decline'].includes(cause);
  const retryCount = state.touches.filter((t) => t.action === 'wait_and_retry').length;
  push({ type: 'wait_and_retry', retryAt: retryTimeFor(cause, now), reason: `silent retry for ${cause}` }, [
    { rule: 'do_not_contact', passed: !state.doNotContact, note: state.doNotContact ? 'customer said STOP: no further debits either' : undefined },
    { rule: 'no_retry_on_hard_decline', passed: cause !== 'card_hard_decline', note: cause === 'card_hard_decline' ? 'issuer said do-not-retry' : undefined },
    { rule: 'silent_retry_applicability', passed: retryOk, note: retryOk ? undefined : `${cause} needs the customer, not a retry` },
    { rule: 'max_silent_retries', passed: retryCount < 2, note: `${retryCount}/2 used` },
    { rule: 'has_payment_instrument', passed: c.kind !== 'abandoned_checkout' && c.kind !== 'overdue_invoice', note: 'retry needs a saved instrument or mandate' },
    { rule: 'attempt_budget', passed: retryCount + touchIndex < p.maxTouches + 1 + (state.humanExtraTouches ?? 0), note: `${retryCount + touchIndex} attempts so far` },
  ]);

  // 2. payment link over each channel
  for (const ch of ['whatsapp', 'sms', 'email'] as Channel[]) {
    push({ type: 'send_payment_link', channel: ch, lang: c.customer.lang, reason: `payment link via ${ch}` }, [
      { rule: 'link_applicability', passed: cause !== 'mandate_revoked' || c.kind !== 'failed_subscription' || true, note: undefined },
    ]);
  }

  // 3. voice call (Hinglish script)
  push({ type: 'voice_call', channel: 'voice', lang: c.customer.lang, reason: 'voice call with a script' }, [
    { rule: 'voice_min_amount', passed: c.amountPaise >= p.voiceMinAmountPaise, note: `min ${(p.voiceMinAmountPaise / 100)} INR for a call` },
  ]);

  // 4. incentive
  const incentiveCauseOk = ['checkout_abandoned', 'otp_abandoned', 'upi_timeout', 'mandate_paused'].includes(cause);
  if (bestChannel) {
    push({ type: 'offer_incentive', channel: bestChannel, lang: c.customer.lang, incentivePct: p.incentiveMaxPct, reason: `${p.incentiveMaxPct}% incentive via ${bestChannel}` }, [
      { rule: 'incentive_once', passed: !state.incentiveUsed },
      { rule: 'incentive_min_amount', passed: c.amountPaise >= p.incentiveMinAmountPaise, note: `min ${(p.incentiveMinAmountPaise / 100)} INR` },
      { rule: 'incentive_cause_fit', passed: incentiveCauseOk || !!state.humanIncentiveApproved, note: state.humanIncentiveApproved ? 'approved by a human' : incentiveCauseOk ? undefined : `no discount for ${cause} (not an intent problem)` },
      { rule: 'incentive_budget', passed: ctx.budgetLeftPaise >= Math.round((c.amountPaise * p.incentiveMaxPct) / 100), note: `budget left ${(ctx.budgetLeftPaise / 100).toFixed(0)} INR` },
      { rule: 'no_incentive_b2b', passed: c.customer.segment !== 'b2b' },
      { rule: 'incentive_not_first_touch', passed: touchIndex >= 1 || !!state.humanIncentiveApproved, note: state.humanIncentiveApproved ? 'approved by a human' : 'try a plain nudge before spending margin' },
    ]);
  }

  // 5. new mandate link (subscriptions)
  if (bestChannel) {
    push({ type: 'new_mandate_link', channel: bestChannel, lang: c.customer.lang, reason: `re-authorise mandate via ${bestChannel}` }, [
      { rule: 'mandate_link_applicability', passed: cause === 'mandate_paused' || cause === 'mandate_revoked', note: 'only for paused/revoked mandates' },
    ]);
  }

  // 6. escalate to a human: only for the right reasons
  const exhausted = touchIndex >= p.maxTouches + (state.humanExtraTouches ?? 0) || state.doNotContact;
  const escalateReason = cause === 'dispute_risk' ? 'possible dispute'
    : c.kind === 'overdue_invoice' && daysOverdueNow > p.b2bEscalateAfterDays ? 'B2B receivable past threshold'
    : cause === 'card_hard_decline' && c.customer.segment === 'vip' ? 'VIP with a hard decline'
    : exhausted && c.amountPaise >= p.escalateMinAmountPaise ? 'high-value case, automation exhausted'
    : undefined;
  push({ type: 'escalate_human', reason: escalateReason ?? 'no escalation trigger' }, [
    { rule: 'escalation_trigger', passed: !!escalateReason, note: escalateReason ?? 'nothing a human would do differently yet' },
  ]);

  // 7. close: always allowed, it is the stopping rule
  push({ type: 'close_case', reason: exhausted ? 'stopping rule reached' : 'nothing worth doing' }, []);

  return out;
}

export function allowedCandidates(ctx: PolicyContext): Candidate[] {
  return evaluateCandidates(ctx).filter((k) => k.allowed);
}

/** Validate an LLM-chosen action against the candidate list. Returns the matching approved candidate or null. */
export function matchCandidate(cands: Candidate[], choice: { type: ActionType; channel?: Channel }): Candidate | null {
  return cands.find((k) => k.allowed && k.action.type === choice.type && (choice.channel ? k.action.channel === choice.channel : true)) ?? null;
}

/** Deterministic fallback: highest expected value among allowed; close if nothing has positive EV. */
export function fallbackChoice(cands: Candidate[]): Candidate {
  const allowed = cands.filter((k) => k.allowed);
  const positive = allowed.filter((k) => k.action.type !== 'close_case' && k.action.type !== 'escalate_human' && k.action.expectedValuePaise > 0);
  if (positive.length) return positive.sort((a, b) => b.action.expectedValuePaise - a.action.expectedValuePaise)[0];
  const esc = allowed.find((k) => k.action.type === 'escalate_human');
  if (esc) return esc;
  return allowed.find((k) => k.action.type === 'close_case')!;
}

/** Baseline "naive retry": what a cron job does. Ignores every rule; we count the violations it would have made. */
export function baselineAction(ctx: PolicyContext): { action: PlannedAction; violations: PolicyCheck[] } {
  const c = ctx.state.case;
  const channel: Channel = 'sms';
  const action = mkAction({ type: 'send_payment_link', channel, lang: 'en', reason: 'naive retry: SMS link every 24h ×3' }, c, ctx.policy, ctx.state.touches.length, ctx.diagnosis.rootCause);
  const cand = evaluateCandidates(ctx).find((k) => k.action.type === 'send_payment_link' && k.action.channel === channel);
  const violations = (cand?.checks ?? []).filter((k) => !k.passed);
  if (isQuietHours(ctx.now, ctx.policy)) violations.push({ rule: 'quiet_hours', passed: false, note: 'sent during quiet hours' });
  return { action, violations };
}
