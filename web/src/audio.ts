// Sound: a soft two-note lantern chime on recovery (Web Audio, no assets) with a persisted mute switch.
let ctx: AudioContext | null = null;
let lastChime = 0;
const KEY = 'lamplighter.muted';
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const listeners = new Set<(m: boolean) => void>();

export function isMuted() { return muted; }
export function setMuted(v: boolean) { muted = v; try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ } for (const l of listeners) l(v); }
export function onMuteChange(cb: (m: boolean) => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** E5 then B5, quick attack, ~600 ms decay, at most one chime per 400 ms. Silent when muted or without a user gesture. */
export function chime() {
  if (muted) return;
  const now = performance.now();
  if (now - lastChime < 400) return;
  lastChime = now;
  const ac = ensureCtx();
  if (!ac || ac.state !== 'running') return;
  const t0 = ac.currentTime;
  for (const [freq, delay] of [[659.25, 0], [987.77, 0.11]] as const) {
    const osc = ac.createOscillator(); const gain = ac.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + delay);
    gain.gain.exponentialRampToValueAtTime(0.06, t0 + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.65);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + delay); osc.stop(t0 + delay + 0.7);
  }
}
