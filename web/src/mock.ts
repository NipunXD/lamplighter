// Fully offline mock backend (`?mock=1`). Fabricates a Saanjh & Co. batch and streams a 7-day run as
// 168 hourly ticks, emitting the same RunEvent / AuditEvent shapes (and actor/type names) as the server.
import type {
  ActionType, AuditEvent, CaseKind, CaseState, Channel, Customer, FailureInfo, Lang, LamplighterState,
  RevenueCase, RootCause, RunConfig, RunEvent, RunMetrics, RunSnapshot, Segment, TimelinePoint, Touch,
} from '@shared/types';
import type { Backend, CreateRunInput, Health, StreamStatus } from './api';
import { addHours, firstName, fmtHours, fmtTime, hoursBetween, isQuietHours, istHour, nextIstHour, rupees, KIND_LABEL, CHANNEL_LABEL } from './format';

export const SIM_START = '2026-09-07T03:30:00.000Z'; // Mon 07 Sep 2026, 09:00 IST
export const MERCHANT = { name: 'Saanjh & Co.', category: 'D2C tea & candles, Jaipur' };
const TICKS = 168;
const INCENTIVE_BUDGET = 1_500_000; // ₹15,000
const TOUCH_COST: Record<Channel, number> = { whatsapp: 80, sms: 25, email: 5, voice: 600 };
const CUSTOMER_FACING = new Set<ActionType>(['send_payment_link', 'voice_call', 'offer_incentive', 'new_mandate_link']);

// ---------- deterministic randomness ----------
type Rng = () => number;
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
function weighted<T>(r: Rng, arr: Array<{ w: number; t: T }>): T {
  const total = arr.reduce((s, a) => s + a.w, 0);
  let x = r() * total;
  for (const a of arr) { x -= a.w; if (x <= 0) return a.t; }
  return arr[arr.length - 1].t;
}
const between = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
function id(r: Rng, prefix: string, len = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(r() * chars.length)];
  return `${prefix}_${s}`;
}
/** 16-hex chain hash (FNV-1a, two lanes). Browser-side stand-in for the server's sha256 prefix. */
function chainHash(body: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x9e3779b1) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// ---------- synthetic batch (mirrors server/data/generate.ts) ----------
const FIRST = ['Aarav', 'Ananya', 'Rohan', 'Priya', 'Kabir', 'Meera', 'Vikram', 'Sneha', 'Arjun', 'Ishita', 'Rahul', 'Pooja', 'Dev', 'Nisha', 'Karan', 'Riya', 'Siddharth', 'Tanvi', 'Manish', 'Zoya', 'Harsh', 'Divya', 'Yash', 'Sana', 'Nikhil', 'Aditi', 'Farhan', 'Kavya', 'Rajat', 'Simran'];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Khan', 'Mehta', 'Reddy', 'Nair', 'Gupta', 'Singh', 'Patel', 'Das', 'Joshi', 'Kulkarni', 'Bose', 'Chawla', 'Pillai', 'Rana', 'Sethi', 'Mishra', 'Bhat'];
const CITIES = ['Jaipur', 'Delhi', 'Mumbai', 'Bengaluru', 'Pune', 'Hyderabad', 'Ahmedabad', 'Lucknow', 'Chandigarh', 'Kolkata', 'Indore', 'Kochi'];
const B2B = ['Chai Tapri Cafés Pvt Ltd', 'Hawa Mahal Hospitality', 'Blue Tokai Corner Store', 'Amer Boutique Stays', 'The Reading Room Café', 'Pink City Gifting Co.', 'Rajwada Banquets', 'Kettle Lane Coffee', 'Nomad Hostels India', 'Saffron Tree Retail'];
const PRODUCTS: Record<CaseKind, Array<{ d: string; min: number; max: number }>> = {
  failed_payment: [
    { d: 'Masala Chai Sampler (250g)', min: 39900, max: 89900 },
    { d: 'Dusk Candle Trio', min: 129900, max: 189900 },
    { d: 'Kashmiri Kahwa Tin + Infuser', min: 79900, max: 149900 },
    { d: 'Festive Gift Box (Diwali pre-order)', min: 249900, max: 499900 },
  ],
  abandoned_checkout: [
    { d: 'Dusk Candle Trio + Chai Sampler', min: 149900, max: 279900 },
    { d: 'Festive Gift Box ×2', min: 499900, max: 799900 },
    { d: 'Ceramic Kulhad Set (6)', min: 89900, max: 159900 },
  ],
  failed_subscription: [
    { d: 'Monthly Chai Box (Sep renewal)', min: 69900, max: 99900 },
    { d: 'Monthly Chai Box Premium (Sep renewal)', min: 129900, max: 149900 },
  ],
  overdue_invoice: [
    { d: 'Wholesale: 24× Dusk Candle Trio', min: 1800000, max: 4200000 },
    { d: 'Wholesale: 40kg loose-leaf assortment', min: 900000, max: 2600000 },
    { d: 'Wholesale: Festive gift boxes (bulk)', min: 3000000, max: 12000000 },
  ],
};
interface FailureTemplate { cause: RootCause; f: Omit<FailureInfo, 'method'> & { method?: FailureInfo['method'] }; bank?: string[] }
const FAILURES_PAYMENT: Array<{ w: number; t: FailureTemplate }> = [
  { w: 30, t: { cause: 'insufficient_funds', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: "Your payment didn't go through as it was declined by the bank.", source: 'customer', step: 'payment_authorization' }, bank: ['Z9: INSUFFICIENT FUNDS IN CUSTOMER ACCOUNT', 'U30: DEBIT HAS BEEN FAILED (INSUFFICIENT BALANCE)', '51: NOT SUFFICIENT FUNDS', 'Z6: LOW BALANCE - TXN DECLINED'] } },
  { w: 22, t: { cause: 'upi_timeout', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_timed_out', description: 'Payment was not completed on time. The UPI request expired before it was approved.', source: 'customer', step: 'payment_authentication', method: 'upi' }, bank: ['U69: COLLECT EXPIRED', 'BT: TRANSACTION TIMED OUT AT REMITTER', 'U28: PSP NOT AVAILABLE'] } },
  { w: 14, t: { cause: 'bank_downtime', f: { code: 'GATEWAY_ERROR', reason: 'gateway_technical_error', description: "The bank's server is currently facing downtime. Please try again after some time.", source: 'bank', step: 'payment_authorization' }, bank: ['91: ISSUER OR SWITCH INOPERATIVE', 'U16: RISK THRESHOLD EXCEEDED / SWITCH DOWN', 'BANK SERVER UNAVAILABLE (HTTP 503)'] } },
  { w: 8, t: { cause: 'card_hard_decline', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: "Your payment didn't go through as it was declined by the bank.", source: 'bank', step: 'payment_authorization', method: 'card' }, bank: ['43: STOLEN CARD, PICK UP', '41: LOST CARD', '14: INVALID CARD NUMBER / ACCOUNT CLOSED', '05: DO NOT HONOUR (BLOCKED BY ISSUER)'] } },
  { w: 10, t: { cause: 'card_soft_decline', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: 'Transaction limit exceeded for this card. Try another card or contact your bank.', source: 'bank', step: 'payment_authorization', method: 'card' }, bank: ['61: EXCEEDS WITHDRAWAL AMOUNT LIMIT', 'Z8: PER TRANSACTION LIMIT EXCEEDED', '65: EXCEEDS FREQUENCY LIMIT'] } },
  { w: 12, t: { cause: 'otp_abandoned', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_cancelled', description: 'Payment processing cancelled by user on the OTP page.', source: 'customer', step: 'payment_authentication' }, bank: ['USER CANCELLED AT ACS', 'OTP NOT SUBMITTED - SESSION CLOSED'] } },
  { w: 4, t: { cause: 'dispute_risk', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: 'Payment declined. Cardholder reported an unrecognised earlier charge from this merchant.', source: 'bank', step: 'payment_authorization', method: 'card' }, bank: ['59: SUSPECTED FRAUD - CARDHOLDER QUERY OPEN', 'CHARGEBACK INQUIRY PENDING ON PRIOR TXN'] } },
];
const FAILURES_SUBSCRIPTION: Array<{ w: number; t: FailureTemplate }> = [
  { w: 45, t: { cause: 'mandate_paused', f: { code: 'BAD_REQUEST_ERROR', reason: 'mandate_paused', description: 'The UPI AutoPay mandate has been paused by the customer in their UPI app.', source: 'customer', step: 'mandate_execution', method: 'emandate' } } },
  { w: 15, t: { cause: 'mandate_revoked', f: { code: 'BAD_REQUEST_ERROR', reason: 'mandate_revoked', description: 'The mandate was revoked by the customer. No further debits can be executed.', source: 'customer', step: 'mandate_execution', method: 'emandate' } } },
  { w: 30, t: { cause: 'insufficient_funds', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: 'Mandate execution failed at the bank.', source: 'customer', step: 'mandate_execution', method: 'emandate' }, bank: ['Z9: INSUFFICIENT FUNDS IN CUSTOMER ACCOUNT', 'U30: DEBIT HAS BEEN FAILED (INSUFFICIENT BALANCE)'] } },
  { w: 10, t: { cause: 'bank_downtime', f: { code: 'GATEWAY_ERROR', reason: 'gateway_technical_error', description: 'Mandate execution failed because the bank was unavailable.', source: 'bank', step: 'mandate_execution', method: 'emandate' }, bank: ['91: ISSUER OR SWITCH INOPERATIVE'] } },
];

