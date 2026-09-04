# The policy the lamplighter works under

All rules live in `server/policy.ts` as pure functions and are unit-tested in `tests/policy.test.ts`.
Every candidate action is evaluated against every applicable rule, and the full check list — passed and failed — is written to the audit log under `candidates_evaluated`.

## Contact rules (apply to payment links, voice calls, incentives, mandate re-auth)
| rule | what it enforces |
|---|---|
| `do_not_contact` | once a customer replies STOP, no customer-facing action and no silent debit either |
| `quiet_hours` | no customer contact 21:00–09:00 IST; the action is **deferred**, not dropped |
| `max_touches` | at most 3 customer-facing touches per case per run |
| `min_gap_between_touches` | at least 20 h between touches |
| `no_repeat_same_touch` | the same action on the same channel at most twice |
| `channel_opt_in` | only channels the customer opted into |
| `dnd_registry` | customers on DND get no SMS and no calls (WhatsApp with opt-in and email remain) |
| `dispute_only_escalate` | a possible dispute is never chased; humans only |
| `b2b_escalation_threshold` | an invoice more than 45 days overdue after one reminder goes to the AR team |
| `positive_expected_value` | cost-bearing actions need EV > 0, where EV = P(recover) × (amount − incentive) − channel cost − goodwill cost |

Goodwill cost = touch index × max(₹5, 1% of the customer's lifetime value). The more we have to lose, the sooner we stop knocking.

## Silent retries
| rule | what it enforces |
|---|---|
| `silent_retry_applicability` | only for insufficient funds, bank downtime, soft card declines — causes a saved instrument or mandate can be re-debited for |
| `no_retry_on_hard_decline` | lost/stolen/closed/do-not-honour: never |
| `has_payment_instrument` | abandoned checkouts and invoices have nothing to retry |
| `max_silent_retries` / `attempt_budget` | at most 2 retries, and touches + retries ≤ 4 |

Retry timing is cause-aware: bank downtime → 3 h later; insufficient funds → the morning after ~36 h (give salary a chance to land); daily card limits → next morning.

## Incentives
`incentive_once`, `incentive_min_amount` (≥ ₹1,000), `incentive_cause_fit` (only when intent is the problem: abandoned checkout, OTP abandoned, UPI timeout, paused mandate — never for insufficient funds), `incentive_budget` (₹15,000 per run), `no_incentive_b2b`, `incentive_not_first_touch` (a plain nudge first).

## Voice
`voice_min_amount` (≥ ₹1,500), plus opt-in and DND. Scripts are Hinglish or English, three sentences, and offer the customer a way to decline.

## Escalation and stopping
`escalation_trigger` allows escalation only with a reason: possible dispute; B2B receivable past threshold; VIP with a hard decline; high-value case (≥ ₹5,000) with automation exhausted. Everything else is **closed** with a reason when nothing has positive expected value, when touches are exhausted, after a STOP, or when the week ends. Closed and escalated cases are listed in the report — the honest exception list.

## The baseline it is compared against
A plain cron: SMS with a link immediately and every 24 h, three times, in English, ignoring quiet hours, DND, hard declines, disputes and STOP. It runs on the same seeded customer world. Its rule violations are counted rather than prevented, so the comparison shows what the policy is worth.
