// Headless batch runner: pnpm batch --seed 7 --size 120 --llm on --razorpay off --days 14 --chaos 0
// The report window defaults to 14 days because B2B receivables pay on promise dates a week or more out.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { RecoveryRun, runBaselineWithTimeline } from './engine.js';
import { LocalLLM } from './llm.js';
import { RazorpayClient } from './razorpay.js';
import { reportMarkdown } from './report.js';
import { rupees } from './time.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : []).filter((x) => x.length));
const on = (v: string | undefined, d: boolean) => v === undefined ? d : v === 'on' || v === 'true' || v === '1';
const cfg = { seed: Number(args.seed ?? 7), size: Number(args.size ?? 120), llm: on(args.llm, true), razorpay: on(args.razorpay, false), simDays: Number(args.days ?? 14), chaos: Number(args.chaos ?? 0), mode: 'agent' as const, tickDelayMs: 0 };
const llm = new LocalLLM({ baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || undefined, chaos: cfg.chaos });
const rzp = new RazorpayClient({ keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, chaos: cfg.chaos });
const run = new RecoveryRun(cfg, { llm, rzp, id: `batch_s${cfg.seed}_n${cfg.size}_${cfg.llm ? 'llm' : 'rules'}${cfg.razorpay ? '_rzp' : ''}` });
let lastDay = -1;
run.onEvent((e) => { if (e.type === 'tick') { const day = Math.floor((new Date(e.simNow).getTime() - new Date(run.simStart).getTime()) / 86_400_000); if (day !== lastDay) { lastDay = day; process.stderr.write(`day ${day}: recovered ${rupees(e.metrics.recoveredPaise)} of ${rupees(e.metrics.atRiskPaise)} (${e.metrics.recoveredCases}/${e.metrics.cases}) llm calls ${e.metrics.llmCalls}\n`); } } });
const t0 = Date.now();
const m = await run.start();
if (on(args.baseline, true)) { const b = await runBaselineWithTimeline(run.config); run.baseline = b.metrics; run.baselineTimeline = b.timeline; }
const snap = run.snapshot();
mkdirSync('data/runtime', { recursive: true });
writeFileSync(`data/runtime/${run.id}.json`, JSON.stringify({ ...snap, audit: run.audit.events }, null, 1));
writeFileSync(`data/runtime/${run.id}.audit.jsonl`, run.audit.toJSONL());
const md = reportMarkdown(snap, run.audit.verify());
writeFileSync(`data/runtime/${run.id}.report.md`, md);
if (on(args.publish, false)) writeFileSync('docs/METRICS.md', md);
console.log(md);
console.error(`wall time ${((Date.now() - t0) / 1000).toFixed(1)}s · files in data/runtime/${run.id}.*`);
