// Root-cause diagnosis: deterministic rules first, the local LLM only for the long tail of raw bank strings.
import { z } from 'zod';
import type { Diagnosis, RevenueCase, RootCause } from './types.js';
import type { LocalLLM } from './llm.js';

export const ROOT_CAUSES = ['insufficient_funds', 'upi_timeout', 'mandate_paused', 'mandate_revoked', 'bank_downtime', 'card_hard_decline', 'card_soft_decline', 'otp_abandoned', 'checkout_abandoned', 'dispute_risk', 'invoice_overdue', 'unknown'] as const;

export function rulesDiagnosis(c: RevenueCase): Diagnosis {
  const r = (rootCause: RootCause, confidence: number, reasoning: string): Diagnosis => ({ rootCause, confidence, reasoning, source: 'rules' });
  if (c.kind === 'abandoned_checkout') return r('checkout_abandoned', 0.95, 'Order created, no payment attempted');
  if (c.kind === 'overdue_invoice') return r('invoice_overdue', 0.95, `Invoice ${c.daysOverdue} days past due`);
  const f = c.failure;
  if (!f) return r('unknown', 0.2, 'No failure information');
  const d = f.description.toLowerCase();
  if (f.reason === 'mandate_paused') return r('mandate_paused', 0.95, 'Mandate paused by the customer in their UPI app');
  if (f.reason === 'mandate_revoked') return r('mandate_revoked', 0.95, 'Mandate revoked by the customer');
  if (f.reason === 'payment_timed_out') return r('upi_timeout', 0.9, 'UPI collect request expired before approval');
  if (f.code === 'GATEWAY_ERROR') return r('bank_downtime', 0.85, 'Gateway error: bank side unavailable');
  if (f.reason === 'payment_cancelled') return r('otp_abandoned', 0.85, 'Customer left at the OTP / authentication step');
  if (d.includes('limit exceeded')) return r('card_soft_decline', 0.8, 'Card limit exceeded: retryable');
  if (d.includes('unrecognised') || d.includes('chargeback') || d.includes('dispute')) return r('dispute_risk', 0.7, 'Issuer flagged a cardholder query on an earlier charge');
  if (d.includes('insufficient funds') && !d.includes('bank response')) return r('insufficient_funds', 0.85, 'Bank declined for insufficient funds');
  return r('unknown', 0.3, 'Generic bank decline; raw bank response not parsed by rules');
}

const LlmDiagnosisSchema = z.object({ rootCause: z.enum(ROOT_CAUSES), confidence: z.number().min(0).max(1), reasoning: z.string().max(400) });
const LLM_DIAG_JSON = {
  type: 'object',
  properties: { rootCause: { type: 'string', enum: [...ROOT_CAUSES] }, confidence: { type: 'number' }, reasoning: { type: 'string' } },
  required: ['rootCause', 'confidence', 'reasoning'], additionalProperties: false,
};

const DIAG_SYSTEM = `You are the payments recovery analyst for an Indian D2C merchant on Razorpay. You read Razorpay error objects and raw bank / NPCI response strings (ISO 8583 codes like 51, 05, 43, 61, 91 and UPI codes like Z9, U30, U69, Z8) and classify the root cause. Definitions: insufficient_funds = customer lacked balance; upi_timeout = UPI collect expired or PSP unavailable; bank_downtime = issuer/switch inoperative or server unavailable; card_hard_decline = lost/stolen card, account closed, do-not-honour, invalid card (never retry); card_soft_decline = limit or frequency exceeded (retryable later); otp_abandoned = customer cancelled at authentication; dispute_risk = fraud suspicion or chargeback query; mandate_paused / mandate_revoked = UPI AutoPay state; unknown only if nothing fits. Keep reasoning under 30 words.`;

export interface DiagnoseResult { diagnosis: Diagnosis; rules: Diagnosis; llm?: { ok: boolean; ms: number; error?: string; rootCause?: RootCause; confidence?: number } }

export async function diagnose(c: RevenueCase, llm: LocalLLM): Promise<DiagnoseResult> {
  const rules = rulesDiagnosis(c);
  if (!llm.enabled || rules.confidence >= 0.8 || !c.failure) return { diagnosis: rules, rules };
  const f = c.failure;
  const user = `Case kind: ${c.kind}. Method: ${f.method}. Razorpay error: code=${f.code}, reason=${f.reason}, source=${f.source}, step=${f.step}. Description: "${f.description}". Customer had ${c.attemptsBefore} failed attempt(s) before. Classify the root cause.`;
  const res = await llm.complete('diagnosis', DIAG_SYSTEM, user, LlmDiagnosisSchema, LLM_DIAG_JSON, 220);
  if (!res.ok) return { diagnosis: rules, rules, llm: { ok: false, ms: res.ms, error: res.error } };
  const v = res.value;
  if (v.confidence < 0.55 || v.rootCause === 'unknown') {
    return { diagnosis: { ...rules, reasoning: `${rules.reasoning}; LLM unsure (${v.rootCause} @ ${v.confidence.toFixed(2)})` }, rules, llm: { ok: true, ms: res.ms, rootCause: v.rootCause, confidence: v.confidence } };
  }
  const diagnosis: Diagnosis = { rootCause: v.rootCause, confidence: Math.min(v.confidence, 0.9), reasoning: v.reasoning, source: rules.rootCause === 'unknown' ? 'llm' : 'rules+llm', llmDisagreed: rules.rootCause !== 'unknown' && rules.rootCause !== v.rootCause };
  return { diagnosis, rules, llm: { ok: true, ms: res.ms, rootCause: v.rootCause, confidence: v.confidence } };
}
