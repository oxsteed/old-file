# OxSteed scale harness (V2-P1-05)

Node-based load and soak harness modeling slices of the 6M-user / 3,500-staff
scale model from the Enterprise Operations Audit V2. Zero dependencies beyond
the Node standard library, so it runs from a bare checkout and in CI.

## What it is

- `scaleModel.cjs` — the scale model: regions with workload skew, persona
  mix, and the derivation from 6M registered users to peak concurrent
  sessions and requests per second.
- `scenarios.cjs` — the scenario catalog. Every path is a real route mounted
  in `server/index.js`. Covers the audit's list: load, browse, search,
  websocket fanout, uploads, food ordering, delivery tracking, wallet/credit,
  payments, support, exports, and staff admin operations.
- `slos.cjs` — per-scenario latency and error budgets with owner and runbook
  pointers.
- `fixtures.cjs` — deterministic synthetic fixture generator (model JSON,
  JSONL samples, scratch-table `seed.sql`). Same seed always yields
  byte-identical files.
- `harness.cjs` — the runner: staged VU ramp (k6-style), weighted scenario
  mixing, per-VU regional latency simulation, keep-alive HTTP, a minimal
  Socket.IO websocket client, SLO evaluation, JSON + Markdown reports.
- `report.cjs`, `stats.cjs`, `httpClient.cjs`, `wsClient.cjs` — internals.

## Quickstart

```bash
# 1. Fixtures (samples only; the full 6M-row materialization is an operator step)
node scripts/scale/fixtures.cjs --seed 42 --out scale-fixtures

# 2. Smoke against a local target
node scripts/scale/harness.cjs --target http://localhost:5000 --profile smoke

# 3. Load run (5 minutes, 50 VUs)
node scripts/scale/harness.cjs --target http://localhost:5000 --profile load

# 4. Soak run (30 minutes, 50 VUs)
node scripts/scale/harness.cjs --target http://localhost:5000 --profile soak

# 5. Spike run
node scripts/scale/harness.cjs --target http://localhost:5000 --profile spike

# 6. Authenticated run (unlocks messaging, wallet, upload, export, admin scenarios)
export OXSTEED_SCALE_USER_TOKEN=... OXSTEED_SCALE_ADMIN_TOKEN=...
node scripts/scale/harness.cjs --target http://localhost:5000 --profile load

# 7. Regional latency simulation (adds each region's modeled RTT client-side)
node scripts/scale/harness.cjs --target http://localhost:5000 --profile load --region-latency model
```

Reports land in `scale-reports/` as `scale-report-<timestamp>.json` and `.md`.
Exit code is 0 when every SLO holds, 2 when any SLO breaches, 1 on harness
errors.

## Safety rules

- `--target` is required. Targets that are not localhost (or `*.test`,
  `*.local`, `*.example`) are refused unless `--confirm-remote` is passed.
  Live runs against real infrastructure are an operator decision; this tool
  never starts one on its own.
- AI-spending steps (`POST /api/chat/message`) are excluded unless
  `--include-ai` is passed, to protect provider budget.
- Auth-gated steps are skipped (counted in the report, never failed) when no
  token is supplied.
- The upload scenario posts a synthetic 64KB buffer; it never reads user
  files. Fixture SQL targets scratch tables named `scale_fixture_*` and is
  labeled test-only.

## Reading a report

- **Verdict**: PASS means the target held this slice of modeled traffic
  within SLO for the run duration. It does not prove 6M-user capacity.
- **Coverage**: the report states what fraction of modeled peak concurrency
  the VU count represents and the linear extrapolation factor. Extrapolation
  is a planning input, not proof.
- **Failures** are 5xx, timeouts, and connection errors. Other 4xx are
  tracked separately as client responses; expect many of them until the
  target database is seeded with fixtures.
- **Skipped** steps mean the run lacked a token (or `--include-ai`).

## Scale model

6M users at 2% peak online gives 120,000 concurrent user sessions; 3,500
staff at 35% peak online gives 1,225 concurrent staff sessions. At ~20s mean
think time that is roughly 6,060 req/s at peak. The harness runs a slice
(e.g. 50 VUs) and the report extrapolates. See `scaleModel.cjs` for the
per-region breakdown and traffic mix.

## CI

`scale-harness.test.cjs` runs with `node --test` and is wired into
`.github/workflows/ci.yml`. It spins stub HTTP and WebSocket servers, so no
live target is needed: catalog validity, fixture determinism, percentile
math, SLO evaluation, the remote-target safety gate, and an end-to-end smoke
run are all covered.

## Operator runbook (live runs are Emile-side)

1. Seed a staging database with `fixtures.cjs` output (extend the sample
   counts for the slice under test; full 6M materialization only on
   purpose-built perf hardware).
2. Start from `smoke`, then `load`, then `soak`. Promote only on PASS.
3. Failure drills the harness does not automate: kill -STOP a worker,
   drop the Redis link, exhaust a provider quota in sandbox, restore from
   backup, then re-run `load` and compare reports.
4. Record each production-scale run's report path as audit evidence.
