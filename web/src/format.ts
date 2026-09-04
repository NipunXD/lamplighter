// Formatting helpers: IST clock, Indian rupee grouping, and human labels for the shared enums.
import type { ActionType, CaseKind, CaseStatus, Channel, RootCause, Segment } from '@shared/types';

export const IST_OFFSET_MIN = 330;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A Date whose UTC fields read as IST wall-clock fields. */
export function istDate(iso: string): Date {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
}
/** Hour of day in IST, fractional (0-24). */
export function istHour(iso: string): number {
  const d = istDate(iso);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}
export function istDayIndex(iso: string): number {
  return Math.floor((new Date(iso).getTime() + IST_OFFSET_MIN * 60_000) / 86_400_000);
}
export function fmtTime(iso: string): string {
  const d = istDate(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function fmtDate(iso: string): string {
  const d = istDate(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}
export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}
export function isQuietHours(iso: string): boolean {
  const h = istHour(iso);
  return h >= 21 || h < 9;
}
export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}
export function hoursBetween(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 3_600_000;
}
/** Next sim time at or after `iso` whose IST hour is `hour`. */
export function nextIstHour(iso: string, hour: number): string {
  const t = new Date(iso).getTime();
  const shifted = t + IST_OFFSET_MIN * 60_000;
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000;
  let target = dayStart + hour * 3_600_000;
  if (target <= shifted) target += 86_400_000;
  return new Date(target - IST_OFFSET_MIN * 60_000).toISOString();
}

/** Indian digit grouping: 1234567 -> "12,34,567". */
export function groupIndian(n: number): string {
  const s = String(Math.floor(Math.abs(n)));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}
/** ₹ from paise. Whole rupees by default; sub-rupee amounts (channel costs) keep two decimals. */
export function rupees(paise: number, opts: { decimals?: boolean } = {}): string {
  const sign = paise < 0 ? '−' : '';
  const abs = Math.abs(paise);
  const showDecimals = opts.decimals ?? (abs < 100_000 && abs % 100 !== 0);
  const whole = Math.floor(abs / 100);
  if (!showDecimals) return `${sign}₹${groupIndian(Math.round(abs / 100))}`;
  return `${sign}₹${groupIndian(whole)}.${pad(Math.round(abs % 100))}`;
}
export function pct(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}
export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
/** First name for people, full name for businesses. */
export function firstName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length <= 2 ? words[0] : name;
}

export const KIND_LABEL: Record<CaseKind, string> = {
  failed_payment: 'Failed payment',
  abandoned_checkout: 'Abandoned checkout',
  failed_subscription: 'Failed subscription',
  overdue_invoice: 'Overdue invoice',
};
export const KIND_COLOR: Record<CaseKind, string> = {
  failed_payment: '#c96a4a',
  abandoned_checkout: '#d4867a',
  failed_subscription: '#8aa48b',
  overdue_invoice: '#6b7fa3',
};
export const KIND_ORDER: CaseKind[] = ['failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'];

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open',
  scheduled: 'Scheduled',
  awaiting_customer: 'Awaiting customer',
  recovered: 'Recovered',
  escalated: 'Escalated',
  closed: 'Closed',
};
export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  insufficient_funds: 'Insufficient funds',
  upi_timeout: 'UPI timeout',
  mandate_paused: 'Mandate paused',
  mandate_revoked: 'Mandate revoked',
  bank_downtime: 'Bank downtime',
  card_hard_decline: 'Card hard decline',
  card_soft_decline: 'Card soft decline',
  otp_abandoned: 'OTP abandoned',
  checkout_abandoned: 'Checkout abandoned',
  dispute_risk: 'Dispute risk',
  invoice_overdue: 'Invoice overdue',
  unknown: 'Unknown',
};
export const ACTION_LABEL: Record<ActionType, string> = {
  wait_and_retry: 'Silent retry',
  send_payment_link: 'Payment link',
  voice_call: 'Voice call',
  offer_incentive: 'Incentive offer',
  new_mandate_link: 'New mandate link',
  escalate_human: 'Escalate to a human',
  close_case: 'Close the case',
};
export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'email', voice: 'voice' };
export const SEGMENT_LABEL: Record<Segment, string> = { new: 'New customer', regular: 'Regular', vip: 'VIP', b2b: 'B2B' };

/** Human phrasing for policy rule ids (used as chip tooltips). */
export const RULE_LABEL: Record<string, string> = {
  do_not_contact: 'customer asked us to stop',
  dispute_only_escalate: 'possible dispute: humans only',
  max_touches: 'already touched 3 times',
  min_gap_between_touches: 'less than 20h since the last touch',
  channel_opt_in: 'channel not opted in',
  dnd_registry: 'customer on the TRAI DND registry',
  quiet_hours: 'inside quiet hours (21:00–09:00 IST)',
  b2b_escalation_threshold: 'B2B receivable past 45 days: hand to AR',
  positive_expected_value: 'expected value is not positive',
  no_retry_on_hard_decline: 'issuer said do-not-retry',
  silent_retry_applicability: 'this cause needs the customer, not a retry',
  max_silent_retries: 'two silent retries already used',
  has_payment_instrument: 'no saved instrument or mandate to debit',
  attempt_budget: 'attempt budget exhausted',
  link_applicability: 'a payment link does not fit',
  voice_min_amount: 'below the minimum amount for a call',
  incentive_once: 'incentive already offered',
  incentive_min_amount: 'below the minimum amount for a discount',
  incentive_cause_fit: 'not an intent problem: no discount',
  incentive_budget: 'incentive budget exhausted',
  no_incentive_b2b: 'no discounts on B2B invoices',
  incentive_not_first_touch: 'try a plain nudge before spending margin',
  mandate_link_applicability: 'only for paused or revoked mandates',
  escalation_trigger: 'nothing a human would do differently yet',
};
export function actionLabel(type: string, channel?: string, opts: { lower?: boolean } = {}): string {
  let base = (ACTION_LABEL as Record<string, string>)[type] ?? type.replace(/_/g, ' ');
  if (opts.lower) base = base.toLowerCase();
  if (!channel || channel === 'voice') return base;
  return `${base} via ${(CHANNEL_LABEL as Record<string, string>)[channel] ?? channel}`;
}
