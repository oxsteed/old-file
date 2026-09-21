# OxSteed

[OxSteed](https://oxsteed.com) connects people with local service providers and
independently operated restaurants. This repository contains the shared web
application and API for customer journeys, business workspaces, restaurant
operations, support, and restricted stored-value Credit. Restaurants on the
platform operate their own businesses; listing them does not imply OxSteed owns
them.

## Repository map

| Path | Purpose |
| --- | --- |
| `client/` | React 18, TypeScript/JSX, Vite, Tailwind, and five-language UI |
| `server/` | Node.js 22, Express, PostgreSQL/PostGIS, Redis, and Socket.IO |
| `server/migrations/` | SQL applied by the migration runner |
| `scripts/` | Deployment, backups, restoration, and isolated verification |
| `docs/` | Feature specifications, acceptance evidence, and operating guides |
| `docs/archive/` | Historical reference files excluded from the running app |

There is no root npm package. Run npm commands in `client/` or `server/`.
See [AGENTS.md](AGENTS.md) for contributor conventions.

## Local development

Use Node.js 22 and npm. The API needs a separate development PostgreSQL database
with PostGIS available and Redis for shared worker/locking behavior. Do not use
the production database for development or test fixtures.

Install locked dependencies from the repository root:

```sh
npm --prefix client ci
npm --prefix server ci
```

Use `server/.env.example` as the environment reference and create an ignored
`server/.env` for the development database. The template defaults to production;
set `NODE_ENV=development` locally. Configure:

- `DATABASE_URL` for the development PostgreSQL database and `REDIS_URL` for its
  development Redis instance.
- A generated `JWT_SECRET` of at least 32 characters and a generated
  `ENCRYPTION_KEY` of exactly 64 hexadecimal characters.
- Stripe sandbox credentials for payment development, never live credentials.
  Startup requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` even when a
  particular development journey does not use payments.
- `CORS_ORIGINS=http://localhost:3000`, `CLIENT_URL=http://localhost:3000`,
  `APP_URL=http://localhost:3000`, and `PORT=5000`.

Start the API in one terminal:

```sh
cd server
npm run migrate
npm run dev
```

Start the client in another terminal:

```sh
cd client
npm run dev
```

Open `http://localhost:3000`. Vite proxies `/api` to `http://localhost:5000` by
default. `client/.env.example` documents optional browser configuration; local
overrides belong in ignored `client/.env.local`. Never place private API keys in
`VITE_*` variables, which become public browser code.

## Docker and isolated verification

On the current MacBook, Docker runs in Colima. The existing isolated harness uses
Compose with separate PostgreSQL/Redis volumes and a random loopback API port:

```sh
docker context use colima
bash scripts/credit-isolated-env.sh start
bash scripts/credit-isolated-env.sh seed
bash scripts/credit-isolated-env.sh test
```

The harness prints the local API URL. `down` removes only that disposable
environment and its volumes; `reset` recreates it. These commands are for
synthetic verification, not production recovery.

`Dockerfile` builds the combined client/API production image.
`docker-compose.coolify.yml` records the production app wiring managed by
Coolify. The older `docker-compose.yml` has development placeholder credentials
and fixed container names; do not use it to start or replace production.

## Checks

```sh
node --test scripts/deploy-coolify.test.cjs
cd client
node --test scripts/*.test.mjs
npm run build:ci
cd ../server
npm test
npm run test:active-job-statuses
```

Build the client before running backend tests that inspect prerendered assets.
Database-dependent verifiers require a configured isolated environment; mocked
unit tests do not replace migration, restore, concurrency, or live-provider checks.

## Deployment and operations

The production website runs on the MacBook using Colima and Coolify. Keep backups
locally for now, as documented in the production runbook. GitHub's default branch
is `old-files-claude`; changing it requires coordinating CI and Coolify settings.

- [CI and Coolify deployment](docs/deployment-ci.md): credentials, target
  verification, deployment ownership, and known integration work.
- [Runbook](RUNBOOK.md): readiness, incidents, migrations, and recovery.
- [Production readiness](PRODUCTION_READINESS.md): configuration and checks.
- [Credit production runbook](docs/oxsteed-credit-production-runbook.md): Credit
  operations, activation safeguards, and incident handling.
- [Credit completion scope](docs/oxsteed-credit-code-completion-goal.md) and
  [execution plan](docs/oxsteed-credit-luna-execution-plan.md): agreed engineering
  requirements and evidence.

Keep actual credentials in Coolify/GitHub secrets or ignored local files.
Historical snapshots and test counts are not a production-readiness declaration.
