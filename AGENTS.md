# AGENTS.md

## Cursor Cloud specific instructions

### Architecture
OxSteed is a monorepo with two independent npm packages:
- **`client/`** — React (Vite) SPA on port 3000, proxies `/api` to the backend
- **`server/`** — Node.js/Express API on port 5000

See `CLAUDE.md` for full project overview, coding conventions, and domain concepts.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Backend | `cd server && npm run dev` | 5000 | Uses nodemon; auto-restarts on file changes |
| Frontend | `cd client && npm run dev` | 3000 | Vite HMR; proxies `/api` → `localhost:5000` |
| PostgreSQL | `sudo pg_ctlcluster 16 main start` | 5432 | Must be running before backend starts |

### Database
- PostgreSQL runs locally. DB name: `oxsteed`, user: `oxsteed`, password: `oxsteed_dev`.
- Connection string: `postgres://oxsteed:oxsteed_dev@localhost:5432/oxsteed`
- Run migrations: `cd server && npm run migrate`
- The initial schema migration (`001_initial_schema.sql`) requires the **PostGIS** extension (`postgresql-16-postgis-3`).
- Some later migrations (e.g. `001_onboarding_tiers_tier3.sql`, `023_*`) have schema conflicts with the initial migration. After a fresh DB setup, you may need to manually apply missing columns or seed data — check server logs for `relation does not exist` errors.

### Environment variables
- `server/.env` holds all backend config. Copy from `server/.env.example` for a fresh setup.
- VAPID keys must be left **blank** (not placeholder strings) to disable push notifications gracefully. Setting them to non-empty invalid values crashes the server.
- External service keys (Stripe, Twilio, Resend, AWS S3, Didit, Google Maps) can be placeholder/empty for basic dev — the server logs warnings but still starts.
- Redis is **not required** for local dev. The rate limiter uses in-memory storage.

### Gotchas
- No lock files are committed. `npm install` resolves fresh each time.
- No lint or test scripts are configured in either `package.json`. Build verification: `cd client && npm run build`.
- The `feature_flags` table has column `is_enabled` (not `enabled` as some migrations expect). Migration 023 may fail on the INSERT for feature_flags — use `is_enabled` column if running manually.
- The `feeService.js` queries `platform_settings` on import. If that table is missing, the server still starts but logs an error.
- The Vite dev server runs on port **3000** (set in `vite.config.js`), not the default 5173.
