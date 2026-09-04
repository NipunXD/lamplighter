# Week in Review — the analysis layer (brief)

## Why
The town shows *what is happening*; the ledger shows totals. Judges (Razorpay engineers) also want to see *where the money went and why*, over time, against the baseline — the analysis. Build a **Week in Review** panel that answers that in one screen, in the same paper-and-lantern craft as the town.

## Where it lives
- New files only: `web/src/review/WeekInReview.tsx` (the panel), `web/src/review/charts/*.tsx` (one file per chart, plain SVG, no chart library), `web/src/review/review.css`, `web/src/review/data.ts` (pure functions that turn a `RunSnapshot` into chart data — unit-testable, no React). You may also edit `web/src/mock.ts` so the mock produces `timeline` and `baselineTimeline` (one `TimelinePoint` per tick, see `server/types.ts`), and add a test file `tests/review-data.test.ts` for `data.ts`. Do not edit `App.tsx`, `Town.tsx`, `House.tsx`, `layout.ts`, `styles.css`, `Ledger.tsx` — the backend author is editing those concurrently and will wire your component in. Export a single component: `export function WeekInReview(props: { snapshot: RunSnapshot; onClose: () => void; live?: boolean })`. It must render sensibly mid-run (partial data, `live` true) and fully at the end.
- Data contract: `RunSnapshot` from `@shared/types` — `cases: CaseState[]`, `metrics: RunMetrics`, `baseline?: RunMetrics`, `timeline: TimelinePoint[]`, `baselineTimeline?: TimelinePoint[]`, `simStart`, `simEnd`, `config`. Read `server/types.ts` and `docs/API.md`.

## Method (non-negotiable — load the `dataviz` skill first and follow it)
- One axis per chart. Never dual axes. Different scales → small multiples.
- Categorical colors in a FIXED order that matches the town: failed_payment terracotta `#c96a4a`, abandoned_checkout clay-rose `#d97b8a`, failed_subscription sage `#7f9a80`, overdue_invoice slate `#6b7fa3`. Outcome colors match the lanterns: recovered amber `#e0962c`, escalated slate-blue `#5b6fa0`, closed warm grey `#9a8f96`. Agent vs baseline: agent amber `#e0962c`, baseline ink-grey `#7a6a72`. Validate every categorical set with the skill's `scripts/validate_palette.js` against the paper surface `#f6efe4` (light) and fix any FAIL by snapping the step, then record the validator output in a comment at the top of `review/data.ts`.
- Thin marks, 2px lines, ≥8px hover targets, 2px surface gaps between stacked segments, recessive grid, direct labels only where they help, a legend whenever ≥2 series, text in ink tokens never in series color.
- Every chart has a hover layer (crosshair + tooltip on the time chart; per-mark tooltip on bars/ribbons). Every chart has a "table" toggle that shows the same data as an HTML table. Respect `prefers-reduced-motion`.
- Check the result against the skill's `anti-patterns.md` before reporting.

## The screen (paper panel that overlays the town area; header "The week in review · Saanjh & Co." with a close ×; scrolls internally; ~1200px wide max)
1. **Headline strip** — four stat tiles: recovered ₹ of at-risk (with %), cases recovered, complaints, policy violations; each with the baseline value small beneath ("naive retry: ₹1,36,148"). Indian grouping `₹3,41,785`.
2. **Recovery over time** — line/area of cumulative recovered ₹ for agent vs baseline across the window (x = simulated days, ticks at day boundaries labelled "Mon 07", "Tue 08"…), shaded vertical bands for quiet hours (21:00–09:00 IST) so the reader sees the agent pausing at night, crosshair tooltip showing both values and the hour. Use `timeline`/`baselineTimeline`; if the baseline timeline is missing, draw only the agent series (no legend box for one series).
3. **Where the money went** — a three-column flow: case kind → diagnosed root cause → outcome (recovered / escalated / closed), ribbons weighted by ₹ at risk, columns as thin bars with 2px gaps, hover highlights a ribbon and shows ₹ and case count. Compute from `cases` (`case.kind`, `diagnosis.rootCause`, `status`). Draw ribbons as cubic Bézier bands in SVG; keep labels in ink.
4. **Root causes** — horizontal stacked bars per root cause (recovered / escalated / closed counts), sorted by case count, with recovered ₹ as a direct label at the end. Below it, a compact **diagnosis accuracy** pair: rules-only vs rules+LLM (from `metrics.diagnosis`), with the override sentence ("36 overrides · 36 correct").
5. **Agent vs naive retry** — small multiples, one mini chart per metric (recovered ₹, touches per case, complaints, policy violations, spend), each two thin bars agent/baseline, direct-labelled. Hide the section when `baseline` is absent.
6. **Reliability strip** — stat tiles: model calls, fallbacks to rules, avg latency, Razorpay orders, API retries, deferred for quiet hours, audit events with the chain badge.
7. **Actions** — a "Download report (.md)" link to `/api/runs/:id/report.md` and "Audit log (.jsonl)" to `/api/runs/:id/audit.jsonl` (in mock mode, render them disabled with a tooltip).

## Craft
Same fonts (Fraunces headings, Nunito body), same paper card surfaces and grain as the town, generous whitespace, section titles with a one-line plain-English takeaway under each ("The agent recovers steadily through the week; the cron gets most of its money on day one and then annoys people"). Compute takeaways from the data, don't hardcode.

## Verify
Use the offline mock: run `pnpm dev:web` (port 5173, `.claude/launch.json` config `web`) and mount your panel temporarily in a scratch entry if needed — the simplest is to add a `?review=1` handling inside **your own** `WeekInReview` story file `web/src/review/preview.tsx` that renders the panel over a mock snapshot at `http://localhost:5173/review.html` (add `web/review.html` pointing at it). Screenshot at 1440×900, check label collisions, and run `pnpm typecheck` and `pnpm test` until clean. Stop the dev server when done. Report: files, validator output summary, what each chart shows, known rough edges.
