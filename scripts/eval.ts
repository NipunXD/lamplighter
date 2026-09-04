// Multi-seed evaluation: the agent vs the naive cron on ten different seeded customer worlds (rules-only, no services).
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { RecoveryRun, runBaselineWithTimeline } from '../server/engine.js';
import { LocalLLM } from '../server/llm.js';
import { RazorpayClient } from '../server/razorpay.js';
import { rupees } from '../server/time.js';
import type { RunMetrics } from '../server/types.js';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const SIZE = 120, DAYS = 14;
type Row = { seed: number; agent: RunMetrics; cron: RunMetrics };
const rows: Row[] = [];
for (const seed of SEEDS) {
  const cfg = { seed, size: SIZE, simDays: DAYS, llm: false, razorpay: false, tickDelayMs: 0, chaos: 0, mode: 'agent' as const };
  const run = new RecoveryRun(cfg, { llm: new LocalLLM({}), rzp: new RazorpayClient({}) });
  const agent = await run.start();
  const { metrics: cron } = await runBaselineWithTimeline(run.config);
  rows.push({ seed, agent, cron });
  process.stderr.write(`seed ${seed}: agent ${rupees(agent.recoveredPaise)} vs cron ${rupees(cron.recoveredPaise)}\n`);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const T95 = 2.262; // t(0.975, df=9)
type Metric = { key: keyof RunMetrics; label: string; fmt: (v: number) => string; lowerBetter?: boolean };
const METRICS: Metric[] = [
  { key: 'recoveredPaise', label: 'recovered', fmt: (v) => rupees(v) },
  { key: 'recoveryRate', label: 'recovery rate (value)', fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'recoveredCases', label: 'cases recovered', fmt: (v) => v.toFixed(1) },
  { key: 'touchesPerCase', label: 'touches per case', fmt: (v) => v.toFixed(2), lowerBetter: true },
  { key: 'complaints', label: 'complaints', fmt: (v) => v.toFixed(1), lowerBetter: true },
  { key: 'stopRequests', label: 'STOP requests', fmt: (v) => v.toFixed(1), lowerBetter: true },
  { key: 'policyViolations', label: 'policy violations', fmt: (v) => v.toFixed(1), lowerBetter: true },
  { key: 'escalated', label: 'escalated to humans', fmt: (v) => v.toFixed(1) },
  { key: 'costPaise', label: 'spend', fmt: (v) => rupees(v), lowerBetter: true },
];
const L: string[] = [];
L.push('# Multi-seed evaluation');
L.push('');
L.push(`Ten seeded customer worlds (seeds 1–10), ${SIZE} cases each, ${DAYS}-day window, rules-only agent (model and Razorpay off) against the naive-retry cron on the **same** world. Paired differences are agent − cron with a 95% t-interval (n = 10). Customers are simulated with hidden state the agent never reads; this measures the policy engine and the recovery loop, not the local model (see docs/METRICS.md for a model-on run).`);
L.push('');
L.push('| metric | agent mean ± sd | cron mean ± sd | paired diff [95% CI] | agent better in |');
L.push('| --- | --- | --- | --- | --- |');
const summary: Record<string, unknown> = {};
for (const mt of METRICS) {
  const a = rows.map((r) => Number(r.agent[mt.key])); const c = rows.map((r) => Number(r.cron[mt.key]));
  const d = a.map((x, i) => x - c[i]); const dm = mean(d); const half = T95 * sd(d) / Math.sqrt(d.length);
  const wins = d.filter((x) => mt.lowerBetter ? x < 0 : x > 0).length;
  const ties = d.filter((x) => x === 0).length;
  summary[mt.key] = { agentMean: mean(a), agentSd: sd(a), cronMean: mean(c), cronSd: sd(c), diffMean: dm, ci: [dm - half, dm + half], wins, ties };
  L.push(`| ${mt.label} | ${mt.fmt(mean(a))} ± ${mt.fmt(sd(a))} | ${mt.fmt(mean(c))} ± ${mt.fmt(sd(c))} | ${mt.fmt(dm)} [${mt.fmt(dm - half)}, ${mt.fmt(dm + half)}] | ${wins}/10${ties ? ` (${ties} tie${ties > 1 ? 's' : ''})` : ''} |`);
}
L.push('');
L.push('## Per seed');
L.push('| seed | at risk | agent recovered | cron recovered | agent complaints | cron complaints | agent touches/case | cron touches/case |');
L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) L.push(`| ${r.seed} | ${rupees(r.agent.atRiskPaise)} | ${rupees(r.agent.recoveredPaise)} | ${rupees(r.cron.recoveredPaise)} | ${r.agent.complaints} | ${r.cron.complaints} | ${r.agent.touchesPerCase.toFixed(2)} | ${r.cron.touchesPerCase.toFixed(2)} |`);
const rec = summary.recoveredPaise as { diffMean: number; ci: number[]; wins: number };
const comp = summary.complaints as { agentMean: number; cronMean: number; wins: number };
const viol = summary.policyViolations as { agentMean: number; cronMean: number };
const touch = summary.touchesPerCase as { agentMean: number; cronMean: number };
L.push('');
L.push('## Summary');
L.push(`Across ten worlds the agent recovers ${rupees(rec.diffMean)} more than the cron per batch on average (95% CI ${rupees(rec.ci[0])} to ${rupees(rec.ci[1])}), winning ${rec.wins} of 10 seeds. It does so with ${touch.agentMean.toFixed(2)} touches per case instead of ${touch.cronMean.toFixed(2)}, ${comp.agentMean.toFixed(1)} complaints instead of ${comp.cronMean.toFixed(1)} (fewer in ${comp.wins} of 10), and ${viol.agentMean.toFixed(0)} policy violations instead of ${viol.cronMean.toFixed(0)}. ${rec.ci[0] > 0 ? 'The interval on recovered money excludes zero.' : 'The interval on recovered money includes zero, so the money advantage is not statistically settled at n = 10; the compliance advantage is.'} The simulator is the same for both arms, so this isolates the value of diagnosis, timing, channel choice and the stopping rules, not of the model.`);
mkdirSync('data/runtime', { recursive: true });
writeFileSync('data/runtime/eval.json', JSON.stringify({ seeds: SEEDS, size: SIZE, days: DAYS, rows, summary }, null, 1));
writeFileSync('docs/EVAL.md', L.join('\n') + '\n');
console.log(L.slice(-2).join('\n'));
