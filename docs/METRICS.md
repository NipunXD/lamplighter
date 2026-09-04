# Lamplighter run report — `batch_s7_n120_llm`

Seed 7 · 120 cases · 7-day window · local LLM on · Razorpay test-mode orders off · chaos 0 · audit chain ✓ 2594 events

## Money
| metric | Lamplighter agent | naive retry baseline |
| --- | --- | --- |
| at risk | ₹10,74,826 | ₹10,74,826 |
| recovered | ₹1,73,393 | ₹1,36,148 |
| recovery rate (value) | 16.1% | 12.7% |
| recovery rate (cases) | 51/120 (42.5%) | 19/120 (15.8%) |
| spend (channel + incentives) | ₹1,109 | ₹76 |
| cost per recovered rupee | ₹0.006 | ₹0.001 |
| customer touches | 177 (1.48/case) | 304 (2.53/case) |
| complaints | 14 | 55 |
| STOP requests | 15 | 16 |
| policy violations | 0 | 358 |
| escalated to humans | 14 | 3 |
| closed by stopping rule | 55 | 98 |

## By kind
| kind | cases | at risk | recovered | rate |
| --- | --- | --- | --- | --- |
| failed_payment | 53 | ₹82,055 | ₹42,727 | 52.1% |
| abandoned_checkout | 25 | ₹90,350 | ₹33,676 | 37.3% |
| failed_subscription | 25 | ₹30,620 | ₹12,366 | 40.4% |
| overdue_invoice | 17 | ₹8,71,801 | ₹84,624 | 9.7% |

## By diagnosed root cause
| root cause | cases | recovered | recovered ₹ |
| --- | --- | --- | --- |
| insufficient_funds | 30 | 19 | ₹27,332 |
| checkout_abandoned | 25 | 10 | ₹33,676 |
| invoice_overdue | 17 | 2 | ₹84,624 |
| mandate_paused | 10 | 3 | ₹4,187 |
| otp_abandoned | 9 | 3 | ₹3,941 |
| card_soft_decline | 8 | 5 | ₹6,533 |
| upi_timeout | 7 | 2 | ₹2,333 |
| bank_downtime | 6 | 6 | ₹9,158 |
| card_hard_decline | 4 | 1 | ₹1,609 |
| mandate_revoked | 2 | 0 | ₹0 |
| dispute_risk | 2 | 0 | ₹0 |

## Diagnosis accuracy (against the generator's hidden ground truth)
- rules only: 86/120 (71.7%)
- rules + local LLM on the long tail: 120/120 (100.0%)
- LLM overrides: 36, of which correct 36

## Reliability
- LLM calls 456, fallbacks to deterministic path 8, avg latency 8055 ms
- Razorpay test-mode orders created 0, verified paid on Razorpay 0, API retries 0
- actions deferred for quiet hours 41, incentive spent ₹986

## Honesty notes
- Customer behaviour is simulated by a seeded model with hidden state the agent never reads; "recovered" in the batch means the simulated customer paid inside the window. Payments that would land after the window are not counted.
- Every outreach is backed by a real Razorpay **test-mode** Order and a self-hosted checkout page; no notifications are sent because the customers are synthetic. A payment completed through Razorpay Checkout is verified by signature, captured, and recorded separately as `razorpay`.
- The baseline is a plain cron: SMS link at once and every 24h, three times, ignoring quiet hours, DND, hard declines and STOP. Its violations are counted, not prevented.
