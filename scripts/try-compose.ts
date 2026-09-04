// Dev tool: see what the local model writes for a few synthetic cases and why the validator accepts or rejects it.
import 'dotenv/config';
import { generateBatch } from '../server/data/generate.js';
import { LocalLLM } from '../server/llm.js';
import { rulesDiagnosis } from '../server/diagnose.js';
import { composeMessage } from '../server/compose.js';

const llm = new LocalLLM({ baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
const { cases } = generateBatch(Number(process.argv[2] ?? 11), 12);
for (const c of cases.slice(0, Number(process.argv[3] ?? 6))) {
  const d = rulesDiagnosis(c);
  const action = { type: 'send_payment_link' as const, channel: 'whatsapp' as const, lang: c.customer.lang, reason: 't', source: 'rules' as const, expectedValuePaise: 1, costPaise: 80 };
  const r = await composeMessage({ c, action, diagnosis: d }, llm);
  console.log(`\n[${c.kind} · ${c.customer.lang} · ${c.customer.name} · ${d.rootCause}] source=${r.source} ms=${r.ms} rejected=${JSON.stringify(r.rejected ?? null)}`);
  console.log('   ', r.draft ?? r.message);
}
