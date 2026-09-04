// The lamplighter: a small figure who walks the road (CSS transform transition on the outer group),
// lifts his pole when a lantern relights, and sits at the well with a chai when it's quiet hours.
import { truncate } from '../format';

interface Props {
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  walking: boolean;
  lift: boolean;
  resting: boolean;
  activity: string;
  flipBubble: boolean;
  onArrive(): void;
}

function Standing() {
  return (
    <g className="lp-figure">
      <line x1="-3" y1="-12" x2="-4.5" y2="0" className="leg leg-l" />
      <line x1="3" y1="-12" x2="4.5" y2="0" className="leg leg-r" />
      <path d="M-7,-31 h14 q3,0 3.5,3 l2,17 h-25 l2,-17 q0.5,-3 3.5,-3z" className="coat" />
      <rect x="-7.5" y="-32.5" width="15" height="3.6" rx="1.6" className="scarf" />
      <circle cx="0" cy="-37.5" r="5.2" className="skin" />
      <rect x="-8.5" y="-41.6" width="17" height="2.4" rx="1.2" className="hat" />
      <path d="M-5,-41.6 v-5 q0,-2 2,-2 h6 q2,0 2,2 v5z" className="hat" />
      <line x1="-5" y1="-27" x2="-9" y2="-17" className="arm" />
      <g className="lp-arm">
        <line x1="5" y1="-27" x2="13" y2="-21" className="arm" />
        <line x1="13" y1="-50" x2="13" y2="-6" className="pole" />
        <circle cx="13" cy="-53" r="8" className="lp-glow" />
        <path d="M13,-58 c-3,3.4 -3,7 0,9.2 c3,-2.2 3,-5.8 0,-9.2z" className="flame-lp" />
      </g>
    </g>
  );
}
function Seated() {
  return (
    <g className="lp-figure">
      <line x1="-12" y1="-42" x2="-8" y2="0" className="pole" />
      <circle cx="-12.5" cy="-44" r="6" className="lp-glow" style={{ opacity: 0.35 }} />
      <path d="M-12.5,-47.5 c-2.2,2.6 -2.2,5.2 0,6.8 c2.2,-1.6 2.2,-4.2 0,-6.8z" className="flame-lp" style={{ opacity: 0.6 }} />
      <line x1="-2" y1="-10" x2="8" y2="-10" className="leg" />
      <line x1="8" y1="-10" x2="8.5" y2="0" className="leg" />
      <line x1="1" y1="-10" x2="11" y2="-10.5" className="leg" />
      <line x1="11" y1="-10.5" x2="11.5" y2="0" className="leg" />
      <path d="M-7,-24 h14 q3,0 3,3 v11 h-20 v-11 q0,-3 3,-3z" className="coat" />
      <rect x="-7.5" y="-25.5" width="15" height="3.6" rx="1.6" className="scarf" />
      <circle cx="0" cy="-30.5" r="5.2" className="skin" />
      <rect x="-8.5" y="-34.6" width="17" height="2.4" rx="1.2" className="hat" />
      <path d="M-5,-34.6 v-5 q0,-2 2,-2 h6 q2,0 2,2 v5z" className="hat" />
      <line x1="5" y1="-20" x2="12" y2="-16" className="arm" />
      <g className="chai">
        <rect x="11" y="-19" width="5.5" height="5" rx="1" className="cup" />
        <path d="M12.5,-20.5 q1.2,-2.5 0,-5" className="steam" />
        <path d="M14.5,-21 q-1.2,-2.5 0,-5" className="steam" />
        <path d="M13.5,-21.5 q1,-3 0,-6" className="steam" />
      </g>
    </g>
  );
}

export function Lamplighter({ x, y, scale, facing, walking, lift, resting, activity, flipBubble, onArrive }: Props) {
  const text = truncate(activity, 60);
  const w = Math.max(40, Math.round(text.length * 6.1 + 18));
  const bubbleX = flipBubble ? -w - 12 : 12;
  return (
    <g
      className={`lp${walking ? ' walking' : ''}${lift ? ' lift' : ''}${resting ? ' resting' : ''}`}
      style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` }}
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === 'transform') onArrive(); }}
    >
      <ellipse cx="0" cy="1" rx={11 * scale} ry={3 * scale} className="lp-shadow" />
      <g className="lp-body" style={{ transform: `scale(${facing * scale}, ${scale})` }}>
        {resting ? <Seated /> : <Standing />}
      </g>
      {text && (
        <g className="lp-bubble" transform={`translate(${bubbleX} ${-56 * scale - 28})`}>
          <rect width={w} height="22" rx="8" />
          <polygon points={flipBubble ? `${w - 16},21 ${w - 6},21 ${w - 2},28` : '6,21 16,21 2,28'} />
          <text x="9" y="15">{text}</text>
        </g>
      )}
    </g>
  );
}
