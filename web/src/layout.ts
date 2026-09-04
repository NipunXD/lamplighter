// Pure geometry for the town: where each house stands, where the road winds, and how the sky reads the hour.

export const TOWN_W = 1200;

export interface Spot { x: number; y: number; s: number; row: number; col: number }
export interface TownLayout {
  H: number;
  horizon: number;
  spots: Spot[];
  road: string;
  rows: number;
  cols: number;
  well: { x: number; y: number };
  square: { x: number; y: number };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function tent(x: number, a: number, peak: number, b: number): number {
  if (x <= a || x >= b) return 0;
  return x < peak ? smoothstep(a, peak, x) : 1 - smoothstep(peak, b, x);
}

export interface SkyMix { night: number; dusk: number; dawn: number; sun: { x: number; y: number } | null; moon: { x: number; y: number } | null }

/** Blend weights and celestial positions for an IST hour. Night 21→5, dusk peaks 19, dawn peaks 6.5. */
export function skyMix(hour: number, H: number): SkyMix {
  const h = ((hour % 24) + 24) % 24;
  let night: number;
  if (h >= 21 || h < 5) night = 1;
  else if (h < 7) night = 1 - smoothstep(5, 7, h);
  else if (h >= 19) night = smoothstep(19, 21, h);
  else night = 0;
  const dusk = tent(h, 17, 19, 21);
  const dawn = tent(h, 5, 6.5, 8.5);
  const top = H * 0.06;
  const base = H * 0.34;
  const arc = (t: number) => ({ x: 90 + t * (TOWN_W - 180), y: base - Math.sin(t * Math.PI) * (base - top) });
  const sunT = (h - 5.5) / 14; // rises 05:30, sets 19:30
  const moonT = (((h - 19 + 24) % 24)) / 11.5; // rises 19:00, sets 06:30
  return {
    night, dusk, dawn,
    sun: sunT > 0 && sunT < 1 ? arc(sunT) : null,
    moon: moonT > 0 && moonT < 1 ? arc(moonT) : null,
  };
}

/** Lay `n` houses out row-major, odd rows offset, with a gentle perspective and a serpentine road. */
export function layoutTown(n: number, H: number): TownLayout {
  const horizon = Math.round(H * 0.3);
  const cols = n <= 70 ? 10 : n <= 120 ? 12 : 14;
  const rows = Math.max(1, Math.ceil(n / cols));
  const yTop = horizon + H * 0.13;
  const yBottom = H - 34;
  const rowPitch = rows > 1 ? (yBottom - yTop) / (rows - 1) : 0;
  const spots: Spot[] = [];
  const rowY: number[] = [];
  const rowWidth: number[] = [];
  for (let r = 0; r < rows; r++) {
    const t = rows > 1 ? r / (rows - 1) : 1;
    const persp = 0.8 + 0.2 * t;
    const width = (TOWN_W - 230) * (0.86 + 0.14 * t);
    const colPitch = width / cols;
    const base = Math.min(rowPitch > 0 ? rowPitch / 82 : 1.2, colPitch / 92);
    const s = Math.min(1.25, Math.max(0.5, base)) * persp;
    const y = rows > 1 ? yTop + r * rowPitch : (yTop + yBottom) / 2;
    rowY.push(y);
    rowWidth.push(width);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= n) break;
      const offset = r % 2 ? 0.5 : 0;
      const x = TOWN_W / 2 - width / 2 + (c + 0.5 + offset) * colPitch - colPitch * 0.25;
      spots.push({ x, y, s, row: r, col: c });
    }
  }
  const well = { x: 78, y: H - 46 };
  // Serpentine road: runs just in front of each row, turns at the ends, and ends at the well.
  const parts: string[] = [];
  for (let r = 0; r < rows; r++) {
    const y = rowY[r] + 16;
    const w = rowWidth[r] / 2 + 48;
    const left = TOWN_W / 2 - w;
    const right = TOWN_W / 2 + w;
    const ltr = r % 2 === 0;
    const x0 = ltr ? left : right;
    const x1 = ltr ? right : left;
    if (r === 0) parts.push(`M ${x0} ${y}`);
    parts.push(`L ${x1} ${y}`);
    if (r < rows - 1) {
      const ny = rowY[r + 1] + 16;
      const bulge = ltr ? 46 : -46;
      parts.push(`C ${x1 + bulge} ${y}, ${x1 + bulge} ${ny}, ${x1} ${ny}`);
    }
  }
  const lastY = rowY[rows - 1] + 16;
  const endsLeft = rows % 2 === 0; // even row count: last row ran right→left
  if (endsLeft) parts.push(`C ${TOWN_W / 2 - rowWidth[rows - 1] / 2 - 90} ${lastY}, ${well.x + 60} ${well.y - 20}, ${well.x + 36} ${well.y}`);
  else parts.push(`C ${TOWN_W / 2 + rowWidth[rows - 1] / 2 + 90} ${lastY}, ${TOWN_W / 2} ${H - 14}, ${well.x + 36} ${well.y}`);
  return { H, horizon, spots, road: parts.join(' '), rows, cols, well, square: { x: TOWN_W / 2, y: H - 30 } };
}

/** Deterministic pseudo-random sequence for scenery (stars, fireflies). */
export function scenery(seed: number, count: number): Array<{ x: number; y: number; r: number; d: number }> {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Array<{ x: number; y: number; r: number; d: number }> = [];
  for (let i = 0; i < count; i++) out.push({ x: rnd(), y: rnd(), r: rnd(), d: rnd() });
  return out;
}
