# OxSteed v2 — CLAUDE.md

## Project Overview

OxSteed is a national US community platform connecting customers with local helpers/service providers (jobs, services, gigs). It uses a hybrid broker/marketplace model with a three-tier subscription system.

**Repo:** `oxsteed/old-file` (monorepo)
**Live API:** https://app.oxsteed.com
**Stack:** Node.js (Express) + React + PostgreSQL (PostGIS) + Meilisearch

---

## Monorepo Structure

```
/
├── client/          # React frontend (Vite)
├── server/          # Node.js/Express API
│   ├── migrations/  # SQL migration files (run on startup)
│   ├── routes/      # Express route handlers
│   ├── models/      # Database models
│   ├── middleware/  # Auth, validation, etc.
│   ├── index.js     # App entry point
│   └── migrate.js   # Migration runner
└── .github/
    └── workflows/   # GitHub Actions CI/CD
```

---

## Infrastructure

| Service | URL | Notes |
|---|---|---|
| API | https://app.oxsteed.com | Node.js, port 5000 |
| Coolify | https://coolify.oxsteed.com | Deployment panel |
| n8n | https://n8n.oxsteed.com | Automation workflows |
| Meilisearch | https://search.oxsteed.com | Full-text search |
| OpenPanel | https://analytics.oxsteed.com | Analytics |
| Uptime Kuma | https://status.oxsteed.com | Monitoring |

**Hosting:** Hetzner VPS (hetzner-server) via Coolify v4
**Tunnel:** Cloudflare Tunnel → all subdomains on oxsteed.com
**Access Control:** Cloudflare Access (One-time PIN) protects coolify + n8n

---

## Database

- **Engine:** PostgreSQL 16 with PostGIS 3.4 (`postgis/postgis:16-3.4`)
- **ORM:** Raw SQL via custom migration runner (`server/migrate.js`)
- **Migrations:** Located in `server/migrations/`, applied in filename order on startup
- **IMPORTANT:** The initial schema requires PostGIS — use `postgis/postgis:16-3.4` image, NOT plain `postgres`

---

## Key Environment Variables (server)

```
DATABASE_URL=postgresql://postgres:<password>@<host>:5432/oxsteed
JWT_SECRET=<secret>
RESEND_API_KEY=re_...
MEILISEARCH_URL=http://search.oxsteed.com
MEILISEARCH_API_KEY=<key>
NODE_ENV=production
```

---

## Development

### Server
```bash
cd server
npm install
npm run dev        # nodemon
npm start          # production
```

### Client
```bash
cd client
npm install
npm run dev        # Vite dev server
npm run build      # Production build to client/dist/
```

---

## Deployment

**Auto-deploy:** Push to `main` branch triggers Coolify webhook → rebuild + redeploy.

Coolify config:
- Build pack: Nixpacks
- Base directory: `/server`
- Port: 5000 (internally), proxied through Cloudflare Tunnel on port 80
- Start command: `node migrate.js && node index.js`

---

## Coding Conventions

- **Backend:** CommonJS (`require`/`module.exports`), Express.js, raw SQL
- **Frontend:** React + Vite, functional components, Tailwind CSS
- **Auth:** JWT tokens (access + refresh), stored in httpOnly cookies
- **Migrations:** Sequential numbered SQL files (`001_`, `005_`, `010_`, etc.)
- **Error handling:** Return `{ error: 'message' }` with appropriate HTTP status

---

## Roadmap (Task List)

| Task | Description | Status |
|------|-------------|--------|
| 1-4 | Infrastructure | ✅ Done |
| 5-7 | GitHub + CI/CD | ✅ Done |
| 8 | PostgreSQL Schema (Drizzle ORM) | 🔜 Week 2-3 |
| 9 | Auth System | 🔜 Week 2-3 |
| 10 | Job Posting + Browsing | 🔜 Week 4 |
| 11 | Bidding System | 🔜 Week 5 |
| 12 | Meilisearch Integration | 🔜 Week 6 |
| 13 | Stripe Connect | 🔜 Week 7 |
| 14 | Escrow Payments | 🔜 Week 8 |
| 15 | Pro Subscription | 🔜 Week 9 |
| 16 | Review System | 🔜 Week 10 |
| 17 | Checkr Background Checks | 🔜 Week 11 |
| 18 | Multi-Channel Notifications | 🔜 Week 11+ |
| 19 | Legal Pages + SEO | 🔜 Week 13 |
| 20 | Admin Dashboard | 🔜 Week 14 |
| 21 | n8n Automation Workflows | 🔜 Week 15-16 |
| 22 | PDF Invoicing | 🔜 Week 17 |
| 23 | Security Audit | 🔜 Week 18 |
| 24 | Go Live | 🔜 Week 18 |
