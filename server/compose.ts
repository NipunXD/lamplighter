// Customer-facing copy: templates that always work, an LLM that makes them warmer, and a validator that keeps both compliant.
import { z } from 'zod';
import type { Diagnosis, PlannedAction, RevenueCase } from './types.js';
import type { LocalLLM } from './llm.js';
import { rupees } from './time.js';

export const LINK = '{link}';
const BANNED = /legal|court|police|arrest|penalt|blacklist|last warning|final notice|lawyer|consequence|credit score|cibil|immediately|urgent/i;
const DEVANAGARI = /[ऀ-ॿ]/;

function firstName(c: RevenueCase) { return c.customer.segment === 'b2b' ? c.customer.name : c.customer.name.split(' ')[0]; }

const REASON_HI: Record<string, string> = {
  insufficient_funds: 'bank ne balance ki wajah se rok diya tha', upi_timeout: 'UPI request time-out ho gayi thi', bank_downtime: 'bank server down tha',
  card_soft_decline: 'card limit ki wajah se nahi hua', card_hard_decline: 'us card se nahi ho paya', otp_abandoned: 'OTP step par ruk gaya tha',
  checkout_abandoned: 'cart mein hi reh gaya', mandate_paused: 'AutoPay pause ho gaya hai', mandate_revoked: 'AutoPay band ho gaya hai', unknown: 'complete nahi ho paya', invoice_overdue: '',
};
const REASON_EN: Record<string, string> = {
  insufficient_funds: "didn't go through at the bank", upi_timeout: 'timed out before the UPI request was approved', bank_downtime: "failed because the bank's server was down",
  card_soft_decline: "hit your card's limit", card_hard_decline: "couldn't be completed with that card", otp_abandoned: 'stopped at the OTP step',
  checkout_abandoned: 'is still waiting in your cart', mandate_paused: 'stopped because AutoPay is paused', mandate_revoked: 'stopped because AutoPay was cancelled', unknown: "didn't go through", invoice_overdue: '',
};

export interface ComposeInput { c: RevenueCase; action: PlannedAction; diagnosis: Diagnosis }

export function templateMessage({ c, action, diagnosis }: ComposeInput): string {
  const amt = rupees(action.type === 'offer_incentive' && action.incentivePct ? Math.round(c.amountPaise * (1 - action.incentivePct / 100)) : c.amountPaise);
  const name = firstName(c);
  const cause = diagnosis.rootCause;
  const hi = c.customer.lang === 'hinglish';
  if (action.type === 'voice_call') {
    return hi
      ? `Namaste ${name} ji, main Saanjh & Co. se bol rahi hoon. Aapka ${c.description} ka payment ${amt} ${REASON_HI[cause] || 'complete nahi ho paya'}. Koi pressure nahi — agar aap chahein toh main abhi WhatsApp par ek secure payment link bhej deti hoon, 2 minute lagenge. Aur agar aap nahi chahte toh bas bata dijiye, hum dobara call nahi karenge.`
      : `Hello ${name}, this is Saanjh & Co. Your payment of ${amt} for ${c.description} ${REASON_EN[cause] || "didn't go through"}. No pressure at all — if you'd like, I can send a secure payment link on WhatsApp right now; it takes two minutes. If you'd rather not, just say so and we won't call again.`;
  }
  if (c.kind === 'overdue_invoice') {
    return `Hello ${c.customer.name} accounts team, a gentle reminder from Saanjh & Co.: the invoice for ${c.description} (${amt}) is ${c.daysOverdue} days past due. You can pay securely here: ${LINK}. If it's already on its way, reply with the UTR and we'll close it on our side. Reply STOP to opt out.`;
  }
  if (action.type === 'new_mandate_link') {
    return hi
      ? `Hi ${name}! Saanjh & Co. se — aapka Monthly Chai Box AutoPay ${cause === 'mandate_revoked' ? 'band' : 'pause'} ho gaya hai, isliye ${amt} ka renewal nahi hua. Chai continue rakhni ho toh yahan se 1 minute mein dobara set kar sakte hain: ${LINK}. Reply STOP to opt out.`
      : `Hi ${name}, this is Saanjh & Co. Your Monthly Chai Box AutoPay is ${cause === 'mandate_revoked' ? 'cancelled' : 'paused'}, so this month's ${amt} renewal didn't go through. If you'd like to keep the chai coming, you can re-authorise in a minute here: ${LINK}. Reply STOP to opt out.`;
  }
  const offer = action.type === 'offer_incentive' && action.incentivePct
    ? (hi ? `Aapke liye ${action.incentivePct}% off rakha hai — ` : `We've kept ${action.incentivePct}% off for you — `)
    : '';
  return hi
    ? `Hi ${name}! Saanjh & Co. se — aapka ${c.description} ka payment (${amt}) ${REASON_HI[cause] || 'complete nahi ho paya'}. ${offer}yahan se 2 minute mein complete kar sakte hain: ${LINK}. Reply STOP to opt out.`
    : `Hi ${name}, this is Saanjh & Co. Your payment of ${amt} for ${c.description} ${REASON_EN[cause] || "didn't go through"}. ${offer}You can complete it in under a minute here: ${LINK}. Reply STOP to opt out.`;
}

