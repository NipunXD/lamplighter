// Thin Razorpay test-mode client with retry, backoff, a circuit breaker and optional chaos injection.
// Only Orders and Payment Links are used; both are real API calls against the merchant's test account.
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RevenueCase } from './types.js';

export interface RzpEvents { onRetry?: (info: { op: string; attempt: number; error: string; waitMs: number }) => void; onCircuit?: (state: 'open' | 'closed') => void }

/** Razorpay's SDK rejects with { statusCode, error: { code, description } }; plain errors have a message. */
export function rzpErrorMessage(e: any): string { return e instanceof CircuitOpenError ? 'circuit open' : (e?.error?.description ?? (typeof e?.message === 'string' ? e.message : undefined) ?? JSON.stringify(e?.error ?? e)); }

export class CircuitOpenError extends Error { constructor() { super('razorpay circuit open'); this.name = 'CircuitOpenError'; } }


export class RazorpayClient {
  private rzp: Razorpay | null;
  private failures = 0;
  private openUntil = 0;
  retries = 0;
  constructor(private opts: { keyId?: string; keySecret?: string; chaos?: number; rng?: () => number; events?: RzpEvents }) {
    this.rzp = opts.keyId && opts.keySecret ? new Razorpay({ key_id: opts.keyId, key_secret: opts.keySecret }) : null;
  }
  get enabled() { return !!this.rzp; }

  // Razorpay test mode rate-limits bursts hard; space calls out and back off properly on 429.
  private lastCallAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private static MIN_SPACING_MS = 700;
  set events(ev: RzpEvents | undefined) { this.opts.events = ev; }

  private async withRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      if (Date.now() < this.openUntil) {
        // circuit open: wait it out (bounded) instead of failing a whole simulated week in 20 wall-clock seconds
        const wait = Math.min(this.openUntil - Date.now(), 25_000);
        this.opts.events?.onCircuit?.('open');
        await new Promise((r) => setTimeout(r, wait));
        if (Date.now() < this.openUntil) throw new CircuitOpenError();
      }
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 4; attempt++) {
        const gap = RazorpayClient.MIN_SPACING_MS - (Date.now() - this.lastCallAt);
        if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        this.lastCallAt = Date.now();
        try {
          if (this.opts.chaos && (this.opts.rng ?? Math.random)() < this.opts.chaos) {
            throw Object.assign(new Error('injected: 503 Service Unavailable (chaos)'), { statusCode: 503 });
          }
          const r = await fn();
          this.failures = 0;
          return r;
        } catch (e: any) {
          lastErr = e;
          const status = e?.statusCode ?? e?.status;
          const msg = e?.error?.description ?? e?.message ?? String(e);
          const is429 = status === 429 || /too many requests/i.test(msg);
          const retryable = !status || status >= 500 || is429;
          if (!retryable || attempt === 4) break;
          const waitMs = (is429 ? 2000 : 300) * Math.pow(2, attempt - 1);
          this.retries++;
          this.opts.events?.onRetry?.({ op, attempt, error: msg, waitMs });
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
      this.failures++;
      if (this.failures >= 3) { this.openUntil = Date.now() + 15_000; this.failures = 0; this.opts.events?.onCircuit?.('open'); }
      throw lastErr;
    };
    // serialise calls so concurrent agent workers cannot burst the API
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** An order for a silent retry or for a recovery pay-page. (Payment Links are capped at 30 per test account, so orders back every link.) */
  async createOrder(c: RevenueCase, runId: string, opts: { purpose: string; discountPct?: number; caseId?: string }) {
    if (!this.rzp) throw new Error('razorpay disabled');
    const amount = opts.discountPct ? Math.round(c.amountPaise * (1 - opts.discountPct / 100)) : c.amountPaise;
    return this.withRetry('orders.create', () => this.rzp!.orders.create({
      amount, currency: 'INR', receipt: `lamp_${c.id.slice(5, 19)}_${Date.now().toString(36).slice(-4)}`,
      notes: { app: 'lamplighter', run_id: runId, case_id: c.id, kind: c.kind, purpose: opts.purpose, customer: c.customer.name.slice(0, 40), description: c.description.slice(0, 60) },
    }));
  }
  async fetchOrderPayments(orderId: string): Promise<any[]> {
    if (!this.rzp) throw new Error('razorpay disabled');
    const r: any = await this.withRetry('orders.fetchPayments', () => this.rzp!.orders.fetchPayments(orderId));
    return r.items ?? [];
  }
  async fetchPayment(paymentId: string): Promise<any> {
    if (!this.rzp) throw new Error('razorpay disabled');
    return this.withRetry('payments.fetch', () => this.rzp!.payments.fetch(paymentId));
  }
  async capturePayment(paymentId: string, amount: number): Promise<any> {
    if (!this.rzp) throw new Error('razorpay disabled');
    return this.withRetry('payments.capture', () => this.rzp!.payments.capture(paymentId, amount, 'INR'));
  }
  /** Standard Checkout signature: HMAC-SHA256(order_id|payment_id, key_secret). */
  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.opts.keySecret) return false;
    const expected = createHmac('sha256', this.opts.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
  get keyId() { return this.opts.keyId; }
}