type Archetype = 'temporary_funds' | 'forgot' | 'friction' | 'intent_lost' | 'hard_no' | 'disputer' | 'busy_ap';
interface Hidden {
  archetype: Archetype;
  payProb: number;
  affinity: Record<Channel, number>;
  respondsToIncentive: boolean;
  fundsAt?: string;
  annoyance: number;
  willStop: boolean;
  delayHours: number;
  bankMsg?: string;
}
export interface Batch { cases: RevenueCase[]; hidden: Map<string, Hidden>; truth: Map<string, RootCause> }

function makeCustomer(r: Rng, kind: CaseKind, i: number): Customer {
  const b2b = kind === 'overdue_invoice';
  const name = b2b ? pick(r, B2B) : `${pick(r, FIRST)} ${pick(r, LAST)}`;
  const segment: Segment = b2b ? 'b2b' : weighted(r, [{ w: 30, t: 'new' as Segment }, { w: 50, t: 'regular' as Segment }, { w: 20, t: 'vip' as Segment }]);
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  const whatsapp = r() < (b2b ? 0.5 : 0.72);
  return {
    id: id(r, 'cust'), name,
    phone: `+91${between(r, 70000, 99999)}${String(between(r, 0, 99999)).padStart(5, '0')}`,
    email: `${slug}${i}@${b2b ? 'accounts.example' : 'example.test'}`,
    lang: b2b ? 'en' : r() < 0.55 ? 'hinglish' : 'en',
    segment, city: pick(r, CITIES),
    channels: { whatsapp, sms: r() < 0.92, email: b2b ? true : r() < 0.85, voice: r() < (b2b ? 0.8 : 0.6) },
    dnd: b2b ? false : r() < 0.2,
    ltvPaise: segment === 'vip' ? between(r, 2500000, 9000000) : segment === 'regular' ? between(r, 300000, 1800000) : segment === 'b2b' ? between(r, 10000000, 60000000) : between(r, 0, 150000),
    pastFailures: r() < 0.7 ? 0 : between(r, 1, 4),
  };
}
function hiddenFor(r: Rng, cause: RootCause, kind: CaseKind, createdAt: string, cust: Customer, bankMsg?: string): Hidden {
  const A = (w: number, t: Archetype) => ({ w, t });
  let arche: Archetype;
  switch (cause) {
    case 'insufficient_funds': arche = weighted(r, [A(60, 'temporary_funds'), A(25, 'forgot'), A(15, 'hard_no')]); break;
    case 'upi_timeout': arche = weighted(r, [A(55, 'friction'), A(30, 'forgot'), A(15, 'intent_lost')]); break;
    case 'bank_downtime': arche = weighted(r, [A(70, 'friction'), A(25, 'forgot'), A(5, 'hard_no')]); break;
    case 'card_hard_decline': arche = weighted(r, [A(55, 'hard_no'), A(30, 'friction'), A(15, 'forgot')]); break;
    case 'card_soft_decline': arche = weighted(r, [A(50, 'temporary_funds'), A(35, 'friction'), A(15, 'forgot')]); break;
    case 'otp_abandoned': arche = weighted(r, [A(40, 'friction'), A(35, 'intent_lost'), A(25, 'forgot')]); break;
    case 'checkout_abandoned': arche = weighted(r, [A(40, 'intent_lost'), A(30, 'friction'), A(20, 'forgot'), A(10, 'hard_no')]); break;
    case 'mandate_paused': arche = weighted(r, [A(50, 'forgot'), A(35, 'intent_lost'), A(15, 'hard_no')]); break;
    case 'mandate_revoked': arche = weighted(r, [A(65, 'hard_no'), A(35, 'intent_lost')]); break;
    case 'dispute_risk': arche = 'disputer'; break;
    case 'invoice_overdue': arche = weighted(r, [A(50, 'busy_ap'), A(30, 'forgot'), A(20, 'disputer')]); break;
    default: arche = 'forgot';
  }
  const base: Record<Archetype, number> = { temporary_funds: 0.3, forgot: 0.66, friction: 0.6, intent_lost: 0.2, hard_no: 0.02, disputer: 0.05, busy_ap: 0.4 };
  const aff = (w: number, s: number, e: number, v: number): Record<Channel, number> => ({ whatsapp: w, sms: s, email: e, voice: v });
  const affinity = cust.segment === 'b2b' ? aff(0.9, 0.5, 1.0, 1.25) : cust.lang === 'hinglish' ? aff(1.2, 0.8, 0.5, 1.3) : aff(1.1, 0.85, 0.8, 1.15);
  return {
    archetype: arche,
    payProb: base[arche] * (0.85 + r() * 0.3),
    affinity,
    respondsToIncentive: arche === 'intent_lost' ? r() < 0.7 : arche === 'friction' ? r() < 0.35 : r() < 0.15,
    fundsAt: arche === 'temporary_funds' ? addHours(createdAt, between(r, 20, 96)) : undefined,
    annoyance: arche === 'hard_no' || arche === 'disputer' ? 1 : between(r, 2, 4),
    willStop: arche === 'hard_no' ? r() < 0.6 : arche === 'intent_lost' ? r() < 0.25 : r() < 0.05,
    delayHours: kind === 'overdue_invoice' ? between(r, 6, 48) : between(r, 1, 30),
    bankMsg,
  };
}

export function generateBatch(seed: number, size: number): Batch {
  const r = mulberry32(seed * 7919 + 17);
  const cases: RevenueCase[] = [];
  const hidden = new Map<string, Hidden>();
  const truth = new Map<string, RootCause>();
  const kinds: Array<{ w: number; t: CaseKind }> = [
    { w: 40, t: 'failed_payment' }, { w: 25, t: 'abandoned_checkout' }, { w: 20, t: 'failed_subscription' }, { w: 15, t: 'overdue_invoice' },
  ];
  for (let i = 0; i < size; i++) {
    const kind = weighted(r, kinds);
    const cust = makeCustomer(r, kind, i);
    const product = pick(r, PRODUCTS[kind]);
    const amountPaise = Math.round(between(r, product.min, product.max) / 100) * 100;
    const createdAt = addHours(SIM_START, -between(r, 1, 72));
    const caseId = id(r, 'case');
    let failure: FailureInfo | undefined;
    let cause: RootCause;
    let daysOverdue: number | undefined;
    let bankMsg: string | undefined;
    const rz: RevenueCase['razorpay'] = {};
    if (kind === 'failed_payment') {
      const t = weighted(r, FAILURES_PAYMENT);
      cause = t.cause;
      const method = t.f.method ?? weighted(r, [{ w: 60, t: 'upi' as const }, { w: 25, t: 'card' as const }, { w: 15, t: 'netbanking' as const }]);
      bankMsg = t.bank ? pick(r, t.bank) : undefined;
      failure = { ...t.f, method, description: bankMsg ? `${t.f.description} Bank response: ${bankMsg}` : t.f.description };
      rz.orderId = id(r, 'order');
    } else if (kind === 'failed_subscription') {
      const t = weighted(r, FAILURES_SUBSCRIPTION);
      cause = t.cause;
      bankMsg = t.bank ? pick(r, t.bank) : undefined;
      failure = { ...t.f, method: 'emandate', description: bankMsg ? `${t.f.description} Bank response: ${bankMsg}` : t.f.description };
      rz.subscriptionId = id(r, 'sub');
    } else if (kind === 'overdue_invoice') {
      cause = 'invoice_overdue';
      daysOverdue = between(r, 3, 52);
      rz.invoiceId = id(r, 'inv');
    } else {
      cause = 'checkout_abandoned';
      rz.orderId = id(r, 'order');
    }
    cases.push({
      id: caseId, kind, customer: cust, amountPaise, currency: 'INR', createdAt, merchant: MERCHANT, description: product.d,
      failure, daysOverdue, attemptsBefore: kind === 'abandoned_checkout' ? 0 : between(r, 1, 3), razorpay: rz,
    });
    hidden.set(caseId, hiddenFor(r, cause, kind, createdAt, cust, bankMsg));
    truth.set(caseId, cause);
  }
  return { cases, hidden, truth };
}

