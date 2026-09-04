import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { RazorpayClient } from '../server/razorpay.js';

describe('razorpay client', () => {
  it('verifies Standard Checkout signatures with HMAC-SHA256(order|payment)', () => {
    const c = new RazorpayClient({ keyId: 'rzp_test_x', keySecret: 'secret123' });
    const sig = createHmac('sha256', 'secret123').update('order_A|pay_B').digest('hex');
    expect(c.verifySignature('order_A', 'pay_B', sig)).toBe(true);
    expect(c.verifySignature('order_A', 'pay_C', sig)).toBe(false);
    expect(c.verifySignature('order_A', 'pay_B', 'deadbeef')).toBe(false);
  });
  it('is disabled without keys and never calls the API', async () => {
    const c = new RazorpayClient({});
    expect(c.enabled).toBe(false);
    await expect(c.createOrder({ id: 'case_x', amountPaise: 100, kind: 'failed_payment', customer: { name: 'A' } } as any, 'run', { purpose: 'test' })).rejects.toThrow('razorpay disabled');
  });
  it('retries injected 5xx failures with backoff and then succeeds', async () => {
    let n = 0;
    const seq = [0.0, 0.0, 0.9]; // chaos rng: fail, fail, pass
    const c = new RazorpayClient({ keyId: 'k', keySecret: 's', chaos: 0.5, rng: () => seq[n++] ?? 0.9, events: { onRetry: () => {} } });
    // @ts-expect-error reach into the private client to stub the SDK
    c.rzp = { orders: { create: async () => ({ id: 'order_ok' }) } };
    const o: any = await c.createOrder({ id: 'case_x', amountPaise: 100, kind: 'failed_payment', customer: { name: 'A' }, description: 'd' } as any, 'run', { purpose: 'test' });
    expect(o.id).toBe('order_ok');
    expect(c.retries).toBe(2);
  }, 20_000);
});
