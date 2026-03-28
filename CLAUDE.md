# CLAUDE.md — OxSteed

> ⚠️ **IMPORTANT FOR AI TOOLS (Claude Code, Copilot, Cursor, etc.)**
>
> This repository is the **current working prototype** built with:
> - **Backend**: Express.js (plain JavaScript, CommonJS)
> - **Database**: PostgreSQL with **raw SQL** (no ORM)
> - **Frontend**: React (JavaScript, not TypeScript) + Vite → deployed to Cloudflare Pages
>
> The "Target Architecture" section further down in this file describes a **future planned rewrite** using Hono (TypeScript) + Drizzle ORM. That version **does not exist yet**.
>
> **When generating code for this repo, use Express.js + plain JS + raw SQL (pg client) unless explicitly told otherwise.**

---

## Business Model
OxSteed is a local home-services marketplace. Customers post jobs. Helpers bid on them. OxSteed takes a fee. We are a BROKER — not an employer. Helpers are independent contractors.

### Three-Tier Model
- **Free Tier** ($0/mo): Helpers can bid on jobs. Appear in search below Pro helpers. Limited to 5 active bids at a time.
- **Pro Tier** ($29.99/mo via Stripe subscription): Unlimited bids. Ranked ABOVE free helpers in search results. Pro badge on profile. Priority in AI matching.
- **Tier 3 — Escrow** (per-job fee): Customer pays OxSteed. OxSteed holds funds. Released to helper on job completion confirmation. Both parties must opt in per job. OxSteed fee: 10% of job value.

### Address Reveal Rule
Customer's address is NEVER shown to a helper until their bid is accepted AND it is within 12 hours of the job start time. This is a safety rule — enforce everywhere.

### Service Categories (10)
Moving, Cleaning, Lawn Care, Handyman, Painting, Plumbing, Electrical, Pet Care, Tutoring, General Labor

### Geography
Launch market: Springfield, Ohio (45501-45506 ZIP codes). All geo-search defaults to 25-mile radius from Springfield center (39.9242, -83.8088).

---

## Current Technical Architecture (What Actually Exists)

> **This is what Claude Code and other AI tools should use when generating or modifying code in this repo.**

### Stack
- **Frontend**: React (JavaScript) + Vite → deployed to Cloudflare Pages
- **Backend**: Express.js (plain JavaScript / CommonJS) → deployed via Coolify on Hetzner CX22, accessed through Cloudflare Tunnel
- **Database**: PostgreSQL 16 — queries written as **raw SQL** using the `pg` (node-postgres) client. No ORM.
- **Auth**: JWT stored in Cloudflare KV. Email/password. Resend for transactional email.
- **Payments**: Stripe Connect (Express accounts for helpers). Stripe Checkout for Pro subscriptions.
- **Background checks**: Checkr API with FCRA adverse action compliance
- **File storage**: Cloudflare R2 (profile photos, invoices)
- **Automation**: n8n on Coolify (timed workflows, AI pipelines)
- **SMS**: Plivo
- **Search**: Meilisearch on Coolify → indexed helper profiles, jobs
- **Monitoring**: Uptime Kuma on Coolify
- **Analytics**: Plausible (self-hosted on Coolify)

### Current Repo Structure
```
oxsteed/
├── CLAUDE.md              ← you are here
├── server/                ← Express.js backend (plain JS)
│   ├── index.js
│   ├── routes/
│   ├── middleware/
│   ├── services/
│   └── db/
│       └── queries/       ← raw SQL helper functions (pg client)
├── client/                ← React frontend (plain JS/JSX)
│   └── src/
│       ├── pages/
│       ├── components/
│       ├── hooks/
│       └── lib/
└── package.json
```

