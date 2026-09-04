import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEvent, LamplighterState } from '@shared/types';
import { createApiBackend, type Backend, type Health, type StreamStatus } from './api';
import { createMockBackend, previewCases } from './mock';
import { useRunStore } from './store';
import { TopBar, type RunPhase, type UiConfig } from './components/TopBar';
import { Town } from './components/Town';
import { Ledger } from './components/Ledger';
import { Journal } from './components/Journal';
import { CaseDrawer } from './components/CaseDrawer';

const PREVIEW_NOW = '2026-09-06T13:15:00.000Z'; // Sun 06 Sep 2026, 18:45 IST: dusk before the week begins
const SPEED_MS: Record<UiConfig['speed'], number> = { 0.5: 400, 1: 200, 4: 50 };
const IDLE_LAMP: LamplighterState = { activity: '', resting: true };

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mock = params.get('mock') === '1';
  const backend = useMemo<Backend>(() => (mock ? createMockBackend() : createApiBackend()), [mock]);
  const { state, ingest, reset } = useRunStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<UiConfig>({ seed: 7, size: 60, llm: true, razorpay: true, speed: 1 });
  const [runId, setRunId] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamStatus>('idle');
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    backend.health().then((h) => { if (alive) { setHealth(h); setHealthError(null); } }).catch((e: Error) => { if (alive) setHealthError(e.message); });
    return () => { alive = false; };
  }, [backend]);
  useEffect(() => () => { unsub.current?.(); }, []);

  const attach = useCallback((id: string) => {
    unsub.current?.();
    reset();
    setRunId(id);
    setSelected(null);
    setPaused(false);
    unsub.current = backend.subscribe(id, ingest, (s, detail) => {
      setStream(s);
      if (s === 'reconnecting' && detail) setNotice(`Event stream dropped — ${detail}`);
      if (s === 'live') setNotice(null);
    });
  }, [backend, ingest, reset]);

  useEffect(() => {
    const id = params.get('run');
    if (id && !mock) attach(id);
  }, [params, mock, attach]);

  const start = async () => {
    setStarting(true);
    setNotice(null);
    try {
      const { id } = await backend.createRun({ seed: cfg.seed, size: cfg.size, llm: cfg.llm, razorpay: cfg.razorpay, mode: 'agent', tickDelayMs: SPEED_MS[cfg.speed], withBaseline: true });
      attach(id);
    } catch (e) {
      setNotice(`Could not start a run: ${(e as Error).message}. Is the server on :8787? Add ?mock=1 for the offline demo.`);
    } finally { setStarting(false); }
  };
  const togglePause = async () => {
    if (!runId) return;
    try {
      if (paused) { await backend.resume(runId); setPaused(false); } else { await backend.pause(runId); setPaused(true); }
    } catch (e) { setNotice((e as Error).message); }
  };
  const onCfg = (patch: Partial<UiConfig>) => {
    setCfg((c) => ({ ...c, ...patch }));
    if (patch.speed && runId && backend.setTickDelay) backend.setTickDelay(runId, SPEED_MS[patch.speed]);
  };

  const snapshot = state.snapshot;
  const phase: RunPhase = !snapshot ? 'idle' : snapshot.status === 'running' ? 'running' : snapshot.status === 'done' ? 'done' : 'failed';
  const preview = useMemo(() => previewCases(cfg.seed, cfg.size), [cfg.seed, cfg.size]);
  const cases = snapshot?.cases ?? preview;
  const simNow = snapshot?.simNow ?? PREVIEW_NOW;
  const lamplighter = snapshot?.lamplighter ?? IDLE_LAMP;
  const casesById = useMemo(() => new Map(cases.map((c) => [c.case.id, c] as const)), [cases]);
  const selectedState = selected ? casesById.get(selected) ?? null : null;
  const previewAtRisk = useMemo(() => preview.reduce((s, c) => s + c.case.amountPaise, 0), [preview]);

  // Drawer audit: the full list from the server (the snapshot only carries the last 200) merged with live events.
  const [fetched, setFetched] = useState<{ id: string; audit: AuditEvent[] } | null>(null);
  useEffect(() => {
    if (!selected || !runId) { setFetched(null); return; }
    let alive = true;
    backend.getCase(runId, selected).then((r) => { if (alive) setFetched({ id: selected, audit: r.audit }); }).catch(() => { /* live events still cover it */ });
    return () => { alive = false; };
  }, [selected, runId, backend]);
  const caseAudit = useMemo(() => {
    const live = selected ? state.auditByCase.get(selected) ?? [] : [];
    const base = fetched && fetched.id === selected ? fetched.audit : [];
    if (!base.length) return live;
    const seen = new Set(base.map((e) => e.seq));
    return [...base, ...live.filter((e) => !seen.has(e.seq))].sort((a, b) => a.seq - b.seq);
  }, [selected, fetched, state.auditByCase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (state.error) setNotice(`Run failed: ${state.error}`); }, [state.error]);

  return (
    <div className="app">
      <TopBar cfg={cfg} onCfg={onCfg} simNow={simNow} phase={phase} paused={paused} stream={stream} health={health} healthError={healthError} mock={mock} onStart={start} onTogglePause={togglePause} starting={starting} />
      {notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="dismiss">×</button></div>}
      <main className="main">
        <section className="town-panel">
          <Town cases={cases} simNow={simNow} lamplighter={lamplighter} empty={!snapshot} selectedId={selected} onSelect={setSelected} />
        </section>
        <aside className="side">
          <Ledger metrics={snapshot?.metrics ?? null} baseline={snapshot?.baseline} previewAtRisk={previewAtRisk} previewCount={preview.length} phase={phase} />
          <Journal events={state.journal} casesById={casesById} auditCount={snapshot?.auditCount ?? 0} hasRun={!!runId} onOpenCase={setSelected} onVerify={() => (runId ? backend.verify(runId) : Promise.resolve({ ok: true }))} />
          <CaseDrawer st={selectedState} audit={caseAudit} open={!!selectedState} canAct={!!runId && phase === 'running'} onClose={() => setSelected(null)}
            onStop={() => (runId && selected ? backend.stopCase(runId, selected) : Promise.resolve({ ok: false }))}
            onPaid={() => (runId && selected ? backend.markPaid(runId, selected) : Promise.resolve({ ok: false }))} />
        </aside>
      </main>
    </div>
  );
}
