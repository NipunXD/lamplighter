# Lamplighter server API (contract shared by the UI and the batch runner)

Base URL in dev: `http://localhost:8787` (Vite proxies `/api` to it). All sim timestamps are ISO strings; render them in IST.

## Types
Shared TypeScript types live in `server/types.ts` and are imported by the web app as `@shared/types` (Vite alias) — `RunSnapshot`, `RunEvent`, `CaseState`, `RunMetrics`, `AuditEvent`, `LamplighterState`, `RunConfig`.

## Endpoints
| Method | Path | Body / notes | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ ok, llm: { enabled, model }, razorpay: { enabled, keyId } }` |
| GET | `/api/runs` | | `RunSnapshot[]` (without cases/audit, lightweight) |
| POST | `/api/runs` | `Partial<RunConfig>` → `{ seed?: number, size?: number, llm?: boolean, mode?: 'agent'|'baseline', razorpay?: boolean, simDays?: number, chaos?: number, tickDelayMs?: number, withBaseline?: boolean }` | `{ id }` — run starts immediately in the background |
| GET | `/api/runs/:id` | | `RunSnapshot` (full) |
| GET | `/api/runs/:id/events` | Server-Sent Events. First message is `{type:'snapshot'}`, then a stream of `RunEvent`. Each SSE `data:` line is one JSON `RunEvent`. | stream |
| GET | `/api/runs/:id/cases/:caseId` | | `{ state: CaseState, audit: AuditEvent[] }` (all audit events for that case) |
| POST | `/api/runs/:id/cases/:caseId/stop` | simulate the customer replying STOP | `{ ok }` |
| POST | `/api/runs/:id/cases/:caseId/paid` | mark paid. If a real Razorpay order exists the server first looks for a captured/authorized payment on it (capturing if needed); if found the recovery is recorded as `razorpay`, else as `simulated` (manual override, audited). | `{ ok, via }` |
| GET | `/pay/:runId/:caseId` | the self-hosted checkout page every message links to (Razorpay Standard Checkout, test mode) | html |
| POST | `/api/pay/verify` | Checkout handler callback `{ runId, caseId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` → HMAC verified, payment captured, lantern relit | `{ ok, reason? }` |
| POST | `/api/runs/:id/pause` / `/resume` | pacing control for live demos | `{ ok }` |
| GET | `/api/runs/:id/audit.jsonl` | append-only, hash-chained log | text |
| GET | `/api/runs/:id/report.md` | metrics report | markdown |
| GET | `/api/runs/:id/verify` | recompute the hash chain | `{ ok, brokenAt? }` |

## Timelines
`RunSnapshot.timeline` is one `TimelinePoint` per simulated hour (`t, recoveredPaise, recoveredCases, touches, complaints, escalated, closed, awaiting, scheduled`) and `baselineTimeline` the same for the naive-retry run on the same world. Clients can also accumulate from `tick` events, but the snapshot is the source of truth when attaching late.

## Defaults
`seed=7, size=60, llm=true, mode='agent', razorpay=true, simDays=7, chaos=0, tickDelayMs=200, withBaseline=true`.
A tick is one simulated hour. A 7-day run is 168 ticks.

## Case status → lantern state
| status | meaning | lantern |
|---|---|---|
| `open` | not yet diagnosed/acted | dark |
| `scheduled` | agent decided to wait (quiet hours, or a smart-timed silent retry) | faint ember |
| `awaiting_customer` | a message/link/call went out, waiting | amber flicker |
| `recovered` | money came back (`recoveredVia: 'simulated' | 'razorpay'`) | warm bright glow |

Field names: `Touch.orderId` / `Touch.payUrl`; `CaseState.razorpay = { orderId?, recoveryOrderId?, payUrl?, paymentId? }`; `RunMetrics.realRazorpayOrders` / `realRazorpayPaid`.
| `escalated` | handed to a human with a reason | blue flag |
| `closed` | stopping rule reached (STOP, hard no, exhausted) | hooded lantern |

## Audit event types (actor → type)
- system: `run_started`, `run_finished`, `budget_set`
- agent: `case_opened`, `diagnosis`, `plan`, `action_deferred`, `message_composed`, `message_sent`, `call_placed`, `silent_retry_scheduled`, `silent_retry_result`, `escalated`, `closed`, `recovered`, `follow_up_scheduled`
- policy: `candidates_evaluated` (payload: `{ candidates: [{ type, channel, allowed, ev, cost, failed: string[] }] }`)
- llm: `llm_diagnosis`, `llm_plan`, `llm_compose`, `llm_fallback` (payload includes `ms`, `error?`)
- razorpay: `order_created` (payload `{ id, amount, receipt, purpose, payUrl? }`), `order_simulated`, `api_retry`, `api_failed`, `api_degraded`, `circuit_open`, `signature_verified`, `signature_rejected`, `payment_captured`, `payment_link_paid` (the recovery event when paid via Checkout; actor razorpay)
- customer: `paid`, `promise_to_pay`, `stop`, `complaint`, `no_response`
- simulator: `outcome` (internal note; UI may ignore)
