// Domain types for Lamplighter. Everything the agent can see lives in RevenueCase/Customer.
// HiddenProfile exists only inside the simulator and is never passed to the agent or the LLM.

export type CaseKind = 'failed_payment' | 'abandoned_checkout' | 'failed_subscription' | 'overdue_invoice';
export type Channel = 'whatsapp' | 'sms' | 'email' | 'voice';
export type Lang = 'en' | 'hinglish';
export type Segment = 'new' | 'regular' | 'vip' | 'b2b';

export type RootCause =
  | 'insufficient_funds'
  | 'upi_timeout'
  | 'mandate_paused'
  | 'mandate_revoked'
  | 'bank_downtime'
  | 'card_hard_decline'
  | 'card_soft_decline'
  | 'otp_abandoned'
  | 'checkout_abandoned'
  | 'dispute_risk'
  | 'invoice_overdue'
  | 'unknown';

export type ActionType =
  | 'wait_and_retry'
  | 'send_payment_link'
  | 'voice_call'
  | 'offer_incentive'
  | 'new_mandate_link'
  | 'escalate_human'
  | 'close_case';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  lang: Lang;
  segment: Segment;
  city: string;
  channels: Record<Channel, boolean>; // opted-in channels
  dnd: boolean; // on TRAI DND registry: no promotional SMS / voice
  ltvPaise: number;
  pastFailures: number;
}

/** Razorpay-style failure descriptor (mirrors the shape of error objects on a failed payment). */
export interface FailureInfo {
  code: 'BAD_REQUEST_ERROR' | 'GATEWAY_ERROR' | 'SERVER_ERROR';
  reason: string; // e.g. payment_failed, payment_timed_out, mandate_paused
  description: string; // bank / customer facing description
  source: 'bank' | 'customer' | 'business' | 'gateway' | 'internal';
  step: string; // payment_authentication | payment_authorization | payment_capture | mandate_execution
  method: 'upi' | 'card' | 'netbanking' | 'wallet' | 'emandate';
}

export interface RevenueCase {
  id: string;
  kind: CaseKind;
  customer: Customer;
  amountPaise: number;
  currency: 'INR';
  createdAt: string; // ISO (sim clock)
  merchant: { name: string; category: string };
  description: string; // what was being bought
  failure?: FailureInfo;
  daysOverdue?: number; // invoices
  attemptsBefore: number; // failed attempts already made by the customer
  /** ids of Razorpay test-mode entities that already existed for this case */
  razorpay: { orderId?: string; subscriptionId?: string; invoiceId?: string };
}

/** Simulator-only. The agent must never see this. */
export type Archetype = 'temporary_funds' | 'forgot' | 'friction' | 'intent_lost' | 'hard_no' | 'disputer' | 'busy_ap';
export interface HiddenProfile {
  caseId: string;
  archetype: Archetype;
  basePayProb: number;
  channelAffinity: Record<Channel, number>;
  respondsToIncentive: boolean;
  fundsAvailableAt?: string; // ISO sim time when money lands (salary day)
  annoyanceThreshold: number; // touches tolerated before going cold / complaining
  willSayStop: boolean;
  responseDelayHours: number;
}

export interface Diagnosis {
  rootCause: RootCause;
  confidence: number;
  reasoning: string;
  source: 'rules' | 'llm' | 'rules+llm';
  llmDisagreed?: boolean;
}

export interface PlannedAction {
  type: ActionType;
  channel?: Channel;
  lang?: Lang;
  message?: string;
  incentivePct?: number;
  retryAt?: string; // ISO sim time
  reason: string;
  source: 'llm' | 'fallback' | 'rules';
  expectedValuePaise: number;
  costPaise: number;
  goodwillPaise?: number; // modelled cost of bothering this customer again
}

export interface PolicyCheck {
  rule: string;
  passed: boolean;
  note?: string;
}

export interface Touch {
  at: string;
  action: ActionType;
  channel?: Channel;
  message?: string;
  costPaise: number;
  orderId?: string; // Razorpay test-mode order backing this outreach
  payUrl?: string; // self-hosted checkout page for that order
}

export type CaseStatus = 'open' | 'scheduled' | 'awaiting_customer' | 'recovered' | 'escalated' | 'closed';

export interface CaseState {
  case: RevenueCase;
  status: CaseStatus;
  diagnosis?: Diagnosis;
  touches: Touch[];
  incentiveUsed: boolean;
  nextActionAt?: string;
  recoveredPaise: number;
  recoveredVia?: 'simulated' | 'razorpay';
  recoveredAt?: string;
  costPaise: number;
  doNotContact: boolean;
  complained: boolean;
  closeReason?: string;
  escalationReason?: string;
  razorpay: { orderId?: string; recoveryOrderId?: string; payUrl?: string; paymentId?: string };
  lastError?: string;
  apiFailures?: number;
}

export interface AuditEvent {
  seq: number;
  ts: string; // wall clock
  simTs: string; // simulated clock
  caseId?: string;
  actor: 'agent' | 'policy' | 'simulator' | 'razorpay' | 'llm' | 'system' | 'customer';
  type: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface RunConfig {
  seed: number;
  size: number;
  llm: boolean;
  mode: 'agent' | 'baseline';
  razorpay: boolean; // create real test-mode entities
  simDays: number;
  chaos: number; // 0..1 probability of injected Razorpay/LLM failures
  tickDelayMs: number; // pacing for live UI runs (0 for headless)
}

export interface RunMetrics {
  cases: number;
  atRiskPaise: number;
  recoveredPaise: number;
  recoveredCases: number;
  recoveryRate: number; // by value
  recoveryRateCases: number;
  costPaise: number;
  costPerRecoveredRupee: number;
  touches: number;
  touchesPerCase: number;
  escalated: number;
  closed: number;
  complaints: number;
  stopRequests: number;
  policyViolations: number; // baseline only: touches that broke policy
  realRazorpayOrders: number;
  realRazorpayPaid: number;
  byKind: Record<CaseKind, { cases: number; atRiskPaise: number; recoveredPaise: number; recoveredCases: number }>;
  byRootCause: Record<string, { cases: number; recoveredCases: number; recoveredPaise: number }>;
  llmCalls: number;
  llmFallbacks: number;
  llmAvgMs: number;
  razorpayRetries: number;
  diagnosis: { n: number; rulesCorrect: number; finalCorrect: number; llmOverrides: number; llmOverridesCorrect: number };
  incentiveSpentPaise: number;
  deferredForQuietHours: number;
  simDays: number;
}

export interface LamplighterState { caseId?: string; activity: string; resting: boolean }

export interface RunSnapshot {
  id: string;
  config: RunConfig;
  status: 'running' | 'done' | 'failed';
  simStart: string;
  simNow: string;
  simEnd: string;
  cases: CaseState[];
  metrics: RunMetrics;
  baseline?: RunMetrics;
  lamplighter: LamplighterState;
  auditCount: number;
  auditTail: AuditEvent[]; // last 200 events
  error?: string;
}

export type RunEvent =
  | { type: 'snapshot'; snapshot: RunSnapshot }
  | { type: 'tick'; simNow: string; metrics: RunMetrics; lamplighter: LamplighterState }
  | { type: 'case'; state: CaseState }
  | { type: 'audit'; event: AuditEvent }
  | { type: 'lamplighter'; lamplighter: LamplighterState }
  | { type: 'done'; metrics: RunMetrics; baseline?: RunMetrics }
  | { type: 'error'; error: string };