### Coding Rules (Current Stack)
1. **Plain JavaScript (CommonJS).** No TypeScript in this repo yet.
2. **Raw SQL via `pg` client.** No ORM — write SQL directly. Use parameterized queries always (`$1, $2` placeholders). Never concatenate user input into SQL strings.
3. **Functional React components only.** No class components.
4. **No CSS modules or styled-components.** Use Tailwind CSS or plain CSS.
5. **Input validation with express-validator or manual checks.** No Zod in current stack.
6. **Never expose secrets.** No API keys in frontend. Use server-side env vars only.
7. **Address safety rule.** NEVER return customer address to helper unless bid accepted AND within 12 hours of job start.
8. **Broker language.** We are a broker/marketplace, NOT an employer. Use "helper" not "employee". Use "service fee" not "wage".
9. **All monetary values in cents.** Store as integer. Display conversion in frontend.
10. **UTC timestamps.** All dates stored as UTC. Frontend converts to user's local timezone.
11. **Soft deletes.** Use `deleted_at` timestamp instead of hard DELETE for users, jobs, bids.
12. **FCRA compliance.** Background check results must follow adverse action workflow: pre-adverse notice → 5 business day wait → adverse action notice.

---

## API Conventions
- All API routes prefixed with `/api/v1/`
- RESTful: GET (read), POST (create), PATCH (update), DELETE (remove)
- Response format: `{ data: T, error: null }` or `{ data: null, error: { code: string, message: string } }`
- Auth middleware checks JWT on all routes except: POST /auth/register, POST /auth/login, POST /auth/forgot-password, GET /health
- Rate limiting: 100 req/min per IP for public routes, 300 req/min for authenticated

---

## Database Conventions (Raw SQL / pg client)
- All queries use parameterized placeholders (`$1`, `$2`, etc.) — never string interpolation
- All tables have: `id` (UUID, primary key), `created_at` (timestamptz), `updated_at` (timestamptz)
- Soft deletes where appropriate (`deleted_at` timestamptz, nullable)
- Enums implemented as PostgreSQL `CHECK` constraints or `ENUM` types for status fields
- Indexes on all foreign keys and commonly filtered columns

### Core Tables
- **users** — id, email, password_hash, role (customer|helper|admin), first_name, last_name, phone, avatar_url, email_verified, created_at, updated_at, deleted_at
- **helper_profiles** — user_id (FK), bio, hourly_rate, service_categories (text[]), zip_code, latitude, longitude, is_pro, stripe_account_id, background_check_status, avg_rating, total_jobs_completed
- **jobs** — id, customer_id (FK), title, description, category, address, city, state, zip_code, latitude, longitude, budget_min, budget_max, status (draft|open|assigned|in_progress|completed|cancelled|disputed), scheduled_date, created_at
- **bids** — id, job_id (FK), helper_id (FK), amount, message, status (pending|accepted|rejected|withdrawn), created_at
- **reviews** — id, job_id (FK), reviewer_id (FK), reviewee_id (FK), rating (1-5), comment, created_at
- **payments** — id, job_id (FK), payer_id (FK), payee_id (FK), amount, platform_fee, stripe_payment_intent_id, status (pending|held|released|refunded|failed), created_at
- **subscriptions** — id, user_id (FK), stripe_subscription_id, plan (free|pro), status (active|cancelled|past_due), current_period_start, current_period_end
- **notifications** — id, user_id (FK), type, title, body, read, channel (email|sms|push), sent_at

---

## Environment Variables
```env
# Database
DATABASE_URL=postgresql://oxsteed_admin:<PASSWORD>@localhost:5432/oxsteed

# Auth
JWT_SECRET=<random-256-bit>
JWT_EXPIRY=7d

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=

# Resend (email)
RESEND_API_KEY=
FROM_EMAIL=noreply@oxsteed.com

# Meilisearch
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=

# Checkr (background checks)
CHECKR_API_KEY=
CHECKR_WEBHOOK_SECRET=

# Cloudflare R2
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY=
CLOUDFLARE_R2_SECRET_KEY=
R2_BUCKET_NAME=oxsteed-uploads

# Plivo (SMS)
PLIVO_AUTH_ID=
PLIVO_AUTH_TOKEN=
PLIVO_PHONE_NUMBER=

# App
FRONTEND_URL=https://oxsteed.com
API_URL=https://app.oxsteed.com
NODE_ENV=production
```

---

## Domains & URLs
| Service | URL |
|---------|-----|
| Frontend | https://oxsteed.com |
| API | https://app.oxsteed.com/api/v1/ |
| Meilisearch | https://search.oxsteed.com |
| Coolify | https://coolify.oxsteed.com |
| n8n | https://n8n.oxsteed.com |
| Uptime Kuma | https://status.oxsteed.com |
| Analytics | https://analytics.oxsteed.com |

