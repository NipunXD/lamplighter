// Deterministic synthetic batch generator for Saanjh & Co., a Jaipur tea & candle studio on Razorpay.
// Produces public RevenueCases (what the agent sees) and HiddenProfiles (what only the simulator sees).
import seedrandom from 'seedrandom';
import type { Archetype, CaseKind, Channel, Customer, FailureInfo, HiddenProfile, RevenueCase, RootCause, Segment } from '../types.js';
import { addHours } from '../time.js';

export const MERCHANT = { name: 'Saanjh & Co.', category: 'D2C tea & candles, Jaipur' };
export const SIM_START = '2026-09-07T03:30:00.000Z'; // Mon 07 Sep 2026, 09:00 IST

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

interface FailureTemplate { cause: RootCause; f: Omit<FailureInfo, 'method'> & { method?: FailureInfo['method'] }; bankMessages?: string[] }

// Razorpay-style error objects. `bankMessages` are raw acquirer / NPCI response strings that the rules layer
// deliberately does NOT parse — that is where the local LLM earns its keep.
const FAILURES_PAYMENT: Array<{ w: number; t: FailureTemplate }> = [
  { w: 30, t: { cause: 'insufficient_funds', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: "Your payment didn't go through as it was declined by the bank.", source: 'customer', step: 'payment_authorization' }, bankMessages: ['Z9: INSUFFICIENT FUNDS IN CUSTOMER ACCOUNT', 'U30: DEBIT HAS BEEN FAILED (INSUFFICIENT BALANCE)', '51: NOT SUFFICIENT FUNDS', 'Z6: LOW BALANCE - TXN DECLINED'] } },
  { w: 22, t: { cause: 'upi_timeout', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_timed_out', description: 'Payment was not completed on time. The UPI request expired before it was approved.', source: 'customer', step: 'payment_authentication', method: 'upi' }, bankMessages: ['U69: COLLECT EXPIRED', 'BT: TRANSACTION TIMED OUT AT REMITTER', 'U28: PSP NOT AVAILABLE'] } },
  { w: 14, t: { cause: 'bank_downtime', f: { code: 'GATEWAY_ERROR', reason: 'gateway_technical_error', description: "The bank's server is currently facing downtime. Please try again after some time.", source: 'bank', step: 'payment_authorization' }, bankMessages: ['91: ISSUER OR SWITCH INOPERATIVE', 'U16: RISK THRESHOLD EXCEEDED / SWITCH DOWN', 'BANK SERVER UNAVAILABLE (HTTP 503)'] } },
  { w: 8, t: { cause: 'card_hard_decline', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: "Your payment didn't go through as it was declined by the bank.", source: 'bank', step: 'payment_authorization', method: 'card' }, bankMessages: ['43: STOLEN CARD, PICK UP', '41: LOST CARD', '14: INVALID CARD NUMBER / ACCOUNT CLOSED', '05: DO NOT HONOUR (BLOCKED BY ISSUER)'] } },
  { w: 10, t: { cause: 'card_soft_decline', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: 'Transaction limit exceeded for this card. Try another card or contact your bank.', source: 'bank', step: 'payment_authorization', method: 'card' }, bankMessages: ['61: EXCEEDS WITHDRAWAL AMOUNT LIMIT', 'Z8: PER TRANSACTION LIMIT EXCEEDED', '65: EXCEEDS FREQUENCY LIMIT'] } },
  { w: 12, t: { cause: 'otp_abandoned', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_cancelled', description: 'Payment processing cancelled by user on the OTP page.', source: 'customer', step: 'payment_authentication' }, bankMessages: ['USER CANCELLED AT ACS', 'OTP NOT SUBMITTED - SESSION CLOSED'] } },
  { w: 4, t: { cause: 'dispute_risk', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: 'Payment declined. Cardholder reported an unrecognised earlier charge from this merchant.', source: 'bank', step: 'payment_authorization', method: 'card' }, bankMessages: ['59: SUSPECTED FRAUD - CARDHOLDER QUERY OPEN', 'CHARGEBACK INQUIRY PENDING ON PRIOR TXN'] } },
];
const FAILURES_SUBSCRIPTION: Array<{ w: number; t: FailureTemplate }> = [
  { w: 45, t: { cause: 'mandate_paused', f: { code: 'BAD_REQUEST_ERROR', reason: 'mandate_paused', description: 'The UPI AutoPay mandate has been paused by the customer in their UPI app.', source: 'customer', step: 'mandate_execution', method: 'emandate' } } },
  { w: 15, t: { cause: 'mandate_revoked', f: { code: 'BAD_REQUEST_ERROR', reason: 'mandate_revoked', description: 'The mandate was revoked by the customer. No further debits can be executed.', source: 'customer', step: 'mandate_execution', method: 'emandate' } } },
  { w: 30, t: { cause: 'insufficient_funds', f: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed', description: 'Mandate execution failed at the bank.', source: 'customer', step: 'mandate_execution', method: 'emandate' }, bankMessages: ['Z9: INSUFFICIENT FUNDS IN CUSTOMER ACCOUNT', 'U30: DEBIT HAS BEEN FAILED (INSUFFICIENT BALANCE)'] } },
  { w: 10, t: { cause: 'bank_downtime', f: { code: 'GATEWAY_ERROR', reason: 'gateway_technical_error', description: 'Mandate execution failed because the bank was unavailable.', source: 'bank', step: 'mandate_execution', method: 'emandate' }, bankMessages: ['91: ISSUER OR SWITCH INOPERATIVE'] } },
];

function pick<T>(rng: seedrandom.PRNG, arr: readonly T[]): T { return arr[Math.floor(rng() * arr.length)]; }
function weighted<T>(rng: seedrandom.PRNG, arr: Array<{ w: number; t: T }>): T {
  const total = arr.reduce((s, a) => s + a.w, 0);
  let r = rng() * total;
  for (const a of arr) { r -= a.w; if (r <= 0) return a.t; }
  return arr[arr.length - 1].t;
}
function between(rng: seedrandom.PRNG, min: number, max: number): number { return min + Math.floor(rng() * (max - min + 1)); }
function id(rng: seedrandom.PRNG, prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 14; i++) s += chars[Math.floor(rng() * chars.length)];
  return `${prefix}_${s}`;
}

function makeCustomer(rng: seedrandom.PRNG, kind: CaseKind, i: number): Customer {
  const b2b = kind === 'overdue_invoice';
  const name = b2b ? pick(rng, B2B) : `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
  const segment: Segment = b2b ? 'b2b' : weighted(rng, [{ w: 30, t: 'new' as Segment }, { w: 50, t: 'regular' as Segment }, { w: 20, t: 'vip' as Segment }]);
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  const whatsapp = rng() < (b2b ? 0.5 : 0.72);
  return {
    id: id(rng, 'cust'),
    name,
    phone: `+91${between(rng, 70000, 99999)}${String(between(rng, 0, 99999)).padStart(5, '0')}`,
    email: `${slug}${i}@${b2b ? 'accounts.example' : 'example.test'}`,
    lang: b2b ? 'en' : rng() < 0.55 ? 'hinglish' : 'en',
    segment,
    city: pick(rng, CITIES),
    channels: { whatsapp, sms: rng() < 0.92, email: b2b ? true : rng() < 0.85, voice: rng() < (b2b ? 0.8 : 0.6) },
    dnd: b2b ? false : rng() < 0.2,
    ltvPaise: segment === 'vip' ? between(rng, 2500000, 9000000) : segment === 'regular' ? between(rng, 300000, 1800000) : segment === 'b2b' ? between(rng, 10000000, 60000000) : between(rng, 0, 150000),
    pastFailures: rng() < 0.7 ? 0 : between(rng, 1, 4),
  };
}

function hiddenFor(rng: seedrandom.PRNG, caseId: string, cause: RootCause, kind: CaseKind, createdAt: string, cust: Customer): HiddenProfile {
  let arche: Archetype;
  switch (cause) {
    case 'insufficient_funds': arche = weighted(rng, [{ w: 60, t: 'temporary_funds' as Archetype }, { w: 25, t: 'forgot' as Archetype }, { w: 15, t: 'hard_no' as Archetype }]); break;
    case 'upi_timeout': arche = weighted(rng, [{ w: 55, t: 'friction' as Archetype }, { w: 30, t: 'forgot' as Archetype }, { w: 15, t: 'intent_lost' as Archetype }]); break;
    case 'bank_downtime': arche = weighted(rng, [{ w: 70, t: 'friction' as Archetype }, { w: 25, t: 'forgot' as Archetype }, { w: 5, t: 'hard_no' as Archetype }]); break;
    case 'card_hard_decline': arche = weighted(rng, [{ w: 55, t: 'hard_no' as Archetype }, { w: 30, t: 'friction' as Archetype }, { w: 15, t: 'forgot' as Archetype }]); break;
    case 'card_soft_decline': arche = weighted(rng, [{ w: 50, t: 'temporary_funds' as Archetype }, { w: 35, t: 'friction' as Archetype }, { w: 15, t: 'forgot' as Archetype }]); break;
    case 'otp_abandoned': arche = weighted(rng, [{ w: 40, t: 'friction' as Archetype }, { w: 35, t: 'intent_lost' as Archetype }, { w: 25, t: 'forgot' as Archetype }]); break;
    case 'checkout_abandoned': arche = weighted(rng, [{ w: 40, t: 'intent_lost' as Archetype }, { w: 30, t: 'friction' as Archetype }, { w: 20, t: 'forgot' as Archetype }, { w: 10, t: 'hard_no' as Archetype }]); break;
    case 'mandate_paused': arche = weighted(rng, [{ w: 50, t: 'forgot' as Archetype }, { w: 35, t: 'intent_lost' as Archetype }, { w: 15, t: 'hard_no' as Archetype }]); break;
    case 'mandate_revoked': arche = weighted(rng, [{ w: 65, t: 'hard_no' as Archetype }, { w: 35, t: 'intent_lost' as Archetype }]); break;
    case 'dispute_risk': arche = 'disputer'; break;
    case 'invoice_overdue': arche = weighted(rng, [{ w: 50, t: 'busy_ap' as Archetype }, { w: 30, t: 'forgot' as Archetype }, { w: 20, t: 'disputer' as Archetype }]); break;
    default: arche = 'forgot';
  }
  const base: Record<Archetype, number> = { temporary_funds: 0.25, forgot: 0.62, friction: 0.55, intent_lost: 0.18, hard_no: 0.02, disputer: 0.05, busy_ap: 0.35 };
  const aff = (w: number, s: number, e: number, v: number): Record<Channel, number> => ({ whatsapp: w, sms: s, email: e, voice: v });
  const affinity = cust.segment === 'b2b' ? aff(0.9, 0.5, 1.0, 1.25) : cust.lang === 'hinglish' ? aff(1.2, 0.8, 0.5, 1.3) : aff(1.1, 0.85, 0.8, 1.15);
  // salary lands 1-4 sim days out for people with temporary funds problems
  const fundsAvailableAt = arche === 'temporary_funds' ? addHours(createdAt, between(rng, 20, 96)) : undefined;
  return {
    caseId,
    archetype: arche,
    basePayProb: base[arche] * (0.85 + rng() * 0.3),
    channelAffinity: affinity,
    respondsToIncentive: arche === 'intent_lost' ? rng() < 0.7 : arche === 'friction' ? rng() < 0.35 : rng() < 0.15,
    fundsAvailableAt,
    annoyanceThreshold: arche === 'hard_no' ? 1 : arche === 'disputer' ? 1 : between(rng, 2, 4),
    willSayStop: arche === 'hard_no' ? rng() < 0.6 : arche === 'intent_lost' ? rng() < 0.25 : rng() < 0.05,
    responseDelayHours: kind === 'overdue_invoice' ? between(rng, 6, 48) : between(rng, 1, 30),
  };
}

export interface GeneratedBatch { cases: RevenueCase[]; hidden: Map<string, HiddenProfile>; truth: Map<string, RootCause> }

export function generateBatch(seed: number, size: number): GeneratedBatch {
  const rng = seedrandom(String(seed));
  const cases: RevenueCase[] = [];
  const hidden = new Map<string, HiddenProfile>();
  const truth = new Map<string, RootCause>();
  const kinds: Array<{ w: number; t: CaseKind }> = [
    { w: 40, t: 'failed_payment' }, { w: 25, t: 'abandoned_checkout' }, { w: 20, t: 'failed_subscription' }, { w: 15, t: 'overdue_invoice' },
  ];
  for (let i = 0; i < size; i++) {
    const kind = weighted(rng, kinds);
    const cust = makeCustomer(rng, kind, i);
    const product = pick(rng, PRODUCTS[kind]);
    const amountPaise = Math.round(between(rng, product.min, product.max) / 100) * 100;
    const createdAt = addHours(SIM_START, between(rng, -24, 48)); // failures keep arriving through the first two days, nights included
    const caseId = id(rng, 'case');
    let failure: FailureInfo | undefined;
    let cause: RootCause;
    let daysOverdue: number | undefined;
    const rz: RevenueCase['razorpay'] = {};
    if (kind === 'failed_payment') {
      const t = weighted(rng, FAILURES_PAYMENT);
      cause = t.cause;
      const method = t.f.method ?? weighted(rng, [{ w: 60, t: 'upi' as const }, { w: 25, t: 'card' as const }, { w: 15, t: 'netbanking' as const }]);
      failure = { ...t.f, method, description: t.bankMessages ? `${t.f.description} Bank response: ${pick(rng, t.bankMessages)}` : t.f.description };
      rz.orderId = id(rng, 'order');
    } else if (kind === 'failed_subscription') {
      const t = weighted(rng, FAILURES_SUBSCRIPTION);
      cause = t.cause;
      failure = { ...t.f, method: 'emandate', description: t.bankMessages ? `${t.f.description} Bank response: ${pick(rng, t.bankMessages)}` : t.f.description };
      rz.subscriptionId = id(rng, 'sub');
    } else if (kind === 'overdue_invoice') {
      cause = 'invoice_overdue';
      daysOverdue = between(rng, 3, 52);
      rz.invoiceId = id(rng, 'inv');
    } else {
      cause = 'checkout_abandoned';
      rz.orderId = id(rng, 'order');
    }
    const c: RevenueCase = {
      id: caseId, kind, customer: cust, amountPaise, currency: 'INR', createdAt, merchant: MERCHANT, description: product.d,
      failure, daysOverdue, attemptsBefore: kind === 'abandoned_checkout' ? 0 : between(rng, 1, 3), razorpay: rz,
    };
    cases.push(c);
    hidden.set(caseId, hiddenFor(rng, caseId, cause, kind, createdAt, cust));
    truth.set(caseId, cause);
  }
  return { cases, hidden, truth };
}

// CLI: pnpm seed [seed] [size]
if (process.argv[1] && process.argv[1].endsWith('generate.ts')) {
  const seed = Number(process.argv[2] ?? 7);
  const size = Number(process.argv[3] ?? 120);
  const b = generateBatch(seed, size);
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const c of b.cases) { byKind[c.kind] = (byKind[c.kind] ?? 0) + 1; total += c.amountPaise; }
  console.log(JSON.stringify({ seed, size, byKind, atRiskINR: total / 100, sample: b.cases[0] }, null, 2));
}
