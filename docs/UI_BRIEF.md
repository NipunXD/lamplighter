# Lamplighter — UI brief (web/)

## What this is
Lamplighter is an AI revenue-recovery agent for a Razorpay merchant (Saanjh & Co., a Jaipur tea & candle studio).
The UI is a **cozy dusk-time town**. Every customer with money slipping away is a house with a lantern.
A dark lantern is a failed payment / abandoned checkout / failed subscription / overdue invoice.
The agent is a **lamplighter** who walks the streets and relights lanterns — but only within policy:
he stops at 21:00 IST and rests until 09:00 (quiet hours), never knocks more than 3 times, never on DND doors for SMS/calls,
and hands stubborn lanterns to a human (escalation) or hoods them (closed) instead of nagging.
The judges are Razorpay engineers: the town must make the agent's **reasoning, money actions and audit trail legible**, not just look pretty.

## Ground rules
- Stack: Vite + React 19 + TypeScript. Config already exists: `web/vite.config.ts`, root `tsconfig.json` (includes `web/src`). Scripts: `pnpm dev:web` (port 5173, proxies `/api` → 8787), `pnpm typecheck`, `pnpm build`.
- Add a Vite alias `@shared` → `../server` and a matching `paths` entry in tsconfig so the UI imports `import type { RunSnapshot, RunEvent, CaseState, RunMetrics, AuditEvent, LamplighterState, RunConfig, CaseStatus } from '@shared/types'`. Type-only imports — never import server runtime code.
- Only touch `web/`, `tsconfig.json` (paths only) and `package.json` (adding deps only). Do not touch `server/`, `tests/`, `docs/`. Do not `git commit`.
- Read `docs/API.md` (the contract) and `server/types.ts` (the shapes) before writing code.
- Allowed deps: `motion` (framer-motion successor) if you want it; otherwise plain CSS + SVG + CSS animations is preferred. Google Fonts via `<link>` in `web/index.html` is fine: **Fraunces** (display, optical size + soft) and **Nunito** (body).
- Must work fully offline with a mock backend: `http://localhost:5173/?mock=1`. Build `web/src/mock.ts` that fabricates a `RunSnapshot` with ~60 cases (Indian names, the 4 kinds, realistic amounts ₹399–₹1,20,000, the merchant name) and then streams `RunEvent`s over 168 ticks (1 tick = 1 simulated hour starting Mon 07 Sep 2026 09:00 IST, `simStart = '2026-09-07T03:30:00.000Z'`): lanterns changing status, audit events with the exact `actor`/`type` names in docs/API.md, the lamplighter moving to whichever case is being worked, resting between 21:00–09:00 IST. When `?mock=1` is absent, use the real API (`web/src/api.ts`: `GET /api/health`, `POST /api/runs`, `GET /api/runs/:id`, SSE `GET /api/runs/:id/events` with auto-reconnect, `GET /api/runs/:id/cases/:caseId`, `POST .../stop`, `POST .../paid`, `POST .../pause|resume`).
- Verify visually: create `.claude/launch.json` with a config named `web` (`pnpm`, `["dev:web"]`, port 5173) and use the browser preview tools to open `http://localhost:5173/?mock=1`, screenshot, and iterate until it looks polished at 1440×900 and still works at 1100×800. Run `pnpm typecheck` until clean.

## Layout (desktop first, full viewport, no page scroll)
- **Top bar (56px)**: wordmark "Lamplighter" (Fraunces) + tiny subtitle "revenue recovery for Saanjh & Co. · Razorpay test mode". Center: the sim clock — a small arc with sun/moon showing the IST hour, the date, and a pill that reads "Quiet hours · lamplighter resting" at night or "Contact window open" by day. Right: run controls — seed (number), batch size (40/60/120 select), toggles "Local LLM" and "Real Razorpay links", speed (0.5×/1×/4×), and a primary **Light the lamps** button (becomes Pause/Resume while running). Status pills: LLM model name (from /api/health) and Razorpay key mode (`rzp_test_…` → "test mode").
- **Main grid**: left ~62% = the **Town** scene; right ~38% = **Ledger** (top, ~40% height) and **Journal** (bottom, fills the rest). A **Case drawer** slides in over the right column when a house is clicked (Esc / × closes it).
- Below 1100px width: stack town on top (min-height 420px), then ledger and journal.

