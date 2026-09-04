// The town: sky that reads the sim hour, hills, a winding road, one house per case, the lamplighter,
// fireflies at night and a one-shot coin sparkle when a lantern relights.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { CaseState, LamplighterState } from '@shared/types';
import { layoutTown, scenery, skyMix, TOWN_W } from '../layout';
import { istHour, KIND_COLOR, KIND_LABEL, KIND_ORDER, ROOT_CAUSE_LABEL, rupees, SEGMENT_LABEL, STATUS_LABEL } from '../format';
import { House, HouseLights } from './House';
import { Lamplighter } from './Lamplighter';

interface Props {
  cases: CaseState[];
  simNow: string;
  lamplighter: LamplighterState;
  empty: boolean;
  selectedId: string | null;
  onSelect(id: string | null): void;
}
interface Sparkle { key: number; x: number; y: number; amount: number }
interface Tip { id: string; left: number; top: number }

const SPARK_DIRS = [[-18, -22], [16, -26], [-26, -6], [26, -10], [-8, -32], [10, -34]];
const CLOUDS = [{ y: 0.22, s: 1.15, dur: 190, delay: 40 }, { y: 0.4, s: 0.8, dur: 150, delay: 110 }, { y: 0.12, s: 0.95, dur: 230, delay: 170 }, { y: 0.55, s: 0.6, dur: 130, delay: 20 }];
const STUDIO = { x: 1118, dy: 100 };

