# OxSteed — Caretaker's Guide to the Website

> **Purpose of this document:** This is a plain-language explanation of the OxSteed website, written so that someone with little or no technical background can understand what the site is, how it works, and what to do if they need to keep it running in my absence. Read it top to bottom once. Then keep it bookmarked.
>
> **Last updated:** April 27, 2026

---

## Table of Contents

1. [What OxSteed Is, in One Page](#1-what-oxsteed-is-in-one-page)
2. [The Big Picture — How a Website Like This Works](#2-the-big-picture--how-a-website-like-this-works)
3. [The Three Audiences and What They See](#3-the-three-audiences-and-what-they-see)
4. [Where Everything Lives (the Code Repository)](#4-where-everything-lives-the-code-repository)
5. [The Outside Services OxSteed Depends On](#5-the-outside-services-oxsteed-depends-on)
6. [Money — How Payments Flow Through the Site](#6-money--how-payments-flow-through-the-site)
7. [The Admin Panel — Your Control Room](#7-the-admin-panel--your-control-room)
8. [How the Site Gets Updated and Deployed](#8-how-the-site-gets-updated-and-deployed)
9. [If Something Goes Wrong — A Triage Playbook](#9-if-something-goes-wrong--a-triage-playbook)
10. [Important Accounts, Logins, and Where the Keys Live](#10-important-accounts-logins-and-where-the-keys-live)
11. [Hiring a Developer to Take Over](#11-hiring-a-developer-to-take-over)
12. [Glossary of Terms](#12-glossary-of-terms)

---

## 1. What OxSteed Is, in One Page

**OxSteed is an online marketplace for local trades and services.** Think of it like a cross between Thumbtack, TaskRabbit, and Angi, focused on connecting customers with local helpers (handymen, contractors, consultants, tool renters, and small businesses).

The site does five main things:

1. **Posts jobs.** A customer types in what they need done ("fix my fence", "tutor my child in math", "rent a pressure washer for the weekend"), and the site collects bids from helpers nearby.
2. **Connects people.** Helpers send bids; customers and helpers chat through the site to agree on details.
3. **Handles money.** When a job is accepted, the customer's payment is held safely (by Stripe, our payment processor) until the job is done, then released to the helper. OxSteed takes a small fee on top.
4. **Verifies trust.** Helpers can get their identity verified, get a background check, and earn ratings and reviews.
5. **Offers extra services.** There are also tool rentals, business profile pages, scheduled consulting sessions, planned-needs (recurring jobs), and a "business launch" service that helps people start a small business.

It is one website that serves three kinds of people: **customers**, **helpers/businesses**, and **admins** (you and any staff).

---

## 2. The Big Picture — How a Website Like This Works

Any modern website like OxSteed has three parts that talk to each other:

### Part A — The Frontend (what people see in their browser)

This is the visual website itself: the homepage, the buttons, the forms, the photos. It runs inside the user's web browser (Chrome, Safari, etc.). It is built with a tool called **React**.

When someone types `oxsteed.com` into their browser, the frontend is what loads first. It's just files (HTML, JavaScript, CSS) being served from our server.

### Part B — The Backend (the brain on the server)

When someone clicks "Post a Job" or "Login", the frontend sends a message to the backend asking it to do something. The backend is the part that actually thinks, checks rules, and saves things. It's a program written in **Node.js + Express** that runs 24/7 on a server we rent.

The backend does things like:

- "Is this person allowed to log in?"
- "Save this new job to the database."
- "Send a text message to the helper saying they got a new bid."
- "Tell Stripe to charge this credit card."

### Part C — The Database (the filing cabinet)

This is where every piece of information is permanently stored: every user account, every job, every message, every payment. It's a **PostgreSQL** database. The backend reads from it and writes to it constantly.

### How they fit together

```
[ Browser / Phone ]  ←→  [ Frontend (React) ]
         ↓ (API calls over the internet)
[ Backend (Node.js) ]
         ↓
[ Database (PostgreSQL) ]   [ Stripe, Twilio, AWS, etc. ]
```

Everything you'll ever need to fix on this site lives in one of those three boxes.

---

## 3. The Three Audiences and What They See

The website automatically shows different pages to different people depending on who is logged in.

### Customers (the public)

These are regular people looking to hire help. They see:

- **Homepage**, About, How It Works, public Helper directory
- **Sign up / Login**
- **Post a Job** — a multi-step form to describe what they need
- **My Jobs** — a dashboard showing their open and completed jobs
- **Messages** — chat with helpers who have bid
- **Discover** — browse helpers and tool rentals nearby
- **Tool Rentals** — rent equipment from neighbors
- **Planned Needs** — set up recurring jobs (e.g., monthly lawn care)
- **Business Launch** intake — apply for our consulting program
- **Settings** — profile, password, notifications, payment methods

### Helpers and Businesses (paid members)

These are the trades workers and small business owners. They see everything customers see, plus:

- **Helper Dashboard** — incoming inquiries, active jobs, earnings
- **Helper Inbox** — messages from prospective customers
- **My Bookings** — scheduled tool-rental and consulting bookings
- **Business Profile / Helper Profile** — their public-facing page
- **Helper Registration** — a multi-step onboarding flow that includes:
  - Tier selection (Free, Pro, etc.)
  - Identity verification (via a service called Didit)
  - Background check (via a service called Checkr — optional)
  - Tax form (W-9) for U.S. helpers
  - Stripe Connect setup so they can receive payouts
- **Consulting Portal** — for paid consulting clients to view their plan and schedule sessions

### Admins (you)

Admins log in at **/admin/login** and get a completely separate panel — see Section 7 for the full tour.

There are two admin levels:

- **Admin** — can moderate content, handle disputes, answer support tickets, manage users
- **Super Admin** — can do everything admins can, plus see financials, change platform settings, set fees, create other admin accounts, and run reports

---

## 4. Where Everything Lives (the Code Repository)

All the code for OxSteed is stored in one place on **GitHub**, in a repository called **oxsteed/old-file**. Think of GitHub as Google Drive for code — every change is tracked, every version saved, and any developer you hire will need access to this repo.

The repository has roughly this layout:

```
old-file/
├── client/         ← The frontend (what the browser shows)
│   └── src/
│       ├── pages/      ← One file per page (HomePage, Login, Dashboard, etc.)
│       ├── admin/      ← The entire admin panel lives here
│       ├── components/ ← Reusable UI pieces (buttons, modals, the navbar)
│       ├── api/        ← Code that talks to the backend
│       └── context/    ← Login state, dark/light theme, language
│
├── server/         ← The backend (the brain)
│   ├── routes/         ← The "front door" — every URL the backend listens on
│   ├── controllers/    ← The actual logic for each feature
│   ├── middleware/     ← Security checks that run on every request
│   ├── migrations/     ← Numbered SQL files that build the database
│   ├── services/       ← Helpers for email, payments, file uploads, etc.
│   ├── jobs/           ← Scheduled tasks (e.g., "send weekly summary every Sunday")
│   └── workers/        ← Background processes (e.g., delayed payment capture)
│
├── Dockerfile          ← Recipe for packaging the whole app into a container
├── docker-compose.yml  ← Recipe for running it on a single computer
├── DEPLOYMENT.md       ← How the site gets pushed live
├── PRODUCTION_CHECKLIST.md ← What to check before any major release
├── CLAUDE.md           ← Long-form running notes for AI assistants and developers
└── ADMIN_CODEBASE_REPORT.md ← THIS DOCUMENT
```

### The naming pattern is simple

Every feature on the site is split into three matching files:

- A **route** file: `server/routes/jobs.js` — lists the URLs (`/api/jobs`, `/api/jobs/:id`)
- A **controller** file: `server/controllers/jobController.js` — does the actual work
- A **page** file: `client/src/pages/JobListPage.jsx` — the screen the user sees

If a developer says "the bug is in the bid controller", they mean `server/controllers/bidController.js`. Once you know this pattern, you can find anything.

---

## 5. The Outside Services OxSteed Depends On

OxSteed does not handle credit cards, send emails, store photos, or verify IDs by itself. It pays other companies (called **third-party services**) to do those things. If any of these stop working, the matching feature on OxSteed will break — and you may need to log into the third-party dashboard to fix it.

| Service | What it does for us | When you'd need to log in |
|---|---|---|
| **Stripe** | Processes all payments and helper payouts | Refund disputes, payout questions, webhook errors |
| **Resend** | Sends transactional emails (password resets, notifications) | If users say they aren't getting emails |
| **Twilio** | Sends SMS text messages (login codes, alerts) | If text messages aren't arriving |
| **Didit** | Verifies a helper's government ID | If ID verification is failing |
| **Checkr** | Runs background checks on helpers | Background-check failures or disputes |
| **AWS S3** | Stores uploaded photos and documents | If photos aren't loading, or to recover a deleted file |
| **Redis** | Speeds up the site and handles rate-limiting | Site slowdowns, login lockout issues |
| **PostgreSQL** | The actual database (the filing cabinet) | Almost never directly — but every backup of this is vital |
| **Coolify** | Hosts the app and handles deployments | When the site is down or needs redeploying |
| **GitHub** | Stores the code and tracks changes | To grant a new developer access to the code |
| **Sentry** | Reports crashes and errors back to us | To diagnose unexplained issues |
| **Google Analytics + Meta Pixel** | Track visitor stats (consent-gated) | Marketing analytics |
| **OpenRouter / Ollama** | Powers the optional AI chat assistant | If the AI chat starts misbehaving |

**Everything except Stripe, Resend, the Database, and Coolify is technically optional** — the site will keep running if any of the others go down, just with that feature disabled. Stripe and the database are the two things you absolutely must protect.

---

## 6. Money — How Payments Flow Through the Site

This is the part most caretakers will care about. Here's how a single job moves through the money system:

### Step-by-step

1. **Customer posts a job.** No money has changed hands yet.
2. **Helpers bid.** Still no money.
3. **Customer accepts a bid.** OxSteed asks Stripe to charge the customer's card, but **the money is held in escrow** — Stripe authorizes the charge but doesn't release the funds.
4. **Helper does the work.**
5. **Customer marks the job complete.** OxSteed tells Stripe to release the money.
6. **Stripe pays the helper directly** (minus OxSteed's platform fee). This is called a **direct charge** through Stripe Connect.
7. **OxSteed keeps the platform fee** automatically.

### Three pricing tiers exist

- **Tier 1 / Tier 2 (standard):** Customer pays upfront via Stripe Checkout, money flows immediately.
- **Tier 3 (escrow):** The "manual capture" flow described above — funds are authorized but held until job completion. This is the safer flow for larger jobs.

### Refunds and disputes

If a customer demands a refund or there's a dispute:

- Either party can open a **dispute** through the OxSteed dispute system (super-admin can resolve it from `/admin/disputes`).
- A super-admin can also issue a **manual refund** from the Job Detail page, which calls Stripe to reverse the charge.
- All payment events are logged in `server/controllers/webhookController.js` and stored in the database.

### What you should monitor monthly

- Log in to the Stripe dashboard and check that **payouts to helpers** match what the OxSteed admin panel shows under **Super Admin → Payouts**.
- Check **Super Admin → Revenue** for the platform-fee total.
- Watch the **Financials** page for any "stuck" payments (status: `authorized` for more than a couple of weeks usually means a job was forgotten).

---

## 7. The Admin Panel — Your Control Room

Go to **`/admin/login`** and sign in with your admin credentials. You'll land on the dashboard.

The left sidebar is divided into two sections: **Operations** (visible to all admins) and **Super Admin** (visible only if your role is super_admin).

### Operations menu — day-to-day tasks

| Page | What it's for |
|---|---|
| **Dashboard** | At-a-glance numbers: users, jobs, revenue, pending items |
| **Users** | Search and view every user account; ban/unban; verify ID |
| **Jobs** | Browse every job posted; flag, cancel, or refund |
| **Reports** | User-submitted reports of bad behavior — review and act |
| **Moderation** | Anything flagged for review (jobs, profiles, content) |
| **Content Removals** | Removed bids and reviews; you can restore reviews here |
| **Skills** | The master list of trade skills helpers can claim |
| **Support Tickets** | Customer support inbox — claim, reply, close tickets |
| **Messages** | Send a message directly to any user as the platform |
| **Search** | Full-text search across users, jobs, businesses |
| **Businesses** | Approve or moderate business profile pages |
| **Tool Rentals** | Moderate rental listings and bookings |
| **Planned Needs** | Recurring-job requests submitted by customers |
| **Payments** | All Stripe payments — search, filter, inspect |
| **Consulting** | Dashboard, payments, scheduler, analytics, sessions, business-launch requests |

### Super Admin menu — sensitive controls (super-admin only)

| Page | What it's for |
|---|---|
| **Super Dashboard** | Higher-level numbers, including financial totals |
| **Revenue** | Platform-fee revenue with charts and CSV export |
| **Financials** | Detailed accounting view |
| **Payouts** | Money sent to helpers |
| **Conversations** | Inspect any conversation between users (privacy-sensitive — only use for safety/legal) |
| **Admin Accounts** | Create, disable, or force-logout other admin staff |
| **Permissions** | Grant specific powers to regular admins (see below) |
| **Regions** | Country/state boundaries for regional admin scoping |
| **Create User** | Manually create a customer/helper/broker account |
| **Search Logs** | What admins have searched for (audit trail) |
| **Settings** | Platform-wide toggles and feature flags |
| **Audit Log** | Every important admin action, ever |
| **User Action Log** | Specifically: things admins did that affected real users |

### How admin permissions work

- **Super admins** can do everything, period.
- **Regular admins** can do the everyday Operations tasks. For sensitive things (issuing refunds, viewing financials, deleting users, creating new users, etc.), a super admin must explicitly grant them that permission via the **Permissions** page.
- This is enforced by the code in `server/middleware/adminAuth.js`. You don't need to read it — just know that if a regular admin says "I don't have access", the answer is to grant them the right permission.

The current list of grantable permissions includes:

- `view_financials`, `export_data`, `manage_settings`, `view_audit_log`, `issue_refunds`, `verify_users`, `delete_users`, `delete_jobs`, `view_search_logs`, `manage_admin_accounts`, `message_users`, `create_users`.

### Recent admin pages to be aware of

These were added or expanded recently and may not be in older notes:

- **Regions Manager** — Lets a super-admin scope a regional admin to a specific country or country+region. Useful as the platform expands internationally.
- **Audit Log → User Actions** — A separate, focused log of every admin action that touched a real user account.
- **Consulting Sessions Admin** — Manages scheduled 1-on-1 consulting sessions including notes, messaging, and post-session follow-ups.
- **Business Launch Admin** — Reviews and progresses the multi-phase business-launch service for clients.
- **Calendar Appointments** — Underlying scheduling system used by both consulting and helper bookings.

---

## 8. How the Site Gets Updated and Deployed

### The development cycle

When a developer wants to change something:

1. They make changes on their own computer.
2. They push the changes to **GitHub** (a git "commit").
3. GitHub runs automatic checks (linting, tests).
4. When approved and merged into the `main` branch, **Coolify** automatically picks it up.
5. Coolify rebuilds the Docker container and restarts the app.
6. **Database migrations run automatically on startup** — any new migration file (e.g., `119_some_change.sql`) is applied before the new code goes live.

That's it. There's nothing manual unless something breaks.

### What the developer is actually doing

- Editing files inside the `client/` or `server/` folders
- Sometimes adding a new SQL file in `server/migrations/`
- Pushing to GitHub
- Watching the Coolify logs to make sure deployment succeeded

### Where to watch a deployment in real time

- **GitHub** → repository → "Actions" tab — to see if automated checks passed
- **Coolify dashboard** → the OxSteed app → "Logs" — to watch the server come up

### Rolling back

If a new deployment breaks things, log into Coolify and roll back to the previous deployment with one click. The old Docker image is kept.

---

## 9. If Something Goes Wrong — A Triage Playbook

When the site is misbehaving, work through these steps in order. **Do not panic and do not start changing code yourself** — call a developer (see Section 11). But you can usually identify the problem quickly with this list.

### Symptom: The whole site is down

1. Try `https://oxsteed.com/health` — if you get `OK`, the server is up; the problem is somewhere else (DNS, SSL).
2. Log in to **Coolify** and look at the OxSteed app status. If it says "stopped" or "crashed", restart it.
3. Check Coolify logs for the most recent error — usually the first red line tells the whole story.
4. Check that the **database** and **Redis** containers are also running.
5. Check Sentry for a flood of new errors — sometimes a single bad deployment is the cause.
6. **Last resort:** roll back the most recent deployment in Coolify.

### Symptom: Users can't log in

- Almost always: an expired secret. Check that `JWT_SECRET` is still set in Coolify environment variables.
- Or: the database is down (see above).

### Symptom: Payments aren't going through

1. Log into the **Stripe dashboard** → Webhooks. Look for failed deliveries.
2. Check that `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Coolify match what's in Stripe.
3. Check the **Payments** page in the admin panel for stuck transactions.

### Symptom: Emails aren't sending

- Resend dashboard → check API status and recent send logs.
- `RESEND_API_KEY` is set in Coolify.
- If the domain's SPF/DKIM/DMARC records expired, emails will go to spam.

### Symptom: Photo uploads broken

- AWS S3 dashboard → check the bucket exists and credentials work.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` set in Coolify.
- Without S3, the site falls back to storing photos as text inside the database — it works but bloats the DB. Get S3 fixed quickly.

### Symptom: A specific user complains about something

- Use **Admin → Search** to find their account.
- Open their **User Detail** page. Everything they've ever done is listed there: jobs, payments, messages, billing history, payouts.
- Use **Audit Log → User Actions** to see what admins have done to their account.

### Symptom: A bad actor / harassment / fraud report

- Find them via **Admin → Search**.
- Use **Ban User** on their User Detail page.
- For payment fraud: also block their card in Stripe.
- All actions are logged automatically — no need to keep your own notes.

---

## 10. Important Accounts, Logins, and Where the Keys Live

> **DO NOT WRITE PASSWORDS INTO THIS FILE.** This section is a checklist of *which accounts* exist. Store the actual passwords in a password manager (1Password, Bitwarden, etc.) and share access with whoever you trust.

You should have administrative login credentials for each of these:

- [ ] **GitHub** — `oxsteed` organization, owner of the `old-file` repository
- [ ] **Coolify** — the host where the live site runs
- [ ] **Stripe** — payment account
- [ ] **AWS** — S3 bucket for file storage
- [ ] **Resend** — email sending account
- [ ] **Twilio** — SMS sending account
- [ ] **Didit** — identity verification account
- [ ] **Checkr** — background-check account (if used)
- [ ] **Sentry** — error monitoring
- [ ] **Google Analytics + Meta Business** — marketing analytics
- [ ] **Domain registrar** — where `oxsteed.com` is registered (this is critical — losing the domain means losing the website)
- [ ] **Email account** that owns all the above logins
- [ ] **The OxSteed super-admin account** — to log into `/admin/login`

All the secret keys (JWT_SECRET, ENCRYPTION_KEY, STRIPE_SECRET_KEY, etc.) live as **environment variables inside Coolify**. They are never stored in the code repository. If Coolify is lost, those secrets are gone — but they can all be regenerated from the corresponding service dashboards.

The full list of required and optional environment variables is documented in `DEPLOYMENT.md` and `server/utils/validateEnv.js`.

---

## 11. Hiring a Developer to Take Over

If something happens to me, you will need to hire a software developer to maintain or extend OxSteed. Here is exactly what to tell them so they can hit the ground running:

### What to give them

1. **Read access** to the GitHub repository at `oxsteed/old-file`.
2. **A copy of this file** (`ADMIN_CODEBASE_REPORT.md`).
3. **A copy of `CLAUDE.md`** in the same repository — that is the long-running technical changelog and project memory.
4. **Login to Coolify** so they can deploy.
5. **Stripe**, **AWS**, **Resend** dashboard access (or at least their environment variables read from Coolify).

### What to tell them in plain English

> "OxSteed is a React + Node.js + PostgreSQL marketplace running on Coolify. The frontend is in `/client`, the backend is in `/server`. Database migrations are numbered SQL files in `/server/migrations` and apply automatically on startup. Payments go through Stripe Connect with manual-capture escrow on Tier 3 jobs. Auth is JWT (15-minute access tokens, 7-day refresh), stored in browser localStorage. Read `CLAUDE.md` for the full project history and `DEPLOYMENT.md` for production env vars."

Any competent full-stack web developer should be productive within a day or two with that information.

### What kind of developer to hire

Look for someone with experience in:

- **React** and **Node.js / Express** (these are common — most full-stack developers know both)
- **PostgreSQL** (any SQL experience is fine)
- **Stripe Connect** (this is the slightly specialized one — be sure to ask)
- Comfort with **Docker** and a hosting platform (Coolify, Heroku, Render, Railway are all similar)

Hourly freelancer rates in the U.S. for this skill set range from roughly $75–$200/hour. For ongoing maintenance, a part-time retainer is usually more economical than per-incident billing.

---

## 12. Glossary of Terms

- **API** — A doorway through which the frontend asks the backend for things. Every URL starting with `/api/` is an API endpoint.
- **Backend** — The server program that does the thinking and database work.
- **Branch** — A separate copy of the code where work-in-progress changes live until they're ready to merge into `main`.
- **Cache** — A temporary fast copy of slow data, usually held in Redis.
- **Commit** — A single saved change to the code, with a timestamp and a message.
- **Container / Docker** — A way of packaging the entire app (code + dependencies) into one self-contained box that runs the same anywhere.
- **CSRF / XSS / SQL injection** — Three common categories of website attack. The code already protects against all three (`server/middleware/`).
- **Dependency** — Outside code we use (e.g., React, Express, Stripe library). Listed in `package.json` files.
- **Deploy** — To take new code and make it live on the public website.
- **Environment variable** — A secret value (like an API key) that's given to the running app from outside the code, so it isn't accidentally committed to GitHub.
- **Escrow** — Money held by a third party (Stripe) until both parties agree it should be released.
- **Frontend** — The visible website that runs in the user's browser.
- **JWT** — JSON Web Token. A signed identification card the backend gives a user when they log in. The browser presents it on every subsequent request to prove they're logged in.
- **Migration** — A numbered SQL file that changes the database structure (adds a column, creates a table, etc.). Migrations are applied in order and never edited after going live.
- **Production** — The real, live website that real users use.
- **Repository / Repo** — The folder full of code stored on GitHub.
- **SPA / Single-Page App** — A site where navigating between pages happens in the browser without a full reload, making the site feel snappier. OxSteed is one.
- **Stripe Connect** — A Stripe feature that lets us pay helpers directly (rather than money going to OxSteed first and then to the helper).
- **Webhook** — A message Stripe (or another service) sends to OxSteed when something happens — like "payment succeeded" — so the site can update.

---

## Final Note

This document is a snapshot in time. If the site changes substantially, update this file. The single most important rule:

> **Don't let the domain `oxsteed.com` expire, don't let the database backups stop, and keep paying the Stripe and Coolify bills.** Everything else can be recovered.

Good luck. — *E.*
