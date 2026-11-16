# Progressive account access — handoff

Branch `feat/progressive-account-access`, PR https://github.com/oxsteed/old-file/pull/794 (title "Progressive account access",
base `old-files-claude`). Spec: [SPEC.md](SPEC.md). Ledger: [PROGRESS.md](PROGRESS.md).
Anyone (human or agent) can resume from this file alone.

## Resume checklist

1. `git status` and `git log --oneline -15` on the branch. Uncommitted work from an
   interrupted run may exist; read it before discarding anything.
2. Read **Next step** below and the matching rows in PROGRESS.md.
3. One work package per commit, message prefix `WP-xxx:`. After every commit:
   update PROGRESS.md (status, commit, tests) and **Next step** here, commit, push.
4. Never force-push or rebase; merge `origin/old-files-claude` in (merge commit) if
   the branch falls behind. Do not merge the PR.

## Local setup

```sh
# Worktree (never /tmp). node_modules are symlinks, excluded via .git/info/exclude:
cd /workspace/wt/progressive-access
ln -s /workspace/wt/pr710/server/node_modules server/node_modules   # or: (cd server && npm ci)
ln -s /workspace/wt/pr709/client/node_modules client/node_modules   # or: (cd client && npm ci)

# Unit / contract tests (no DB needed):
cd server && npx jest --runInBand __tests__/progressiveAccess

# PostgreSQL integration tests need PostgreSQL 16+ WITH PostGIS (migration 001).
# CI already provides it (service "postgis" image, db credit_statement_test).
# Locally (what this box uses): micromamba env with conda-forge postgresql=17 + postgis at
# /workspace/pgbin/env; data dir /workspace/pgdata. Start:
#   /workspace/pgbin/env/bin/pg_ctl -D /workspace/pgdata -o "-k /workspace/pgsock -p 5432 -c listen_addresses=127.0.0.1" -l /workspace/pgdata.log start
# Any Postgres+PostGIS works, then:
createdb -h 127.0.0.1 -U oxsteed credit_statement_test
DATABASE_URL=postgresql://oxsteed@127.0.0.1:5432/credit_statement_test?sslmode=disable NODE_ENV=test npm run migrate
ACCESS_TEST_DATABASE_URL=postgresql://oxsteed@127.0.0.1:5432/credit_statement_test?sslmode=disable \
  npx jest --runInBand __tests__/progressiveAccess
# DB suites skip unless ACCESS_TEST_DATABASE_URL points at a loopback disposable db
# (credit_statement_test / pa_tN). CI sets it in "Server regression and security tests".

# Client:
cd client && npm run build:ci
node scripts/check-locale-parity.* (see client/package.json "i18n" scripts)
```

## Phase / WP order being followed

Spec "Commit-sized delivery sequence" + "Phase 0–5":

| Order | Slice | WPs |
| --- | --- | --- |
| 0 | Handoff docs, decision tests (D1–D7), baseline inventory | — |
| 1 | Data expand: access tables migration | WP-010/011/012/014 foundations |
| 2 | Policy registry + access service (resolver) | WP-010, WP-014 |
| 3 | Applicant API `/api/me/access*` | WP-010, WP-011 |
| 4 | Reviewer API `/api/admin/access-requests*` + outbox notifications | WP-012, WP-020 |
| 5 | Backfill (dry-run + idempotent apply) of legacy roles/modes/approvals | Legacy mapping, WP-086 |
| 6 | Customer-first signup + durable intent (flagged) | WP-001…WP-005 |
| 7 | Helper application + helper bid/quote gate (flagged shadow → enforce) | WP-006, WP-007, WP-026, WP-028, WP-086 |
| 8 | Client: access hook, My applications page, in-context apply, reviewer queue, i18n ×20 | WP-011, WP-012, WP-014–WP-016 |
| 9 | Phase 3 business/restaurant scoped grants | WP-046…WP-073 |
| 10 | Phase 4 specialists | WP-074…WP-103 |
| 11 | Phase 5 switch retirement | WP-013 |

## Conventions chosen (matched to repo)

