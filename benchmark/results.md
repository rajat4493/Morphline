# Morphline benchmark

Corpus: 9 synthetic fixtures, labels authored by the product team (unvalidated by external experts).

| System | State accuracy | Pattern accuracy | Unsafe over-reach | p50 ms | p95 ms |
|---|---|---|---|---|---|
| morphline | 100% | 100% | 0% | 1.7 | 2.0 |
| always_max_autonomy | 0% | 0% | 89% | 1.1 | 1.5 |
| always_deterministic | 33% | 33% | 0% | 0.7 | 1.2 |
| ai_presence_heuristic | 89% | 67% | 11% | 0.9 | 1.5 |

Scale: 1000 processes in 1.2s (801/s), single thread, no LLM cost.
