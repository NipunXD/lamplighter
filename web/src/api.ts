// Backend access: the real Lamplighter server over fetch + SSE (with reconnect), behind an interface
// that web/src/mock.ts also implements so the whole UI runs offline with `?mock=1`.
import type { AuditEvent, CaseState, RunConfig, RunEvent, RunSnapshot } from '@shared/types';

export interface Health {
  ok: boolean;
  llm: { enabled: boolean; model?: string | null; reachable?: boolean };
  razorpay: { enabled: boolean; keyId?: string | null; mode?: string };
}
export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed';
export type CreateRunInput = Partial<RunConfig> & { withBaseline?: boolean };

export interface Backend {
  readonly kind: 'api' | 'mock';
  health(): Promise<Health>;
  createRun(cfg: CreateRunInput): Promise<{ id: string }>;
  getRun(id: string): Promise<RunSnapshot>;
  /** Subscribes to the run's event stream. The first event is always a snapshot. Returns an unsubscribe fn. */
  subscribe(id: string, onEvent: (e: RunEvent) => void, onStatus: (s: StreamStatus, detail?: string) => void): () => void;
  getCase(id: string, caseId: string): Promise<{ state: CaseState; audit: AuditEvent[] }>;
  stopCase(id: string, caseId: string): Promise<{ ok: boolean }>;
  markPaid(id: string, caseId: string): Promise<{ ok: boolean; via?: string }>;
  pause(id: string): Promise<{ ok: boolean }>;
  resume(id: string): Promise<{ ok: boolean }>;
  verify(id: string): Promise<{ ok: boolean; brokenAt?: number }>;
  /** Mock only: change pacing mid-run. */
  setTickDelay?(id: string, ms: number): void;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  if (!res.ok) {
    let detail = '';
    try { const t = (await res.text()).trim(); detail = t.startsWith('<') ? '' : t.slice(0, 200); } catch { /* ignore */ }
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`.trim());
  }
  return (await res.json()) as T;
}
const post = <T,>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export function createApiBackend(): Backend {
  return {
    kind: 'api',
    health: () => request<Health>('/api/health'),
    createRun: (cfg) => post<{ id: string }>('/api/runs', cfg),
    getRun: (id) => request<RunSnapshot>(`/api/runs/${id}`),
    subscribe(id, onEvent, onStatus) {
      let es: EventSource | null = null;
      let closed = false;
      let attempt = 0;
      let timer: number | undefined;
      const open = () => {
        if (closed) return;
        onStatus(attempt === 0 ? 'connecting' : 'reconnecting', attempt ? `attempt ${attempt + 1}` : undefined);
        es = new EventSource(`/api/runs/${id}/events`);
        es.onopen = () => { attempt = 0; onStatus('live'); };
        es.onmessage = (m) => {
          let ev: RunEvent;
          try { ev = JSON.parse(m.data) as RunEvent; } catch { return; }
          onEvent(ev);
          if (ev.type === 'done' || ev.type === 'error') {
            closed = true;
            es?.close();
            onStatus('closed');
          }
        };
        es.onerror = () => {
          if (closed) return;
          // The browser retries on its own while CONNECTING. If it gave up (CLOSED), back off and reopen;
          // the server replays a fresh snapshot on every connect, so no events are lost.
          if (es && es.readyState === EventSource.CLOSED) {
            es.close();
            attempt += 1;
            const wait = Math.min(10_000, 1000 * 2 ** (attempt - 1));
            onStatus('reconnecting', `retrying in ${Math.round(wait / 1000)}s`);
            timer = window.setTimeout(open, wait);
          } else {
            onStatus('reconnecting');
          }
        };
      };
      open();
      return () => {
        closed = true;
        if (timer) window.clearTimeout(timer);
        es?.close();
      };
    },
    getCase: (id, caseId) => request(`/api/runs/${id}/cases/${caseId}`),
    stopCase: (id, caseId) => post(`/api/runs/${id}/cases/${caseId}/stop`),
    markPaid: (id, caseId) => post(`/api/runs/${id}/cases/${caseId}/paid`),
    pause: (id) => post(`/api/runs/${id}/pause`),
    resume: (id) => post(`/api/runs/${id}/resume`),
    verify: (id) => request(`/api/runs/${id}/verify`),
  };
}
