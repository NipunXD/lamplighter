// The recovery run: a simulated week in which the agent works a batch of at-risk revenue under policy.
import seedrandom from 'seedrandom';
import { z } from 'zod';
import { AuditLog } from './audit.js';
import { generateBatch, SIM_START } from './data/generate.js';
import { CustomerWorld, type SimOutcome } from './simulator.js';
import { LocalLLM } from './llm.js';
import { RazorpayClient, CircuitOpenError, rzpErrorMessage } from './razorpay.js';
import { DEFAULT_POLICY, evaluateCandidates, fallbackChoice, matchCandidate, baselineAction, isQuietHours, nextContactWindow, type Candidate, type PolicyConfig } from './policy.js';
import { diagnose } from './diagnose.js';
import { composeMessage, LINK, templateMessage } from './compose.js';
import { addHours, fmtIST, hoursBetween, rupees } from './time.js';
import type { AuditEvent, CaseKind, CaseState, LamplighterState, PlannedAction, RootCause, RunConfig, RunEvent, RunMetrics, RunSnapshot, Touch } from './types.js';

type Scheduled = { at: string; type: 'agent_due' | 'silent_retry' | 'customer_pays' | 'customer_stop' | 'customer_complains' | 'promise_to_pay'; caseId: string; token?: number; payload?: Record<string, unknown> };

export const DEFAULT_CONFIG: RunConfig = { seed: 7, size: 60, llm: true, mode: 'agent', razorpay: true, simDays: 7, chaos: 0, tickDelayMs: 0 };

