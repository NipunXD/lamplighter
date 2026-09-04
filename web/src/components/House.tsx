// One house = one case. `House` is the body (darkens at night); `HouseLights` is drawn in a layer above
// the night overlay so windows and lanterns actually glow. Both are memoised: only a changed case re-renders.
import { memo, type CSSProperties } from 'react';
import type { CaseKind, CaseState } from '@shared/types';
import { KIND_COLOR, KIND_LABEL, STATUS_LABEL, rupees } from '../format';

const ROOF_SHADE: Record<CaseKind, string> = { failed_payment: '#a2503a', abandoned_checkout: '#b06a60', failed_subscription: '#6a8570', overdue_invoice: '#526385' };
// Tiny kind glyphs (10×10 boxes): cup, basket, calendar, ledger.
const ICONS: Record<CaseKind, string> = {
  failed_payment: 'M1.5 2.5h6v3.5a3 3 0 0 1-6 0zM7.5 3.5h1a1.5 1.5 0 0 1 0 3h-1',
  abandoned_checkout: 'M1 4.5h8l-1 4.5H2zM3 4.5a2 2 0 0 1 4 0',
  failed_subscription: 'M1.5 2.5h7v7h-7zM1.5 4.5h7M3.5 1.5v2M6.5 1.5v2',
  overdue_invoice: 'M2.5 1.5h5v8h-5zM4 3.5h2M4 5.5h2M4 7.5h1.5',
};

export interface HouseProps { st: CaseState; x: number; y: number; s: number; i: number; selected: boolean }

export const House = memo(function House({ st, x, y, s, selected }: HouseProps) {
  const c = st.case;
  const label = `${c.customer.name}, ${c.customer.city}. ${KIND_LABEL[c.kind]} of ${rupees(c.amountPaise)}, ${STATUS_LABEL[st.status].toLowerCase()}.`;
  return (
    <g className={`house st-${st.status}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})`} data-case={c.id} tabIndex={0} role="button" aria-label={label}>
      {selected && <ellipse cx="2" cy="4" rx="56" ry="13" className="sel-ring" />}
      <ellipse cx="6" cy="2" rx="46" ry="6.5" fill="rgba(43,34,48,0.16)" />
      <polygon points="26,-34 46,-46 46,-12 26,0" className="h-side" />
      <rect x="-26" y="-34" width="52" height="34" className="h-front" />
      <polygon points="0,-60 20,-72 52,-46 32,-34" fill={ROOF_SHADE[c.kind]} />
      <polygon points="-32,-34 0,-60 32,-34" fill={KIND_COLOR[c.kind]} />
      <path d="M-32,-34 H32 L52,-46" className="h-trim" />
      <path d="M-8,-20 a8,8 0 0 1 16,0 v20 h-16z" className="h-doorframe" />
      <rect x="-6" y="-18" width="12" height="18" className="h-door" />
      <circle cx="3.5" cy="-9" r="1" fill="#e9c27a" />
      <rect x="10" y="-28" width="11" height="10" rx="1" className="h-win" />
      <path d="M15.5,-28 v10 M10,-23 h11" className="h-winbar" />
      <path d={ICONS[c.kind]} transform="translate(-22 -30)" className="h-icon" />
      <rect x="-41.5" y="-30" width="3" height="30" className="h-post" />
      <rect x="-44" y="-31" width="8" height="2" rx="0.5" className="h-post" />
      {st.status === 'escalated' && (
        <g className="pennant">
          <line x1="0" y1="-60" x2="0" y2="-80" className="h-pole" />
          <polygon points="0,-80 14,-75.5 0,-71" className="pennant-flag" />
        </g>
      )}
      {st.status === 'closed' && st.doNotContact && (
        <g className="stop-tag">
          <rect x="-8" y="-16.5" width="16" height="7" rx="1.5" />
          <text x="0" y="-11" textAnchor="middle">STOP</text>
        </g>
      )}
    </g>
  );
});

export const HouseLights = memo(function HouseLights({ st, x, y, s, i }: HouseProps) {
  // Desynchronise flicker per house without per-frame state: a duration in 0.6–1.2s and a negative delay.
  const style = { '--fd': `${(0.6 + ((i * 7) % 7) / 10).toFixed(2)}s`, '--fdl': `-${((i * 13) % 10) / 10}s` } as CSSProperties;
  return (
    <g className={`lantern st-${st.status}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})`} style={style}>
      <rect x="10.5" y="-27.5" width="10" height="9" className="win" />
      <g className="glows">
        {st.status === 'recovered' && <circle cx="-40" cy="-36" r="38" className="halo" />}
        <circle cx="-40" cy="-36" r="21" className="glow" />
      </g>
      <rect x="-46" y="-42" width="12" height="13" rx="1.5" className="glass" />
      <path d="M-40,-40.5 c-2.6,3.2 -2.6,6.4 0,8 c2.6,-1.6 2.6,-4.8 0,-8z" className="flame" />
      {st.status === 'closed' && <polygon points="-49,-42 -40,-49.5 -31,-42 -31,-39.5 -49,-39.5" className="hood" />}
    </g>
  );
});
