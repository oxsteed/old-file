# Existing investor functionality review (OxSteed Invest, Track 0)

Date: 2026-11-17. Base: branch `feat/oxsteed-invest` off default `2d8a4f19`
(PR #797 merged). Scope: read-only audit of every current "investor" surface
in the worktree. Every claim below was verified against the code at that base;
file paths were resolved by grep and read, not taken from the build brief.

## Locked model this review applies

Investor = a person or authorized org representative investing eligible
OxSteed Credit in approved opportunities from eligible entities on OxSteed.
NOT investing in OxSteed itself. There is no platform-investor persona.
US-only, revenue share first and only structure, Reg CF via a registered
intermediary (proposed, conditional). Credit-only contributions is a HARD line.
New capabilities live under the `investor.*` namespace, subject to this review.

## Headline finding

Almost everything called "investor" today is **reporting about OxSteed the
platform** (KPIs, revenue, franchise pipeline), not participation in entity
opportunities. That reporting surface is legitimate and mostly KEEP. The
danger is naming and plumbing collision: the same word, the same
`/investor/*` routes, the same `investor` mode value, and the same admin
"Investor" account-type label would, if reused naively, let reporting access
be read as participation access. Nothing in this review authorizes
auto-migrating `investor.reporting` access into `investor.participate`.
That migration stays forbidden: participation needs its own application,
eligibility check, and grant, decided separately.

A second structural fact: **`investor` is not a `users.role` value.** There is
no `INVESTOR` entry in `server/constants/roles.js` (roles are customer,
helper, helper_pro, broker, employee, admin, super_admin). `investor` exists
only as a `default_mode` value (migration 280, `server/utils/modeRole.js:54`,
`server/controllers/authController.js:184`), and admin provisioning maps it to
`role: 'customer', default_mode: 'investor'`
(`server/controllers/superAdminUserController.js:55`). The legacy guards in
`server/routes/investor.js:19` and
`server/middleware/requireAccess.js:166` that test `req.user?.role ===
'investor'` therefore never match a real role; they are dead branches kept
alive only by the capability check beside them. Track 1 must not copy that
pattern for participation checks.

## Verdict counts

KEEP: 11. ADAPT: 6. DEPRECATE: 1. Total items reviewed: 18.

## Review table

| # | Item (file:line) | What it does today | Product purpose it assumes | Verdict | Dependency that must be understood before changing it |
|---|---|---|---|---|---|
| 1 | `server/services/access/policyRegistry.js:161-176` (`investor.reporting`, version `investor-policy-2`, reviewPermission `review_investor_access`, legacyModes `['investor']`) | Versioned capability: a person applies for reporting access (audience string, requested reports, about text); platform reviewers holding `review_investor_access` decide; approval does not satisfy any activation requirement. | Reporting about OxSteed. | KEEP | `server/services/access/accessService.js` grant/decision flow and `server/services/access/legacyMapping.js:58-59` (audience record grants, mode without audience is an exception). New capabilities are siblings here, not edits to this entry. |
| 2 | `server/routes/investor.js:1-43` (mounted `/api/investor`, `server/index.js:655`) and `server/controllers/investorController.js:1-369` | Five read-only endpoints: `/kpis`, `/revenue-chart`, `/franchise`, `/supply-demand`, `/evidence/:metric`. All aggregate platform data (users, jobs, `platform_ledger` revenue, franchise applications). Fail-open on missing tables. | Reporting about OxSteed. | KEEP | `server/analytics/metricsRegistry.js` canonical metrics; `server/analytics/investorEvidence.js` aggregate-only drill-through with min-cell suppression; audience dataset gate `requireInvestorDataset` in the route file. The `/api/investor` mount prefix is now shared namespace: participation endpoints must use distinct subpaths (for example `/api/investor/opportunities`, `/api/investor/commitments`) and must never reuse these handlers. |
| 3 | `server/middleware/requireAccess.js:163-168` (`requireInvestorCapability`) and `server/services/access/accessService.js:152-174` (`getInvestorAudience`) | Enforces `investor.reporting` per `ACCESS_INVESTOR_ENFORCEMENT` (off/shadow/enforce) and loads the active audience row; 403s `investor_audience_required` when no audience exists. | Reporting about OxSteed. | KEEP | `server/services/access/flags.js:53-56` (`investorEnforcement()`); audience table (item 4). This is the pattern to copy for participation gates, with a different capability key and a different loader, never a shared loader. |
| 4 | `investor_reporting_audiences` table, `server/migrations/20261116170000_investor_reporting_audiences.sql` | One audience row per grant (`grant_id` unique, `audience_key`, `datasets` array, status, expiry). The grant is only useful with an approved audience. | Reporting about OxSteed. | KEEP | `access_grants` row it references; `accessService.getInvestorAudience` expiry/status checks. Participation must NOT reuse this table: opportunity-level document access and commitment ownership need their own tables keyed to opportunity and commitment, not to a reporting audience. |
| 5 | `server/analytics/investorEvidence.js:1-98` | Aggregate-only KPI drill-through (period buckets, currency, source); no ids, names, or free text; buckets under 3 records suppressed. | Reporting about OxSteed. | KEEP | `server/analytics/metricEvidence.js` and `queryBuilder.js`; the four-metric allowlist `INVESTOR_EVIDENCE_METRICS`. If entity-opportunity reporting ever reuses this module, the metric allowlist and the `isSuperAdmin: true` scope at line 33 must be re-examined, because entity data is not platform data. |
| 6 | `client/src/pages/InvestorDashboardPage.jsx:1-516` and `client/src/components/investor/InvestorEvidencePanel.jsx:1-104` | Reporting dashboard: platform KPIs, revenue chart, franchise pipeline, supply/demand, evidence panel. Reads the boot projection (`investorAudience.datasets`) for dataset gating and redirects non-investors to `/dashboard`. | Reporting about OxSteed. | KEEP | `/api/investor/*` endpoints (item 2); `accessProjection` shape from `accessService.js:134-143`. The page title "Investor Dashboard" will become ambiguous once "My investments" exists; Track 1 should rename this page in copy (for example "Platform reporting") or give the participation surface a clearly different title, without changing this page's data. |
| 7 | `server/routes/robots.js:29` (`Disallow: /investor/`) | Keeps all investor pages out of search indexes. | Reporting about OxSteed (privacy). | KEEP | None. The new participation pages (directory, opportunity pages, My investments) are also account-gated and must stay under this disallow; do not carve out a public opportunity directory from it without a separate decision, because opportunity pages carry confidential material. |
| 8 | `server/__tests__/investorRouteAccess.test.js:1-74` and investor sections of `server/__tests__/progressiveAccess.db.test.js:99-166, 270-274` | Mounted-route tests (role reachability, capability and audience 403s) and DB tests (WP-077: approval creates a scoped audience, expiry and dataset narrowing enforced). | Reporting about OxSteed. | KEEP | `requireAccess` middleware and the audience table. These tests pin reporting behavior; Track 1 adds separate participation tests and must not weaken these. |
| 9 | Locale keys `investorDashboard.*` and `investorLogin.*` (`client/src/locales/en.json:20138-20155, 22710-22760`, mirrored in es/fr/ht/ar) | Copy for the reporting dashboard, evidence panel, and investor login page. | Reporting about OxSteed. | KEEP | `scripts/splitLocaleCatalogs.mjs` sharded catalogs; the `verify:i18n` gate. New participation strings need new keys (`investorParticipate.*` or similar), never reuse of `investorDashboard.*` keys for participation copy. |
| 10 | Docs: `docs/progressive-access/SPEC.md` investor sections (notably lines 790-802, 1714, 3926-3934), `docs/progressive-access/HANDOFF.md`, `docs/progressive-access/PROGRESS.md` | Records the reporting closure: request a specific audience, approve it, verify scoped KPI/chart/evidence through expiry or revoke; approval grants no funds movement, owner, or staff rights. | Reporting about OxSteed. | KEEP | The progressive-access grant machinery. Track 1 records participation closure separately; do not edit these sections to describe participation. |
| 11 | Migration 280, `server/migrations/280_add_investor_mode.sql` | Adds `investor` to the `users.default_mode` and `pending_registrations.default_mode` CHECK constraints. | Neutral (mode value). | KEEP | `server/utils/modeRole.js:54` (`SELF_SELECTABLE_MODES` includes `investor`); `server/controllers/authController.js:184`. The value stays for reporting legacy; its meaning must be clarified in code comments by Track 1 (mode is not participation eligibility). Applied migration: never edit the file. |
| 12 | `client/src/pages/InvestorLoginPage.jsx:1-108` | Separate login page: email, password, drawn signature, terms agreement; signs in, then navigates to `/investor/dashboard` regardless of whether the account holds reporting access (only toasts "switching mode" when `default_mode` is not `investor`). | Ambiguous: assumes "investor" is one thing, and that signing in as one leads to the reporting dashboard. | ADAPT | `useAuth().login`; `client/src/App.jsx:495` route. Before participation launches, this page needs a decision: keep it as the reporting login and give participation its own entry, or turn it into a chooser. As written it would misdirect a participation applicant to platform KPIs. Do not change until Track 1 defines the entry flow. |
| 13 | `client/src/App.jsx:495` (`/investor/login`) and `:683` (`/investor/dashboard`) | Client routes for the reporting login and dashboard. | Reporting about OxSteed. | ADAPT | `InvestorLoginPage`, `InvestorDashboardPage`, `Guarded`/`ProtectedRoute`. The `/investor/*` path prefix is now shared with participation. Track 1 must lay out the full route map (directory, opportunity, application, commit, My investments) before adding routes, so reporting and participation URLs never collide and the robots disallow still covers both. |
| 14 | `server/services/access/legacyMapping.js:58-59` and `policyRegistry.js:169` (`legacyModes: ['investor']`) | Legacy `investor` mode without an audience record is surfaced as an exception (`investor_mode_without_audience`); with an audience it grants `investor.reporting`. | Reporting about OxSteed. | ADAPT | `accessService.loadFacts` (audience lookup). Under the new model, a legacy `investor` mode must never imply `investor.participate`, and the exception reason must stay reporting-scoped. Track 1 adds an explicit rule (mode alone grants no participation capability) and a test pinning it. |
| 15 | Admin "Investor" account type: `client/src/components/CreateUserForm.jsx:20`, `client/src/admin/pages/UsersList.jsx:28`, `server/controllers/superAdminUserController.js:55` | Admins can create or filter an "Investor" account type, which provisions `role: 'customer', default_mode: 'investor'`. | Ambiguous: a mode label that reads as a role and as a person type. | ADAPT | `server/constants/roles.js` (no Investor role exists); locale keys for the `investor` label (`en.json:7669, 7691`). Once participation exists, this label is ambiguous between "reporting audience holder" and "participation applicant". Track 1 should rename or annotate it (for example "Investor (reporting)") and confirm the provisioning path creates no participation grant. |
| 16 | `server/routes/payments.js:44` (`GET /investor-summary`, admin only) and `server/controllers/paymentController.js:1225-1244` (`getInvestorSummary`) | Returns `total_invested_cents` and `revenue_share_cents` both equal to the sum of captured `platform_fee`, `helpers_funded` as distinct payees, and `active_opportunities` as open jobs. | Investing in OxSteed: presents platform fee revenue as if it were investment, and open jobs as investment opportunities. | DEPRECATE | No client caller exists (grep over `client/src` and `server` finds no consumer besides the route and controller). The field names are wrong-model artifacts: under the locked model, "invested" means Credit committed to entity opportunities, and "opportunities" means approved entity raises, not open jobs. Track 1 should remove the endpoint or replace it with aggregates over the new investment subledger; it must not be wired into any investor-facing surface as is. |
| 17 | `server/services/access/accessService.js:35` (route allowlist includes `/investor`) and `:134-143` (projection carries `investorAudience`) | Boot projection exposes reporting capability and audience datasets to the client. | Reporting about OxSteed. | ADAPT | `client/src/pages/InvestorDashboardPage.jsx:210-218` consumes it. Participation needs its own projection fields (capabilities held, pilot membership, eligibility state), added alongside, never by overloading `investorAudience`. |
| 18 | Docs mentioning investors as a persona: `docs/oxsteed-product-definition.md:232-246, 393`, `docs/oxsteed-four-tabs-by-persona.md:280`, `docs/oxsteed-pack-architecture.md`, `docs/growth/design-spec.md`, `docs/analytics-platform/SCOPE.md` | Describe property investors, franchise backers, and "investor heroes" as platform personas whose value is capital, credibility, and due diligence on local services. | Mixed: mostly property/franchise backing, adjacent to but not the same as entity-opportunity participation. | ADAPT | These are product-definition docs, not code. Track 1 (or the counsel brief) should add a short note where these personas are defined, distinguishing platform reporting/franchise backing from Reg CF entity participation, so a later reader does not treat the persona copy as the participation spec. No code depends on them. |

## Where the new investor.* capabilities plug into the policy registry

New entries go in `server/services/access/policyRegistry.js` as siblings of
`investor.reporting`, following the existing entry shape:

- `investor.participate`: subjectType `self`; reviewerClass `platform`;
  reviewPermission a new admin grant code (do not reuse
  `review_investor_access`, which is the reporting reviewer pool);
  `applicantMayRequest: true`; `legacyModes: []` and `legacyRoles: []`
  (nothing legacy grants participation); activationRequirements to be defined
  by Track 1 (identity/authority verification, eligibility, agreement
  acceptance are participation requirements, not access-request activation
  steps, and must be checked again at commit and closing).
- `investment_opportunity.publish`: subjectType `business` (the entity);
  reviewerClass `platform`; separate review permission; applicant flow is the
  entity submission, not a self-service access request, so
  `applicantMayRequest` needs a Track 1 decision.
- Closing and proceeds release are NOT capabilities in this registry as
  drawn today: the brief requires them under separate authorities with no
  self-approval and separate review plus execution. If they are modeled as
  capabilities, they need their own entries with distinct reviewer
  permissions from publish; if they are modeled as admin oversight actions,
  they need their own permission codes. Either way, no single grant may
  authorize both closing and proceeds release, and no entity representative
  may approve their own opportunity.
- Document access is relationship-scoped (investor holds a current
  application or commitment for that opportunity), not a standalone
  capability grant; the registry should not gain a blanket
  `investor.view_documents` key.
- `investor.reporting` stays untouched. No grant, migration, or mapping may
  convert a reporting grant into `investor.participate`, and the legacy
  mapping must gain a test proving mode `investor` alone yields no
  participation grant.

## How ACCESS_INVESTOR_ENFORCEMENT relates to the new INVEST_* flags

`ACCESS_INVESTOR_ENFORCEMENT` (`server/services/access/flags.js:18, 53-56`,
default `off`, values off/shadow/enforce) governs **reporting only**: it
controls whether `requireInvestorCapability` demands a current
`investor.reporting` grant for the five `/api/investor` reporting endpoints.
It has no bearing on participation, and flipping it to `enforce` does not
enable or disable any investment activity.

The proposed new flags are a separate, independent layer:

- `INVEST_ENABLED` (master, default off): gates the entire participation
  surface, server and client. With it off, no participation route, page, or
  commit path is reachable, regardless of grants or pilot membership.
- `INVEST_COMMITMENTS_ENABLED` (default off, separate pilot gate): gates
  commitment creation specifically, so the directory and application flows
  can be reviewed while commitments stay impossible.
- `INVEST_PILOT_USER_IDS`: allowlist of user UUIDs for piloting, mirroring
  the existing `ACCESS_PILOT_USER_IDS` pattern
  (`flags.js:25-29`).

Rules for Track 1: the INVEST_* flags must be checked server-side on every
participation write path, not only in UI gating; `ACCESS_INVESTOR_ENFORCEMENT`
must never be read as a participation gate; and a user who holds
`investor.reporting` (or legacy mode `investor`) gains nothing under the
INVEST_* flags unless they separately hold `investor.participate` and pass
the eligibility recheck. Live activity stays disabled by design until
counsel and partner approval, so all three INVEST_* flags ship off.

## Open questions for the Track 1 builder

1. Does the reporting dashboard get renamed in copy, or does the
   participation surface take a distinct name while reporting keeps "Investor
   Dashboard"? (Item 6.)
2. What is the entry flow: does `/investor/login` stay reporting-only with a
   separate participation entry, or become a chooser? (Item 12.)
3. Is `GET /investor-summary` deleted outright or replaced with subledger
   aggregates? (Item 16.)
4. Are closing and proceeds release modeled as registry capabilities or as
   admin oversight actions? (Registry section above.)