const PlanSchema = z.object({ choice: z.number().int(), reasoning: z.string().max(400) });
const PLAN_JSON = { type: 'object', properties: { choice: { type: 'integer' }, reasoning: { type: 'string' } }, required: ['choice', 'reasoning'], additionalProperties: false };
const PLAN_SYSTEM = `You are the revenue-recovery agent for Saanjh & Co., an Indian tea & candle studio on Razorpay. You pick the next step for one at-risk payment from a short list of options the policy engine has ALREADY approved. Choose the option most likely to bring the money back at the lowest cost and least annoyance. Heuristics: silent retry for bank-side or funds-timing problems; WhatsApp over SMS when available; the customer's own language; a voice call only for larger amounts; a discount only when intent, not funds, is the problem; escalate only when the reason is real; close when nothing is worth doing. Reasoning under 30 words.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstName = (s: CaseState) => s.case.customer.segment === 'b2b' ? s.case.customer.name : s.case.customer.name.split(' ')[0];

export class RecoveryRun {
  readonly id: string;
  readonly config: RunConfig;
  readonly audit = new AuditLog();
  readonly states = new Map<string, CaseState>();
  readonly simStart = SIM_START;
  readonly simEnd: string;
  simNow: string;
  status: RunSnapshot['status'] = 'running';
  error?: string;
  baseline?: RunMetrics;
  lamplighter: LamplighterState = { activity: 'waiting for dusk', resting: false };
  private world: CustomerWorld;
  private truth: Map<string, RootCause>;
  private rulesTruth = new Map<string, RootCause>();
  private queue: Scheduled[] = [];
  private tokens = new Map<string, number>();
  private listeners = new Set<(e: RunEvent) => void>();
  private policy: PolicyConfig = DEFAULT_POLICY;
  private budgetLeftPaise: number;
  private counters = { llmFallbacks: 0, deferred: 0, violations: 0, complaints: 0, stops: 0, realOrders: 0, realPaid: 0, llmOverrides: 0 };
  publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:8787';
  private paused = false;
  private rng: seedrandom.PRNG;
  llm: LocalLLM;
  rzp: RazorpayClient;

  constructor(config: Partial<RunConfig>, deps: { llm: LocalLLM; rzp: RazorpayClient; id?: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.id = deps.id ?? `run_${Date.now().toString(36)}_${this.config.mode}`;
    this.llm = this.config.llm ? deps.llm : new LocalLLM({});
    this.rzp = this.config.razorpay ? deps.rzp : new RazorpayClient({});
    this.rng = seedrandom(`run-${this.config.seed}-${this.config.mode}`);
    const batch = generateBatch(this.config.seed, this.config.size);
    this.world = new CustomerWorld(batch.hidden, this.config.seed);
    this.truth = batch.truth;
    for (const c of batch.cases) this.states.set(c.id, { case: c, status: 'open', touches: [], incentiveUsed: false, recoveredPaise: 0, costPaise: 0, doNotContact: false, complained: false, razorpay: { orderId: c.razorpay.orderId } });
    this.simNow = this.simStart;
    this.simEnd = addHours(this.simStart, this.config.simDays * 24);
    this.budgetLeftPaise = this.policy.incentiveBudgetPaise;
    this.audit.onEvent((event) => this.emit({ type: 'audit', event }));
    this.rzp.events = {
      onRetry: (i) => this.log('razorpay', 'api_retry', { op: i.op, attempt: i.attempt, error: i.error, waitMs: i.waitMs }),
      onCircuit: (state) => this.log('razorpay', 'circuit_open', { state, note: 'pausing Razorpay calls briefly after repeated failures' }),
    };
  }

  // ---------- pub/sub ----------
  onEvent(fn: (e: RunEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(e: RunEvent) { for (const l of this.listeners) l(e); }
  private log(actor: AuditEvent['actor'], type: string, payload: Record<string, unknown>, caseId?: string) { return this.audit.append({ simTs: this.simNow, actor, type, payload, caseId }); }
  private touchCase(s: CaseState) { this.emit({ type: 'case', state: s }); }
  private setLamp(caseId: string | undefined, activity: string) { this.lamplighter = { caseId, activity, resting: isQuietHours(this.simNow, this.policy) }; this.emit({ type: 'lamplighter', lamplighter: this.lamplighter }); }
  pause() { this.paused = true; } resume() { this.paused = false; }

  // ---------- scheduling ----------
  private schedule(ev: Scheduled) { this.queue.push(ev); this.queue.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0); }
  private bump(caseId: string) { const t = (this.tokens.get(caseId) ?? 0) + 1; this.tokens.set(caseId, t); return t; }

  // ---------- main loop ----------
  async start(): Promise<RunMetrics> {
    try {
      this.log('system', 'run_started', { config: this.config, cases: this.states.size, atRiskPaise: this.atRisk(), simStart: this.simStart, simEnd: this.simEnd, llm: this.llm.enabled, razorpay: this.rzp.enabled });
      this.log('system', 'budget_set', { incentiveBudgetPaise: this.budgetLeftPaise, policy: this.policy });
      const cases = [...this.states.values()];
      cases.forEach((s, i) => {
        // a case is worked when it arrives; the backlog from before the window is spread across the first morning
        const at = s.case.createdAt < this.simStart ? addHours(this.simStart, i % 6) : s.case.createdAt;
        this.schedule({ at, type: 'agent_due', caseId: s.case.id, token: this.bump(s.case.id) });
      });
      while (this.simNow < this.simEnd) {
        while (this.paused) await sleep(100);
        await this.processDue();
        this.simNow = addHours(this.simNow, 1);
        const quiet = isQuietHours(this.simNow, this.policy);
        this.lamplighter = { caseId: this.lamplighter.caseId, resting: quiet, activity: quiet ? 'quiet hours: resting by the well' : (this.lamplighter.activity ?? '') };
        this.emit({ type: 'tick', simNow: this.simNow, metrics: this.metrics(), lamplighter: this.lamplighter });
        if (this.config.tickDelayMs > 0) await sleep(this.config.tickDelayMs);
      }
      // anything still open at the end of the window is closed honestly as "window ended"
      for (const s of this.states.values()) if (['open', 'scheduled', 'awaiting_customer'].includes(s.status)) { s.status = 'closed'; s.closeReason = 'recovery window ended'; this.log('agent', 'closed', { reason: s.closeReason }, s.case.id); this.touchCase(s); }
      this.status = 'done';
      const m = this.metrics();
      this.log('system', 'run_finished', { metrics: m, auditChain: this.audit.verify() });
      this.setLamp(undefined, 'the week is done');
      this.emit({ type: 'done', metrics: m, baseline: this.baseline });
      return m;
    } catch (e: any) {
      this.status = 'failed'; this.error = e?.message ?? String(e);
      this.log('system', 'run_failed', { error: this.error });
      this.emit({ type: 'error', error: this.error ?? 'unknown error' });
      throw e;
    }
  }

  private async processDue() {
    const due: Scheduled[] = [];
    while (this.queue.length && this.queue[0].at <= this.simNow) due.push(this.queue.shift()!);
    // customer events first (they change state), then agent work
    for (const ev of due.filter((d) => d.type !== 'agent_due' && d.type !== 'silent_retry')) await this.handleCustomerEvent(ev);
    const work = due.filter((d) => d.type === 'agent_due' || d.type === 'silent_retry');
    const concurrency = this.llm.enabled ? 4 : 1;
    let i = 0;
    const worker = async () => { while (i < work.length) { const ev = work[i++]; await this.handleAgentEvent(ev); } };
    await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
  }

  private async handleCustomerEvent(ev: Scheduled) {
    const s = this.states.get(ev.caseId)!;
    switch (ev.type) {
      case 'customer_pays':
        if (s.status === 'recovered') return;
        this.recover(s, 'simulated', String(ev.payload?.note ?? ''));
        return;
      case 'customer_stop':
        s.doNotContact = true; this.counters.stops++;
        this.log('customer', 'stop', { note: ev.payload?.note }, s.case.id);
        if (['awaiting_customer', 'scheduled', 'open'].includes(s.status)) await this.act(s.case.id);
        return;
      case 'customer_complains':
        s.complained = true; this.counters.complaints++;
        this.log('customer', 'complaint', { note: ev.payload?.note }, s.case.id); this.touchCase(s);
        return;
      case 'promise_to_pay': {
        const payAt = String(ev.payload?.payAt);
        this.log('customer', 'promise_to_pay', { note: ev.payload?.note, payAt, payAtIST: fmtIST(payAt) }, s.case.id);
        s.nextActionAt = addHours(payAt, 24);
        this.schedule({ at: s.nextActionAt, type: 'agent_due', caseId: s.case.id, token: this.bump(s.case.id) });
        this.log('agent', 'follow_up_scheduled', { at: s.nextActionAt, reason: 'promise-to-pay: hold all contact until the promised date passes' }, s.case.id);
        this.touchCase(s);
        return;
      }
    }
  }

  private async handleAgentEvent(ev: Scheduled) {
    const s = this.states.get(ev.caseId)!;
    if (['recovered', 'escalated', 'closed'].includes(s.status)) return;
    if (ev.type === 'agent_due') {
      if (ev.token !== this.tokens.get(s.case.id)) return; // superseded
      if (this.config.mode === 'baseline') return this.baselineAct(s);
      if (!s.diagnosis) await this.openCase(s);
      await this.act(s.case.id);
      return;
    }
    if (ev.type === 'silent_retry') await this.silentRetry(s);
  }

  // ---------- agent ----------
  private async openCase(s: CaseState) {
    this.setLamp(s.case.id, `looking at ${firstName(s)}'s lantern`);
    this.log('agent', 'case_opened', { kind: s.case.kind, amountPaise: s.case.amountPaise, failure: s.case.failure, daysOverdue: s.case.daysOverdue, customer: { name: s.case.customer.name, segment: s.case.customer.segment, lang: s.case.customer.lang, dnd: s.case.customer.dnd, channels: s.case.customer.channels } }, s.case.id);
    const r = await diagnose(s.case, this.llm);
    this.rulesTruth.set(s.case.id, r.rules.rootCause);
    if (r.llm) {
      if (r.llm.ok) { this.log('llm', 'llm_diagnosis', { ms: r.llm.ms, rootCause: r.llm.rootCause, confidence: r.llm.confidence, rulesSaid: r.rules.rootCause }, s.case.id); if (r.diagnosis.source !== 'rules') this.counters.llmOverrides++; }
      else { this.counters.llmFallbacks++; this.log('llm', 'llm_fallback', { stage: 'diagnosis', ms: r.llm.ms, error: r.llm.error, usedRules: r.rules.rootCause }, s.case.id); }
    }
    s.diagnosis = r.diagnosis;
    this.log('agent', 'diagnosis', { ...r.diagnosis }, s.case.id);
    this.touchCase(s);
  }

  private async act(caseId: string) {
    const s = this.states.get(caseId)!;
    if (['recovered', 'escalated', 'closed'].includes(s.status) || !s.diagnosis) return;
    const ctx = { now: this.simNow, state: s, diagnosis: s.diagnosis, budgetLeftPaise: this.budgetLeftPaise, policy: this.policy };
    const cands = evaluateCandidates(ctx);
    this.log('policy', 'candidates_evaluated', { candidates: cands.map((k) => ({ type: k.action.type, channel: k.action.channel, allowed: k.allowed, ev: k.action.expectedValuePaise, cost: k.action.costPaise, deferUntil: k.deferUntil, failed: k.checks.filter((c) => !c.passed).map((c) => c.rule), checks: k.checks })) }, caseId);
    const chosen = await this.choose(s, cands);
    const a = chosen.action;
    if (chosen.deferUntil && chosen.deferUntil > this.simNow) {
      s.status = 'scheduled'; s.nextActionAt = chosen.deferUntil; this.counters.deferred++;
      this.schedule({ at: chosen.deferUntil, type: 'agent_due', caseId, token: this.bump(caseId) });
      this.log('agent', 'action_deferred', { action: a.type, channel: a.channel, until: chosen.deferUntil, untilIST: fmtIST(chosen.deferUntil), reason: 'quiet hours (21:00–09:00 IST)' }, caseId);
      this.setLamp(caseId, `${firstName(s)} can wait till morning`);
      this.touchCase(s);
      return;
    }
    await this.execute(s, a);
  }

  private async choose(s: CaseState, cands: Candidate[]): Promise<Candidate> {
    const allowed = cands.filter((k) => k.allowed);
    const substantive = allowed.filter((k) => k.action.type !== 'close_case');
    const fb = fallbackChoice(cands);
    // The model is consulted when the numbers are close; when one option clearly dominates, the numbers win.
    const ranked = substantive.filter((k) => k.action.type !== 'escalate_human').sort((a, b) => b.action.expectedValuePaise - a.action.expectedValuePaise);
    const close = ranked.length >= 2 && ranked[1].action.expectedValuePaise > 0 && ranked[0].action.expectedValuePaise < ranked[1].action.expectedValuePaise * 1.6;
    if (!this.llm.enabled || substantive.length < 2 || !close) {
      this.log('agent', 'plan', { action: fb.action.type, channel: fb.action.channel, reason: fb.action.reason, ev: fb.action.expectedValuePaise, source: 'rules', why: !this.llm.enabled ? 'llm off' : substantive.length < 2 ? 'only one sensible option' : 'expected value clearly favours one option' }, s.case.id);
      return fb;
    }
    const history = s.touches.map((t) => `${fmtIST(t.at)}: ${t.action}${t.channel ? ' via ' + t.channel : ''}`).join('; ') || 'none';
    const list = allowed.map((k, i) => `${i}. ${k.action.type}${k.action.channel ? ' via ' + k.action.channel : ''}${k.action.incentivePct ? ` (${k.action.incentivePct}% off)` : ''}${k.action.retryAt ? ` at ${fmtIST(k.action.retryAt)}` : ''} — expected value ₹${(k.action.expectedValuePaise / 100).toFixed(0)}, cost ₹${(k.action.costPaise / 100).toFixed(2)}${k.action.type === 'escalate_human' ? ` — reason: ${k.action.reason}` : ''}`).join('\n');
    const recommended = allowed.indexOf(fb);
    const b2bHint = s.case.customer.segment === 'b2b' ? ' This is a B2B receivable: accounts teams respond to a call or an email they can forward, not to chat nudges.' : '';
    const user = `Case: ${s.case.kind.replace(/_/g, ' ')}, ${rupees(s.case.amountPaise)} for "${s.case.description}". Customer: ${s.case.customer.segment}, speaks ${s.case.customer.lang}, city ${s.case.customer.city}, lifetime value ${rupees(s.case.customer.ltvPaise)}, DND=${s.case.customer.dnd}. Diagnosis: ${s.diagnosis!.rootCause.replace(/_/g, ' ')} (confidence ${s.diagnosis!.confidence.toFixed(2)}): ${s.diagnosis!.reasoning}. Now: ${fmtIST(this.simNow)}. Previous touches: ${history}.${b2bHint}\nApproved options:\n${list}\nExpected value recommends option ${recommended}. Pick it unless you have a concrete reason to prefer another; state the reason. Answer with exactly one option number.`;
    const res = await this.llm.complete('plan', PLAN_SYSTEM, user, PlanSchema, PLAN_JSON, 160);
    if (res.ok && res.value.choice >= 0 && res.value.choice < allowed.length) {
      const pick = allowed[res.value.choice];
      const chosen: Candidate = { ...pick, action: { ...pick.action, source: 'llm', reason: res.value.reasoning } };
      this.log('llm', 'llm_plan', { ms: res.ms, choice: res.value.choice, action: pick.action.type, channel: pick.action.channel, reasoning: res.value.reasoning, fallbackWouldBe: fb.action.type }, s.case.id);
      this.log('agent', 'plan', { action: pick.action.type, channel: pick.action.channel, reason: res.value.reasoning, ev: pick.action.expectedValuePaise, source: 'llm' }, s.case.id);
      return chosen;
    }
    this.counters.llmFallbacks++;
    this.log('llm', 'llm_fallback', { stage: 'plan', ms: res.ms, error: res.ok ? `choice ${res.value.choice} out of range` : res.error, used: fb.action.type }, s.case.id);
    this.log('agent', 'plan', { action: fb.action.type, channel: fb.action.channel, reason: fb.action.reason, ev: fb.action.expectedValuePaise, source: 'fallback' }, s.case.id);
    return fb;
  }

  private async execute(s: CaseState, a: PlannedAction) {
    const id = s.case.id;
    switch (a.type) {
      case 'wait_and_retry': {
        s.status = 'scheduled'; s.nextActionAt = a.retryAt;
        s.touches.push({ at: this.simNow, action: 'wait_and_retry', costPaise: 0 });
        this.schedule({ at: a.retryAt!, type: 'silent_retry', caseId: id });
        this.log('agent', 'silent_retry_scheduled', { at: a.retryAt, atIST: fmtIST(a.retryAt!), reason: a.reason }, id);
        this.setLamp(id, `letting ${firstName(s)}'s bank catch up`);
        this.touchCase(s);
        return;
      }
      case 'escalate_human': {
        s.status = 'escalated'; s.escalationReason = a.reason;
        this.log('agent', 'escalated', { reason: a.reason, packet: { diagnosis: s.diagnosis, tried: s.touches.map((t) => ({ at: fmtIST(t.at), action: t.action, channel: t.channel })), amountPaise: s.case.amountPaise, customer: s.case.customer.name } }, id);
        this.setLamp(id, `handing ${firstName(s)} to a human`);
        this.touchCase(s);
        return;
      }
      case 'close_case': {
        s.status = 'closed'; s.closeReason = s.doNotContact ? 'customer asked us to stop' : a.reason;
        this.log('agent', 'closed', { reason: s.closeReason, touches: s.touches.length }, id);
        this.setLamp(id, `hooding ${firstName(s)}'s lantern`);
        this.touchCase(s);
        return;
      }
      case 'voice_call':
      case 'send_payment_link':
      case 'offer_incentive':
      case 'new_mandate_link': {
        await this.outreach(s, a);
        return;
      }
    }
  }

  private async outreach(s: CaseState, a: PlannedAction) {
    const id = s.case.id;
    this.setLamp(id, `${a.type === 'voice_call' ? 'calling' : 'writing to'} ${firstName(s)} (${a.channel})`);
    const composed = await composeMessage({ c: s.case, action: a, diagnosis: s.diagnosis! }, this.llm);
    if (composed.error || composed.rejected) { this.counters.llmFallbacks++; this.log('llm', 'llm_fallback', { stage: 'compose', ms: composed.ms, error: composed.error, rejected: composed.rejected, draft: composed.draft, used: 'template' }, id); }
    else if (composed.source === 'llm') this.log('llm', 'llm_compose', { ms: composed.ms, lang: a.lang, chars: composed.message.length }, id);
    this.log('agent', 'message_composed', { source: composed.source, lang: a.lang, channel: a.channel, validated: true }, id);

    let orderId: string | undefined; let payUrl: string | undefined;
    const isLink = a.type !== 'voice_call';
    if (isLink) {
      const purpose = a.type === 'offer_incentive' ? `incentive_${a.incentivePct}pct` : a.type === 'new_mandate_link' ? 'mandate_reauth' : 'recovery';
      payUrl = `${this.publicUrl}/pay/${this.id}/${id}`;
      if (this.rzp.enabled) {
        try {
          const o: any = await this.rzp.createOrder(s.case, this.id, { purpose, discountPct: a.incentivePct });
          orderId = o.id; this.counters.realOrders++;
          this.log('razorpay', 'order_created', { id: o.id, amount: o.amount, receipt: o.receipt, status: o.status, purpose, payUrl }, id);
        } catch (e: any) {
          const msg = rzpErrorMessage(e);
          s.apiFailures = (s.apiFailures ?? 0) + 1;
          if (s.apiFailures < 3) {
            this.log('razorpay', 'api_failed', { op: 'orders.create', error: msg, attempt: s.apiFailures, action: 'deferred 1h, will retry' }, id);
            s.lastError = msg; s.status = 'scheduled'; s.nextActionAt = addHours(this.simNow, 1);
            this.schedule({ at: s.nextActionAt, type: 'agent_due', caseId: id, token: this.bump(id) });
            this.touchCase(s);
            return;
          }
          // degrade honestly: the message still goes out, the pay page will create the order lazily, and the case is flagged
          this.log('razorpay', 'api_degraded', { op: 'orders.create', error: msg, note: 'Razorpay unavailable 3× — message sent anyway; pay page will create the order on demand; flagged for operator review' }, id);
          s.lastError = `degraded: ${msg}`;
        }
      } else {
        orderId = `order_sim_${id.slice(5, 13)}`;
        this.log('razorpay', 'order_simulated', { id: orderId, payUrl, note: 'razorpay disabled for this run' }, id);
      }
    }
    const message = isLink ? composed.message.replace(LINK, payUrl!) : composed.message;
    const touch: Touch = { at: this.simNow, action: a.type, channel: a.channel, message, costPaise: a.costPaise, orderId, payUrl };
    s.touches.push(touch); s.costPaise += a.costPaise;
    if (a.type === 'offer_incentive') { s.incentiveUsed = true; this.budgetLeftPaise -= Math.round((s.case.amountPaise * (a.incentivePct ?? 0)) / 100); }
    if (isLink) { s.razorpay.recoveryOrderId = orderId; s.razorpay.payUrl = payUrl; }
    this.log('agent', isLink ? 'message_sent' : 'call_placed', { channel: a.channel, lang: a.lang, message, costPaise: a.costPaise, incentivePct: a.incentivePct, orderId, payUrl, delivery: 'simulated (synthetic customer)' }, id);
    s.status = 'awaiting_customer';
    this.applyOutcome(s, this.world.onTouch(s, a, this.simNow), a);
    // follow-up: re-plan after the minimum gap, inside the contact window
    if (s.status === 'awaiting_customer') {
      const at = nextContactWindow(addHours(this.simNow, this.policy.minGapHours), this.policy);
      s.nextActionAt = at;
      this.schedule({ at, type: 'agent_due', caseId: id, token: this.bump(id) });
      this.log('agent', 'follow_up_scheduled', { at, atIST: fmtIST(at) }, id);
    }
    this.touchCase(s);
  }

  private applyOutcome(s: CaseState, o: SimOutcome, a: PlannedAction) {
    const id = s.case.id;
    this.log('simulator', 'outcome', { kind: o.kind, note: o.note, archetype: this.world.archetypeOf(id) }, id);
    switch (o.kind) {
      case 'pays': this.schedule({ at: o.at, type: 'customer_pays', caseId: id, payload: { note: `${o.note}; ${hoursBetween(this.simNow, o.at).toFixed(0)}h after the ${a.channel ?? a.type}` } }); break;
      case 'promise_to_pay': this.schedule({ at: o.at, type: 'promise_to_pay', caseId: id, payload: { note: o.note, payAt: o.payAt } }); this.schedule({ at: o.payAt, type: 'customer_pays', caseId: id, payload: { note: 'paid as promised' } }); break;
      case 'stop': this.schedule({ at: o.at, type: 'customer_stop', caseId: id, payload: { note: o.note } }); break;
      case 'complains': this.schedule({ at: o.at, type: 'customer_complains', caseId: id, payload: { note: o.note } }); break;
      case 'ignores': break;
    }
  }

  private async silentRetry(s: CaseState) {
    const id = s.case.id;
    if (s.doNotContact) { this.log('agent', 'silent_retry_skipped', { reason: 'customer said STOP after this was scheduled' }, id); await this.act(id); return; }
    this.setLamp(id, `retrying ${firstName(s)}'s payment quietly`);
    if (this.rzp.enabled) {
      try { const o: any = await this.rzp.createOrder(s.case, this.id, { purpose: 'silent_retry' }); s.razorpay.orderId = o.id; this.counters.realOrders++; this.log('razorpay', 'order_created', { id: o.id, amount: o.amount, receipt: o.receipt, purpose: 'silent_retry' }, id); }
      catch (e: any) { this.log('razorpay', 'api_failed', { op: 'orders.create', error: rzpErrorMessage(e), action: 'retry in 1h' }, id); this.schedule({ at: addHours(this.simNow, 1), type: 'silent_retry', caseId: id }); return; }
    }
    const o = this.world.onSilentRetry(s, this.simNow);
    this.log('agent', 'silent_retry_result', { success: o.kind === 'pays', note: o.note }, id);
    if (o.kind === 'pays') { this.recover(s, 'simulated', o.note); return; }
    await this.act(id);
  }

  private async baselineAct(s: CaseState) {
    const id = s.case.id;
    if (!s.diagnosis) s.diagnosis = { rootCause: 'unknown', confidence: 0, reasoning: 'baseline does not diagnose', source: 'rules' };
    if (s.touches.length >= 3) { s.status = 'closed'; s.closeReason = 'baseline: 3 attempts done'; this.log('agent', 'closed', { reason: s.closeReason }, id); this.touchCase(s); return; }
    const { action, violations } = baselineAction({ now: this.simNow, state: s, diagnosis: s.diagnosis, budgetLeftPaise: 0, policy: this.policy });
    this.counters.violations += violations.length;
    const message = templateMessage({ c: s.case, action: { ...action, lang: 'en' }, diagnosis: s.diagnosis }).replace(LINK, `https://rzp.io/l/sim-${id.slice(5, 11)}`);
    s.touches.push({ at: this.simNow, action: action.type, channel: action.channel, message, costPaise: action.costPaise }); s.costPaise += action.costPaise;
    this.log('agent', 'message_sent', { channel: 'sms', lang: 'en', message, costPaise: action.costPaise, violations: violations.map((v) => v.rule), mode: 'baseline' }, id);
    s.status = 'awaiting_customer';
    this.applyOutcome(s, this.world.onTouch(s, { ...action, lang: 'en' }, this.simNow), action);
    if (s.status === 'awaiting_customer') this.schedule({ at: addHours(this.simNow, 24), type: 'agent_due', caseId: id, token: this.bump(id) });
    this.touchCase(s);
  }

  private recover(s: CaseState, via: 'simulated' | 'razorpay', note: string, paymentId?: string) {
    const disc = s.incentiveUsed ? Math.round((s.case.amountPaise * this.policy.incentiveMaxPct) / 100) : 0;
    s.status = 'recovered'; s.recoveredVia = via; s.recoveredAt = this.simNow; s.recoveredPaise = s.case.amountPaise - disc;
    if (paymentId) s.razorpay.paymentId = paymentId;
    if (via === 'razorpay') this.counters.realPaid++;
    this.bump(s.case.id); // cancel any pending follow-up
    this.log(via === 'razorpay' ? 'razorpay' : 'customer', via === 'razorpay' ? 'payment_link_paid' : 'paid', { amountPaise: s.recoveredPaise, via, note, paymentId, discountPaise: disc }, s.case.id);
    this.log('agent', 'recovered', { amountPaise: s.recoveredPaise, via, touches: s.touches.length, costPaise: s.costPaise }, s.case.id);
    this.setLamp(s.case.id, `${firstName(s)}'s lantern is lit again (+${rupees(s.recoveredPaise)})`);
    this.touchCase(s);
  }

  // ---------- live-demo hooks ----------
  async customerStop(caseId: string) { const s = this.states.get(caseId); if (!s) return false; await this.handleCustomerEvent({ at: this.simNow, type: 'customer_stop', caseId, payload: { note: 'STOP received (demo control)' } }); return true; }

  /** Look for a captured (or capturable) Razorpay payment on the case's recovery order. */
  private async settleFromRazorpay(s: CaseState, note: string): Promise<boolean> {
    if (!s.razorpay.recoveryOrderId || !this.rzp.enabled) return false;
    const payments = await this.rzp.fetchOrderPayments(s.razorpay.recoveryOrderId);
    for (const p of payments) {
      if (p.status === 'captured') { this.recover(s, 'razorpay', note, p.id); return true; }
      if (p.status === 'authorized') {
        const cap: any = await this.rzp.capturePayment(p.id, p.amount);
        this.log('razorpay', 'payment_captured', { paymentId: p.id, amount: p.amount, status: cap.status, method: p.method }, s.case.id);
        this.recover(s, 'razorpay', `${note} (captured)`, p.id); return true;
      }
    }
    return false;
  }

  async markPaid(caseId: string): Promise<'razorpay' | 'simulated' | 'already' | 'missing'> {
    const s = this.states.get(caseId); if (!s) return 'missing';
    if (s.status === 'recovered') return 'already';
    try { if (await this.settleFromRazorpay(s, 'verified on Razorpay')) return 'razorpay'; }
    catch (e: any) { this.log('razorpay', 'api_failed', { op: 'orders.fetchPayments', error: rzpErrorMessage(e) }, caseId); }
    this.log('system', 'manual_override', { note: 'operator marked paid (demo control); not verified on Razorpay' }, caseId);
    this.recover(s, 'simulated', 'operator marked paid');
    return 'simulated';
  }

  /** Checkout handler callback: verify the signature, confirm with Razorpay, relight the lantern. */
  async verifyCheckout(caseId: string, orderId: string, paymentId: string, signature: string): Promise<{ ok: boolean; reason?: string }> {
    const s = this.states.get(caseId); if (!s) return { ok: false, reason: 'unknown case' };
    if (s.razorpay.recoveryOrderId !== orderId) { this.log('razorpay', 'signature_rejected', { reason: 'order id does not belong to this case', orderId }, caseId); return { ok: false, reason: 'order mismatch' }; }
    if (!this.rzp.verifySignature(orderId, paymentId, signature)) { this.log('razorpay', 'signature_rejected', { reason: 'HMAC mismatch', orderId, paymentId }, caseId); return { ok: false, reason: 'bad signature' }; }
    this.log('razorpay', 'signature_verified', { orderId, paymentId }, caseId);
    if (s.status === 'recovered') return { ok: true };
    try {
      const p: any = await this.rzp.fetchPayment(paymentId);
      if (p.status === 'authorized') { const cap: any = await this.rzp.capturePayment(paymentId, p.amount); this.log('razorpay', 'payment_captured', { paymentId, amount: p.amount, status: cap.status, method: p.method }, caseId); }
      else if (p.status !== 'captured') return { ok: false, reason: `payment status ${p.status}` };
      this.recover(s, 'razorpay', `paid on Razorpay checkout via ${p.method}`, paymentId);
      return { ok: true };
    } catch (e: any) { this.log('razorpay', 'api_failed', { op: 'payments.fetch/capture', error: rzpErrorMessage(e) }, caseId); return { ok: false, reason: 'razorpay api error' }; }
  }

  /** Poll real Razorpay orders (server mode). Returns number newly recovered. */
  async checkRealPayments(): Promise<number> {
    if (!this.rzp.enabled) return 0;
    let n = 0;
    for (const s of this.states.values()) {
      if (s.status === 'recovered' || !s.razorpay.recoveryOrderId || s.razorpay.recoveryOrderId.startsWith('order_sim')) continue;
      try { if (await this.settleFromRazorpay(s, 'paid on Razorpay (polled)')) n++; } catch { /* transient; next poll */ }
    }
    return n;
  }

  /** Lazily create the order for a pay page when the outreach happened while Razorpay was degraded. */
  async ensureRecoveryOrder(caseId: string): Promise<CaseState | undefined> {
    const s = this.states.get(caseId); if (!s) return undefined;
    if (!s.razorpay.recoveryOrderId && this.rzp.enabled) {
      const o: any = await this.rzp.createOrder(s.case, this.id, { purpose: 'recovery_lazy', discountPct: s.incentiveUsed ? this.policy.incentiveMaxPct : undefined });
      s.razorpay.recoveryOrderId = o.id; this.counters.realOrders++;
      this.log('razorpay', 'order_created', { id: o.id, amount: o.amount, purpose: 'recovery_lazy', note: 'created on demand when the pay page opened' }, caseId);
    }
    return s;
  }

  // ---------- metrics & snapshot ----------
  private atRisk() { let t = 0; for (const s of this.states.values()) t += s.case.amountPaise; return t; }

  metrics(): RunMetrics {
    const kinds: CaseKind[] = ['failed_payment', 'abandoned_checkout', 'failed_subscription', 'overdue_invoice'];
    const byKind = Object.fromEntries(kinds.map((k) => [k, { cases: 0, atRiskPaise: 0, recoveredPaise: 0, recoveredCases: 0 }])) as RunMetrics['byKind'];
    const byRootCause: RunMetrics['byRootCause'] = {};
    let recoveredPaise = 0, recoveredCases = 0, cost = 0, touches = 0, escalated = 0, closed = 0, incentive = 0;
    let dn = 0, rulesCorrect = 0, finalCorrect = 0, overridesCorrect = 0;
    for (const s of this.states.values()) {
      const k = byKind[s.case.kind]; k.cases++; k.atRiskPaise += s.case.amountPaise;
      const rc = s.diagnosis?.rootCause ?? 'undiagnosed';
      byRootCause[rc] ??= { cases: 0, recoveredCases: 0, recoveredPaise: 0 }; byRootCause[rc].cases++;
      if (s.status === 'recovered') { recoveredPaise += s.recoveredPaise; recoveredCases++; k.recoveredPaise += s.recoveredPaise; k.recoveredCases++; byRootCause[rc].recoveredCases++; byRootCause[rc].recoveredPaise += s.recoveredPaise; if (s.incentiveUsed) incentive += s.case.amountPaise - s.recoveredPaise; }
      if (s.status === 'escalated') escalated++; if (s.status === 'closed') closed++;
      cost += s.costPaise; touches += s.touches.filter((t) => t.action !== 'wait_and_retry').length;
      if (s.diagnosis && this.config.mode === 'agent') { dn++; const t = this.truth.get(s.case.id); if (this.rulesTruth.get(s.case.id) === t) rulesCorrect++; if (s.diagnosis.rootCause === t) finalCorrect++; if (s.diagnosis.source !== 'rules' && s.diagnosis.rootCause === t) overridesCorrect++; }
    }
    const atRisk = this.atRisk();
    return {
      cases: this.states.size, atRiskPaise: atRisk, recoveredPaise, recoveredCases, recoveryRate: atRisk ? recoveredPaise / atRisk : 0, recoveryRateCases: this.states.size ? recoveredCases / this.states.size : 0,
      costPaise: cost + incentive, costPerRecoveredRupee: recoveredPaise ? (cost + incentive) / recoveredPaise : 0, touches, touchesPerCase: this.states.size ? touches / this.states.size : 0,
      escalated, closed, complaints: this.counters.complaints, stopRequests: this.counters.stops, policyViolations: this.counters.violations,
      realRazorpayOrders: this.counters.realOrders, realRazorpayPaid: this.counters.realPaid, byKind, byRootCause,
      llmCalls: this.llm.stats.calls, llmFallbacks: this.counters.llmFallbacks, llmAvgMs: this.llm.stats.calls ? Math.round(this.llm.stats.totalMs / this.llm.stats.calls) : 0, razorpayRetries: this.rzp.retries,
      diagnosis: { n: dn, rulesCorrect, finalCorrect, llmOverrides: this.counters.llmOverrides, llmOverridesCorrect: overridesCorrect },
      incentiveSpentPaise: incentive, deferredForQuietHours: this.counters.deferred, simDays: this.config.simDays,
    };
  }

  snapshot(full = true): RunSnapshot {
    return { id: this.id, config: this.config, status: this.status, simStart: this.simStart, simNow: this.simNow, simEnd: this.simEnd, cases: full ? [...this.states.values()] : [], metrics: this.metrics(), baseline: this.baseline, lamplighter: this.lamplighter, auditCount: this.audit.events.length, auditTail: full ? this.audit.events.slice(-200) : [], error: this.error };
  }
  caseAudit(caseId: string) { return this.audit.events.filter((e) => e.caseId === caseId); }
}

/** Headless baseline with the same seed/size/window, for an honest comparison. */
export async function runBaseline(cfg: RunConfig): Promise<RunMetrics> {
  const run = new RecoveryRun({ ...cfg, mode: 'baseline', llm: false, razorpay: false, tickDelayMs: 0, chaos: 0 }, { llm: new LocalLLM({}), rzp: new RazorpayClient({}) });
  return run.start();
}
