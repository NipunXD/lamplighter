// HTTP + SSE server for the town UI and demo controls.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { RecoveryRun, runBaseline } from './engine.js';
import { LocalLLM } from './llm.js';
import { RazorpayClient } from './razorpay.js';
import { reportMarkdown } from './report.js';
import type { RunConfig, RunEvent } from './types.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const env = { llmBase: process.env.LLM_BASE_URL, llmModel: process.env.LLM_MODEL || undefined, keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET };
const app = express();
app.use(cors());
app.use(express.json());
const runs = new Map<string, RecoveryRun>();

async function llmReachable(): Promise<{ reachable: boolean; models?: string[] }> {
  if (!env.llmBase) return { reachable: false };
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${env.llmBase.replace(/\/$/, '')}/models`, { signal: ctrl.signal }); clearTimeout(t);
    const j: any = await r.json();
    return { reachable: r.ok, models: (j.data ?? []).map((m: any) => m.id) };
  } catch { return { reachable: false }; }
}

app.get('/api/health', async (_req, res) => {
  const l = await llmReachable();
  res.json({ ok: true, llm: { enabled: !!env.llmModel, model: env.llmModel ?? null, baseUrl: env.llmBase ?? null, reachable: l.reachable, models: l.models ?? [] }, razorpay: { enabled: !!(env.keyId && env.keySecret), keyId: env.keyId ? env.keyId.slice(0, 12) + '…' : null, mode: env.keyId?.startsWith('rzp_test_') ? 'test' : env.keyId ? 'live?' : 'off' } });
});

app.get('/api/runs', (_req, res) => res.json([...runs.values()].map((r) => r.snapshot(false))));

app.post('/api/runs', async (req, res) => {
  const body = (req.body ?? {}) as Partial<RunConfig> & { withBaseline?: boolean };
  const cfg: Partial<RunConfig> = { seed: body.seed, size: body.size, llm: body.llm, mode: body.mode, razorpay: body.razorpay, simDays: body.simDays, chaos: body.chaos, tickDelayMs: body.tickDelayMs ?? 200 };
  for (const k of Object.keys(cfg) as (keyof RunConfig)[]) if (cfg[k] === undefined) delete cfg[k];
  const llm = new LocalLLM({ baseUrl: env.llmBase, model: env.llmModel, chaos: cfg.chaos });
  const rzp = new RazorpayClient({ keyId: env.keyId, keySecret: env.keySecret, chaos: cfg.chaos });
  const run = new RecoveryRun(cfg, { llm, rzp });
  runs.set(run.id, run);
  if (body.withBaseline !== false && run.config.mode === 'agent') {
    try { run.baseline = await runBaseline(run.config); } catch (e) { console.error('baseline failed', e); }
  }
  run.start().catch((e) => console.error(`run ${run.id} failed:`, e?.message ?? e));
  res.json({ id: run.id });
});

const P = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : v ?? '');
const getRun = (req: express.Request, res: express.Response): RecoveryRun | undefined => { const r = runs.get(P(req.params.id)); if (!r) res.status(404).json({ error: 'run not found' }); return r; };

app.get('/api/runs/:id', (req, res) => { const r = getRun(req, res); if (r) res.json(r.snapshot(true)); });

app.get('/api/runs/:id/events', (req, res) => {
  const r = getRun(req, res); if (!r) return;
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const send = (e: RunEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  send({ type: 'snapshot', snapshot: r.snapshot(true) });
  const off = r.onEvent(send);
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000);
  req.on('close', () => { off(); clearInterval(hb); });
});

app.get('/api/runs/:id/cases/:caseId', (req, res) => { const r = getRun(req, res); if (!r) return; const s = r.states.get(P(req.params.caseId)); if (!s) return res.status(404).json({ error: 'case not found' }); res.json({ state: s, audit: r.caseAudit(P(req.params.caseId)) }); });
app.post('/api/runs/:id/cases/:caseId/stop', async (req, res) => { const r = getRun(req, res); if (!r) return; res.json({ ok: await r.customerStop(P(req.params.caseId)) }); });
app.post('/api/runs/:id/cases/:caseId/paid', async (req, res) => { const r = getRun(req, res); if (!r) return; const via = await r.markPaid(P(req.params.caseId)); res.json({ ok: via !== 'missing', via }); });
app.post('/api/runs/:id/pause', (req, res) => { const r = getRun(req, res); if (!r) return; r.pause(); res.json({ ok: true }); });
app.post('/api/runs/:id/resume', (req, res) => { const r = getRun(req, res); if (!r) return; r.resume(); res.json({ ok: true }); });
app.get('/api/runs/:id/audit.jsonl', (req, res) => { const r = getRun(req, res); if (!r) return; res.type('text/plain').send(r.audit.toJSONL()); });
app.get('/api/runs/:id/verify', (req, res) => { const r = getRun(req, res); if (!r) return; res.json(r.audit.verify()); });
app.get('/api/runs/:id/report.md', (req, res) => { const r = getRun(req, res); if (!r) return; res.type('text/markdown').send(reportMarkdown(r.snapshot(true), r.audit.verify())); });

// ---------- self-hosted checkout page: the "payment link" every message points at ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
app.get('/pay/:runId/:caseId', async (req, res) => {
  const run = runs.get(P(req.params.runId));
  if (!run) return res.status(404).send('<h1>This pay link belongs to a run that is no longer in memory.</h1><p>Start a run in Lamplighter and open a pay page from a house.</p>');
  let s;
  try { s = await run.ensureRecoveryOrder(P(req.params.caseId)); } catch (e: any) { return res.status(502).send(`<h1>Razorpay is unavailable right now</h1><p>${esc(e?.error?.description ?? e?.message)}</p>`); }
  if (!s) return res.status(404).send('<h1>Unknown case</h1>');
  const c = s.case; const disc = s.incentiveUsed ? 10 : 0; const amount = Math.round(c.amountPaise * (1 - disc / 100));
  const paid = s.status === 'recovered';
  const keyId = env.keyId ?? '';
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay Saanjh &amp; Co.</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 0%,#3b2a5a 0%,#1b1638 70%);font-family:Nunito,system-ui,sans-serif;color:#2b2230}
.card{background:#f6efe4;border-radius:20px;padding:36px 40px;max-width:440px;width:calc(100% - 40px);box-shadow:0 30px 80px rgba(0,0,0,.45)}
h1{font-family:Fraunces,serif;font-size:30px;margin:0 0 4px}.sub{color:#7a6a72;margin:0 0 22px}.amt{font-family:Fraunces,serif;font-size:44px;margin:10px 0 4px}.desc{margin:0 0 18px}
button{width:100%;padding:16px;border:0;border-radius:14px;background:#c96a4a;color:#fff;font:700 18px Nunito,sans-serif;cursor:pointer}button:disabled{background:#8aa48b}
.note{font-size:13px;color:#7a6a72;margin-top:16px;line-height:1.5}.ok{background:#e4efe2;color:#2f5d3a;padding:12px;border-radius:12px;margin-top:16px}.bad{background:#f7dcdc;color:#8a2c2c;padding:12px;border-radius:12px;margin-top:16px}
.lantern{display:inline-block;width:14px;height:14px;border-radius:50%;background:${paid ? '#ffb347' : '#5a4d63'};box-shadow:${paid ? '0 0 18px 6px rgba(255,179,71,.6)' : 'none'};margin-right:8px;vertical-align:middle}</style></head>
<body><div class="card"><h1>Saanjh &amp; Co.</h1><p class="sub"><span class="lantern"></span>${paid ? 'This lantern is already lit — thank you!' : `Hi ${esc(c.customer.name)}, here is your ${disc ? `${disc}% off ` : ''}payment for`}</p>
<p class="desc"><strong>${esc(c.description)}</strong></p><div class="amt">₹${(amount / 100).toLocaleString('en-IN')}</div>
<button id="pay" ${paid ? 'disabled' : ''}>${paid ? 'Paid ✓' : `Pay ₹${(amount / 100).toLocaleString('en-IN')}`}</button>
<div id="result"></div>
<p class="note">Razorpay <strong>test mode</strong>. Try UPI id <code>success@razorpay</code>, or card <code>4111 1111 1111 1111</code> with any future expiry and CVV. Order <code>${esc(s.razorpay.recoveryOrderId)}</code>.</p></div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
const opts = { key: ${JSON.stringify(keyId)}, amount: ${amount}, currency: 'INR', name: 'Saanjh & Co.', description: ${JSON.stringify(c.description)}, order_id: ${JSON.stringify(s.razorpay.recoveryOrderId ?? '')},
  prefill: { name: ${JSON.stringify(c.customer.name)}, email: ${JSON.stringify(c.customer.email)}, contact: '+919000090000' }, theme: { color: '#c96a4a' }, notes: { app: 'lamplighter', case_id: ${JSON.stringify(c.id)} },
  handler: async (r) => {
    const el = document.getElementById('result'); el.className = ''; el.textContent = 'Verifying with Saanjh & Co. …';
    try {
      const res = await fetch('/api/pay/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: ${JSON.stringify(run.id)}, caseId: ${JSON.stringify(c.id)}, ...r }) });
      const j = await res.json();
      el.className = j.ok ? 'ok' : 'bad'; el.textContent = j.ok ? 'Payment verified. Your lantern is lit again — thank you!' : 'We could not verify this payment: ' + (j.reason || 'unknown');
      if (j.ok) { const b = document.getElementById('pay'); b.disabled = true; b.textContent = 'Paid ✓'; }
    } catch (e) { el.className = 'bad'; el.textContent = 'Network error while verifying.'; }
  } };
document.getElementById('pay').onclick = () => { const rz = new Razorpay(opts); rz.on('payment.failed', (e) => { const el = document.getElementById('result'); el.className = 'bad'; el.textContent = 'Payment failed: ' + (e.error && e.error.description || 'declined'); }); rz.open(); };
</script></body></html>`);
});

app.post('/api/pay/verify', async (req, res) => {
  const { runId, caseId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  const run = runs.get(String(runId ?? ''));
  if (!run) return res.status(404).json({ ok: false, reason: 'run not found' });
  if (typeof razorpay_order_id !== 'string' || typeof razorpay_payment_id !== 'string' || typeof razorpay_signature !== 'string') return res.status(400).json({ ok: false, reason: 'missing fields' });
  res.json(await run.verifyCheckout(String(caseId ?? ''), razorpay_order_id, razorpay_payment_id, razorpay_signature));
});

// poll real Razorpay orders so a payment made on the pay page relights its lantern even without the handler
setInterval(async () => { for (const r of [...runs.values()].slice(-3)) { try { await r.checkRealPayments(); } catch { /* ignore */ } } }, 30_000);

const dist = path.resolve(process.cwd(), 'dist');
if (existsSync(dist)) { app.use(express.static(dist)); app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'))); }

app.listen(PORT, HOST, () => console.log(`lamplighter server on http://${HOST}:${PORT} · llm ${env.llmModel ?? 'off'} · razorpay ${env.keyId ? 'test keys loaded' : 'off'}`));
