// Top bar: wordmark, the sim clock (sun/moon on an arc, IST), run controls and status pills.
import type { Health, StreamStatus } from '../api';
import { fmtDate, fmtTime, istHour, isQuietHours } from '../format';

export interface UiConfig { seed: number; size: number; llm: boolean; razorpay: boolean; speed: 0.5 | 1 | 4 }
export type RunPhase = 'idle' | 'running' | 'done' | 'failed';

interface Props {
  cfg: UiConfig;
  onCfg(patch: Partial<UiConfig>): void;
  simNow: string;
  phase: RunPhase;
  paused: boolean;
  stream: StreamStatus;
  health: Health | null;
  healthError: string | null;
  mock: boolean;
  onStart(): void;
  onTogglePause(): void;
  starting: boolean;
}

function ClockArc({ simNow }: { simNow: string }) {
  const h = istHour(simNow);
  const day = h >= 6 && h < 18.5;
  const t = day ? (h - 6) / 12.5 : ((h - 18.5 + 24) % 24) / 11.5;
  const a = Math.PI * (1 - Math.min(1, Math.max(0, t)));
  const cx = 36 + 28 * Math.cos(a);
  const cy = 30 - 24 * Math.sin(a);
  return (
    <svg className="clock-arc" viewBox="0 0 72 34" aria-hidden="true">
      <path d="M8,30 A28,28 0 0 1 64,30" fill="none" stroke="#d9c4a3" strokeWidth="1.5" strokeDasharray="2 3" />
      <line x1="4" y1="30" x2="68" y2="30" stroke="#d9c4a3" strokeWidth="1.5" />
      {day ? (
        <g transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)})`}><circle r="6" fill="#ffd166" /><circle r="8.5" fill="#ffd166" opacity="0.25" /></g>
      ) : (
        <g transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)})`}><circle r="5.5" fill="#3b2a5a" /><circle cx="2" cy="-1.5" r="4.6" fill="#f6efe4" /></g>
      )}
    </svg>
  );
}

export function TopBar({ cfg, onCfg, simNow, phase, paused, stream, health, healthError, mock, onStart, onTogglePause, starting }: Props) {
  const running = phase === 'running';
  const quiet = isQuietHours(simNow);
  const keyId = health?.razorpay.keyId ?? '';
  const live = !!health && (health.razorpay.mode === 'live?' || keyId.startsWith('rzp_live_'));
  const rzpLabel = !health ? '…' : !health.razorpay.enabled ? 'Razorpay off' : health.razorpay.mode === 'test' || keyId.startsWith('rzp_test_') ? 'Razorpay test mode' : live ? 'Razorpay LIVE key' : 'Razorpay on';
  const llmLabel = !health ? '…' : health.llm.enabled ? `${health.llm.model ?? 'local LLM'}${health.llm.reachable === false ? ' · unreachable' : ''}` : 'LLM off · rules only';
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M11 9h10l2 4v11a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V13z" fill="#2b2230" />
          <rect x="14" y="5" width="4" height="4" rx="1" fill="#2b2230" />
          <circle cx="16" cy="19" r="6" fill="#ffb347" />
          <path d="M16 13.5c-2.4 3-2.4 6 0 7.6 2.4-1.6 2.4-4.6 0-7.6z" fill="#ff7a1a" />
        </svg>
        <div>
          <h1>Lamplighter</h1>
          <small>revenue recovery for Saanjh &amp; Co. · Razorpay test mode{mock ? ' · offline mock' : ''}</small>
        </div>
      </div>

      <div className="clock" aria-live="polite">
        <ClockArc simNow={simNow} />
        <div className="clock-date"><b>{fmtTime(simNow)}</b> <span className="long">IST · </span>{fmtDate(simNow)}</div>
        <span className={`pill${quiet ? ' quiet' : ''}`} title={quiet ? 'No customer contact between 21:00 and 09:00 IST; the lamplighter rests by the well' : 'Customer contact allowed (09:00–21:00 IST)'}>{quiet ? 'Quiet hours · resting' : 'Contact window open'}</span>
      </div>

      <div className="controls">
        <label className="field seed"><span>seed</span><input type="number" min={1} max={9999} value={cfg.seed} disabled={running} onChange={(e) => onCfg({ seed: Math.max(1, Number(e.target.value) || 1) })} aria-label="seed" /></label>
        <label className="field"><select value={cfg.size} disabled={running} onChange={(e) => onCfg({ size: Number(e.target.value) })} aria-label="batch size" title="batch size">
          <option value={40}>40 lanterns</option><option value={60}>60 lanterns</option><option value={120}>120 lanterns</option>
        </select></label>
        <label className="switch" title="Use the local LLM for diagnosis, planning and copy (rules fallback always on)"><input type="checkbox" checked={cfg.llm} disabled={running} onChange={(e) => onCfg({ llm: e.target.checked })} /><span><span className="lbl-long">Local </span>LLM</span></label>
        <label className="switch" title="Create real Razorpay test-mode orders behind every checkout link"><input type="checkbox" checked={cfg.razorpay} disabled={running} onChange={(e) => onCfg({ razorpay: e.target.checked })} /><span><span className="lbl-long">Real </span>Razorpay</span></label>
        <div className="seg" role="group" aria-label="speed">
          {([0.5, 1, 4] as const).map((sp) => <button key={sp} type="button" aria-pressed={cfg.speed === sp} onClick={() => onCfg({ speed: sp })} disabled={running && !mock}>{sp}×</button>)}
        </div>
        {running ? (
          <button type="button" className="btn-primary secondary" onClick={onTogglePause}>{paused ? 'Resume' : 'Pause'}</button>
        ) : (
          <button type="button" className="btn-primary" onClick={onStart} disabled={starting}>{starting ? 'Lighting…' : 'Light the lamps'}</button>
        )}
        {healthError ? (
          <span className="status-pill warn" title={healthError}><i className="dot" /><span className="label">server offline · try ?mock=1</span></span>
        ) : (
          <span className={`status-pill${live ? ' warn' : ''}${health && (!health.llm.enabled || !health.razorpay.enabled) ? ' off' : ''}`} title={`LLM: ${llmLabel}\nRazorpay: ${rzpLabel}${keyId ? ` (${keyId})` : ''}`}>
            <i className="dot" /><span className="label">{llmLabel} · {rzpLabel.replace('Razorpay ', '')}</span>
          </span>
        )}
        {running && <span className={`status-pill dot-only${stream === 'live' && !paused ? ' live' : stream === 'reconnecting' ? ' warn' : ''}`} title={`event stream: ${paused ? 'paused' : stream}`} aria-label={`event stream ${paused ? 'paused' : stream}`}><i className="dot" /></span>}
      </div>
    </header>
  );
}
