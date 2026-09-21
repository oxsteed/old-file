# OxSteed contributor guide

Use this file for current working rules. Start with `README.md` for setup and
`RUNBOOK.md` for operations. Keep this guide short; record package progress and
verification evidence in the relevant document under `docs/`.

## Source of truth

- `client/`: React, TypeScript/JSX, Vite, Tailwind, and the browser interfaces.
- `server/`: Express API, PostgreSQL access, background workers, and tests.
- `server/migrations/`: the only SQL directory read by `server/migrate.js`.
  Inspect existing filenames before assigning a new migration number. Do not
  renumber, replace, or repurpose migrations already applied to a database.
- `docs/archive/`: historical notes and retired root-level code. Do not import
  it, execute its SQL, or treat old status/test-count claims as current evidence.
- Preserve existing uncommitted changes and unrelated work.

## Runtime and deployment

- Production uses this MacBook, Colima, Docker, and Coolify. Use the `colima`
  Docker context explicitly for production inspection; do not start a parallel
  Docker Desktop stack or revive the retired restaurant Node API on port 3001.
- `Dockerfile` builds the web/API image. `docker-compose.coolify.yml` describes
  the production app's network and upload-volume wiring; actual live settings
  are managed in Coolify. `docker-compose.yml` is a legacy configuration with
  development placeholders, not a safe production bootstrap.
- Preserve existing database/Redis volumes, uploads, and local backups. Use
  `scripts/credit-isolated-env.sh` and `docker-compose.credit-test.yml` for
  destructive tests or simulated financial activity, never production.
- Read `/ready` for dependency/worker readiness and `/health` for liveness.
  A healthy old deployment does not prove a new commit deployed successfully.
- Keep secrets out of source, logs, chat output, and browser bundles. Only public
  configuration belongs in `VITE_*`. Keep example environment files empty or
  unmistakably synthetic; put real values in the deployment secret store.
- See `docs/deployment-ci.md` before changing deployment ownership or credentials.

## Implementation conventions

- Follow the surrounding code and established light/dark theme tokens.
- Localize user-visible strings across `en`, `es`, `fr`, `ht`, and `ar`; preserve
  namespace and key parity in both legacy and namespaced locale catalogs.
- Keep authorization, restaurant ownership checks, and validation on the server.
  Preserve idempotency and transactional accounting around financial writes.
- Use existing structured logging and avoid exposing private request data.
- Keep the single realtime/bootstrap lifecycle and graceful shutdown behavior;
  workers start only after required dependencies are ready.
- Prefer focused tests that exercise behavior. Run `npm run build:ci` in `client/`
  for browser changes and the relevant Jest suites in `server/` for API changes.
  Deployment scripts have `node --test scripts/deploy-coolify.test.cjs`.
- The backend prerender tests require an existing client production build.
  Record commands actually run, results, and any missing live verification.
  Compilation, test counts, and historical notes alone do not prove readiness.

## Credit scope and safeguards

- Preserve the complete scope in `docs/oxsteed-credit-code-completion-goal.md` and
  follow `docs/oxsteed-credit-luna-execution-plan.md` when working on that goal.
  Update its requirements matrix with evidence and the next exact action.
- Preserve restaurant wallet isolation, append-only ledger history, production
  activation controls, currency precision, and required operational safeguards.
- Human licensing, provider approvals, agreements, custody, and hardware belong
  to the later launch phase. Continue independent software work and isolated
  verification while documenting unavailable live checks.
- For Credit cards, read `docs/oxsteed-credit-card-ecosystem.md`; verify current
  migration and runtime state instead of assuming the historical source-only
  card implementation was deployed or accepted.

## Historical context

Full prior guides are retained unchanged at
`docs/archive/contributor-guides/AGENTS-2026-09-21.md` and
`docs/archive/contributor-guides/CLAUDE-2026-09-21.md`.
Consult the relevant section only when history is needed; resolve discrepancies
against current source and verified runtime state.
