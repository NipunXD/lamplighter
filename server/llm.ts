// Local LLM client (OpenAI-compatible; LM Studio / Ollama). Structured output via json_schema, zod-validated.
// Every call has a timeout and a deterministic fallback path; the agent must keep working with the model off.
import { z } from 'zod';

export interface LlmOpts { baseUrl?: string; model?: string; timeoutMs?: number; chaos?: number; rng?: () => number }
export interface LlmStats { calls: number; failures: number; totalMs: number; promptTokens: number; completionTokens: number }

export class LocalLLM {
  stats: LlmStats = { calls: 0, failures: 0, totalMs: 0, promptTokens: 0, completionTokens: 0 };
  private disabledUntil = 0;
  constructor(private opts: LlmOpts) {}
  get enabled() { return !!this.opts.model && !!this.opts.baseUrl; }

  async complete<T>(name: string, system: string, user: string, schema: z.ZodType<T>, jsonSchema: Record<string, unknown>, maxTokens = 300): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string; ms: number }> {
    const start = Date.now();
    if (!this.enabled) return { ok: false, error: 'llm disabled', ms: 0 };
    if (Date.now() < this.disabledUntil) return { ok: false, error: 'llm circuit open', ms: 0 };
    this.stats.calls++;
    try {
      if (this.opts.chaos && (this.opts.rng ?? Math.random)() < this.opts.chaos) throw new Error('injected: model returned garbage (chaos)');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 45_000);
      let res: Response;
      try {
        res = await fetch(`${this.opts.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({
            model: this.opts.model, temperature: 0.2, max_tokens: maxTokens,
            messages: [{ role: 'system', content: system + ' /no_think' }, { role: 'user', content: user }],
            response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } },
          }),
        });
      } finally { clearTimeout(t); }
      if (!res.ok) throw new Error(`llm http ${res.status}`);
      const data: any = await res.json();
      const raw: string = data.choices?.[0]?.message?.content ?? '';
      const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      this.stats.promptTokens += data.usage?.prompt_tokens ?? 0;
      this.stats.completionTokens += data.usage?.completion_tokens ?? 0;
      const parsed = schema.safeParse(JSON.parse(cleaned));
      if (!parsed.success) throw new Error(`schema mismatch: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
      const ms = Date.now() - start;
      this.stats.totalMs += ms;
      return { ok: true, value: parsed.data, ms };
    } catch (e: any) {
      this.stats.failures++;
      const ms = Date.now() - start;
      this.stats.totalMs += ms;
      const msg = e?.name === 'AbortError' ? 'llm timeout' : (e?.message ?? String(e));
      if (/fetch failed|ECONNREFUSED/.test(msg)) this.disabledUntil = Date.now() + 30_000; // server down: stop hammering
      return { ok: false, error: msg, ms };
    }
  }
}