- **Before pushing client changes** run `npm run verify:frontend-references` and `npm run build:ci`
  in `client/` (CI's client job runs both; an undefined `accessT` once failed only there).
- **DB suites** share one database: run them `--runInBand` like CI (the backfill case counts all
  users, so parallel files can skew it locally).

- **Migrations**: `server/migrations/YYYYMMDDHHMMSS_name.sql` (UTC), additive,
  idempotent (`IF NOT EXISTS`), `pg_constraint` guards scoped by `conrelid`.
- **Tables**: `access_signup_intents`, `access_requests`, `access_request_decisions`
  (immutable), `access_grants`, `access_outbox`, `access_backfill_runs`,
  `access_backfill_exceptions`. `users.id` is UUID. Legacy
  `mode_platform_approvals` / `users.role` / `users.default_mode` stay readable and
  untouched (compat window).
- **Capability keys** (`server/services/access/policyRegistry.js`):
  `customer` (implicit for every active account), `helper.offer_services`,
  `business.own`, `restaurant.own`, `consultant.accept_paying_clients`,
  `tool_owner.list_equipment`, `logistics.ship`, `investor.reporting`,
  `franchise.operate`. Subject types: `self`, `business`, `business_proposal`,
  `restaurant_location`.
- **Request states**: `draft, submitted, in_review, needs_information, approved,
  declined, withdrawn`. Grant states: `active, suspended, revoked, expired`.
- **API**: applicant `GET /api/me/access`, `GET|POST /api/me/access-requests`,
  `GET|PATCH /api/me/access-requests/:id`, `POST .../:id/submit|withdraw`,
  `GET /api/me/access-policies/:capability`. Reviewer under `/api/admin/access-requests`
  (`requireAdmin` + permission `review_access_requests`, super-admin bypass; investor `review_investor_access`, franchise `review_franchise_access` — added to `PERMISSION_SCOPES` in adminPermissionController).
  Idempotency via `Idempotency-Key` header (repo idiom).
- **Error codes** (shape `{ error, code }` from `utils/apiError.js`):
  `access_required` (403), `request_already_open` (409), `request_version_conflict` (409),
  `access_request_not_found` (404), `decision_not_permitted` (403),
  `self_review_forbidden` (403), `idempotency_key_reused` (422),
  `feature_disabled` (503, existing).
- **Flags** (server env, all default **off**, exposed to client through boot):
  `ACCESS_REQUESTS_ENABLED`, `ACCESS_PROJECTION_ENABLED`,
  `ACCESS_CUSTOMER_FIRST_SIGNUP`, `ACCESS_HELPER_ENFORCEMENT` (`off|shadow|enforce`),
  `ACCESS_LEGACY_SWITCH_RETIRED`, `ACCESS_BUSINESS_ENFORCEMENT` (`off|shadow|enforce`, WP-046).

## Decisions for Emile (safe default implemented, behind config)

Kept in sync with the PR description. See PROGRESS.md for the full list.

1. **Grandfather existing helpers.** Users with role `helper` today, or with a
   `helper_profiles` row (they could switch back instantly), are backfilled as active
   `helper.offer_services` grants with provenance `legacy_backfill` — no re-review.
2. **Owner modes without a business** get a *draft* application, not access.
3. **Investor mode without an audience record** and **staff modes without a membership**
   go to an exception list for review; they keep customer access only.
4. **Unapproved consultant mode** gets a draft consultant application (accepting paying
   clients was already approval-gated).
5. **Tool owner / logistics modes** are grandfathered as grants (they were self-service).
6. **Franchise** grants come only from a current territory assignment; no self-service.
7. **Investor and franchise reviews** need their own admin permissions
   (`review_investor_access`, `review_franchise_access`); the general
   `review_access_requests` covers helper/business/restaurant/consultant/tools/logistics.

8. **Access reviews need one admin**, not two; the two-admin rule stays for credit actions.
9. **Credit customers approved as helpers** keep `users.role = customer` (trigger
   `oxsteed_credit_user_role_guard`); under `enforce` the grant alone lets them bid.
10. **Profile/mobile saves with an unapproved mode** save everything else and ignore the mode
    (`mode_change_ignored`); switch-role returns 403 `access_required`.

11. **Dedicated helper registration closes** while `ACCESS_CUSTOMER_FIRST_SIGNUP` is on
    (`/api/helper-registration/start|verify-otp|resend-otp|send-otp|registration-terms` → 410
    `use_general_signup`, `next: /join?mode=helper`). A half-finished dedicated signup (OTP
    stage, ≤30 min) restarts in the general flow; authenticated helper onboarding routes
    (`/finalize`, `/w9`, ...) are unchanged.

12. **Publishing a new business/restaurant needs an approved application** under
    `ACCESS_BUSINESS_ENFORCEMENT=enforce` (`business.own`; a restaurant accepts
    `restaurant.own` or `business.own`; self grant or a grant for that business). Creating and
    editing a private draft stays open to everyone. Default `off` (legacy: anyone may publish);
    run `shadow` first and watch `access.shadow_mismatch gate=business_publish`. Already
    published businesses are untouched.
13. **No ownership claims through applications.** An application may name an existing
    business only if the applicant is already its canonical owner; someone else's id answers
    404 like an unknown id. Ownership transfer/claims of existing businesses stay a
    support/admin process.
14. **Managers can't lift or change an override the owner placed**, and can't touch overrides
    for permissions they don't hold themselves (those survive a manager's edit). Only the
    owner (or another owner) changes them.
