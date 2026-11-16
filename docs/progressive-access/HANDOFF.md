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
  `ACCESS_LEGACY_SWITCH_RETIRED`.

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

## Next step

**Exact next action (resume here):** WP-007 "Verification and provider callbacks" — make
identity/background-check provider callbacks (Didit, helper onboarding) record evidence
on the open `helper.offer_services` request (bump `evidence_revision`) instead of changing
`users.role`; then WP-015/WP-016 (Home + nav read `GET /api/me/access` `personal[]` instead
of `default_mode`), then WP-020 remaining (outbox → in-app badge), then Phase 3 starting
at WP-046. Small open items: a login-path test for WP-004; helper-only routes still using
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
