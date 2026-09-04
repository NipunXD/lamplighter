// Dev-only story for the Week in Review panel: http://localhost:5173/review.html?state=done|live|nobaseline|notimeline&width=town|full
// Runs the offline mock headlessly (tickDelayMs 0), freezes a snapshot, and mounts the panel over a stand-in town.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { RunSnapshot } from '@shared/types';
import '../styles.css';
import { createMockBackend } from '../mock';
import { WeekInReview } from './WeekInReview';

type Variant = 'done' | 'live' | 'nobaseline' | 'notimeline';
const VARIANTS: Array<{ id: Variant; label: string }> = [
  { id: 'done', label: 'Finished week' },
  { id: 'live', label: 'Mid-run (Wed)' },
  { id: 'nobaseline', label: 'No baseline' },
  { id: 'notimeline', label: 'No timeline (fallback)' },
];

async function makeSnapshot(variant: Variant): Promise<RunSnapshot> {
  const backend = createMockBackend();
  const { id } = await backend.createRun({ seed: 7, size: 60, tickDelayMs: 0, withBaseline: variant !== 'nobaseline' });
  const snap = await new Promise<RunSnapshot>((resolve) => {
    let ticks = 0;
    const off = backend.subscribe(id, (ev) => {
      if (ev.type === 'tick' && variant === 'live' && ++ticks === 50) {
        // Wed 08 Sep ~10:00 IST. Pause first: the mock hands out live state objects, so freeze a copy before it moves on.
        void backend.pause(id);
        void backend.getRun(id).then((s) => { off(); resolve(structuredClone(s)); });
      }
      if (ev.type === 'done') { off(); void backend.getRun(id).then((s) => resolve(structuredClone(s))); }
    }, () => {});
  });
  if (variant === 'notimeline') return { ...snap, timeline: [], baselineTimeline: undefined };
  return snap;
}

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const [variant, setVariant] = useState<Variant>((params.get('state') as Variant) || 'done');
  const [wide, setWide] = useState(params.get('width') === 'full');
  const [open, setOpen] = useState(true);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    setSnapshot(null);
    void makeSnapshot(variant).then((s) => { if (alive) setSnapshot(s); });
    return () => { alive = false; };
  }, [variant]);
  const overlay = snapshot && open ? <WeekInReview snapshot={snapshot} onClose={() => setOpen(false)} live={variant === 'live'} /> : null;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><h1>Lamplighter</h1><small>Week in Review · preview</small></div>
        <div className="controls">
          <div className="seg">{VARIANTS.map((v) => <button key={v.id} type="button" aria-pressed={variant === v.id} onClick={() => { setVariant(v.id); setOpen(true); }}>{v.label}</button>)}</div>
          <div className="seg"><button type="button" aria-pressed={!wide} onClick={() => setWide(false)}>Town width</button><button type="button" aria-pressed={wide} onClick={() => setWide(true)}>Full width</button></div>
          <button type="button" className="btn" onClick={() => setOpen((o) => !o)}>{open ? 'Close panel' : 'Open panel'}</button>
        </div>
      </header>
      <main className="main" style={{ position: 'relative' }}>
        <section className="town-panel" style={{ position: 'relative' }}>
          <div className="town" aria-hidden="true" />
          {!wide && overlay}
        </section>
        <aside className="side">
          <div className="card" style={{ minHeight: 200 }} />
          <div className="card" />
        </aside>
        {wide && overlay}
        {!snapshot && <div className="town-caption"><b>Running the mock week…</b><span>168 ticks, offline</span></div>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