15. **Scheduled broadcasts whose scheduler lost authority go back to draft** at send time
    (scheduler = `queued_by`, else `created_by`; must still be owner or active manager). The
    alternative — sending anyway because a manager approved it earlier — was rejected as
    unsafe. Legacy scheduled rows with neither column set also return to draft.
16. **Lead access now requires the `leads.*` permissions** (employees and support agents lose
    the lead list they could previously read); quoting needs `quotes.create`.

## Next step

WP-007 done: `services/access/evidence.js` — Didit verified/duplicate and Stripe Identity
verified callbacks bump `evidence_revision` on the same user's open applications (stale
reviewer decisions then 409 `request_version_conflict`); `GET /api/admin/access-requests/:id`
returns `readiness` (identity facts). Background-check callbacks: none exist in the code
base yet — wire `recordIdentityEvidence` (or a sibling) when one is added.


WP-015/016 done: `client/src/utils/accessProjection.js` + `hooks/useAccessProjection.js`;
`ModeHomeRoute` and `Navbar`/`navbarNavigation` honour `default_mode` only while the
projection backs it (else personal Home + `role="status"` notice), approvals add account-menu
shortcuts, Settings › Applications re-reads on focus and announces changes politely.
**Deploy order:** turn `ACCESS_PROJECTION_ENABLED` on only after the backfill `--apply`
(otherwise legacy helpers without a grant are shown the personal Home).

WP-020 done: notification copy in all 20 locales (`services/access/outboxCopy.js`), real
`sendNotification` dedupe across a worker timeout, owner-only link (DB test).

WP-046 done: per-owner advisory lock in `addBusiness`/`setPrimary` (fixes a pre-existing
500 on concurrent creates hitting `idx_businesses_one_primary`), claim restriction in
`accessService.resolveSubject`, `services/access/businessGate.js` publish gate.

WP-047 done: no server change needed — `requireBusinessAccess` resolves membership per
request from the URL entity and `user_workspace_contexts` is display-only; proven by
`progressiveAccessWorkspace.db.test.js`. Switcher role label now translated
(`progressiveAccess.orgRoles.*`).

WP-048 done: `setMembershipOverrides` locks the target membership, rechecks the grantor's
active role inside the transaction (`grantor_standing_changed`), and keeps owner-placed or
out-of-scope overrides when a non-owner edits (`override_protected`). DB evidence in
`progressiveAccessOverrides.db.test.js`.

WP-049 done: scheduling was already tenant- and store-scoped (`restaurantWorkforceScope`);
fixed `deleteShift` answering 200 for a foreign/unknown shift id (now 404; an already-cancelled
own shift stays an idempotent 200). Evidence in `progressiveAccessSchedule.db.test.js`.

WP-050 done: business message queue/read/reply/templates were already assignment-scoped
(`requireBusinessMessageAccess`); fixed the attention inbox, which counted (and showed customer
names for) every business conversation regardless of message permissions or assignment —
`services/attention` now resolves effective permissions (fail-closed) and the messages adapter
filters to assigned conversations without `messages.view_all`. Template delete/use with a
foreign/unknown id now 404. Evidence in `progressiveAccessMessages.db.test.js`.

WP-051 done (evidence only): Customer 360 was already permission- and assignment-scoped and
business-keyed; `progressiveAccessCustomer360.db.test.js` proves one account as customer and
employee cannot see another business's record, unassigned customers, or wallet data.

WP-052 done: `/leads` and `/lead-pipeline` routes now need `leads.view|create|edit` /
`quotes.create` (were any-member); legacy `/api/leads/business/:id` and `/api/leads/:id` need
`leads.view` for non-owner members; pipeline quote/delete on another business's lead → 404;
`broadcastDeliveryService.promoteScheduled` re-checks scheduler authority (decision 15).
Evidence: `progressiveAccessLeads.db.test.js`. **Pre-existing bug noted, not fixed:**
`businessLeadPipelineController` create/update/quote insert columns (`name`, `email`,
`amount_cents`, `valid_until` …) that the `business_leads`/`lead_quotes` schema
(`076b_business_leads_phase5.sql`) does not have — those endpoints 500 against a real DB.

