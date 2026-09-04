# Multi-seed evaluation

Ten seeded customer worlds (seeds 1–10), 120 cases each, 14-day window, rules-only agent (model and Razorpay off) against the naive-retry cron on the **same** world. Paired differences are agent − cron with a 95% t-interval (n = 10). Customers are simulated with hidden state the agent never reads; this measures the policy engine and the recovery loop, not the local model (see docs/METRICS.md for a model-on run).

| metric | agent mean ± sd | cron mean ± sd | paired diff [95% CI] | agent better in |
| --- | --- | --- | --- | --- |
| recovered | ₹4,51,722 ± ₹2,32,139 | ₹1,92,890 ± ₹1,31,880 | ₹2,58,832 [₹1,56,604, ₹3,61,061] | 10/10 |
| recovery rate (value) | 41.2% ± 15.1% | 17.6% ± 9.4% | 23.6% [15.3%, 31.9%] | 10/10 |
| cases recovered | 47.7 ± 4.4 | 23.6 ± 4.0 | 24.1 [22.0, 26.2] | 10/10 |
| touches per case | 1.61 ± 0.05 | 2.50 ± 0.06 | -0.89 [-0.94, -0.84] | 10/10 |
| complaints | 16.7 ± 4.1 | 44.8 ± 7.6 | -28.1 [-33.0, -23.2] | 10/10 |
| STOP requests | 12.8 ± 2.1 | 13.7 ± 2.1 | -0.9 [-2.0, 0.2] | 6/10 (3 ties) |
| policy violations | 0.0 ± 0.0 | 352.2 ± 24.7 | -352.2 [-369.8, -334.6] | 10/10 |
| escalated to humans | 9.8 ± 2.3 | 2.5 ± 1.3 | 7.3 [6.2, 8.4] | 10/10 |
| spend | ₹2,137 ± ₹748 | ₹75 ± ₹2 | ₹2,062 [₹1,526, ₹2,597] | 0/10 |

## Per seed
| seed | at risk | agent recovered | cron recovered | agent complaints | cron complaints | agent touches/case | cron touches/case |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ₹10,51,800 | ₹5,01,281 | ₹1,18,073 | 14 | 55 | 1.51 | 2.54 |
| 2 | ₹9,27,282 | ₹3,01,642 | ₹90,836 | 12 | 38 | 1.63 | 2.52 |
| 3 | ₹7,63,320 | ₹2,53,921 | ₹2,01,123 | 21 | 41 | 1.57 | 2.48 |
| 4 | ₹17,12,601 | ₹9,80,144 | ₹5,11,314 | 12 | 37 | 1.62 | 2.38 |
| 5 | ₹11,22,572 | ₹4,67,857 | ₹2,62,650 | 13 | 40 | 1.65 | 2.49 |
| 6 | ₹7,96,735 | ₹5,23,815 | ₹2,51,783 | 16 | 45 | 1.56 | 2.46 |
| 7 | ₹10,74,826 | ₹6,04,485 | ₹1,36,148 | 19 | 55 | 1.62 | 2.53 |
| 8 | ₹9,05,897 | ₹2,22,314 | ₹1,13,930 | 16 | 41 | 1.63 | 2.48 |
| 9 | ₹10,23,978 | ₹2,06,316 | ₹47,084 | 21 | 40 | 1.68 | 2.59 |
| 10 | ₹13,71,425 | ₹4,55,445 | ₹1,95,954 | 23 | 56 | 1.63 | 2.52 |

## Summary
Across ten worlds the agent recovers ₹2,58,832 more than the cron per batch on average (95% CI ₹1,56,604 to ₹3,61,061), winning 10 of 10 seeds. It does so with 1.61 touches per case instead of 2.50, 16.7 complaints instead of 44.8 (fewer in 10 of 10), and 0 policy violations instead of 352. The interval on recovered money excludes zero. The simulator is the same for both arms, so this isolates the value of diagnosis, timing, channel choice and the stopping rules, not of the model.
