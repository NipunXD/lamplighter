import { describe, it, expect } from 'vitest';
import { RecoveryRun, runBaseline } from '../server/engine.js';
import { LocalLLM } from '../server/llm.js';
import { RazorpayClient } from '../server/razorpay.js';
import { istHour } from '../server/time.js';

const deps = () => ({ llm: new LocalLLM({}), rzp: new RazorpayClient({}) });

describe('recovery run (headless, model off, razorpay off)', () => {
  it('keeps every invariant over a simulated week', async () => {
    const run = new RecoveryRun({ seed: 21, size: 60, llm: false, razorpay: false, simDays: 7, tickDelayMs: 0 }, deps());
    const m = await run.start();
    expect(run.status).toBe('done');
    expect(m.cases).toBe(60);
    expect(m.recoveredPaise).toBeLessThanOrEqual(m.atRiskPaise);
    expect(m.policyViolations).toBe(0);
    expect(run.audit.verify().ok).toBe(true);
    const customerFacing = new Set(['send_payment_link', 'voice_call', 'offer_incentive', 'new_mandate_link']);
    for (const s of run.states.values()) {
      const touches = s.touches.filter((t) => customerFacing.has(t.action));
      expect(touches.length).toBeLessThanOrEqual(3);
      for (const t of touches) {
        const h = istHour(t.at);
        expect(h >= 9 && h < 21).toBe(true); // never inside quiet hours
        if (s.case.customer.dnd) expect(t.channel === 'sms' || t.channel === 'voice').toBe(false);
        expect(t.message).toMatch(/STOP|Saanjh/);
      }
      // every terminal state carries a reason
      if (s.status === 'closed') expect(s.closeReason).toBeTruthy();
      if (s.status === 'escalated') expect(s.escalationReason).toBeTruthy();
      expect(['recovered', 'escalated', 'closed']).toContain(s.status);
    }
    // a STOP is final: no customer-facing touch after it
    const stops = run.audit.events.filter((e) => e.type === 'stop');
    expect(stops.length).toBeGreaterThan(0);
    for (const st of stops) {
      const later = run.audit.events.filter((e) => e.caseId === st.caseId && e.seq > st.seq && (e.type === 'message_sent' || e.type === 'call_placed' || e.type === 'silent_retry_result'));
      expect(later).toEqual([]);
    }
    // hard declines are never silently retried
    for (const s of run.states.values()) if (s.diagnosis?.rootCause === 'card_hard_decline') expect(s.touches.some((t) => t.action === 'wait_and_retry')).toBe(false);
  }, 30_000);

  it('is deterministic for a seed with the model off', async () => {
    const a = await new RecoveryRun({ seed: 5, size: 30, llm: false, razorpay: false, tickDelayMs: 0 }, deps()).start();
    const b = await new RecoveryRun({ seed: 5, size: 30, llm: false, razorpay: false, tickDelayMs: 0 }, deps()).start();
    expect(a.recoveredPaise).toBe(b.recoveredPaise);
    expect(a.touches).toBe(b.touches);
  }, 30_000);

  it('beats the naive baseline on the same world and the baseline breaks rules', async () => {
    const cfg = { seed: 7, size: 60, llm: false, razorpay: false, simDays: 7, tickDelayMs: 0, chaos: 0, mode: 'agent' as const };
    const agent = await new RecoveryRun(cfg, deps()).start();
    const base = await runBaseline(cfg);
    expect(base.policyViolations).toBeGreaterThan(0);
    expect(agent.policyViolations).toBe(0);
    expect(agent.recoveredPaise).toBeGreaterThan(base.recoveredPaise);
    expect(agent.complaints).toBeLessThan(base.complaints);
  }, 30_000);

  it('survives chaos: injected model garbage never stops the run', async () => {
    const llm = new LocalLLM({ baseUrl: 'http://127.0.0.1:9', model: 'nope', timeoutMs: 500 }); // unreachable server
    const run = new RecoveryRun({ seed: 9, size: 20, llm: true, razorpay: false, tickDelayMs: 0 }, { llm, rzp: new RazorpayClient({}) });
    const m = await run.start();
    expect(run.status).toBe('done');
    expect(m.llmFallbacks).toBeGreaterThan(0);
    expect(run.audit.events.some((e) => e.type === 'llm_fallback')).toBe(true);
    expect(m.recoveredPaise).toBeGreaterThan(0);
  }, 30_000);
});