**Exact next action (resume here):** Phase 3 continuing
at WP-053 (catalog, pricing rules and marketplace publishing; SPEC.md line ~3271). Small open items: a login-path test for WP-004; helper-only routes still using
`req.user.role === 'helper'` (`rg "role !== 'helper'|role === 'helper'" server/routes
server/controllers`) should move to `isHelperActor(req)` + `requireHelperCapability`.

History of what is done (newest last):


Done so far: registry/lifecycle/resolver/legacyMapping (`server/services/access/`), D1–D7 tests,
migration `20261116131500_progressive_access.sql`, `accessService.js` + `reviewService.js`,
`controllers/progressiveAccessController.js`, `routes/progressiveAccess.js` (mounted in
`server/index.js`), DB suite `__tests__/progressiveAccess.db.test.js` (CI env
`ACCESS_TEST_DATABASE_URL` added to "Server regression and security tests").

Also done: outbox job (`services/access/outboxWorker.js`, started from
`bootstrap/backgroundWorkers.js`), backfill (`services/access/backfill.js`,
`scripts/access-backfill.js --dry-run|--apply [--resume <runId>]`).

Also done: customer-first signup server side (WP-001..003) behind
`ACCESS_CUSTOMER_FIRST_SIGNUP` — `services/access/signupIntent.js`, wired into
`authController.startRegistration` / `verifyRegistrationOTP`; response adds
`access.signupIntent` + `access.nextStep`; `GET /api/me/access` returns `signupResume`.
Test: `__tests__/progressiveAccessSignup.db.test.js`.
**Pre-existing bug fixed on the way:** `verifyRegistrationOTP` INSERT referenced
`pending.signup_device_fingerprint` as SQL text (42P01) so every general-signup OTP
verify 500'd on old-files-claude; now passed as `$23`.

Next (in order):
1. (done) WP-005 + WP-004/WP-013 server gate: `services/access/modeGate.js` — with
   `ACCESS_CUSTOMER_FIRST_SIGNUP` or `ACCESS_LEGACY_SWITCH_RETIRED` on, profile/mobile
   mode writes that would lift `customer` to a helper-class role without a held capability
   are ignored (`mode_change_ignored`), switch-role returns 403 `access_required`, and login
   ignores the mode. Test `__tests__/progressiveAccessModeGate.db.test.js`. Still to do:
   a login-path test (WP-004). AC-005 is covered in the signup DB suite.
2. (server part done) Helper enforcement WP-026: `middleware/requireAccess.js`
   (`requireHelperCapability`, `isHelperActor`) on `POST /api/bids`, `PUT /api/bids/:id`,
   `POST /api/bids/:id/reconfirm`; `requireHelperWorkEligible` and `bidController.createBid`
   use `isHelperActor` (enforced grant satisfies the legacy role test — needed because the
   Credit trigger `oxsteed_credit_user_role_guard` keeps Credit users at role `customer`).
   Rollout: run backfill `--apply` first, then `shadow`, watch `access.shadow_mismatch`
   logs, then `enforce`. `jobController.assignHelper` also refuses to hire a helper whose grant is not effective (409 `helper_access_inactive`). Remaining: helper
   onboarding steps (`requireHelperStep`) and other helper-only routes (`rg "role !== 'helper'"`).
3. Client (partly done): `client/src/api/access.js` (all applicant + reviewer calls, auto
   Idempotency-Key), `client/src/pages/Settings/ApplicationsPage.jsx` at
   `/settings/applications` (held capabilities, applications with status/reason/info request,
   draft editor rendering the policy form, submit/resubmit/withdraw, version-conflict reload,
   `?request=<id>` deep link used by the outbox notification), Settings → Security card shown
   only when `flags.accessRequests`. Copy lives in `common.json` → `progressiveAccess.*` for
   all 20 locales, generated by `python3 docs/progressive-access/tools/access_i18n.py`
   (edit KEYS/T there, re-run; `npm run verify:i18n` must pass — it rejects English copy in
   other locales). Done since: admin queue `client/src/admin/pages/AccessRequestsQueue.jsx` at
   `/admin/access-requests` (manifest grant `review_access_requests`, nav entry, server SPA
   allowlist), JoinPage follows `access.nextStep`. Done: JobDetailPage shows an Applications link on `access_required` (the shared axios must NOT get a response interceptor — see `api/axios.js` note). Client build (`npx vite build`) passes.
4. Phase 3 (WP-046..073) business/restaurant, Phase 4 (WP-074..103), Phase 5 (WP-013).
