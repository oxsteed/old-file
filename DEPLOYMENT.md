# OxSteed Production Deployment Guide

This document covers deploying OxSteed to production.

## Quick Start (Docker)

### Prerequisites
- Docker & Docker Compose installed
- PostgreSQL database (or use included docker-compose)
- Redis instance (or use included docker-compose)
- All required environment variables (see below)

### Local Development with Docker Compose

```bash
# Start all services (PostgreSQL, Redis, Node.js app)
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

The app will be available at `http://localhost:5000`.

## Environment Variables (Required)

These MUST be set before starting the server. The app will exit immediately with clear error messages if any are missing.

```env
# Core Authentication
JWT_SECRET=<at least 32 random characters>
ENCRYPTION_KEY=<exactly 32 bytes, base64 or hex>

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Stripe Payment Processing
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...  # For Tier 3 payments

# URLs
CLIENT_URL=https://yourdomain.com  # Frontend URL (for password reset links, CORS)
APP_URL=https://yourdomain.com     # Public-facing domain
```

## Environment Variables (Optional — Gracefully Disabled)

If not set, features degrade gracefully:

```env
# File Storage (defaults to base64 in DB if unset)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=

# Email (defaults to no-op if unset)
RESEND_API_KEY=

# SMS/OTP (defaults to no-op if unset)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Identity Verification (skippable if unset)
DIDIT_API_KEY=
DIDIT_WEBHOOK_SECRET=

# AI Chat (falls back to limited Ollama if unset)
OPENAI_API_KEY=
OPENROUTER_API_KEY=

# Analytics (consent-gated, safe to omit)
VITE_GA_MEASUREMENT_ID=
VITE_META_PIXEL_ID=

# Distributed Rate Limiting (falls back to in-memory if unset)
REDIS_URL=redis://host:6379/0

# Web Push Notifications (fully optional)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:support@yourdomain.com
```

## Production Deployment

### Option 1: Coolify (Recommended)

1. **Create repository** in Coolify
2. **Set environment variables** in Coolify secrets (dashboard)
3. **Configure build** to use provided `Dockerfile`
4. **Deploy** — migrations run automatically on startup

### Option 2: Docker Registry (AWS ECR, Docker Hub, etc)

```bash
# Build image
docker build -t oxsteed:latest .

# Tag for registry
docker tag oxsteed:latest your-registry/oxsteed:latest

# Push
docker push your-registry/oxsteed:latest

# Run on server
docker run \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... \
  -e STRIPE_SECRET_KEY=... \
  -p 5000:5000 \
  your-registry/oxsteed:latest
```

### Option 3: Manual Node.js (Not Recommended)

```bash
cd server
npm ci --omit=dev
DATABASE_URL=... JWT_SECRET=... npm start
```

## Database Migrations

Migrations run **automatically** on server startup. They are idempotent — safe to run multiple times.

To manually apply migrations:
```bash
npm run migrate
```

Current migration count: 113 total

## Health Checks

The app exposes a `/health` endpoint for load balancers:

```bash
curl http://localhost:5000/health
# Returns: { "status": "ok" }
```

Docker health check is configured in Dockerfile; Coolify will detect it automatically.

## Monitoring & Logs

Structured JSON logging to stdout/stderr (compatible with Datadog, Logtail, Papertrail):

- **Info** level: request logs, business events
- **Warn** level: recoverable issues (missing optional env vars, email send failures)
- **Error** level: failures (DB errors, Stripe API failures)

Configure via `LOG_LEVEL` env var (default: `info` in production, `debug` in development).

## Security Checklist

- [ ] Set strong `JWT_SECRET` (min 32 chars, use `openssl rand -base64 32`)
- [ ] Set strong `ENCRYPTION_KEY` (use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] Enable HTTPS at load balancer
- [ ] Configure CORS allowed origins
- [ ] Verify Stripe Connect is enabled on Stripe dashboard (for Tier 3 payments)
- [ ] Restrict database access to app server IP only
- [ ] Use dedicated database user with minimal permissions
- [ ] Enable Redis password authentication if exposed
- [ ] Configure rate limiting: `REDIS_URL` should point to Redis instance (built-in fallback to in-memory)
- [ ] Rotate refresh tokens regularly (configured in code, no env var needed)

## First-Time Verification

After deployment, verify these flows work end-to-end:

1. **Public browse**: Visit `/`, `/helpers`, `/jobs`, `/discover` — no auth required
2. **Sign up (customer)**: Register, verify email, complete Didit verification
3. **Sign up (helper)**: Register, verify email, complete Didit verification, access helper dashboard
4. **Login**: Existing user can log back in
5. **Post job**: Customer can post a job and see it listed
6. **Message helper**: Customer can message a helper (or helper message customer)
7. **Payment**: Tier 1 payment intent creation succeeds (Stripe keys valid)

## Scaling

### Single Instance (Default)
- Works for up to ~50 concurrent users
- Database connection pool: 10 (configurable via `DB_POOL_MAX`)
- Rate limiting: in-memory (only works on this instance)

### Multiple Instances
- Add `REDIS_URL` pointing to shared Redis — rate limiting becomes distributed
- Use load balancer to distribute requests
- Database connection pooling is per-instance

### Payment Queue (Async Payments)
- Optional: set `PAYMENT_CAPTURE_ASYNC=true` to process Stripe captures via Bull queue
- Requires `REDIS_URL` to be configured
- Worker process: `npm run worker` (or configure via Docker/supervisor)

## Troubleshooting

### Server Won't Start
Check logs for missing environment variables. The app exits with a clear error message.

### "Email verification required" but user verified email
Clear browser localStorage (tokens cached) and log in again.

### "Identity verification required" but user verified with Didit
The webhook may have failed to fire. Check Didit webhook logs. User can manually trigger refresh from `/verify-identity` page.

### Payment intent fails
1. Verify `STRIPE_SECRET_KEY` is set and valid
2. Verify `STRIPE_WEBHOOK_SECRET` is set and matches Stripe dashboard
3. Check Stripe dashboard for webhook failures (Developertools → Webhooks)

### Migrations fail on existing database
All migrations are idempotent. Run `npm run migrate` to check the `_migrations` table — if a migration is marked as applied but the schema is missing, check the migration file for conditional CREATE IF NOT EXISTS statements.

## Rolling Back

Migrations are designed to be forward-compatible. To roll back:

1. Stop the app
2. Manually revert the last applied migration in `_migrations` table
3. Revert the corresponding migration file
4. Restart

Note: Data may have been transformed in the new schema; ensure you have a database backup before rolling back.

## Support

For issues, check:
- Server logs via `docker-compose logs app` or your deployment platform's log viewer
- Structured error messages in logs (correlation IDs help trace requests)
- Stripe dashboard for webhook failures
- `/health` endpoint is returning 200 OK
- Database connectivity: `psql $DATABASE_URL -c "SELECT 1"`
