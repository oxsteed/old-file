# Super Admin Production-Readiness Audit

Audit date: 2026-09-08/09

## Scope

The audit covered the shared Super Admin layout, sidebar search, route guards, all Super Admin navigation destinations, their client API calls, matching server routes, mutation confirmations, loading/error states, and the shared user-detail/authentication paths.

The sidebar now exposes 25 Super Admin destinations, including the existing Fee Config, Pricing Config, and Pricing Overrides routes that were previously reachable only by URL.

## Findings And Fixes

### Fixed in this audit

- Financials now receives `job_fee_revenue_cents`, `subscription_revenue_cents`, and `total_refunds_cents`, with zero-safe SQL totals. The UI was already displaying these fields, but the API omitted them.
- Payouts now safely formats PostgreSQL numeric strings and malformed values instead of calling `.toFixed()` on a string and crashing the page.
- Revenue, Financials, Payouts, Audit Log, Fee Config, Pricing Config, and Search Logs now show visible load failures with retry actions instead of silently rendering empty or misleading data.
- Audit Log filters reset pagination to page one, preventing a valid filter from appearing empty when the previous page no longer exists.
- Fee Config no longer remains on an endless spinner after either initial request fails.
- Pricing Config no longer leaves editable defaults on screen after its read request fails.
- Fee Config, Pricing Config, and Pricing Overrides are discoverable in the Super Admin sidebar.

## Tab Matrix

Status meanings: `Code-verified` means the page, guard, client request, and server route were matched locally. It does not mean a production write was executed against live business data.

| Tab | Status | Notes |
| --- | --- | --- |
| Super Dashboard | Code-verified | Super-admin dashboard and activity/geo endpoints are mounted and guarded. |
| Money | Code-verified | Financial permission and API contract are present; page has a visible error state. |
| Revenue | Fixed and code-verified | Numeric formatting and visible retryable errors added. |
| Fee Config | Fixed and code-verified | Initial-load failure no longer leaves an endless spinner. Reset remains confirmation-gated by the page flow. |
| Pricing Config | Fixed and code-verified | Read failures now block editing and offer retry. |
| Pricing Overrides | Code-verified | Read and update routes match; live provider/record effects require staging data. |
| Financials | Fixed and code-verified | API now returns all four summary fields used by the UI; export errors are visible. |
| Payouts | Fixed and code-verified | String-safe currency formatting and retryable load errors added. |
| Conversations | Code-verified | List/detail/status routes match and the detail view has a return path. |
| Admin Accounts | Code-verified | Account/status/force-logout routes match; destructive force logout is confirmed. |
| Permissions | Code-verified | Grant/revoke routes match; revoke is confirmation-gated. |
| Regions | Code-verified | CRUD routes and server boundary validation match; delete is confirmation-gated. |
| Internal Access | Code-verified | List and per-user update routes match. |
| Gate Lockouts | Code-verified | Lockout, attempt, and lift routes match; lift is an explicit action. |
| Create User | Code-verified | Full-create route and page navigation are present. |
| Search Logs | Fixed and code-verified | Response fallbacks and visible retryable errors added; debounced filters reset pagination. |
| Settings | Code-verified | Settings and feature-flag routes match; save failures are visible. |
| Audit Log | Fixed and code-verified | Response fallbacks, retryable errors, and filter pagination reset added. |
| User Action Log | Code-verified | Filter, export, region lookup, and error states are present. |
| One Truth | Code-verified | Filter, stats, suspect, and user endpoints match; no public data exposure was found in the client contract. |
| Franchise HQ | Code-verified | Admin list/detail/mutation routes match; activation is an explicit workflow. |
| Country Packs | Code-verified | Admin list/status routes match; status changes require confirmation. |
| Corporate Setup | Code-verified | Corporate catalog, departments, titles, assignments, org chart, and audit routes are mounted. |
| Mode Policies | Code-verified | Admin policy reads and updates are routed through the platform approval API. |
| Mode Approvals | Code-verified | Pending approval list, approve, and reject flows are routed and reason-gated for rejection. |

## Verification Evidence

- `npm --prefix client run verify:i18n`: passed.
- `npm --prefix client run typecheck`: passed.
- `npm --prefix client run build`: passed as part of `build:ci`.
- Focused server tests: 3 suites passed, 21 tests passed (`adminAuthSecurity`, `directCatalog`, `supportLiveConnection`).
- Full server suite: 88 suites passed, 570 tests passed; 2 suites failed with 3 pre-existing failures outside this audit.
- `node --check` passed for the changed server controller and admin routes.
- `git diff --check` passed.
- Deployment commit `939acfba` was pushed through GitHub Desktop and deployed by Coolify.
- The live container is healthy on image `tdrapz1vvcoftfwsk7fcdq0h_app:939acfba`; `https://oxsteed.com/ready` returned 200 with database, migrations, Redis, realtime, workers, traffic, and shutdown checks healthy.
- Live browser smoke test of `/admin/super/dashboard` confirmed the sidebar search and all 25 Super Admin links render after deployment.

## Remaining Release Blockers

These items were not changed because safely completing them requires staging data, live provider credentials, or an explicit operational decision:

1. Full browser click-through of every write action needs a staging database or disposable Super Admin account. Running create, revoke, delete, pricing, country activation, franchise activation, refund, payout, and approval mutations against production would be unsafe.
2. Stripe, Resend, object storage, and OpenAI/OpenRouter behavior needs provider-backed staging verification. The audit confirms route wiring but does not certify external delivery, billing settlement, or AI-provider availability.
3. The full server suite still has an unrelated `job.test.js` fixture expecting public job detail access but receiving `401`.
4. The full server suite still has an unrelated `discover.test.js` fixture expecting `/helpers/:id` while the implementation returns `/helpers/public/:id`.
5. The duplicate `reports` React route in `client/src/admin/AdminApp.jsx` remains outside the Super Admin scope and needs an owner decision about which report experience should be canonical.
6. The public `https://oxsteed.com/sitemap.xml` endpoint returned 404 during the read-only smoke check. This is outside the Super Admin release and should be investigated before relying on sitemap-based SEO discovery.

## Recommendation

The Super Admin area is not honestly certifiable as fully production-ready until the release blockers above are cleared. The local code changes in this audit are safe and verified, the deployment is healthy, and the most important misleading/error-prone reporting behaviors have been corrected. The next safest step is a staging smoke run with seeded admin, financial, approval, franchise, region, country-pack, and external-provider fixtures, followed by the same focused tests and a full browser read-only smoke check.