export function Town({ cases, simNow, lamplighter, empty, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [H, setH] = useState(900);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setH(Math.round(Math.min(1250, Math.max(720, (TOWN_W * height) / width))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => layoutTown(cases.length, H), [cases.length, H]);
  const hour = istHour(simNow);
  const mix = useMemo(() => skyMix(hour, H), [hour, H]);
  const stars = useMemo(() => scenery(11, 80), []);
  const flies = useMemo(() => scenery(23, 16), []);
  const treeline = useMemo(() => scenery(31, 16).map((t, i) => ({ x: 60 + t.x * (TOWN_W - 340), y: layout.horizon + 62 + t.y * 14, s: 0.5 + t.r * 0.3, k: i % 2 })), [layout.horizon]);
  const indexById = useMemo(() => new Map(cases.map((c, i) => [c.case.id, i] as const)), [cases]);
  const horizon = layout.horizon;

  // --- sparkles + pole lift on recovery (detected from status transitions, no per-frame state) ---
  const prevStatus = useRef<Map<string, string>>(new Map());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [lift, setLift] = useState(false);
  useEffect(() => {
    const fresh: Sparkle[] = [];
    const next = new Map<string, string>();
    for (const st of cases) {
      const was = prevStatus.current.get(st.case.id);
      next.set(st.case.id, st.status);
      if (st.status === 'recovered' && was && was !== 'recovered') {
        const sp = layout.spots[indexById.get(st.case.id) ?? -1];
        if (sp) fresh.push({ key: Date.now() + Math.random(), x: sp.x - 40 * sp.s, y: sp.y - 36 * sp.s, amount: st.recoveredPaise || st.case.amountPaise });
      }
    }
    prevStatus.current = next;
    if (!fresh.length) return;
    setSparkles((s) => [...s, ...fresh]);
    setLift(true);
    window.setTimeout(() => { if (mounted.current) setSparkles((s) => s.filter((x) => !fresh.includes(x))); }, 2300);
    window.setTimeout(() => { if (mounted.current) setLift(false); }, 1000);
  }, [cases, indexById, layout]);

  // --- lamplighter target, facing and walking state ---
  const target = useMemo(() => {
    if (empty || lamplighter.resting) return { x: layout.well.x + 38, y: layout.well.y + 1, s: 1 };
    if (lamplighter.caseId) {
      const sp = layout.spots[indexById.get(lamplighter.caseId) ?? -1];
      if (sp) return { x: sp.x - 40 * sp.s + 14 * sp.s, y: sp.y + 12, s: sp.s };
    }
    return { x: layout.square.x, y: layout.square.y, s: 1 };
  }, [empty, lamplighter.resting, lamplighter.caseId, layout, indexById]);
  const lastX = useRef(target.x);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [walking, setWalking] = useState(false);
  const walkTimer = useRef<number | null>(null);
  useEffect(() => {
    const dx = target.x - lastX.current;
    if (Math.abs(dx) > 2) setFacing(dx < 0 ? -1 : 1);
    if (Math.abs(dx) > 2 || true) {
      lastX.current = target.x;
      if (!empty) {
        setWalking(true);
        if (walkTimer.current) window.clearTimeout(walkTimer.current);
        walkTimer.current = window.setTimeout(() => setWalking(false), 900);
      }
    }
  }, [target, empty]);
  const onArrive = useCallback(() => {
    setWalking(false);
    if (walkTimer.current) window.clearTimeout(walkTimer.current);
  }, []);

  // --- hover tooltip + click via event delegation (150 houses, one handler) ---
  const [tip, setTip] = useState<Tip | null>(null);
  const locate = useCallback((id: string): Tip | null => {
    const sp = layout.spots[indexById.get(id) ?? -1];
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!sp || !svg || !wrap) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(sp.x + 4 * sp.s, sp.y - 76 * sp.s).matrixTransform(ctm);
    const r = wrap.getBoundingClientRect();
    return { id, left: pt.x - r.left, top: pt.y - r.top };
  }, [layout, indexById]);
  const caseFromEvent = (e: { target: EventTarget | null }) => (e.target as Element | null)?.closest?.('[data-case]')?.getAttribute('data-case') ?? null;
  const onOver = (e: PointerEvent<SVGSVGElement>) => {
    const id = caseFromEvent(e);
    if (id && id !== tip?.id) setTip(locate(id));
  };
  const onOut = (e: PointerEvent<SVGSVGElement>) => {
    const to = e.relatedTarget as Element | null;
    if (!to || !to.closest?.('[data-case]')) setTip(null);
  };
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const id = caseFromEvent(e);
    if (id) onSelect(id === selectedId ? null : id);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const id = caseFromEvent(e);
    if (id) { e.preventDefault(); onSelect(id); }
  };
  const tipCase = tip ? cases[indexById.get(tip.id) ?? -1] : undefined;

  const overlayOpacity = 0.58 * mix.night + 0.16 * mix.dusk + 0.08 * mix.dawn;
  const rootStyle = { '--night': mix.night.toFixed(3) } as CSSProperties;
  const skyBottom = horizon + 24;
  const previewAtRisk = cases.reduce((s, c) => s + c.case.amountPaise, 0);
  const flipBubble = target.x > TOWN_W - 420;

  return (
    <div className="town" ref={wrapRef} data-phase={mix.night > 0.5 ? 'night' : 'day'}>
      <svg ref={svgRef} viewBox={`0 0 ${TOWN_W} ${H}`} preserveAspectRatio="xMidYMid slice" style={rootStyle}
        onPointerOver={onOver} onPointerOut={onOut} onClick={onClick} onKeyDown={onKey} role="group" aria-label="The town: one house per case">
        <defs>
          <linearGradient id="skyDay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fbde3" /><stop offset="0.7" stopColor="#d9e4ec" /><stop offset="1" stopColor="#f6e6c6" /></linearGradient>
          <linearGradient id="skyDusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4b3468" /><stop offset="0.55" stopColor="#d95c7a" /><stop offset="1" stopColor="#f6b169" /></linearGradient>
          <linearGradient id="skyDawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5c5a92" /><stop offset="0.55" stopColor="#e8908f" /><stop offset="1" stopColor="#f8cd92" /></linearGradient>
          <linearGradient id="skyNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#15112f" /><stop offset="0.6" stopColor="#2a2150" /><stop offset="1" stopColor="#4a3670" /></linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dccaa3" /><stop offset="1" stopColor="#cdb78d" /></linearGradient>
          <linearGradient id="nightFade" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
            <stop offset={Math.max(0, (horizon - 90) / H).toFixed(4)} stopColor="#1b1638" stopOpacity="0" />
            <stop offset={((horizon + 10) / H).toFixed(4)} stopColor="#1b1638" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="glow"><stop offset="0" stopColor="#ffd27a" stopOpacity="0.95" /><stop offset="0.35" stopColor="#ffb347" stopOpacity="0.55" /><stop offset="1" stopColor="#ff7a1a" stopOpacity="0" /></radialGradient>
          <radialGradient id="pool"><stop offset="0" stopColor="#ffc46b" stopOpacity="0.6" /><stop offset="0.5" stopColor="#ffb347" stopOpacity="0.22" /><stop offset="1" stopColor="#ffb347" stopOpacity="0" /></radialGradient>
          <radialGradient id="sunGlow"><stop offset="0" stopColor="#fff2b0" stopOpacity="0.9" /><stop offset="1" stopColor="#ffd98a" stopOpacity="0" /></radialGradient>
          <radialGradient id="moonGlow"><stop offset="0" stopColor="#fff8e0" stopOpacity="0.55" /><stop offset="1" stopColor="#fff8e0" stopOpacity="0" /></radialGradient>
          <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" /></filter>
        </defs>

        {/* sky: day base, dawn / dusk / night cross-faded on top */}
        <rect width={TOWN_W} height={skyBottom} fill="url(#skyDay)" />
        <rect className="sky-layer" width={TOWN_W} height={skyBottom} fill="url(#skyDawn)" style={{ opacity: mix.dawn }} />
        <rect className="sky-layer" width={TOWN_W} height={skyBottom} fill="url(#skyDusk)" style={{ opacity: mix.dusk }} />
        <rect className="sky-layer" width={TOWN_W} height={skyBottom} fill="url(#skyNight)" style={{ opacity: mix.night }} />
        <g className="stars" style={{ opacity: mix.night }}>
          {stars.map((st, i) => (
            <circle key={i} className={`star${i % 4 === 0 ? ' tw' : ''}`} cx={st.x * TOWN_W} cy={st.y * (horizon - 40)} r={0.6 + st.r * 1.3} fill="#fff6d8" style={i % 4 === 0 ? { animationDelay: `${st.d * 3}s` } : { opacity: 0.4 + st.r * 0.5 }} />
          ))}
        </g>
        <g className={`celestial sun${mix.sun ? '' : ' hidden'}`} style={{ transform: `translate(${(mix.sun?.x ?? 90).toFixed(1)}px, ${(mix.sun?.y ?? H * 0.34).toFixed(1)}px)`, opacity: mix.sun ? 1 : 0 }}>
          <circle r="60" fill="url(#sunGlow)" />
          <circle r="19" fill="#ffe08a" />
        </g>
        <g className={`celestial moon${mix.moon ? '' : ' hidden'}`} style={{ transform: `translate(${(mix.moon?.x ?? 90).toFixed(1)}px, ${(mix.moon?.y ?? H * 0.34).toFixed(1)}px)`, opacity: mix.moon ? 1 : 0 }}>
          <circle r="44" fill="url(#moonGlow)" />
          <circle r="15" fill="#f6efd8" />
          <circle cx="-5" cy="-3" r="3" fill="#e4dcc2" />
          <circle cx="5" cy="5" r="2" fill="#e4dcc2" />
          <circle cx="4" cy="-6" r="1.4" fill="#e4dcc2" />
        </g>

        {/* clouds drift all day and fade out at night */}
        <g className="clouds" style={{ opacity: (1 - mix.night) * 0.85 }}>
          {CLOUDS.map((c, i) => (
            <g key={i} className="cloud" style={{ '--cd': `${c.dur}s`, '--cdelay': `-${c.delay}s` } as CSSProperties}>
              <g transform={`translate(0 ${(c.y * horizon).toFixed(0)}) scale(${c.s})`}>
                <ellipse cx="0" cy="0" rx="46" ry="14" /><ellipse cx="-28" cy="4" rx="26" ry="10" /><ellipse cx="26" cy="2" rx="30" ry="12" /><ellipse cx="4" cy="-8" rx="24" ry="12" />
              </g>
            </g>
          ))}
        </g>

        {/* horizon: far ridge with Jaipur domes, nearer hill with a little parallax */}
        <path className="hill-far" d={`M0,${horizon + 12} C150,${horizon - 30} 300,${horizon - 8} 450,${horizon - 26} S 800,${horizon - 2} 950,${horizon - 30} S 1150,${horizon - 12} ${TOWN_W},${horizon - 22} V${horizon + 60} H0 Z`} />
        <g className="hill-far">
          <path d={`M500,${horizon - 20} a14,14 0 0 1 28,0 z M514,${horizon - 34} v-8 M560,${horizon - 18} a9,9 0 0 1 18,0 z M480,${horizon - 16} h-10 v-10 h10 z M485,${horizon - 26} a5,5 0 0 1 0,-1`} />
          <path d={`M880,${horizon - 24} a12,12 0 0 1 24,0 z M892,${horizon - 36} v-7 M915,${horizon - 20} h-8 v-9 h8 z`} />
        </g>
        <path className="hill-mid" d={`M0,${horizon + 34} C200,${horizon + 4} 380,${horizon + 26} 560,${horizon + 10} S 900,${horizon + 34} ${TOWN_W},${horizon + 6} V${horizon + 90} H0 Z`} />
        <rect className="hill-dusk" y={horizon - 40} width={TOWN_W} height="90" fill="url(#skyDusk)" style={{ opacity: 0.18 * mix.dusk + 0.14 * mix.dawn, mixBlendMode: 'screen' }} />

        {/* ground and the road */}
        <rect y={horizon + 30} width={TOWN_W} height={H - horizon - 30} fill="url(#ground)" />
        <path d={layout.road} fill="none" stroke="#c9ac7e" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
        <path d={layout.road} fill="none" stroke="#c4a577" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
        <path d={layout.road} fill="none" stroke="#dcc39a" strokeWidth="1.5" strokeDasharray="5 12" strokeLinecap="round" opacity="0.7" />

        {/* the well, a bench and a tree where the lamplighter rests */}
        <g transform={`translate(${layout.well.x} ${layout.well.y})`}>
          <ellipse cx="-2" cy="4" rx="58" ry="8" fill="rgba(43,34,48,0.12)" />
          <rect x="-58" y="-30" width="4" height="30" fill="#6e4a3a" />
          <circle cx="-56" cy="-42" r="15" fill="#7f9a80" />
          <circle cx="-67" cy="-33" r="11" fill="#8aa48b" />
          <circle cx="-45" cy="-34" r="12" fill="#93ab90" />
          <rect x="-18" y="-20" width="36" height="20" rx="2" fill="#a89484" />
          <path d="M-18,-13 h36 M-18,-6 h36 M-9,-20 v7 M9,-13 v7 M0,-6 v6" stroke="#8a776a" strokeWidth="1" />
          <rect x="-14" y="-40" width="2.5" height="20" fill="#5b4238" />
          <rect x="11.5" y="-40" width="2.5" height="20" fill="#5b4238" />
          <polygon points="-22,-40 0,-52 22,-40" fill="#c96a4a" />
          <path d="M-22,-40 H22" stroke="#e58aa0" strokeWidth="1.5" />
          <line x1="0" y1="-51" x2="0" y2="-29" stroke="#3a2b2e" strokeWidth="1" />
          <rect x="-3" y="-30" width="6" height="5" fill="#7a5b4a" />
          <rect x="24" y="-9" width="32" height="3.5" rx="1" fill="#8b5a3c" />
          <rect x="26" y="-6" width="2.5" height="7" fill="#6e4433" />
          <rect x="51" y="-6" width="2.5" height="7" fill="#6e4433" />
        </g>

        {/* houses (bodies), then the night overlay, then everything that glows */}
        <g className="treeline">
          {treeline.map((t, i) => (
            <g key={i} className="tree" transform={`translate(${t.x.toFixed(0)} ${t.y.toFixed(0)}) scale(${t.s.toFixed(2)})`}>
              <ellipse cx="0" cy="3" rx="16" ry="4" fill="rgba(43,34,48,0.12)" />
              <rect x="-2.5" y="-16" width="5" height="19" fill="#6e4a3a" />
              <circle cx="0" cy="-26" r="14" fill={t.k ? '#7f9a80' : '#8aa48b'} />
              <circle cx="-10" cy="-18" r="10" fill={t.k ? '#8aa48b' : '#93ab90'} />
              <circle cx="10" cy="-19" r="11" fill="#93ab90" />
            </g>
          ))}
        </g>
        <g className="studio" transform={`translate(${STUDIO.x} ${(horizon + STUDIO.dy).toFixed(0)})`}>
          <ellipse cx="4" cy="3" rx="58" ry="8" fill="rgba(43,34,48,0.16)" />
          <polygon points="34,-46 54,-56 54,-12 34,0" fill="#d7c19c" />
          <rect x="-36" y="-46" width="70" height="46" fill="#efdfc2" />
          <rect x="-40" y="-52" width="98" height="7" rx="1.5" fill="#c96a4a" />
          <path d="M-36,-46 H34 L54,-56" fill="none" stroke="#e58aa0" strokeWidth="1.6" />
          <rect x="-30" y="-33" width="60" height="9" rx="1.5" fill="#e58aa0" />
          <path d="M-30,-33 v9 M-20,-33 v9 M-10,-33 v9 M0,-33 v9 M10,-33 v9 M20,-33 v9" stroke="#f6efe4" strokeWidth="2.6" />
          <rect x="-26" y="-22" width="20" height="14" rx="1" fill="#3b3040" stroke="#e58aa0" strokeWidth="1" />
          <rect x="6" y="-22" width="20" height="14" rx="1" fill="#3b3040" stroke="#e58aa0" strokeWidth="1" />
          <rect x="-6" y="-14" width="9" height="14" fill="#6e4433" />
          <rect x="-24" y="-63" width="48" height="10" rx="2" fill="#2b2230" />
          <text x="0" y="-55.5" textAnchor="middle" fontSize="7.2" fontWeight="700" fill="#f6efe4" style={{ fontFamily: 'var(--font-display)', letterSpacing: 0.3 }}>Saanjh &amp; Co.</text>
          <path d="M-40,-23 h-6 v11 h6 M-44,-20 a2,2 0 0 1 4,0" fill="none" stroke="#5a4b5e" strokeWidth="1.2" />
          <rect x="-58" y="-30" width="3" height="30" className="h-post" />
        </g>
        <g className="houses">
          {layout.spots.map((sp, i) => cases[i] && <House key={cases[i].case.id} st={cases[i]} x={sp.x} y={sp.y} s={sp.s} i={i} selected={cases[i].case.id === selectedId} />)}
        </g>
        <rect className="night-overlay" width={TOWN_W} height={H} fill="url(#nightFade)" style={{ opacity: overlayOpacity }} />
        <g className="lights">
          <g className="studio-lights" transform={`translate(${STUDIO.x} ${(horizon + STUDIO.dy).toFixed(0)})`}>
            <ellipse cx="-56" cy="3" rx="34" ry="9" className="pool-always" />
            <rect x="-25.5" y="-21.5" width="19" height="13" className="swin" />
            <rect x="6.5" y="-21.5" width="19" height="13" className="swin" />
            <circle cx="-56" cy="-36" r="18" className="sglow" />
            <rect x="-62" y="-42" width="12" height="13" rx="1.5" fill="#3b3040" stroke="#2b2230" strokeWidth="0.8" />
            <path d="M-56,-40.5 c-2.6,3.2 -2.6,6.4 0,8 c2.6,-1.6 2.6,-4.8 0,-8z" fill="#ffb347" />
            {[0, 1.3].map((d) => <circle key={d} className="puff" cx="44" cy="-58" r="3" style={{ '--pd': `${d}s` } as CSSProperties} />)}
          </g>
          {layout.spots.map((sp, i) => cases[i] && <HouseLights key={cases[i].case.id} st={cases[i]} x={sp.x} y={sp.y} s={sp.s} i={i} selected={false} />)}
        </g>

        <Lamplighter x={target.x} y={target.y} scale={0.72 * Math.max(0.75, target.s)} facing={facing} walking={walking && !lamplighter.resting && !empty} lift={lift && !lamplighter.resting}
          resting={empty || lamplighter.resting} activity={empty ? 'Waiting for the lamps…' : lamplighter.activity} flipBubble={flipBubble} onArrive={onArrive} />

        <g className="fireflies" style={{ opacity: mix.night }}>
          {flies.map((f, i) => (
            <g key={i} transform={`translate(${(120 + f.x * (TOWN_W - 240)).toFixed(0)} ${(horizon + 60 + f.y * (H - horizon - 120)).toFixed(0)})`}>
              <circle className="firefly" r={1.4 + f.r} style={{ '--dx': `${(f.d - 0.5) * 60}px`, '--dy': `${(f.r - 0.5) * 40}px`, '--dur': `${5 + f.d * 6}s`, '--delay': `-${f.r * 6}s` } as CSSProperties} />
            </g>
          ))}
        </g>

        <g className="sparkles" pointerEvents="none">
          {sparkles.map((sp) => (
            <g key={sp.key} transform={`translate(${sp.x.toFixed(1)} ${sp.y.toFixed(1)})`}>
              {SPARK_DIRS.map(([dx, dy], i) => <circle key={i} className="spark" r={2.2} style={{ '--sx': `${dx}px`, '--sy': `${dy}px`, animationDelay: `${i * 40}ms` } as CSSProperties} />)}
              <text className="rise" textAnchor="middle" y="-14">+{rupees(sp.amount)}</text>
            </g>
          ))}
        </g>
      </svg>

      <div className="town-legend" aria-hidden="true">
        {KIND_ORDER.map((k) => <span key={k}><i style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]}</span>)}
      </div>
      {empty && (
        <div className="town-caption">
          <b>Press Light the lamps to begin</b>
          <span>{cases.length} lanterns dark across Saanjh &amp; Co.'s town · {rupees(previewAtRisk)} at risk</span>
        </div>
      )}
      {tip && tipCase && (
        <div className="town-tip" style={{ left: tip.left, top: tip.top }} role="tooltip">
          <b>{tipCase.case.customer.name}</b>
          <div className="muted">{tipCase.case.customer.city} · {SEGMENT_LABEL[tipCase.case.customer.segment]}{tipCase.case.customer.dnd ? ' · DND' : ''}</div>
          <div>{KIND_LABEL[tipCase.case.kind]} · <span className="amt">{rupees(tipCase.case.amountPaise)}</span></div>
          <div>{STATUS_LABEL[tipCase.status]}{tipCase.diagnosis ? ` · ${ROOT_CAUSE_LABEL[tipCase.diagnosis.rootCause]}` : ''}{tipCase.touches.length ? ` · ${tipCase.touches.length} touch${tipCase.touches.length > 1 ? 'es' : ''}` : ''}</div>
        </div>
      )}
    </div>
  );
}
