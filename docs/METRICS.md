# Lamplighter run report — `batch_s7_n120_llm`

Seed 7 · 120 cases · 14-day window · local LLM on · Razorpay test-mode orders off · chaos 0 · audit chain ✓ 2425 events

## Money
| metric | Lamplighter agent | naive retry baseline |
| --- | --- | --- |
| at risk | ₹10,74,826 | ₹10,74,826 |
| recovered | ₹3,41,785 | ₹1,36,148 |
| recovery rate (value) | 31.8% | 12.7% |
| recovery rate (cases) | 59/120 (49.2%) | 19/120 (15.8%) |
| spend (channel + incentives) | ₹2,530 | ₹76 |
| cost per recovered rupee | ₹0.007 | ₹0.001 |
| customer touches | 156 (1.30/case) | 304 (2.53/case) |
| complaints | 11 | 55 |
| STOP requests | 15 | 16 |
| policy violations | 0 | 358 |
| escalated to humans | 11 | 3 |
| closed by stopping rule | 50 | 98 |

## By kind
| kind | cases | at risk | recovered | rate |
| --- | --- | --- | --- | --- |
| failed_payment | 53 | ₹82,055 | ₹44,962 | 54.8% |
| abandoned_checkout | 25 | ₹90,350 | ₹38,253 | 42.3% |
| failed_subscription | 25 | ₹30,620 | ₹17,483 | 57.1% |
| overdue_invoice | 17 | ₹8,71,801 | ₹2,41,087 | 27.7% |

## By diagnosed root cause
| root cause | cases | recovered | recovered ₹ |
| --- | --- | --- | --- |
| insufficient_funds | 30 | 20 | ₹28,732 |
| checkout_abandoned | 25 | 9 | ₹38,253 |
| invoice_overdue | 17 | 5 | ₹2,41,087 |
| mandate_paused | 10 | 4 | ₹5,605 |
| otp_abandoned | 9 | 4 | ₹5,301 |
| card_soft_decline | 8 | 6 | ₹7,053 |
| upi_timeout | 7 | 3 | ₹3,285 |
| bank_downtime | 6 | 6 | ₹9,158 |
| card_hard_decline | 4 | 2 | ₹3,311 |
| mandate_revoked | 2 | 0 | ₹0 |
| dispute_risk | 2 | 0 | ₹0 |

## Diagnosis accuracy (against the generator's hidden ground truth)
- rules only: 86/120 (71.7%)
- rules + local LLM on the long tail: 120/120 (100.0%)
- LLM overrides: 36, of which correct 36

## Reliability
- LLM calls 407, fallbacks to deterministic path 9, avg latency 11067 ms
- Razorpay test-mode orders created 0, verified paid on Razorpay 0, API retries 0
- actions deferred for quiet hours 30, incentive spent ₹2,345

## Honesty notes
- Customer behaviour is simulated by a seeded model with hidden state the agent never reads; "recovered" in the batch means the simulated customer paid inside the window. Payments that would land after the window are not counted.
- Every outreach is backed by a real Razorpay **test-mode** Order and a self-hosted checkout page; no notifications are sent because the customers are synthetic. A payment completed through Razorpay Checkout is verified by signature, captured, and recorded separately as `razorpay`.
- The baseline is a plain cron: SMS link at once and every 24h, three times, ignoring quiet hours, DND, hard declines and STOP. Its violations are counted, not prevented.