export function validateMessage(msg: string, { c, action }: ComposeInput): string[] {
  const errs: string[] = [];
  const isVoice = action.type === 'voice_call';
  if (msg.length > (isVoice ? 700 : 420)) errs.push(`too long (${msg.length})`);
  if (!msg.includes('Saanjh')) errs.push('merchant name missing');
  const amt = rupees(action.type === 'offer_incentive' && action.incentivePct ? Math.round(c.amountPaise * (1 - action.incentivePct / 100)) : c.amountPaise);
  if (!msg.includes(amt)) errs.push(`exact amount ${amt} missing`);
  if (!isVoice && !msg.includes(LINK)) errs.push('{link} placeholder missing');
  if (!isVoice && !/STOP/.test(msg)) errs.push('opt-out line missing');
  const banned = msg.match(BANNED); if (banned) errs.push(`banned phrase: "${banned[0]}"`);
  if (DEVANAGARI.test(msg)) errs.push('Hinglish must be Roman script');
  if (action.type === 'offer_incentive' && action.incentivePct && !msg.includes(`${action.incentivePct}%`)) errs.push('discount not stated');
  return errs;
}

const MsgSchema = z.object({ message: z.string().min(20).max(800) });
const MSG_JSON = { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false };

export async function composeMessage(input: ComposeInput, llm: LocalLLM): Promise<{ message: string; source: 'llm' | 'template'; ms?: number; error?: string; rejected?: string[]; draft?: string }> {
  const template = templateMessage(input);
  if (!llm.enabled) return { message: template, source: 'template' };
  const { c, action, diagnosis } = input;
  const isVoice = action.type === 'voice_call';
  const amt = rupees(action.type === 'offer_incentive' && action.incentivePct ? Math.round(c.amountPaise * (1 - action.incentivePct / 100)) : c.amountPaise);
  const hi = c.customer.lang === 'hinglish';
  const system = hi
    ? `You write short, warm payment reminders for "Saanjh & Co.", an Indian tea & candle studio on Razorpay. Write in HINGLISH: Hindi words in Roman (Latin) script mixed naturally with English, the way a friendly Indian shop owner texts a customer. Never use Devanagari. Never threaten, never invent deadlines, penalties or consequences, never mention legal action or credit scores, never say "urgent" or "immediately". Example of the style: "Hi Riya! Saanjh & Co. se — aapka Dusk Candle Trio ka payment (₹1,299) complete nahi ho paya. Koi baat nahi, yahan se 2 minute mein ho jayega: {link}. Reply STOP to opt out."`
    : `You write short, warm payment reminders for "Saanjh & Co.", an Indian tea & candle studio on Razorpay. Sound like a kind small-business owner, not a collections agency. Never threaten, never invent deadlines, penalties or consequences, never mention legal action or credit scores, never say "urgent" or "immediately". Example of the style: "Hi Riya, this is Saanjh & Co. Your payment of ₹1,299 for the Dusk Candle Trio didn't go through. No stress — you can complete it in under a minute here: {link}. Reply STOP to opt out."`;
  const must = isVoice
    ? `REQUIRED, verbatim: the string "Saanjh & Co." and the amount "${amt}".`
    : `REQUIRED, verbatim, all four: (1) the string "Saanjh & Co." (2) the amount "${amt}" (3) the placeholder {link} exactly once, where the payment link goes (4) the final sentence "Reply STOP to opt out."${action.type === 'offer_incentive' ? ` (5) the text "${action.incentivePct}% off"` : ''}`;
  const context = c.kind === 'overdue_invoice'
    ? `Recipient: the accounts team at ${c.customer.name} (a B2B buyer). Their invoice for "${c.description}" (${amt}) is ${c.daysOverdue} days past due. Invite them to reply with the UTR if it is already paid.`
    : `Recipient: ${firstName(c)}. Their payment of ${amt} for "${c.description}" ${c.kind === 'abandoned_checkout' ? 'is still waiting in the cart' : `${REASON_EN[diagnosis.rootCause] || "didn't go through"}`}. Do not mention error codes, gateways or internal terms.${action.type === 'offer_incentive' ? ` We are giving them ${action.incentivePct}% off; ${amt} is the discounted amount.` : ''}${action.type === 'new_mandate_link' ? ' They need to re-authorise their Monthly Chai Box AutoPay via the link.' : ''}`;
  const user = isVoice
    ? `Write a voice-call script (max 3 short sentences, under 550 characters). ${context} Offer to send a WhatsApp payment link and make clear they can decline. Do not mention error codes or internal terms. ${must}`
    : `Write one ${action.channel} message under 320 characters. ${context} ${must}`;
  const res = await llm.complete('message', system, user, MsgSchema, MSG_JSON, 260);
  if (!res.ok) return { message: template, source: 'template', ms: res.ms, error: res.error };
  const msg = res.value.message.replace(/\s+/g, ' ').trim();
  const errs = validateMessage(msg, input);
  if (errs.length) return { message: template, source: 'template', ms: res.ms, rejected: errs, draft: msg };
  return { message: msg, source: 'llm', ms: res.ms };
}