## The Town (SVG, viewBox about 1200×720)
- Isometric-ish grid: lay `snapshot.cases` out row-major in ~10 columns, alternating rows offset for a village feel, with a winding sand road between rows and a **town well / bench** at the bottom-left where the lamplighter rests at night.
- Sky: a full-bleed gradient that reads the sim hour — deep indigo/plum with stars and drifting fireflies at night, apricot/rose at dusk (18–20h) and dawn (6–8h), pale gold/sky by day. Transition smoothly on every tick (CSS transition on gradient stops or cross-fade two rects). Soft parallax hills/silhouettes at the horizon, a moon or sun that moves along an arc.
- Each **House**: roof polygon (colour by `case.kind`: failed_payment terracotta, abandoned_checkout clay-rose, failed_subscription sage, overdue_invoice slate-blue — Jaipur-pink trims), walls in warm sand, a door, a window that glows when the lantern is lit, and a **lantern post** in front. Tiny kind icon on the wall (cup / basket / calendar / ledger) drawn as simple SVG paths (no icon library needed). Amount shown on hover in a tooltip: name, city, kind, amount, status, root cause.
- **Lantern states** (from `CaseState.status`):
  - `open`: dark glass, no glow.
  - `scheduled`: faint ember, slow 3s pulse (the lamplighter decided to wait — quiet hours or a smart-timed silent retry).
  - `awaiting_customer`: amber flicker (irregular 0.6–1.2s flicker using a couple of keyframes).
  - `recovered`: warm bright glow with a radial gradient + `feGaussianBlur` halo, the window lights up, and a one-shot **coin sparkle** with a rising "+₹1,899" badge.
  - `escalated`: lantern stays dim, a small blue pennant flag on the roof.
  - `closed`: lantern hooded (a little cap over it) and dim; if `doNotContact`, a tiny "STOP" tag on the door.
- **Lamplighter**: a small friendly figure (hat, coat, a pole with a flame). He walks along the road to the house of `lamplighter.caseId` with a 500–900ms ease-in-out transform transition, does a small "lift the pole" animation when a lantern relights, and at night (`lamplighter.resting`) sits at the well with a tiny steam-from-chai animation and a moon over him. A speech-bubble near him shows `lamplighter.activity` (one short line, truncate at ~60 chars).
- Keep it performant to 150 houses: no per-house heavy filters; reuse one `<defs>` glow filter; animate with CSS classes, not React state churn per frame. Use `prefers-reduced-motion` to disable flicker/parallax.

## Ledger (warm paper card)
Big numbers first: **Recovered ₹X of ₹Y at risk** (progress bar), recovery rate by value and by case count, cost per recovered rupee, touches per case, escalated / closed / complaints / STOP requests, incentive spent, cases deferred for quiet hours, real Razorpay links created and real links paid. When `snapshot.baseline` exists, show a compact **"vs naive retry"** comparison row: recovered ₹, complaints, and policy violations (baseline has violations; the agent shows 0). Small "by kind" strip (4 mini bars). All money formatted `₹1,23,456` (Indian grouping).

## Journal (the audit trail, narrated)
A live feed of `AuditEvent`s newest at the bottom (auto-scroll unless the user scrolled up). Render each as one plain-English line with a small actor chip (agent / policy / llm / razorpay / customer / system) and IST time. Examples: policy `candidates_evaluated` → "Policy: 4 of 7 actions allowed — voice call blocked (voice_min_amount), silent retry blocked (no_retry_on_hard_decline)"; razorpay `payment_link_created` → "Razorpay: payment link plink_… for ₹1,899 (link)"; customer `paid` → "Meera paid ₹1,899 · 14h after the WhatsApp nudge"; llm `llm_fallback` → "LLM answer rejected (schema mismatch) — used the rules fallback". Filter chips by actor. Show a hash-chain badge "audit chain ✓ 412 events" that calls `/api/runs/:id/verify` on click (mock: always ok).

## Case drawer
Header: customer name, city, segment, language, DND badge, kind, amount, status pill. Sections:
1. **What happened**: description, Razorpay failure code/reason/description (monospace block), attempts before, days overdue.
2. **Diagnosis**: root cause, confidence bar, source (rules / llm / rules+llm), reasoning; a note if the LLM disagreed with rules.
3. **What the policy allowed**: the latest `candidates_evaluated` payload as a list of candidates with ✓/✗ and failed-rule chips (from the case's audit events).
4. **Touches**: timeline of touches with channel, language, the actual message text, cost, and the Razorpay payment link URL as a clickable link when present.
5. **Outcome**: recovered (via simulated / razorpay), escalated (reason), closed (reason).
6. Buttons (real API only; disabled in terminal states): "Customer replies STOP" → `POST .../stop`; "Mark paid" → `POST .../paid` and show `via`.

## Tone and craft
Cozy, warm, confident. No generic dashboard blue. Paper-and-lantern palette: ink `#2b2230`, paper `#f6efe4`, sand `#e9d8bf`, terracotta `#c96a4a`, jaipur pink `#e58aa0`, lantern amber `#ffb347`, ember `#ff7a1a`, sage `#8aa48b`, slate `#6b7fa3`, night `#1b1638` → `#3b2a5a`, dusk `#f2a65a` → `#d95c7a`. Subtle paper grain via an SVG noise filter at low opacity. Motion is purposeful and short; nothing bounces for no reason. Empty state before a run: the town at dusk, all lanterns dark, a gentle "Press Light the lamps to begin" caption.