export function openState(c: RevenueCase): CaseState {
  return { case: c, status: 'open', touches: [], incentiveUsed: false, recoveredPaise: 0, costPaise: 0, doNotContact: false, complained: false, razorpay: {} };
}

// ---------- policy (a faithful, compact mirror of server/policy.ts) ----------
interface Cand { type: ActionType; channel?: Channel; allowed: boolean; ev: number; cost: number; failed: string[]; incentivePct?: number; retryAt?: string; reason: string }
const RETRY_OK = new Set<RootCause>(['insufficient_funds', 'bank_downtime', 'card_soft_decline']);
const INCENTIVE_OK = new Set<RootCause>(['checkout_abandoned', 'otp_abandoned', 'upi_timeout', 'mandate_paused']);
const PRIOR: Record<RootCause, Partial<Record<ActionType, number>>> = {
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
function retryTimeFor(cause: RootCause, now: string): string {
  switch (cause) {
    case 'bank_downtime': return addHours(now, 3);
    case 'insufficient_funds': return nextIstHour(addHours(now, 36), 10);
    case 'card_soft_decline': return nextIstHour(addHours(now, 12), 10);
    case 'upi_timeout': return addHours(now, 2);
    default: return addHours(now, 24);
  }
}
function evaluateCandidates(st: CaseState, cause: RootCause, now: string, budgetLeft: number): Cand[] {
  const c = st.case;
  const cust = c.customer;
  const touches = st.touches.filter((t) => CUSTOMER_FACING.has(t.action));
  const n = touches.length;
  const last = touches[n - 1];
  const retries = st.touches.filter((t) => t.action === 'wait_and_retry').length;
  const daysOverdueNow = (c.daysOverdue ?? 0) + Math.max(0, hoursBetween(c.createdAt, now) / 24);
  const bestChannel = (['whatsapp', 'email', 'sms'] as Channel[]).find((ch) => cust.channels[ch] && !(cust.dnd && ch === 'sms'));
  const out: Cand[] = [];
  const common = (channel?: Channel): string[] => {
    const f: string[] = [];
    if (st.doNotContact) f.push('do_not_contact');
    if (cause === 'dispute_risk') f.push('dispute_only_escalate');
    if (n >= 3) f.push('max_touches');
    if (last && hoursBetween(last.at, now) < 20) f.push('min_gap_between_touches');
    if (channel && !cust.channels[channel]) f.push('channel_opt_in');
    if (channel && cust.dnd && (channel === 'sms' || channel === 'voice')) f.push('dnd_registry');
    if (c.kind === 'overdue_invoice' && daysOverdueNow > 45 && n >= 1) f.push('b2b_escalation_threshold');
    return f;
  };
  const push = (type: ActionType, channel: Channel | undefined, extra: Array<string | false>, reason: string, incentivePct?: number, retryAt?: string) => {
    const channelCost = channel ? TOUCH_COST[channel] : 0;
    const cost = channelCost + (type === 'voice_call' ? TOUCH_COST.voice : 0);
    const incentiveCost = type === 'offer_incentive' ? Math.round((c.amountPaise * (incentivePct ?? 0)) / 100) : 0;
    const prob = Math.min(0.95, (PRIOR[cause]?.[type] ?? 0) * (channel === 'whatsapp' ? 1.1 : channel === 'email' ? 0.75 : 1) * Math.pow(0.6, n));
    const ev = Math.round(prob * (c.amountPaise - incentiveCost) - cost);
    const failed = [...(CUSTOMER_FACING.has(type) ? common(channel) : []), ...extra.filter((x): x is string => !!x)];
    if ((cost > 0 || type === 'offer_incentive') && ev <= 0) failed.push('positive_expected_value');
    out.push({ type, channel, allowed: failed.length === 0, ev, cost, failed, incentivePct, retryAt, reason });
  };
  push('wait_and_retry', undefined, [
    st.doNotContact && 'do_not_contact',
    cause === 'card_hard_decline' && 'no_retry_on_hard_decline',
    !RETRY_OK.has(cause) && 'silent_retry_applicability',
    retries >= 2 && 'max_silent_retries',
    (c.kind === 'abandoned_checkout' || c.kind === 'overdue_invoice') && 'has_payment_instrument',
    retries + n >= 4 && 'attempt_budget',
  ], `silent retry for ${cause}`, undefined, retryTimeFor(cause, now));
  for (const ch of ['whatsapp', 'sms', 'email'] as Channel[]) push('send_payment_link', ch, [], `payment link via ${ch}`);
  push('voice_call', 'voice', [c.amountPaise < 150_000 && 'voice_min_amount'], 'voice call with a script');
  if (bestChannel) {
    push('offer_incentive', bestChannel, [
      st.incentiveUsed && 'incentive_once',
      c.amountPaise < 100_000 && 'incentive_min_amount',
      !INCENTIVE_OK.has(cause) && 'incentive_cause_fit',
      budgetLeft < Math.round(c.amountPaise * 0.1) && 'incentive_budget',
      cust.segment === 'b2b' && 'no_incentive_b2b',
      n < 1 && 'incentive_not_first_touch',
    ], `10% incentive via ${bestChannel}`, 10);
    push('new_mandate_link', bestChannel, [!(cause === 'mandate_paused' || cause === 'mandate_revoked') && 'mandate_link_applicability'], `re-authorise mandate via ${bestChannel}`);
  }
  const exhausted = n >= 3 || st.doNotContact;
  const escalateReason = cause === 'dispute_risk' ? 'possible dispute'
    : c.kind === 'overdue_invoice' && daysOverdueNow > 45 ? 'B2B receivable past threshold'
    : cause === 'card_hard_decline' && cust.segment === 'vip' ? 'VIP with a hard decline'
    : exhausted && c.amountPaise >= 500_000 ? 'high-value case, automation exhausted'
    : undefined;
  push('escalate_human', undefined, [!escalateReason && 'escalation_trigger'], escalateReason ?? 'no escalation trigger');
  push('close_case', undefined, [], exhausted ? 'stopping rule reached' : 'nothing worth doing');
  return out;
}

// ---------- copy ----------
const REASONING: Record<RootCause, (bank: string | undefined, days: number | undefined) => string> = {
  insufficient_funds: (b) => `Bank response "${b ?? 'NSF'}" is an insufficient-funds code: the customer meant to pay, the balance was short. Money lands on a salary cycle, so a silent retry after ~36h beats a nudge.`,
  upi_timeout: () => 'The UPI collect request expired before approval: friction, not lost intent. A fresh link on the preferred channel usually converts.',
  bank_downtime: (b) => `Issuer or switch was down ("${b ?? '91'}"). Nothing the customer can fix; retry silently once the bank is back.`,
  card_hard_decline: (b) => `Issuer returned a do-not-retry decline ("${b ?? '05'}"). Never retry the same card; ask for another method or stop.`,
  card_soft_decline: () => 'Per-transaction or daily card limit exceeded. Limits reset overnight, so retry the next morning.',
  otp_abandoned: () => 'The customer left on the OTP page. Intent was there; make paying a single tap.',
  checkout_abandoned: () => 'Cart built, checkout never started. A gentle reminder first; a discount only if they hesitate.',
  mandate_paused: () => 'AutoPay mandate paused from the UPI app. Usually deliberate but reversible: send a re-authorisation link.',
  mandate_revoked: () => 'Mandate revoked by the customer. Treat as a cancellation unless they re-authorise on their own terms.',
  dispute_risk: () => 'The bank flags an open cardholder query on an earlier charge. Do not contact; hand to a human.',
  invoice_overdue: (_, d) => `B2B invoice ${d ?? '?'} days past due. AP teams pay on cycles: a polite reminder with the link, then a call.`,
  unknown: () => 'No usable failure signal; try the cheapest nudge.',
};
const WHY_EN: Partial<Record<RootCause, string>> = {
  insufficient_funds: 'the bank said the balance was short', upi_timeout: 'the UPI request timed out', bank_downtime: 'the bank was briefly down',
  card_hard_decline: 'the card was declined by your bank', card_soft_decline: 'the card hit its daily limit', otp_abandoned: 'the OTP step was left open',
};
const WHY_HI: Partial<Record<RootCause, string>> = {
  insufficient_funds: 'bank ne balance kam bataya', upi_timeout: 'UPI request time-out ho gayi', bank_downtime: 'bank thodi der ke liye down tha',
  card_hard_decline: 'card bank ne decline kar diya', card_soft_decline: 'card ki daily limit cross ho gayi', otp_abandoned: 'OTP step adhoora reh gaya',
};
function composeMessage(st: CaseState, action: ActionType, lang: Lang, cause: RootCause, url: string | undefined, days: number): string {
  const c = st.case;
  const first = firstName(c.customer.name);
  const amt = rupees(c.amountPaise);
  const link = url ?? 'https://rzp.io/i/simulated';
  if (c.kind === 'overdue_invoice') return `Dear ${c.customer.name} accounts team, invoice ${c.razorpay.invoiceId ?? ''} for ${c.description} (${amt}) is ${days} days past due. You can settle it here: ${link}. Reply here if you need a revised PO. — Saanjh & Co. receivables`;
  if (action === 'new_mandate_link') return lang === 'hinglish'
    ? `Namaste ${first}! Aapka Monthly Chai Box AutoPay pause ho gaya hai, isliye is mahine ka box ruka hua hai. Ek tap mein dobara authorise karein: ${link} — Saanjh & Co.`
    : `Hi ${first}, your Monthly Chai Box AutoPay is paused, so this month's box is on hold. Re-authorise in one tap: ${link} — Saanjh & Co.`;
  if (action === 'offer_incentive') return lang === 'hinglish'
    ? `${first}, aapka ${c.description} abhi bhi cart mein hai. Aaj complete karein aur 10% off paayein: ${link} — Saanjh & Co.`
    : `${first}, your ${c.description} is still waiting. Complete it today and we'll take 10% off: ${link} — Saanjh & Co.`;
  if (action === 'voice_call') return lang === 'hinglish'
    ? `Namaste ${first} ji, main Saanjh & Co. se bol rahi hoon. Aapka ${c.description} ka payment (${amt}) complete nahi ho paya tha. Kya main abhi WhatsApp par link bhej doon?`
    : `Hello ${first}, this is Saanjh & Co. Your payment of ${amt} for ${c.description} didn't complete. Shall I send a fresh link on WhatsApp right now?`;
  if (c.kind === 'abandoned_checkout') return lang === 'hinglish'
    ? `Namaste ${first}! Aapka ${c.description} (${amt}) cart mein rakha hai. Jab chahein yahan se complete karein: ${link} — Saanjh & Co.`
    : `Hi ${first}, your ${c.description} (${amt}) is still in the cart. Finish whenever you're ready: ${link} — Saanjh & Co.`;
  const why = (lang === 'hinglish' ? WHY_HI : WHY_EN)[cause] ?? (lang === 'hinglish' ? 'payment complete nahi hua' : "the payment didn't complete");
  return lang === 'hinglish'
    ? `Namaste ${first}! ${c.description} ka payment (${amt}) ${why}. Yeh naya link 48 ghante tak valid hai: ${link}. Koi dikkat ho to yahin reply karein. — Saanjh & Co.`
    : `Hi ${first}, your payment of ${amt} for ${c.description} didn't go through — ${why}. Here's a fresh link, valid for 48h: ${link}. Reply STOP to opt out. — Saanjh & Co.`;
}

// ---------- the run ----------
type Outcome = { kind: 'pays' | 'stop' | 'complaint' | 'no_response' | 'promise'; touch: Touch; hoursAfter: number; payAt?: string };
interface Scheduled { at: number; seq: number; caseId: string; kind: 'open' | 'act' | 'customer' | 'retry' | 'pay'; outcome?: Outcome }

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

class MockRun {
  readonly id: string;
  readonly config: RunConfig;
  private readonly rng: Rng;
  private readonly order: string[] = [];
  private readonly states = new Map<string, CaseState>();
  private readonly hidden: Map<string, Hidden>;
  private readonly truth: Map<string, RootCause>;
  private readonly audit: AuditEvent[] = [];
  private readonly listeners = new Set<(e: RunEvent) => void>();
  private queue: Scheduled[] = [];
  private qseq = 0;
  private tick = 0;
  private simNow = SIM_START;
  private status: RunSnapshot['status'] = 'running';
  private lamplighter: LamplighterState = { activity: 'Lacing boots for the morning round', resting: false };
  private metrics: RunMetrics;
  private baseline?: RunMetrics;
  /** One point per simulated hour, stamped like the server: after the hour's work, with the hour being entered. */
  private readonly timeline: TimelinePoint[] = [];
  private baselineTimeline?: TimelinePoint[];
  private paused = false;
  private resumeWaiters: Array<() => void> = [];
  private aborted = false;
  tickDelay: number;
  private deferred = 0;
  private budgetLeft = INCENTIVE_BUDGET;
  private llm = { calls: 0, fallbacks: 0, ms: 0 };
  private rzpRetries = 0;
  private realOrders = 0;
  private diag = { n: 0, rulesCorrect: 0, finalCorrect: 0, llmOverrides: 0, llmOverridesCorrect: 0 };
  private cold = new Set<string>();
  private started = false;

  constructor(cfg: CreateRunInput) {
    this.config = {
      seed: cfg.seed ?? 7, size: cfg.size ?? 60, llm: cfg.llm ?? true, mode: cfg.mode ?? 'agent', razorpay: cfg.razorpay ?? true,
      simDays: 7, chaos: cfg.chaos ?? 0, tickDelayMs: cfg.tickDelayMs ?? 200,
    };
    this.tickDelay = this.config.tickDelayMs;
    this.id = `mock_${this.config.seed}_${Date.now().toString(36)}`;
    this.rng = mulberry32(this.config.seed * 104729 + 3);
    const batch = generateBatch(this.config.seed, this.config.size);
    this.hidden = batch.hidden;
    this.truth = batch.truth;
    for (const c of batch.cases) { this.states.set(c.id, openState(c)); this.order.push(c.id); }
    this.metrics = this.computeMetrics();
    if (cfg.withBaseline ?? true) { const b = this.naiveBaseline(batch); this.baseline = b.metrics; this.baselineTimeline = b.timeline; }
  }

  // --- plumbing ---
  listen(fn: (e: RunEvent) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(e: RunEvent) { for (const l of this.listeners) l(e); }
  private timeAt(t: number) { return addHours(SIM_START, t); }
  private tickOf(iso: string) { return Math.max(this.tick + 1, Math.ceil(hoursBetween(SIM_START, iso) - 1e-6)); }
  private schedule(s: Omit<Scheduled, 'seq'>) { if (s.at < TICKS) this.queue.push({ ...s, seq: this.qseq++ }); }
  private cases(): CaseState[] { return this.order.map((id) => this.states.get(id)!); }
  private log(actor: AuditEvent['actor'], type: string, caseId: string | undefined, payload: Record<string, unknown>, simTs = this.simNow): AuditEvent {
    const prevHash = this.audit.length ? this.audit[this.audit.length - 1].hash : 'genesis';
    const seq = this.audit.length + 1;
    const ts = new Date().toISOString();
    const body = { seq, ts, simTs, caseId, actor, type, payload, prevHash };
    const e: AuditEvent = { ...body, hash: chainHash(JSON.stringify(body)) };
    this.audit.push(e);
    this.emit({ type: 'audit', event: e });
    return e;
  }
  private push(st: CaseState) { this.emit({ type: 'case', state: { ...st, touches: [...st.touches], razorpay: { ...st.razorpay } } }); }
  private lamp(caseId: string | undefined, activity: string, resting = false) {
    this.lamplighter = { caseId, activity, resting };
    this.emit({ type: 'lamplighter', lamplighter: this.lamplighter });
  }
  private gate(): Promise<void> { return this.paused ? new Promise((res) => this.resumeWaiters.push(res)) : Promise.resolve(); }
  pause() { this.paused = true; }
  resume() { this.paused = false; const w = this.resumeWaiters; this.resumeWaiters = []; for (const fn of w) fn(); }
  abort() { this.aborted = true; this.resume(); }

  snapshot(): RunSnapshot {
    return {
      id: this.id, config: this.config, status: this.status, simStart: SIM_START, simNow: this.simNow, simEnd: this.timeAt(TICKS),
      cases: this.cases(), metrics: this.metrics, baseline: this.baseline, lamplighter: this.lamplighter,
      timeline: this.timeline.slice(), baselineTimeline: this.baselineTimeline?.slice(), auditCount: this.audit.length, auditTail: this.audit.slice(-200),
    };
  }
  auditFor(caseId: string) { return this.audit.filter((e) => e.caseId === caseId); }
  state(caseId: string) { return this.states.get(caseId); }

  // --- main loop ---
  async start() {
    if (this.started) return;
    this.started = true;
    this.log('system', 'run_started', undefined, { config: this.config, cases: this.order.length, atRiskPaise: this.metrics.atRiskPaise, simStart: SIM_START, simEnd: this.timeAt(TICKS), seed: this.config.seed, size: this.config.size, llm: this.config.llm, razorpay: this.config.razorpay, merchant: MERCHANT.name });
    this.log('system', 'budget_set', undefined, { incentiveBudgetPaise: INCENTIVE_BUDGET, maxTouches: 3, quietHours: '21:00–09:00 IST', minGapHours: 20 });
    // Opening wave: biggest lanterns first, a few per contact hour, never at night.
    const ids = [...this.order].sort((a, b) => this.states.get(b)!.case.amountPaise - this.states.get(a)!.case.amountPaise);
    const perTick = Math.max(2, Math.ceil(ids.length / 20));
    let t = 0, slot = 0;
    for (const caseId of ids) {
      while (isQuietHours(this.timeAt(t))) t++;
      this.queue.push({ at: t, seq: this.qseq++, caseId, kind: 'open' });
      if (++slot >= perTick) { slot = 0; t++; }
    }
    for (let i = 0; i < TICKS; i++) {
      if (this.aborted) return;
      await this.gate();
      await this.step(i);
      await sleep(this.tickDelay);
    }
    this.finish();
  }
  private finish() {
    this.status = 'done';
    this.simNow = this.timeAt(TICKS);
    this.metrics = this.computeMetrics();
    this.lamp(undefined, `Week done · ${this.metrics.recoveredCases} lanterns relit, ${rupees(this.metrics.recoveredPaise)} home`, false);
    this.emit({ type: 'tick', simNow: this.simNow, metrics: this.metrics, lamplighter: this.lamplighter });
    this.log('system', 'run_finished', undefined, { metrics: this.metrics, auditChain: { ok: true }, recoveredPaise: this.metrics.recoveredPaise, atRiskPaise: this.metrics.atRiskPaise });
    this.emit({ type: 'done', metrics: this.metrics, baseline: this.baseline });
  }
  private async step(t: number) {
    this.tick = t;
    this.simNow = this.timeAt(t);
    const quiet = isQuietHours(this.simNow);
    const due = this.queue.filter((q) => q.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.queue = this.queue.filter((q) => q.at > t);
    const waiting = () => this.cases().filter((s) => s.status === 'scheduled' || s.status === 'open').length;
    if (quiet && !this.lamplighter.resting) this.lamp(undefined, `Quiet hours · resting at the well till 09:00 · ${waiting()} lanterns waiting`, true);
    if (!quiet && this.lamplighter.resting) this.lamp(undefined, `Morning round · ${waiting()} lanterns to check`, false);
    let worked = 0;
    for (const item of due) {
      const st = this.states.get(item.caseId);
      if (!st) continue;
      const before = this.audit.length;
      this.handle(item, st, quiet);
      // Pace the lamplighter's walk between houses, but only while someone can see it (background tabs throttle timers to ~1/s).
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (visible && this.audit.length > before && !quiet && ++worked < due.length) await sleep(Math.min(240, this.tickDelay / 2));
    }
    this.metrics = this.computeMetrics();
    this.timeline.push(this.timelinePoint(this.timeAt(t + 1)));
    this.emit({ type: 'tick', simNow: this.simNow, metrics: this.metrics, lamplighter: this.lamplighter });
  }
  private handle(item: Scheduled, st: CaseState, quiet: boolean) {
    const terminal = st.status === 'recovered' || st.status === 'escalated' || st.status === 'closed';
    switch (item.kind) {
      case 'open': if (st.status === 'open') this.openCase(st); break;
      case 'act': if (!terminal) this.plan(st, quiet); break;
      case 'retry': if (!terminal) this.silentRetry(st, quiet); break;
      case 'customer': if (!terminal && item.outcome) this.customerOutcome(st, item.outcome, quiet); break;
      case 'pay': if (!terminal && item.outcome) this.recover(st, 'simulated', item.outcome.hoursAfter, item.outcome.touch, quiet, 'paid as promised after the AP cycle'); break;
    }
  }

  // --- the agent ---
  private openCase(st: CaseState) {
    const c = st.case;
    const first = firstName(c.customer.name);
    this.log('agent', 'case_opened', c.id, { kind: c.kind, amountPaise: c.amountPaise, failure: c.failure, daysOverdue: c.daysOverdue, attemptsBefore: c.attemptsBefore, customer: { name: c.customer.name, city: c.customer.city, segment: c.customer.segment, lang: c.customer.lang, dnd: c.customer.dnd, channels: c.customer.channels } });
    this.lamp(c.id, `Reading ${first}'s ${KIND_LABEL[c.kind].toLowerCase()} · ${rupees(c.amountPaise)}`);
    this.diagnose(st);
    this.plan(st, false);
  }
  private diagnose(st: CaseState) {
    const c = st.case;
    const cause = this.truth.get(c.id) ?? 'unknown';
    const h = this.hidden.get(c.id)!;
    const ambiguous = !!h.bankMsg && (cause === 'card_hard_decline' || cause === 'dispute_risk' || cause === 'card_soft_decline' || cause === 'bank_downtime');
    const rulesSaid: RootCause = ambiguous && this.rng() < 0.5 ? (cause === 'bank_downtime' ? 'unknown' : 'card_soft_decline') : cause;
    let source: 'rules' | 'llm' | 'rules+llm' = 'rules';
    let confidence = rulesSaid === cause ? 0.62 + this.rng() * 0.12 : 0.55;
    let final = rulesSaid;
    let llmDisagreed = false;
    this.diag.n++;
    if (rulesSaid === cause) this.diag.rulesCorrect++;
    if (this.config.llm) {
      const ms = between(this.rng, 380, 2400);
      this.llm.calls++;
      this.llm.ms += ms;
      if (this.rng() < 0.07) {
        this.llm.fallbacks++;
        this.log('llm', 'llm_fallback', c.id, { ms, stage: 'diagnosis', error: pick(this.rng, ['schema mismatch: rootCause Invalid enum value', 'llm timeout', 'llm http 500']) });
      } else {
        source = 'rules+llm';
        confidence = 0.8 + this.rng() * 0.16;
        if (rulesSaid !== cause) { llmDisagreed = true; final = cause; this.diag.llmOverrides++; this.diag.llmOverridesCorrect++; }
        this.log('llm', 'llm_diagnosis', c.id, { ms, rootCause: final, confidence: Number(confidence.toFixed(2)), evidence: h.bankMsg ?? c.failure?.reason ?? c.kind });
      }
    }
    if (final === cause) this.diag.finalCorrect++;
    const reasoning = REASONING[final](h.bankMsg, c.daysOverdue);
    st.diagnosis = { rootCause: final, confidence: Number(confidence.toFixed(2)), reasoning, source, llmDisagreed: llmDisagreed || undefined };
    this.log('agent', 'diagnosis', c.id, { rootCause: final, confidence: st.diagnosis.confidence, source, reasoning, llmDisagreed, rulesSaid });
    this.push(st);
  }
  private plan(st: CaseState, quiet: boolean) {
    const c = st.case;
    const cause = st.diagnosis?.rootCause ?? 'unknown';
    const cands = evaluateCandidates(st, cause, this.simNow, this.budgetLeft);
    this.log('policy', 'candidates_evaluated', c.id, { candidates: cands.map(({ type, channel, allowed, ev, cost, failed }) => ({ type, channel, allowed, ev, cost, failed })) });
    const allowed = cands.filter((k) => k.allowed);
    const positive = allowed.filter((k) => k.type !== 'escalate_human' && k.type !== 'close_case' && k.ev > 0).sort((a, b) => b.ev - a.ev);
    const esc = allowed.find((k) => k.type === 'escalate_human');
    let chosen: Cand;
    let source: 'llm' | 'fallback' | 'rules' = 'rules';
    if (esc) chosen = esc;
    else if (positive.length) {
      chosen = positive[0];
      if (this.config.llm) {
        const ms = between(this.rng, 300, 1800);
        this.llm.calls++;
        this.llm.ms += ms;
        if (this.rng() < 0.05) {
          this.llm.fallbacks++;
          source = 'fallback';
          this.log('llm', 'llm_fallback', c.id, { ms, stage: 'plan', error: pick(this.rng, ['chose an action the policy had blocked (voice_call)', 'schema mismatch: channel Invalid enum value', 'llm timeout']) });
        } else {
          source = 'llm';
          const alt = positive[1];
          let why = `highest expected value (${rupees(chosen.ev)})`;
          if (alt && alt.channel === 'whatsapp' && c.customer.lang === 'hinglish' && this.rng() < 0.6) { chosen = alt; why = 'Hinglish-first customer with WhatsApp opted in: a warm nudge beats a blind retry'; }
          else if (alt && chosen.type === 'send_payment_link' && alt.type === 'wait_and_retry' && cause === 'insufficient_funds' && this.rng() < 0.5) { chosen = alt; why = 'salary-cycle NSF: retrying quietly after payday avoids a needless message'; }
          this.log('llm', 'llm_plan', c.id, { ms, choice: `${chosen.type}${chosen.channel ? `:${chosen.channel}` : ''}`, action: chosen.type, channel: chosen.channel, reasoning: why, fallbackWouldBe: positive[0].type });
          chosen = { ...chosen, reason: why };
        }
      }
    } else chosen = allowed.find((k) => k.type === 'close_case')!;
    this.log('agent', 'plan', c.id, { action: chosen.type, channel: chosen.channel, reason: chosen.reason, source, ev: chosen.ev, cost: chosen.cost, retryAt: chosen.retryAt, incentivePct: chosen.incentivePct });
    this.execute(st, chosen, quiet);
  }
  private execute(st: CaseState, k: Cand, quiet: boolean) {
    const c = st.case;
    const first = firstName(c.customer.name);
    const lang = c.customer.lang;
    if (CUSTOMER_FACING.has(k.type) && quiet) {
      const until = nextIstHour(this.simNow, 9);
      this.log('agent', 'action_deferred', c.id, { action: k.type, channel: k.channel, until, reason: 'quiet hours (21:00–09:00 IST)' });
      this.deferred++;
      st.status = 'scheduled';
      st.nextActionAt = until;
      this.schedule({ at: this.tickOf(until), caseId: c.id, kind: 'act' });
      this.push(st);
      return;
    }
    switch (k.type) {
      case 'wait_and_retry': {
        const retryAt = k.retryAt ?? addHours(this.simNow, 24);
        st.touches.push({ at: this.simNow, action: 'wait_and_retry', costPaise: 0 });
        st.status = 'scheduled';
        st.nextActionAt = retryAt;
        this.log('agent', 'silent_retry_scheduled', c.id, { at: retryAt, cause: st.diagnosis?.rootCause, reason: k.reason });
        if (!quiet) this.lamp(c.id, `Letting ${first}'s bank settle · retry ${fmtTime(retryAt)}`);
        this.schedule({ at: this.tickOf(retryAt), caseId: c.id, kind: 'retry' });
        break;
      }
      case 'send_payment_link':
      case 'offer_incentive':
      case 'new_mandate_link': {
        const channel = k.channel ?? 'whatsapp';
        // Every message links to the self-hosted checkout page for a Razorpay test-mode order (or a simulated order).
        const discount = k.incentivePct ? Math.round((c.amountPaise * k.incentivePct) / 100) : 0;
        const url = `http://localhost:8787/pay/${this.id}/${c.id}`;
        let orderId: string;
        if (this.config.razorpay) {
          if (this.rng() < 0.04) { this.rzpRetries++; this.log('razorpay', 'api_retry', c.id, { op: 'orders.create', attempt: 1, error: '503 Service Unavailable', waitMs: 200 }); }
          orderId = id(this.rng, 'order');
          this.realOrders++;
          this.log('razorpay', 'order_created', c.id, { id: orderId, amount: c.amountPaise - discount, receipt: `lamp_${c.id.slice(5, 19)}`, status: 'created', purpose: 'recovery', payUrl: url });
        } else {
          orderId = `order_sim_${id(this.rng, '', 10).slice(1)}`;
          this.log('razorpay', 'order_simulated', c.id, { id: orderId, payUrl: url, note: 'razorpay disabled for this run' });
        }
        st.razorpay = { ...st.razorpay, recoveryOrderId: orderId, payUrl: url };
        const days = (c.daysOverdue ?? 0) + Math.floor(hoursBetween(c.createdAt, this.simNow) / 24);
        const message = composeMessage(st, k.type, lang, st.diagnosis?.rootCause ?? 'unknown', url, days);
        if (this.config.llm) {
          const ms = between(this.rng, 500, 2600);
          this.llm.calls++;
          this.llm.ms += ms;
          this.log('llm', 'llm_compose', c.id, { ms, channel, lang, chars: message.length });
        }
        this.log('agent', 'message_composed', c.id, { channel, lang, message, source: this.config.llm ? 'llm' : 'rules', incentivePct: k.incentivePct });
        this.log('agent', 'message_sent', c.id, { channel, lang, message, costPaise: k.cost, incentivePct: k.incentivePct, orderId, payUrl: url, action: k.type, delivery: 'simulated (synthetic customer)' });
        const touch: Touch = { at: this.simNow, action: k.type, channel, message, costPaise: k.cost, orderId, payUrl: url };
        st.touches.push(touch);
        st.costPaise += k.cost;
        if (k.type === 'offer_incentive') { st.incentiveUsed = true; this.budgetLeft -= Math.round(c.amountPaise * 0.1); }
        st.status = 'awaiting_customer';
        st.nextActionAt = undefined;
        this.lamp(c.id, k.type === 'offer_incentive' ? `Offering ${first} 10% off on ${CHANNEL_LABEL[channel]}` : k.type === 'new_mandate_link' ? `Sending ${first} a fresh AutoPay link on ${CHANNEL_LABEL[channel]}` : `${CHANNEL_LABEL[channel]} nudge to ${first} in ${lang === 'hinglish' ? 'Hinglish' : 'English'}`);
        this.scheduleOutcome(st, touch, this.bookFollowUp(st));
        break;
      }
      case 'voice_call': {
        const script = composeMessage(st, 'voice_call', lang, st.diagnosis?.rootCause ?? 'unknown', undefined, 0);
        this.log('agent', 'call_placed', c.id, { lang, script, costPaise: k.cost });
        const touch: Touch = { at: this.simNow, action: 'voice_call', channel: 'voice', message: script, costPaise: k.cost };
        st.touches.push(touch);
        st.costPaise += k.cost;
        st.status = 'awaiting_customer';
        st.nextActionAt = undefined;
        this.lamp(c.id, `Calling ${first} · ${lang === 'hinglish' ? 'Hinglish' : 'English'} script`);
        this.scheduleOutcome(st, touch, this.bookFollowUp(st));
        break;
      }
      case 'escalate_human':
        this.log('agent', 'escalated', c.id, { reason: k.reason });
        st.status = 'escalated';
        st.escalationReason = k.reason;
        st.nextActionAt = undefined;
        if (!quiet) this.lamp(c.id, `Handing ${first}'s case to a human · ${k.reason}`);
        break;
      case 'close_case':
        this.log('agent', 'closed', c.id, { reason: k.reason });
        st.status = 'closed';
        st.closeReason = k.reason;
        st.nextActionAt = undefined;
        if (!quiet) this.lamp(c.id, `Hooding ${first}'s lantern · ${k.reason}`);
        break;
    }
    this.push(st);
  }
  /** Book the check-back: 18–30h out, so evening touches come due inside quiet hours and the policy has to defer. */
  private bookFollowUp(st: CaseState): string {
    const hours = 18 + between(this.rng, 0, 12);
    const at = addHours(this.simNow, hours);
    st.nextActionAt = at;
    this.log('agent', 'follow_up_scheduled', st.case.id, { at, reason: `check back in ${hours}h if there is no reply` });
    return at;
  }
  private scheduleOutcome(st: CaseState, touch: Touch, followUpAt: string) {
    const c = st.case;
    const h = this.hidden.get(c.id)!;
    const n = st.touches.filter((t) => CUSTOMER_FACING.has(t.action)).length - 1; // touches before this one
    const touchNo = n + 1;
    const at = this.simNow;
    const r = this.rng;
    const sched = (kind: Outcome['kind'], when: string, payAt?: string) =>
      this.schedule({ at: this.tickOf(when), caseId: c.id, kind: 'customer', outcome: { kind, touch, hoursAfter: hoursBetween(at, when), payAt } });
    if (this.cold.has(c.id)) return sched('no_response', followUpAt);
    if (h.willStop && touchNo >= 2 && r() < 0.8) return sched('stop', addHours(at, 0.5 + r() * 3));
    if (touchNo > h.annoyance) {
      this.cold.add(c.id);
      return r() < 0.5 ? sched('complaint', addHours(at, 1 + r() * 4)) : sched('no_response', followUpAt);
    }
    let p = h.payProb * (touch.channel ? h.affinity[touch.channel] : 1) * Math.pow(0.7, n);
    if (touch.action === 'offer_incentive') p *= h.respondsToIncentive ? 1.9 : 1.1;
    if (touch.action === 'new_mandate_link' && h.archetype === 'friction') p *= 1.25;
    p *= 1.1; // language matched by construction
    const hr = istHour(at);
    if ((hr >= 9 && hr < 11) || (hr >= 18 && hr < 20.5)) p *= 1.1;
    if (h.archetype === 'temporary_funds' && h.fundsAt && at < h.fundsAt) p *= 0.2;
    if (h.archetype === 'busy_ap' && touch.action === 'voice_call') p *= 1.4;
    p = Math.min(0.97, p);
    if (r() < p) {
      let payAt = addHours(at, h.delayHours * (0.5 + r()));
      if (h.fundsAt && payAt < h.fundsAt) payAt = addHours(h.fundsAt, 2 + r() * 6);
      if (h.archetype === 'busy_ap' && r() < 0.45) return sched('promise', addHours(at, 4), addHours(at, 48 + r() * 72));
      return sched('pays', payAt);
    }
    return sched('no_response', followUpAt);
  }
  private customerOutcome(st: CaseState, o: Outcome, quiet: boolean) {
    const c = st.case;
    const first = firstName(c.customer.name);
    switch (o.kind) {
      case 'pays':
        this.recover(st, 'simulated', o.hoursAfter, o.touch, quiet, `paid ${fmtHours(o.hoursAfter)} after the ${o.touch.channel ? CHANNEL_LABEL[o.touch.channel] : ''} ${o.touch.action === 'voice_call' ? 'call' : 'nudge'}`.replace(/\s+/g, ' '));
        break;
      case 'promise':
        this.log('customer', 'promise_to_pay', c.id, { payAt: o.payAt, channel: o.touch.channel, note: 'AP team promised payment after their cycle' });
        if (o.payAt) this.schedule({ at: this.tickOf(o.payAt), caseId: c.id, kind: 'pay', outcome: { ...o, hoursAfter: hoursBetween(o.touch.at, o.payAt) } });
        break;
      case 'stop':
        this.log('customer', 'stop', c.id, { channel: o.touch.channel, text: 'STOP' });
        st.doNotContact = true;
        st.status = 'closed';
        st.closeReason = 'customer asked us to stop';
        this.log('agent', 'closed', c.id, { reason: st.closeReason });
        if (!quiet) this.lamp(c.id, `${first} said STOP · hooding the lantern, no more knocks`);
        this.push(st);
        break;
      case 'complaint':
        this.log('customer', 'complaint', c.id, { channel: o.touch.channel, note: `touch #${st.touches.filter((t) => CUSTOMER_FACING.has(t.action)).length} was one too many` });
        st.complained = true;
        st.status = 'closed';
        st.closeReason = 'customer complained: stopping all contact';
        this.log('agent', 'closed', c.id, { reason: st.closeReason });
        this.push(st);
        break;
      case 'no_response':
        // The follow-up came due with no reply: re-plan now. In quiet hours the policy defers any contact to 09:00.
        this.log('customer', 'no_response', c.id, { channel: o.touch.channel, action: o.touch.action, hoursWaited: Math.round(o.hoursAfter) });
        this.plan(st, quiet);
        break;
    }
  }
  private silentRetry(st: CaseState, quiet: boolean) {
    const c = st.case;
    const h = this.hidden.get(c.id)!;
    const first = firstName(c.customer.name);
    let p: number;
    switch (h.archetype) {
      case 'temporary_funds': p = h.fundsAt && this.simNow >= h.fundsAt ? 0.8 : 0.05; break;
      case 'friction': p = 0.75; break;
      case 'forgot': p = 0.2; break;
      case 'hard_no': p = 0; break;
      default: p = 0.12;
    }
    if (this.config.razorpay) {
      const orderId = id(this.rng, 'order');
      st.razorpay = { ...st.razorpay, orderId };
      this.realOrders++;
      this.log('razorpay', 'order_created', c.id, { id: orderId, amount: c.amountPaise, receipt: `lamp_${c.id.slice(5, 19)}`, status: 'created', purpose: 'silent_retry' });
    }
    if (this.rng() < p) {
      this.log('agent', 'silent_retry_result', c.id, { success: true, note: `retry succeeded on the saved ${c.failure?.method ?? 'instrument'}` });
      const lastTouch = st.touches[st.touches.length - 1];
      this.recover(st, 'simulated', hoursBetween(lastTouch.at, this.simNow), lastTouch, quiet, `silent retry succeeded on the saved ${c.failure?.method ?? 'instrument'}`);
      return;
    }
    const msg = h.bankMsg ?? 'declined again';
    st.lastError = msg;
    this.log('agent', 'silent_retry_result', c.id, { success: false, note: `bank declined again: ${msg}` });
    if (!quiet) this.lamp(c.id, `${first}'s bank said no again · re-planning`);
    this.plan(st, quiet);
  }
  private recover(st: CaseState, via: 'simulated' | 'razorpay', hoursAfter: number, touch: Touch | undefined, quiet: boolean, note: string) {
    const c = st.case;
    const first = firstName(c.customer.name);
    const disc = st.incentiveUsed ? Math.round(c.amountPaise * 0.1) : 0;
    const amount = c.amountPaise - disc;
    // Same two-step shape as the server: the money event (customer `paid` / razorpay `payment_link_paid`), then the agent's `recovered`.
    this.log(via === 'razorpay' ? 'razorpay' : 'customer', via === 'razorpay' ? 'payment_link_paid' : 'paid', c.id, { amountPaise: amount, via, note, discountPaise: disc, hoursAfter: Number(hoursAfter.toFixed(1)), channel: touch?.channel, action: touch?.action });
    this.log('agent', 'recovered', c.id, { amountPaise: amount, via, touches: st.touches.length, costPaise: st.costPaise });
    st.status = 'recovered';
    st.recoveredPaise = amount;
    st.recoveredVia = via;
    st.recoveredAt = this.simNow;
    st.nextActionAt = undefined;
    if (!quiet) this.lamp(c.id, `${first}'s lantern is lit again (+${rupees(amount)})`);
    this.push(st);
  }

  // --- manual controls (drawer buttons) ---
  manualStop(caseId: string): boolean {
    const st = this.states.get(caseId);
    if (!st || st.status === 'recovered' || st.status === 'escalated' || st.status === 'closed') return false;
    const last = st.touches[st.touches.length - 1] ?? { at: this.simNow, action: 'send_payment_link' as ActionType, costPaise: 0 };
    this.customerOutcome(st, { kind: 'stop', touch: last, hoursAfter: 0 }, isQuietHours(this.simNow));
    this.metrics = this.computeMetrics();
    this.emit({ type: 'tick', simNow: this.simNow, metrics: this.metrics, lamplighter: this.lamplighter });
    return true;
  }
  manualPaid(caseId: string): 'simulated' | null {
    const st = this.states.get(caseId);
    if (!st || st.status === 'recovered' || st.status === 'escalated' || st.status === 'closed') return null;
    const last = st.touches[st.touches.length - 1];
    // Offline there is no Razorpay to ask, so this is always the audited manual override.
    this.log('system', 'manual_override', caseId, { note: 'operator marked paid (demo control); not verified on Razorpay' });
    this.recover(st, 'simulated', last ? hoursBetween(last.at, this.simNow) : 0, last, isQuietHours(this.simNow), 'marked paid by an operator (manual override)');
    this.metrics = this.computeMetrics();
    this.emit({ type: 'tick', simNow: this.simNow, metrics: this.metrics, lamplighter: this.lamplighter });
    return 'simulated';
  }

  // --- numbers ---
  /** Same shape and semantics as the server's timelinePoint(): cumulative money/touches/complaints, current status counts. */
  private timelinePoint(t: string): TimelinePoint {
    let recoveredPaise = 0, recoveredCases = 0, touches = 0, complaints = 0, escalated = 0, closed = 0, awaiting = 0, scheduled = 0;
    for (const s of this.cases()) {
      if (s.status === 'recovered') { recoveredPaise += s.recoveredPaise; recoveredCases++; }
      else if (s.status === 'escalated') escalated++; else if (s.status === 'closed') closed++;
      else if (s.status === 'awaiting_customer') awaiting++; else if (s.status === 'scheduled') scheduled++;
      touches += s.touches.filter((x) => x.action !== 'wait_and_retry').length;
      if (s.complained) complaints++;
    }
    return { t, recoveredPaise, recoveredCases, touches, complaints, escalated, closed, awaiting, scheduled };
  }
  private computeMetrics(): RunMetrics {
    const states = this.cases();
    const byKind = {} as RunMetrics['byKind'];
    for (const k of ['failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'] as CaseKind[]) byKind[k] = { cases: 0, atRiskPaise: 0, recoveredPaise: 0, recoveredCases: 0 };
    const byRootCause: RunMetrics['byRootCause'] = {};
    let atRisk = 0, recovered = 0, recoveredCases = 0, cost = 0, touches = 0, escalated = 0, closed = 0, complaints = 0, stops = 0, realPaid = 0, incentive = 0;
    for (const s of states) {
      const k = s.case.kind;
      atRisk += s.case.amountPaise;
      byKind[k].cases++;
      byKind[k].atRiskPaise += s.case.amountPaise;
      const rc = s.diagnosis?.rootCause ?? 'undiagnosed';
      byRootCause[rc] ??= { cases: 0, recoveredCases: 0, recoveredPaise: 0 };
      byRootCause[rc].cases++;
      if (s.status === 'recovered') {
        recovered += s.recoveredPaise; recoveredCases++;
        byKind[k].recoveredPaise += s.recoveredPaise; byKind[k].recoveredCases++;
        byRootCause[rc].recoveredCases++; byRootCause[rc].recoveredPaise += s.recoveredPaise;
        if (s.incentiveUsed) incentive += s.case.amountPaise - s.recoveredPaise;
        if (s.recoveredVia === 'razorpay') realPaid++;
      }
      cost += s.costPaise;
      touches += s.touches.length;
      if (s.status === 'escalated') escalated++;
      if (s.status === 'closed') closed++;
      if (s.complained) complaints++;
      if (s.doNotContact) stops++;
    }
    return {
      cases: states.length, atRiskPaise: atRisk, recoveredPaise: recovered, recoveredCases,
      recoveryRate: atRisk ? recovered / atRisk : 0, recoveryRateCases: states.length ? recoveredCases / states.length : 0,
      costPaise: cost, costPerRecoveredRupee: recovered ? (cost + incentive) / recovered : 0,
      touches, touchesPerCase: states.length ? touches / states.length : 0,
      escalated, closed, complaints, stopRequests: stops, policyViolations: 0,
      realRazorpayOrders: this.realOrders, realRazorpayPaid: realPaid, byKind, byRootCause,
      llmCalls: this.llm.calls, llmFallbacks: this.llm.fallbacks, llmAvgMs: this.llm.calls ? Math.round(this.llm.ms / this.llm.calls) : 0,
      razorpayRetries: this.rzpRetries, diagnosis: { ...this.diag }, incentiveSpentPaise: incentive, deferredForQuietHours: this.deferred, simDays: 7,
    };
  }
  /** What a cron job would have done: SMS link every 24h ×3, at whatever hour, ignoring DND and STOP.
   *  Also returns its hourly timeline (same conventions as the agent's) so the review can draw both curves. */
  private naiveBaseline(batch: Batch): { metrics: RunMetrics; timeline: TimelinePoint[] } {
    const r = mulberry32(this.config.seed * 31 + 11);
    // hour offsets from SIM_START; the money lands a little after the SMS (the customer's own delay), never in a new rng draw
    interface Ev { touchAt: number[]; paidAt?: number; paidPaise: number; complaintsAt: number[]; closedAt?: number }
    const events: Ev[] = [];
    const byKind = {} as RunMetrics['byKind'];
    for (const k of ['failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'] as CaseKind[]) byKind[k] = { cases: 0, atRiskPaise: 0, recoveredPaise: 0, recoveredCases: 0 };
    let atRisk = 0, recovered = 0, recoveredCases = 0, complaints = 0, stops = 0, violations = 0, touches = 0;
    for (const c of batch.cases) {
      const h = batch.hidden.get(c.id)!;
      const cause = batch.truth.get(c.id)!;
      atRisk += c.amountPaise;
      byKind[c.kind].cases++;
      byKind[c.kind].atRiskPaise += c.amountPaise;
      let stopped = false, paid = false;
      const startHour = between(r, 0, 23);
      const ev: Ev = { touchAt: [], paidPaise: 0, complaintsAt: [] };
      for (let k = 1; k <= 3 && !paid; k++) {
        touches++;
        const hour = startHour + (k - 1) * 24;
        const at = addHours(SIM_START, hour);
        ev.touchAt.push(hour);
        const quiet = isQuietHours(at);
        if (quiet) violations++;
        if (c.customer.dnd) violations++;
        if (stopped) violations++;
        if (cause === 'dispute_risk') violations++;
        if (!c.customer.channels.sms) violations++;
        let p = h.payProb * h.affinity.sms * Math.pow(0.7, k - 1) * (quiet ? 0.6 : 1) * (c.customer.lang === 'hinglish' ? 0.9 : 1);
        if (h.archetype === 'temporary_funds' && h.fundsAt && at < h.fundsAt) p *= 0.2;
        if (stopped) p *= 0.1;
        if (r() < p) { paid = true; recovered += c.amountPaise; recoveredCases++; byKind[c.kind].recoveredPaise += c.amountPaise; byKind[c.kind].recoveredCases++; ev.paidAt = hour + Math.ceil(Math.min(h.delayHours, 24) / 2); ev.paidPaise = c.amountPaise; break; }
        if (!stopped && h.willStop && k >= 2 && r() < 0.8) { stopped = true; stops++; }
        if (k > h.annoyance && r() < 0.5) { complaints++; ev.complaintsAt.push(hour + 2); }
        if (quiet && r() < 0.25) { complaints++; ev.complaintsAt.push(hour + 1); }
      }
      if (!paid) ev.closedAt = ev.touchAt[ev.touchAt.length - 1] + 24; // the cron gives up a day after its last SMS
      events.push(ev);
    }
    const timeline: TimelinePoint[] = [];
    for (let t = 1; t <= TICKS; t++) {
      // an event at hour h is worked at that hour and shows in the point stamped h+1 (server convention)
      let recoveredPaise = 0, recoveredCases = 0, touchesN = 0, complaintsN = 0, closedN = 0, awaiting = 0;
      for (const e of events) {
        touchesN += e.touchAt.filter((h) => h < t).length;
        complaintsN += e.complaintsAt.filter((h) => h < t).length;
        if (e.paidAt !== undefined && e.paidAt < t) { recoveredPaise += e.paidPaise; recoveredCases++; }
        else if (e.closedAt !== undefined && e.closedAt < t) closedN++;
        else if (e.touchAt[0] < t) awaiting++;
      }
      timeline.push({ t: addHours(SIM_START, t), recoveredPaise, recoveredCases, touches: touchesN, complaints: complaintsN, escalated: 0, closed: closedN, awaiting, scheduled: 0 });
    }
    const cost = touches * TOUCH_COST.sms;
    const metrics: RunMetrics = {
      cases: batch.cases.length, atRiskPaise: atRisk, recoveredPaise: recovered, recoveredCases,
      recoveryRate: atRisk ? recovered / atRisk : 0, recoveryRateCases: batch.cases.length ? recoveredCases / batch.cases.length : 0,
      costPaise: cost, costPerRecoveredRupee: recovered ? cost / recovered : 0, touches, touchesPerCase: 3,
      escalated: 0, closed: batch.cases.length - recoveredCases, complaints, stopRequests: stops, policyViolations: violations,
      realRazorpayOrders: 0, realRazorpayPaid: 0, byKind, byRootCause: {}, llmCalls: 0, llmFallbacks: 0, llmAvgMs: 0, razorpayRetries: 0,
      diagnosis: { n: 0, rulesCorrect: 0, finalCorrect: 0, llmOverrides: 0, llmOverridesCorrect: 0 }, incentiveSpentPaise: 0, deferredForQuietHours: 0, simDays: 7,
    };
    return { metrics, timeline };
  }
}

export function createMockBackend(): Backend {
  const runs = new Map<string, MockRun>();
  const get = (id: string) => { const r = runs.get(id); if (!r) throw new Error(`mock: no run ${id}`); return r; };
  return {
    kind: 'mock',
    health: async () => ({ ok: true, llm: { enabled: true, model: 'qwen3-4b · mock' }, razorpay: { enabled: true, keyId: 'rzp_test_MockKey000000' } } satisfies Health),
    createRun: async (cfg) => {
      for (const r of runs.values()) r.abort();
      runs.clear();
      const run = new MockRun(cfg);
      runs.set(run.id, run);
      setTimeout(() => { void run.start(); }, 40);
      return { id: run.id };
    },
    getRun: async (id) => get(id).snapshot(),
    subscribe(id, onEvent, onStatus: (s: StreamStatus, detail?: string) => void) {
      const run = runs.get(id);
      if (!run) { onStatus('closed', 'no such run'); return () => {}; }
      let off: (() => void) | null = null;
      let cancelled = false;
      onStatus('connecting');
      queueMicrotask(() => {
        if (cancelled) return;
        onEvent({ type: 'snapshot', snapshot: run.snapshot() });
        off = run.listen(onEvent);
        onStatus('live');
      });
      return () => { cancelled = true; off?.(); };
    },
    getCase: async (id, caseId) => {
      const run = get(id);
      const state = run.state(caseId);
      if (!state) throw new Error(`mock: no case ${caseId}`);
      return { state, audit: run.auditFor(caseId) };
    },
    stopCase: async (id, caseId) => ({ ok: get(id).manualStop(caseId) }),
    markPaid: async (id, caseId) => { const via = get(id).manualPaid(caseId); return via ? { ok: true, via } : { ok: false }; },
    pause: async (id) => { get(id).pause(); return { ok: true }; },
    resume: async (id) => { get(id).resume(); return { ok: true }; },
    verify: async () => ({ ok: true }),
    setTickDelay: (id, ms) => { const r = runs.get(id); if (r) r.tickDelay = ms; },
  };
}

/** Empty-state preview: the town before any run, every lantern dark. */
export function previewCases(seed: number, size: number): CaseState[] {
  return generateBatch(seed, size).cases.map(openState);
}
