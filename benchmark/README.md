# Benchmark

`python -m benchmark.run --scale 1000 --out benchmark/results.md`

## Limits (read before quoting any number)
- 9 synthetic fixtures that the engine was **developed against**; 100% here is a
  regression floor, not evidence of real-world accuracy.
- Labels were written by the product team, not independent experts.
- Baselines are naive stand-ins for an approach, not measurements of any vendor.
- No competitor product has been run. Do not publish comparative claims until
  real sanitized exports + expert labels + competitor runs exist.

## Next
1. Collect >=50 sanitized real exports; have 2+ automation architects label independently (report inter-rater agreement).
2. Hold out a test split the engine is never tuned on.
3. Add a single-prompt LLM baseline.
