# Smoke fixtures

`smoke.jsonl` is a small set of clearly synthetic labelled items. Every
line carries a `"_synthetic": true` marker. These items exist only to
prove the evaluation harness in `../runner.js` runs end to end: dataset
loading, rule scoring, the closed candidate list, the Ollama call shape,
metric computation and gate evaluation.

They are NOT the gold evaluation set described in design spec section
8.5 (300 reviewed items per vertical per language). No item here was
reviewed as gold data, and no quality-bar conclusion can be drawn from
results on this file. In particular, the seeded taxonomy in migration
921 only carries keyword rules for `services.plumbing.drain_clog`, so
items labelled with the other seeded codes are expected to land in
review until real rules, real model behaviour and gold data exist.