---

## Key Business Rules (enforce in ALL generated code)
1. OxSteed is a broker. Never generate language implying employment relationship.
2. Address reveal: ONLY after bid accepted AND within 12 hours of job start.
3. Pro helpers ALWAYS rank above free helpers in search results, all else being equal.
4. Escrow: both customer and helper must opt in. 48-hour dispute window after job marked complete. Auto-release after 72 hours if customer doesn't respond.
5. Checkr background checks must follow FCRA: pre-adverse action notice → 5 business day wait → adverse action notice if proceeding.
6. Reviews are bidirectional (customer reviews helper AND helper reviews customer). 7-day window to leave review. Helper can respond to review publicly.
7. All financial amounts stored in cents (integers), displayed in dollars.
8. All timestamps stored in UTC, displayed in user's local timezone.

---

## Roadmap (Task List)

| Task | Description | Status |
|------|-------------|--------|
| 1-4 | Infrastructure (Hetzner, Coolify, Cloudflare, services) | ✅ Done |
| 5-7 | GitHub + CI/CD | ✅ Done |
| 8 | PostgreSQL Schema (raw SQL migrations) | 🔜 Week 2-3 |
| 9 | Auth System (JWT, register, login, email verify) | 🔜 Week 2-3 |
| 10 | Job Posting + Browsing | 🔜 Week 4 |
| 11 | Bidding System | 🔜 Week 5 |
| 12 | Meilisearch Integration | 🔜 Week 6 |
| 13 | Stripe Connect (helper payouts) | 🔜 Week 7 |
| 14 | Escrow Payments | 🔜 Week 8 |
| 15 | Pro Subscription (Stripe Checkout) | 🔜 Week 9 |
| 16 | Review System | 🔜 Week 10 |
| 17 | Checkr Background Checks | 🔜 Week 11 |
| 18 | Multi-Channel Notifications (email + SMS) | 🔜 Week 11+ |
| 19 | Legal Pages + SEO | 🔜 Week 13 |
| 20 | Admin Dashboard | 🔜 Week 14 |
| 21 | e2e Automation Workflows (n8n) | 🔜 Week 15-16 |
| 22 | Mobile Responsiveness + PWA | 🔜 Week 17 |
| 23 | Load Testing + Security Audit | 🔜 Week 18 |
| 24 | Launch Prep + Marketing | 🔜 Week 19-20 |

---

## Target Architecture (Future V2 Rewrite — NOT YET BUILT)

> **This section is for planning purposes only. Do NOT use these patterns when generating code for the current repo.**
>
> The plan is to eventually rewrite the backend in Hono (TypeScript) with Drizzle ORM once the prototype is validated. This is a future migration, not the current state.

### Planned V2 Stack
- **Backend**: Hono (TypeScript) → same Coolify/Hetzner infra
- **ORM**: Drizzle ORM (type-safe queries, schema-driven migrations)
- **Frontend**: React + TypeScript + Vite (same Cloudflare Pages)

### Planned V2 Monorepo Structure
```
oxsteed-v2/
├── CLAUDE.md
├── packages/
│   ├── api/               ← Hono backend (TypeScript)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── routes/
│   │       ├── middleware/
│   │       ├── services/
│   │       ├── db/
│   │       │   ├── schema.ts    ← Drizzle ORM schema
│   │       │   └── migrations/
│   │       └── lib/
│   └── web/               ← React frontend (TypeScript)
│       └── src/
│           ├── pages/
│           ├── components/
│           ├── hooks/
│           ├── lib/
│           └── stores/
├── package.json           ← npm workspaces root
└── .github/
    └── workflows/         ← CI/CD
```

### Planned V2 Coding Rules
1. **TypeScript everywhere.** No `any` types. Use `unknown` + type guards if needed.
2. **Drizzle ORM only.** No raw SQL unless Drizzle cannot express the query.
3. **Zod for all input validation.** Every API endpoint validates request body/params with Zod.
4. **Functional components only.** No class components in React.
5. **Tailwind CSS for all styling.**
6. **Error boundaries in React.** Every page-level component wraps in ErrorBoundary.
7. **Sequential migrations.** Name migration files: `001_create_users.sql`, `002_create_jobs.sql`, etc.
