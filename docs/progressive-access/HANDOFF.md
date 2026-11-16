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
  `ACCESS_LEGACY_SWITCH_RETIRED`, `ACCESS_BUSINESS_ENFORCEMENT` (`off|shadow|enforce`, WP-046),
  `ACCESS_CONSULTANT_ENFORCEMENT` (`off|shadow|enforce`, WP-074),
  `ACCESS_INVESTOR_ENFORCEMENT` (`off|shadow|enforce`, WP-077).

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
17. **Waitlist and client-package lists are no longer any-member**: employees/support agents
    lose the business-wide waitlist (needs customers.view_all or calendar.view_all) and see
    only the client packages of customers they serve.
18. **Opening a draft restaurant storefront needs the owner's approval**, even when a manager
    presses the button (the approval belongs to the canonical owner, not the operator).
19. **Managers cannot change their own or a peer manager's store boundary**, nor hand
    out a store role at their own rank; only the owner (or a higher role) can.
20. **Store-scoped staff cannot change the shared (brand) menu**; they 86 items or set
    store prices through their store's menu. Shared-menu edits need all-store scope.
21. **Menu photos vs prices share one permission (`menu.manage`).** The spec asks to tell
    them apart; adding a `menu.media` permission needs a catalog migration and role
    defaults. Left as-is (safest: no one gains access). Say if you want the split.
22. **Offline sales from a removed cashier are held, not posted.** When a hub replays after
    the drawer's cashier lost access, a manager must requeue or void the sale. The cash
    was collected, so this only delays posting. Native builds/hardware still need a
    human test-mode check.
23. **Statements: managers need `payouts.view`, store managers see no restaurant-wide
    settlement.** Managers have `payouts.view` by default, so nothing changes until an
    owner denies it ("staffing only"). A manager limited to some stores no longer sees the
    whole restaurant's settlement statement.

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

WP-053 done: product/rule/tier writes were already business-keyed; fixed a product pricing
rule being creatable against another business's product id, rule delete answering 200 for a
foreign id (now 404), and added audit entries for product pricing rule create/update/delete
and bulk tier changes. Evidence: `progressiveAccessCatalog.db.test.js`.

WP-054 done: business invoices were already finance-role gated with the owner as issuer and
helper invoices confined to `business_id IS NULL`; recurring generation is idempotent per
period. Fixed `businessFinance` quote and expense routes (`:quoteId`/`:expenseId`) whose
controllers read `req.params.id` — get/update/send/delete silently did nothing — and made
quote/expense/recurring deletes 404 for unknown ids. Recurring billing has no unattended
scheduler (generation is a manual manager action), so revocation stops it. Evidence:
`progressiveAccessInvoices.db.test.js`.

WP-055 done: waitlist list needs `customers.view_all|calendar.view_all` (matches the hub tab
gate), update/remove need `calendar.manage_all` (were any-member); client packages list needs
`customers.view_all|view_assigned` and, without view_all, shows only customers the member
serves (an appointment with them as staff); redeem needs `calendar.manage_all|manage_self`,
self-only redeems only for served customers (404 otherwise). Evidence:
`progressiveAccessPackages.db.test.js`. (Decision 17.)

WP-056 done: Stripe Connect callback was already bound (signed state + browser nonce cookie +
one-time fingerprint + owner recheck at consume) — now evidenced on real Postgres. Fixed:
`GET /integrations` and `GET /webhooks` (Stripe account id, webhook URLs that may carry
tokens) were any-member → need `settings.integrations`; webhook delete for a foreign id → 404.
Evidence: `progressiveAccessIntegrations.db.test.js`. Brand attach/detach (restaurantBrands)
left as is (resource-scoped, covered by brand tests).

WP-057 done: requester (tenant) view of a maintenance request and `/my` no longer include
`owner_notes`, and event notes are shown to the tenant only when flagged `tenant_visible`
(older events stay hidden); an assigned helper who is not on the team can progress the work
but gets 403 `assignee_scope` for reassigning or writing internal notes; compliance records
reject a `unit_id` from another business (404). **Real bug fixed:** every
`PATCH /api/maintenance-requests/:id` returned 500 on PostgreSQL ("inconsistent types deduced
for parameter $1") — status param now cast. Evidence: `progressiveAccessMaintenance.db.test.js`.

WP-058 done: new `server/utils/sameBusinessRefs.js` (`assertBusinessRefs`) — trades,
creative, professional and beauty controllers now 404 when a body references a quote,
diagnostic/intake/engagement request or appointment of another business, or assigns a
non-team user as beauty staff (FKs only proved the row existed somewhere). Public intake
(`middleware/publicIntake.js`) also strips `linked_quote_id`, `linked_appointment_id`,
`assigned_staff_id`, `assigned_helper_id`, `quote_id`. Not changed: trades
`assigned_helper_id` on member writes may still name an outside helper (contractors).
Evidence: `progressiveAccessTemplates.db.test.js`.

WP-059 done: `/health-alerts` list/generate/dismiss need `analytics.view_summary` (were
any-member; matches the hub tab gate); the `overdue_invoices` alert is shown/dismissable only
with `invoices.view` or `analytics.view_financial`; dismissing another business's alert → 404.
**Real bug fixed:** `generateAlerts` always returned 500 — its upsert used
`ON CONFLICT (business_id, alert_type)` and `updated_at`, neither of which exist (migration
242); now update-then-insert under an advisory lock. Evidence: `progressiveAccessHealth.db.test.js`.

WP-060 done: `PATCH /api/restaurants/:id/publishing` with `status: active` on a draft store
now runs `businessGate.checkPublish` for the canonical owner (`owner_user_id`) and the
store's business (403 `access_required` + `next` under enforce; no query when off). Paused →
active is untouched. A manager cannot publish when the owner lacks approval (decision 18).
Two-applications conflict is already prevented by WP-046 (`resolveSubject` requires the
applicant to own the business). Evidence: `progressiveAccessRestaurant.db.test.js`.

WP-061 done: store-scoped staff were already confined (F-02: `requireBrand` keeps
store-scoped managers off `location-access`; store menu checks `getLocationRole`). Added
`assertWithinCallerScope` in `restaurantLocationAccessController` (replace/clear): no
self-edit, no editing a peer/higher membership, no store role at/above own rank, no
location outside own stores (decision 19). Evidence: `progressiveAccessRestaurantStores.db.test.js`.

WP-062 done: `foodController.assertBrandMenuManage` (menu.manage + all-store scope) on the
10 shared-menu mutations (categories, items, duplicate, modifier groups);
`GET /food/restaurants/:id/menu/manage` returns `canEditBrandMenu`; `RestaurantMenuManager`
hides edit affordances and shows `progressiveAccess.menu.storeScoped` when false
(decision 20). Public storefront reads unchanged. Evidence: `progressiveAccessRestaurantMenu.db.test.js`.

WP-063 done: `foodController.updateOrderStatus` now re-reads the actor's
`business_members` row `FOR SHARE` and recomputes `getLocationScope` with the transaction
client (staff only; devices/owner unchanged). The DB test races a removal against a retry
and fails without the fix. Screen orders are device-location bound; customer cancel needs
the customer or the tracking token (both traced, unchanged).
Evidence: `progressiveAccessRestaurantOrders.db.test.js`.

WP-064 done (evidence; the code change was WP-062's `assertBrandMenuManage`): brand
publish already requires `menu.manage` on source+targets and all-store scope; store menu
pricing needs `menu.manage`, 86 needs `pos.use|kitchen.update`. There is no separate
media permission today — decision 21. Evidence: `progressiveAccessRestaurantCatalog.db.test.js`.

WP-065 done (evidence only): `restaurantHostingController` already resolves the location
via `assertLocationAccess` and binds tables to that location; host actions need
`restaurant.manage|pos.use|orders.manage`, so team/calendar overrides do not imply hosting.
Evidence: `progressiveAccessRestaurantHost.db.test.js`.

WP-066 done: `restaurantInventoryOperationsController` — `requireAllStoreInventory` on
`createArea`/`createSupplier` (both upsert restaurant-wide rows), `assertTeamUser` for
`responsibleUserId`. Supplier catalog already checks the item's store. Cashier/drawer/
device/receipt isolation is the existing CI suite `restaurantStoreIsolation.db.test.js`.
Evidence: `progressiveAccessRestaurantInventory.db.test.js`.

WP-067 done: in `restaurantAppFlowController`, `getKitchenFeed` and `ackKitchenTicket` now
bind a paired display (`req.displayDevice.locationId`) to its store (they were
restaurant-wide; the DB test fails without the fix). Pre-existing bug fixed: ticket ack
always returned 500 on PostgreSQL (`$1` varchar/text inference; `accepted_at` compared
`$2`, the promised time). Pairings without a store stay restaurant-wide (legacy).
Not covered yet: personal details on public queue boards (queue_board feed). Check it
under WP-068/069 if they touch queue screens.
Evidence: `progressiveAccessRestaurantDisplays.db.test.js`.

WP-068 done (evidence only; inventory already checks `assertExistingItemLocationAccess`).
Note: the Employee role has `inventory.update` by default; the test promotes a
Representative. Permission cache is 30 s per instance (`invalidateCache` on change).
Evidence: `progressiveAccessRestaurantStock.db.test.js`.

WP-069 done (evidence only): crew shifts check `assertManage` + store scope (composite FK
blocks foreign stores); payroll export needs `payroll.view` (Owner-only by default) and
`assertLocationAccess`. Role changes need `role_updated_by = owner` (DB trigger).
Evidence: `progressiveAccessRestaurantCrew.db.test.js`.

WP-070 done: `runnerWorkspaceController.getUnifiedInbox` offered open tasks (customer name,
order metadata) in every workspace the user belonged to; offers now need
`runner.update|runner.manage|orders.manage` there (fail closed). Assigned tasks stay
visible; handoff already lets the assigned runner finish. Claims were already scoped.
Evidence: `progressiveAccessRestaurantRunner.db.test.js` (fails without the fix).

WP-071 done: `validateCrewAssignee(restaurantId, assignee, locationId)` now also requires a
store-scoped assignee to work at the task's store (create and reassign). SOPs/checklists
are brand-level (`assertManage` + `requireBrand`), so store managers do not author them.
Evidence: `progressiveAccessRestaurantOps.db.test.js`.

WP-072 done: `storeHubService.replayOneSale` now checks `cashierStillAtStore` (owner, or
active member with no store boundary or this store) and otherwise holds the sale with a
review message (decision 22). Resolve stays behind `pos.manage` + store scope. Screen
offline tickets allow only pay-at-counter, so no offline card capture exists to double.
**Needs a human:** the spec asks the native integration owner to verify real
RestaurantTerminalOffline builds and hardware with test-mode providers — not done here.
Evidence: `progressiveAccessRestaurantHub.db.test.js`.

WP-073 done: new `services/access/financeStanding.memberHasFinanceRead` (manager role +
effective `payouts.view` + no store boundary for a restaurant statement). Used by
`settlementStatementArchive` and `statementInvestigation` (`assertMerchantFinanceStanding`)
and `statementCenterService.buildRestaurantSettlement` (decision 23). Downloads re-check on
every request, so old links die with the standing. Ledgers/currency untouched.
Evidence: `progressiveAccessRestaurantStatements.db.test.js` (fails without the fix).

WP-074 implemented in `40573c463`. With `ACCESS_CONSULTANT_ENFORCEMENT=enforce`,
an effective `consultant.accept_paying_clients` grant is required for a consultant's
assigned referral to move to engaged or won. Off and shadow retain the legacy
approval decision. The update locks the assignment and grant, and commits the
status and referral log together. Setup and unpaid or closing updates on assigned
work remain available. Former assignees lose the referral and its activity.
The customer-facing business launch history now excludes consultant notes and
compensation fields. The contractor dashboard links to Applications when allowed,
and approved consultants get a shortcut while keeping customer navigation.
The disposable PostgreSQL run also caught and verified the fix for a pre-existing
status update 500 from conflicting SQL parameter types. Three focused server
suites passed (43 tests), the frontend reference check and navbar tests passed,
and `npm run build:ci` passed. AC-050 has partial evidence.

WP-075 implemented in `8fbe8b4e7`. Enforce mode resolves the assigned consultant's
grant for public slots, new scheduled sessions and payment intents, and final
confirmation. Existing sessions can be read after expiry. Checkout ownership,
completed payment checks and admin booking authority are retained. The pending
session insert is replay-safe, and concurrent confirmations for the same
consultant and local date serialize before checking for overlap. Migration
`20261116160500_fix_consulting_availability_slots.sql` replaces the pre-existing
unsupported `generate_series(time, time, interval)` call with local timestamp
arithmetic. It applies on the disposable PostgreSQL database, migration history
validation passed, and six targeted server suites passed (54 tests, no skips).
Real provider payment and browser acceptance remain open.

WP-076 server checkpoint `954117d8a`. Signed-in Business Launch intake persists
with its requester. Verified email may recover guest records; linked records keep
their owner. Enforce-mode market matching and referral assignment require an
effective consultant grant. Reassignment clears the former adviser's status
notes and timestamps. Four focused server suites passed (37 tests), including
the full intake and assignment flow, an independently pending Owner application
with zero Owner grants, and participant-scoped consulting action items.

WP-014 session isolation in `47fcd2ff2`. The Home, navbar and Settings projection
now shares work only within the same verified account and auth epoch. The API
returns the responding account ID, so a changed cookie in another tab cannot
publish access under the earlier account before the session event arrives.
Applications resets its local view on the same boundary. Verified two mounted
hook consumers in Chrome with delayed old-session responses, same-account
relogin, mismatched cookie identity, and a successful refresh. The existing
navbar browser test, two PostgreSQL suites (23 tests), frontend references
(1,241 files), and `npm run build:ci` (1,202 verified assets) passed.

WP-076 linkage checkpoint `13a79c2aa`. Owners can start a new proposal draft
from Applications and open the existing intake from that record. A signed-in
applicant can link their own open ownership application during intake. Coming
back to Settings shows the latest non-archived advisory status beside the
separate application status. Foreign accounts and guests cannot submit a link,
and the adviser view contains no application identifier. The migration applied
in disposable PostgreSQL and passed the immutable history check. Five server
suites passed (52 tests). Chrome exercised the real Applications and intake UI
through the whole form with fixture responses. `npm run build:ci` passed. The UI
reuses existing strings verified present in all 20 locale catalogs.

WP-076 attachment checkpoint `3b7991c1a`, with applicant controls in
`3e2fded67`, consultant controls in `50032e617`, and the browser fixture in
`19c531b5b`. Private case objects now use
`business-launch/private/<request-id>/...` and only the applicant, current
assigned adviser, or an operations reviewer can list or download an attachment.
Visibility is explicit, and the uploader can remove their own file. The object
key is never returned to the browser. PostgreSQL coverage includes a signed
download, shared/applicant-only/adviser-only cases, copied-case denial, and a
former adviser's denial after reassignment. The migration and route use the
existing upload validation, malware scan, private storage, signed URL, and
deletion-queue primitives. The applicant Business Launch status modal now lists,
downloads, uploads, and removes files using only server-provided metadata. The
UI keeps shared and applicant-only visibility choices inside the selected
request. The assigned consultant referral card now lists shared/consultant-only
files, supports explicit upload visibility, and keeps the ownership application
identifier out of the consultant response. The browser fixture covers shared
versus applicant-only controls. Live acceptance and exact-head CI remain open.

WP-077 is in progress at `e48738e84`, `0b45ff681`, `ad95b1a09`, `d2346b1e4`, `04e097b34`, `1a9775db2`, and `eb280311e`. The mounted KPI route
test proves the old array-to-variadic denial and the corrected legacy role
path. Migration `20261116170000_investor_reporting_audiences.sql` now creates a
named dataset audience when an investor request is approved; enforce mode
requires that live audience, rejects expiry/revoke, and rejects a route whose
dataset is not in the audience. The focused DB case and seven-case mounted
route suite pass locally. The dashboard projection now carries the current
audience and the browser fixture proves an `overview + revenue` audience calls
only KPI and revenue routes; franchise, supply-demand, and evidence panels are
not fetched/rendered without their datasets. The evidence entry point is
`/investor/evidence/:metric`; no separate investor export route is registered,
so export remains an explicit later package rather than an invented client path.
**Exact next action (resume here):** add a projection/browser regression for an
approved investor whose grant is revoked or expires while the dashboard is
open. Confirm the customer workspace remains available, investor-only data is
cleared, and no stale investor request crosses the account/session boundary.
That regression is now `investorDashboard.revocation.browser-check.cjs`: it
holds KPI/chart responses, revokes the projection, confirms the customer home,
and then releases the stale responses without rendering their values. The
applicant audience form, reviewer confirmation, narrowed dashboard fixture,
projection mapping, and dataset-aware loading are complete.
**Next package:** begin WP-078 (franchise application, review, and territory).
First mount the declared franchise routes and document whether the existing
application/territory records can be connected to progressive grants without
granting an unscoped territory or changing `users.role`.

WP-078 is now in progress at `83c6c82a9`; the latest pushed UI checkpoint is
`4140a091a` and the admin acceptance checkpoint is `179378c97`.
`franchise_applications` already
contains the applicant/owner, approval status, linked business, and desired
territory fields; there is no separate territory-assignment table. The safe
boundary is therefore an active `launched` application with a non-null linked
business, and the territory routes are gated by `franchise.operate` under
`ACCESS_FRANCHISE_ENFORCEMENT` while the applicant status routes stay readable.
The mounted route suite (`server/__tests__/franchiseRouteAccess.test.js`)
passes for off/enforce/denied cases.
The territory page is at `0dd3848bf`: it reads `{ access, flags }`, makes zero
API calls while the progressive grant is absent, loads stats/helpers after
grant refresh, and clears the rendered territory after revoke
(`franchiseTerritoryAccess.browser-check.cjs`). The application/status surface
and its franchise quick links are now projection-aware at `4140a091a`; the
browser fixture proves an approved customer-class applicant has no territory
link, an activated owner gets both entry points after the grant appears, and a
revoked grant removes them again.
`franchiseAdminAccess.browser-check.cjs` now exercises the real HQ review and
activation controls: activation grants owner A, reassignment grants owner B and
records A revoked, and a rejected status records B revoked. Together with the
disposable PostgreSQL test and the applicant/territory browser fixtures, this
covers the local activation, reassignment, and revoked-link acceptance path.
**Exact next action (resume here):** perform populated live territory acceptance
with the real approved/activated owner and a second non-owner account while
`ACCESS_FRANCHISE_ENFORCEMENT` is enforce, recording the projection response,
territory API calls, and revoke/reassignment behavior without changing
`users.role`. If live credentials or populated records are unavailable, record
that limitation and keep the exact-head CI link open before moving to WP-079.

WP-079 now has checkpoints at `61042175e` and `c3d7c081e`. The client projection maps
`logistics` to `logistics.ship`, so an unapproved or revoked logistics preference
falls back to Customer Home. An approved logistics grant adds a `/logistics/buyer`
account shortcut without replacing Customer Home, and an actively selected
logistics preference still lands in the Buyer workspace. Buyer checkout and
read/history routes remain customer-permitted; this package must not turn a
pending organizer application into a checkout denial.
The focused server acceptance now passes: `logisticsPaymentAttempts.test.js`
explicitly checks a customer with `organizer_access: pending` can create a
checkout attempt, while the existing buyer warehouse/payment/refund suites pass
65/65 with own-record scoping and foreign-record denial. The responsive browser
fixture (`logisticsCompletion.browser-check.cjs`) also switches to that pending
customer before checkout and passes account-isolation and stale-context checks.
**Exact next action (resume here):** continue WP-080 (logistics pooled
campaigns). WP-079's focused buyer/checkout work is complete locally; its
populated live acceptance and exact-head CI remain open.

WP-080 is in progress at `e5c66e332` (server role derivation), `b3e5cfcf3`
(customer-view organizer shortcut), `46e21611c` (pooled campaign lifecycle
acceptance), `20983e644` (review publication and placement visibility), and
`77e317c06` (safe rollover and sharing).
When `ACCESS_PROJECTION_ENABLED` is active,
`resolveLogisticsRole` checks the progressive self grant before falling back to
the legacy buyer/business role; this keeps organizer submission and ownership
checks server-authoritative while avoiding a mode or role write.
`server/__tests__/logisticsPooledOrders.test.js` now exercises an approved-grant
customer through campaign create, own-draft edit, submission, review-state read,
Operations publication, and placement approval visibility, while a pending
customer can publicly browse/join but is denied foreign draft submission and
editing. `client/scripts/logisticsProgressiveOrganizer.browser-check.cjs`
renders the production navigation projection and `NewCampaignPage`, follows the
Organizer shortcut, and verifies the campaign form returns to the Organizer
workspace; revoking the projection removes the shortcut.
The organizer-only `POST /api/logistics/campaigns/:id/rollover` route requires
an expired below-MOQ campaign and creates a clean draft without carrying
participants, funding, supplier quote, or approval state. `CampaignPreview`
shares the canonical read-only public campaign URL through Web Share or the
clipboard, with localized copy in en/es/fr/ht/ar. Focused server suites (109
tests), the browser fixture, frontend reference scan, inline-style guard, and
`npm run build:ci` pass locally; build emitted 1,203 assets.
**Exact next action (resume here):** run exact-head PR CI and attempt populated
live campaign acceptance (or record the unavailable-data limitation). WP-081 is
now checkpointed locally and the next implementation package is WP-082
(Logistics distribution and fulfillment). Do not claim live acceptance or remote
CI until observed.

WP-081 is checkpointed at `1e89d5ca2` (business-scoped procurement and sourcing).
The recurring-program service now resolves owner, manager, and effective
permission-based procurement authority on the canonical business, rejects
missing or unauthorized `business_id` values, and hides unscoped personal
programs from procurement listings. Sourcing requests use the same authority
for create, list, and request-detail access, and a linked request must belong to
the selected business. `BusinessProcurementPage` now requires a business
selection, filters linked requests to that business, and sends the canonical
business ID on program creation. Focused server suites (138 tests) and the full
client build gate (1,203 assets) pass locally.
**Exact next action (resume here):** inspect WP-082's distributor assignment,
shipment, warehouse, and revocation boundaries; add server-authoritative
assignment checks and browser evidence before moving to WP-083.

WP-082 is checkpointed at `5f666d8cc` (assigned distributor delivery access).
`requireDeliveryActor()` now permits operations staff or a reseller/franchise
buyer whose `delivery_orders.assigned_to` still matches the authenticated user;
changed or revoked assignments fail closed before a status update. Delivery
reads include assigned distributor records without widening ordinary buyer
visibility, and the existing delivery state machine remains the only mutation
path. `logisticsDistributorAssignment.test.js`, warehouse transition tests, and
buyer warehouse-read tests pass together (149 tests).
Browser evidence and populated live fulfillment acceptance remain open.

WP-083 is checkpointed at `c5c9c975b` (internal operations/compliance separation).
The admin router now gives operations and compliance sessions read-only access to
the restrictions and supplier records they need to inspect, while restriction
writes remain behind the compliance workspace and supplier writes remain behind
admin RBAC plus the explicit `logistics.procurement` grant. The restricted-PO
approval handler now refuses non-restricted orders and writes a structured audit
entry containing the before state, after state, current staff actor, notes, and
request IP. `requireAnyInternalLogisticsWorkspace()` preserves route-specific
session and active-credential checks, and does not grant operations staff the
compliance approval route. `logisticsInternalWorkspaceBoundary.test.js`,
`adminBundleBRoutes.test.js`, `logisticsProcurementGates.test.js`, and
`logisticsRefundsRoutes.test.js` pass together (50 tests).
**Exact next action (resume here):** add browser evidence for the operations
read-only restrictions/supplier surface, operations denial of restriction or
supplier mutation, and compliance approval audit identity; then attempt
populated live approval acceptance. If the live environment is unavailable,
record that limitation and keep the exact-head CI link open before moving to
WP-084.

WP-084 is checkpointed at `5850cee40` (payment role and money-movement boundary).
The declared offline-payment confirmation route now re-checks the caller's
checkout restrictions at confirmation time, in addition to authentication and
impersonation rejection. The offline rail still enforces that the caller is the
job customer or assigned helper, that the job uses the offline rail, and that
the confirmation write is idempotent per job. `paymentRoleMoneyMovement.test.js`
passes the route contract. The real-PostgreSQL `paymentLayers.db.test.js` was
discovered but skipped locally because `JOB_EDIT_TEST_DATABASE_URL` is not
configured; populated retry/denial acceptance and exact-head CI remain open.
**Exact next action (resume here):** run the isolated payment-layers PostgreSQL
suite with a disposable database, add approved-versus-pending actor retry and
foreign-job denial evidence, then inspect WP-085 helper earnings/payout scope.

WP-085 is checkpointed at `7c9f70fe2` (helper payout destination access).
Payout-method create, update, and delete now pass through
`requireHelperCapability` before the existing TOTP and completed-onboarding
guards. Under helper-enforcement `enforce`, a customer-class account therefore
needs an effective `helper.offer_services` grant before changing a payout
destination; the existing controller still scopes every method query to the
authenticated user and keeps fresh TOTP required. `payoutAccessBoundary.test.js`,
`progressiveAccessHelperEnforcement.test.js`, and the existing payout
controller/security suites pass together (26 tests). Populated revoked-helper
payout acceptance and exact-head CI remain open.
**Exact next action (resume here):** run the isolated payout-method and helper
earnings checks with a disposable PostgreSQL database, verify historical
earnings remain readable after helper-work revocation while new payout changes
are denied, then inspect WP-086 Credit wallet isolation.

WP-086 is currently an evidence checkpoint rather than a source change. The
existing Credit conversion implementation already requires the actor to equal
the customer owner, locks and replays by idempotency key, checks quote customer,
status, expiry, amount and currency, re-runs sanctions at the money boundary,
and posts debit/fee/credit journal legs against that customer's source and
target wallets. `oxsteedCreditCurrencyConversion.test.js`,
`oxsteedCreditPhase6.test.js`, and
`oxsteedCreditControllerAmountAliases.test.js` pass locally (38 tests).
**Exact next action (resume here):** run the disposable Credit isolation suite
covering customer, merchant, restaurant and kiosk scopes; record any remaining
cross-wallet denial gap before beginning WP-087 statements and exports.

WP-087 is checkpointed at `5216d9091` (statement finance-standing separation).
The Statement Center now filters business manager scopes through the canonical
`payouts.view` permission while preserving owner access. The statement archive's
restaurant-document standing applies the same finance permission and store-scope
check, so an active operational member cannot discover or download settlement
documents without finance read. `statementFinanceBoundary.test.js` and
`statementCenter.test.js` pass together (15 tests). Disposable export/download
revocation and exact-head CI remain open.
**Exact next action (resume here):** run the statement archive/export suites with
a disposable PostgreSQL database, revoke business finance read during a staged
export, and verify the next metadata, detail, download, and rendition requests
all re-authorize against the current standing before moving to WP-088.

WP-088 is currently an evidence checkpoint rather than a source change. The
existing dispute controller verifies job-party ownership, preserves a 30-day
window and warranty barrier, and uses client-request idempotency for disputes,
evidence, and messages. Agent food refunds remain admin plus
`issue_refunds`-grant gated and reject impersonated sessions; Credit adjustment
mutations remain admin plus `manage_financials` and durable maker-checker gated.
`disputeOpenIdempotency.test.js`, `disputeEvidence.test.js`, `disputeW2.test.js`,
`agentFoodRefundActions.test.js`, and `agentCreditAdjustments.test.js` pass
locally (75 tests).
**Exact next action (resume here):** run the populated support/refund acceptance
with a view-only support actor, a legitimately privileged actor, and a wrong
business/context retry; then inspect WP-089 platform staff grants and governance.
Small open items: helper onboarding middleware and remaining helper-only routes
still using `req.user.role === 'helper'` (`rg "role !== 'helper'|role === 'helper'"
server/routes server/controllers`) should move to the same live capability marker.

WP-026 now also places `requireHelperCapability` before helper profile,
onboarding, listing, availability, personal-invoice, connect, instant-payout,
and payout-request surfaces. `requireRole` and onboarding/tax eligibility accept
that marker only for helper role groups. This keeps the off/shadow behavior
unchanged while allowing an approved customer-role helper to use those surfaces
when enforcement is on. The helper enforcement contract passes 23 tests, profile
buffer/gallery regressions pass 5 tests, and the populated personal/business
invoice boundary plus payout/auth contracts pass.

The latest server helper-compatibility checkpoint is `3307f4348` (with the
preceding profile/onboarding/listing/invoice checkpoints immediately before it).
The worktree is clean apart from the unrelated untracked
`docs/oxsteed-progressive-access-developer-handoff.md`. The four populated
WP-008 business suites pass together (41 tests), and PR Analyze is pending for
the exact pushed head.

The client capability checkpoint is now pushed at `3c954caed`: `AuthContext` now
reads the shared access projection and exposes `hasHelperAccess`, so an approved
customer-role helper can receive helper onboarding/bidding state without
changing `default_mode`; `jobDetailModel` consumes that capability-aware signal.
The focused job-detail and client projection contracts pass, and frontend
reference verification plus typecheck pass locally. The exact next action is to
record the CI result for `3c954caed`, then continue the remaining planned access
packages without removing the compatibility endpoint.

WP-017 is now an implementation checkpoint. The existing
session-epoch fence, cross-tab refresh lock, transient-refresh policy, cookie
CSRF boundary, and session-scope checks pass locally (32 unit/server tests).
The authenticated browser matrix in `client/scripts/loginSession.browser-check.cjs`
passed all 17 synthetic browser scenarios, including cross-tab account changes,
refresh fencing, logout propagation, stale-account protection, legacy-token
migration, and passkey hydration. Exact-head CI is the remaining verification
gap for this checkpoint.

WP-018 has been audited as the next in-progress package. Passkey registration,
TOTP enrollment, session-management routes, localized settings surfaces, and
unsupported-browser guidance are covered by 16 server tests and 7 client
contracts. The remaining evidence is a native authenticator/browser acceptance
run plus exact-head CI; do not treat static passkey contracts as proof of a
hardware-backed WebAuthn ceremony.

The capability-aware helper client surface checkpoint is also pushed in the
current worktree: messaging, calendar, invoices, marketplace recommendations,
and Settings now consume `hasHelperAccess` instead of requiring a legacy helper
role. The client contract suite passes 11 tests, frontend-reference verification
finds 0 issues, and typecheck passes. The next exact code action remains the
native authenticator acceptance for WP-018 after exact-head CI is observed.

WP-089 is currently an evidence checkpoint rather than a source change. The
platform governance routes (`server/routes/governance.js`) require both live
admin authentication and `requireSuperAdmin`; regular admin permission grants
and delegations re-check active user state, token/session revocation, expiry,
revocation, grantor authority, and the global-versus-regional boundary on every
request. `loadAssignedRegions` and `requireRegionAccessForUser` fail closed when
the current regional grant is missing or the authorization lookup is unavailable,
so a stale regional drawer cannot silently become unrestricted. The platform
support conversation queue checks the same live global `manage_support` standing
and a business-manager role falls through to the customer/business surface rather
than receiving platform-wide data. `workforce.test.js` plus
`analyticsGovernance.test.js` pass together (57 tests), and
`statementAdmin.test.js` passes (17 tests); the populated statement DB suite is
environment-gated and was skipped without `STATEMENT_JOB_TEST_DATABASE_URL`.
**Exact next action (resume here):** run populated regional staff/grant fixtures
where a reviewer loses one region while an approval drawer is open, then repeat
the support/refund acceptance from WP-088 with a view-only support actor, a
privileged actor, and a wrong-business/context retry; WP-090's identity
boundary checkpoint follows below.

WP-090 now has a focused identity-boundary checkpoint at `e7e920d0d`. The
internal workspace controller and `canUseInternalAccessRoute` check the live
employee department assignment before loading catalog, permissions, or roster
data; consumer role and location preference do not grant entry. The regression
suite `server/__tests__/internalWorkspaceAccess.test.js` covers a same-location
customer denial, an active employee entering the matching department, and
assignment removal denying access before downstream reads (3 tests).
**Exact next action (resume here):** run populated staff-login fixtures with a
consumer and an employee sharing location data, revoke the employee's active
assignment, verify the internal route is denied while customer features remain
available, then continue to WP-091 analytics and telemetry audiences.

WP-091 has a source checkpoint at `8877b58ee`. The helper-owned promotion
analytics routes now use `requireHelperCapability`, matching the existing
progressive helper gate used by bids and payout destinations. Under enforcement,
a customer-class account without `helper.offer_services` receives
`access_required`, an approved customer-class helper can read performance, and a
legacy helper with a revoked grant cannot record shares. The focused route and
helper-enforcement suites pass together (21 tests).
**Exact next action (resume here):** run populated analytics fixtures comparing
ordinary customer, business manager, investor, and staff requests across the
aggregate/detail/export/cache paths, then verify consent and row filters agree
before continuing to the WP-092 checkpoint below.

WP-092 is currently an evidence checkpoint. Progressive access decisions emit
their own durable `access_outbox` events and projection bumps; they do not call
campaign delivery. Growth activity ingestion independently requires the
consent/jurisdiction gate (including GPC opt-out handling), and scheduled offer
delivery re-resolves the current regional authorization before queueing. The
focused growth/telemetry/outbox suites pass (40 tests); the populated promotion
analytics database suite is environment-gated and skipped without its disposable
DB URL.
**Exact next action (resume here):** run the populated old-fixture mode-toggle
and capability-approval scenario, count only the intended access transition and
retry events, and verify no campaign is sent without current consent and segment
eligibility before moving to WP-093.

WP-093 is currently an evidence checkpoint. `connectorAuth` resolves the API-key
holder from the live users table, requires an active admin role and enrolled 2FA,
and each sensitive route rechecks the shared active grant/delegation lookup.
Regional grants cannot authorize global connector actions. Signed partner
postbacks independently bind to an active partner and matching click/company
context, reject stale or mismatched signatures, deduplicate event identity, and
enforce allowed status and amount transitions. The connector, hardening, and
partner-growth suites pass together (78 tests).
**Exact next action (resume here):** run a populated connector/partner fixture
with a human capability token against a machine-only route, then revoke the
connector grant and replay the signed callback against a different company;
verify both are denied without changing the authorized path before moving to
WP-094.

WP-094 is currently an evidence checkpoint. The moderation and safety surfaces
keep domain holds independent from progressive access: approving a capability
does not clear a media safety state, tool `moderation_hold`, profile-visibility
override, user restriction, or SOS incident. Reinstatement remains an explicit
domain action with its own audit trail. The focused media safety, moderation
hold, profile visibility, and SOS suites pass together (37 tests); 10 populated
media DB tests are environment-gated and skipped locally.
**Exact next action (resume here):** run a populated suspended-provider fixture
where access approval occurs before reinstatement, verify new offer/publish
attempts remain blocked, then perform the authorized reinstatement and check
that only the intended scope changes and the evidence remains traceable before
moving to WP-095.

WP-095 is currently an evidence checkpoint. The generic upload surface always
stores private objects under user-scoped keys and mints short-lived signed URLs;
it refuses caller-requested public visibility and deletes an object if signing
or persistence fails. Existing shipment-document and consultant launch
attachment paths re-check current actor/request scope and reject cross-request
or cross-conversation keys. The focused upload, shipment, and consulting
attachment suites pass together (40 tests); the populated consultant DB suite
is environment-gated and skipped locally.
**Exact next action (resume here):** run a populated private-request fixture
through unauthenticated access, a different reviewer, revoked reviewer, signed
URL replay, and unsafe-file cases, then confirm public Media and food assets
remain unaffected before moving to WP-096.

WP-096 is currently an evidence checkpoint. Paid product entitlement is now
derived from the current product tier and billing status exposed by the auth
identity, while helper capability remains a separate progressive-access
precondition. An active paid tier and first-year trial continue to unlock
Pro-only product surfaces; an explicitly expired or cancelled paid product tier
does not. Legacy membership entitlements remain supported, and a subscription
renewal updates billing state without minting or duplicating an
`access_grants` row. The helper enforcement, subscription lifecycle, QR, paid
entitlement, auth contract, and client navigation suites pass (58 server tests,
11 auth tests, and 15 client tests).
**Exact next action (resume here):** run the populated second-device renewal
scenario for a customer-class user with an already active helper grant; verify
the renewal is idempotent, the existing grant remains the only grant, core
helper affordances still work while billing is expired, and Pro/trial-only
actions follow the current billing/trial policy before moving to WP-097.

WP-097 is currently an evidence checkpoint. Affiliate programs, schedules,
stats, commissions, analytics, and payout calculation now require the canonical
`helper.offer_services` capability under the existing progressive-access
switch. Admin payout review remains a separate financial control: the maker
needs `manage_financials`, impersonated sessions are rejected, a fresh
amount-bound step-up is required, and the existing dual-approval/idempotency
flow remains authoritative. Referral attribution is bounded to the recognized
identifier format at both the Join page and server endpoints; unknown query
parameters, including forged approval-style values, are not carried into
signup or access state. Existing signed offer links and HMAC partner postbacks
remain consent-gated, partner/currency/click scoped, and receipt-idempotent;
they never create a progressive access grant. Focused auth and affiliate route
suites pass (42 tests), and referral/partner/affiliate payout suites pass (79
tests). Frontend reference verification found 0 issues, signup/navigation tests
pass (19 tests), and `build:ci` typecheck/build plus `verify:dist-assets` pass
with 1,203 emitted assets.
The populated disposable PostgreSQL referral scenario now passes in
`progressiveAccessSignup.db.test.js` (9 tests): an existing referrer can share a
Helper-intent link, customer-first signup records the referral once, the draft
application resumes from the same account identity, forged approval-style input
does not change authority, and no affiliate program or `access_grants` row is
created automatically. The referral count update is awaited before signup
responds, but remains non-fatal if its metrics write fails.
**Exact next action (resume here):** move to WP-098, Release visibility and
startup bootstrap. Audit feature-flag boot behavior and startup readiness for
the progressive-access projection/request switches, then run the relevant
startup/health suites before recording the next checkpoint.

WP-098 is currently an evidence checkpoint. The client requests the server-owned
launch snapshot before first render, waits at most three seconds, and falls back
to build-time defaults if configuration is unavailable; API launch gates remain
server-authoritative and fail closed. The client/server launch catalogs stay in
lockstep, the boot request is no-store, and old asset recovery remains covered
by the existing service-worker and `build:ci` checks. The iOS and Android
compatibility endpoints return safe defaults when unset and independent
server-owned minimum/latest/update/force-after overrides when configured.
`appVersion.test.js`, `launchGate.test.js`, and `serverBootSmoke.test.js` pass
(26 tests), and `launchScopeVisibility.test.mjs` plus
`vortexEnvDefaults.test.mjs` pass (11 client tests).
**Exact next action (resume here):** move to WP-099, Email, SMS and provider
retry handling. Audit notification preferences, transition-derived recipients,
outbox retries, and webhook authenticity; run the relevant delivery/retry
suites and record any provider-availability limits before the next checkpoint.

WP-099 is currently an evidence checkpoint. Email preference mutations require
authentication, while one-click and tokenized unsubscribe paths stay explicit;
resubscribe is the only ordinary path that clears the global unsubscribe state.
Message-notification retry is an operations-admin action with a strict limiter,
impersonation rejection, and an audit entry. Provider failures are retained in
the outbox/dead-letter flow rather than reported as successful delivery, and
support-channel webhook ingestion verifies its signature before opening a
transaction. `emailPreferences.test.js`, `messageNotificationOutbox.test.js`,
`messageOutboxAdmin.test.js`, `notificationEmailFailurePropagation.test.js`,
and `supportChatController.test.js` pass (34 tests); support webhook,
guest-email privacy, and calendar retry suites pass (14 tests). No source
change was needed in this checkpoint.
**Exact next action (resume here):** move to WP-100, Audit, finance and
exceptional administration. Verify that access-request review cannot act as a
financial override or expose cross-organization investigation data; run the
admin audit, step-up, maker/checker, and investigation-scope suites before the
next checkpoint.

WP-100 is currently an evidence checkpoint. The reviewer path in
`services/access/reviewService.js` resolves the reviewer’s capability-specific
authority again inside the request-row lock, and an approval only changes the
access request decision, the scoped `access_grants` row, the access outbox, and
the projection version. It does not call treasury, wallet, payout, balance, or
investigation-note APIs. Treasury routes keep read (`view_financials`) and write
(`manage_financials` or super-admin) authority separate; sensitive money rails
retain the existing step-up, maker/checker, idempotency, and impersonation
guards. Investigation access remains purpose-limited, named-approver-bound,
time-bounded, scope-bounded, and audit-logged, with resource hiding for
out-of-scope organizations.

The focused run of `adminOpsPrivacy.test.js`, `adminPermissionScope.test.js`,
`adminGrantLookup.test.js`, `adminUserAccountB6.test.js`, `statementAdmin.test.js`,
`investigationAccess.test.js`, `investigationRead.test.js`,
`progressiveAccessDecisions.test.js`, `dualApprovalGating.test.js`,
`dualApprovalService.test.js`, and `treasury.test.js` passed (137 tests; 8
environment-gated skips). The disposable/populated cross-organization
approval-without-financial-override scenario and exact-head CI remain open; the
unit evidence confirms the platform access decision has no financial mutation
or investigation-note read path.
**Exact next action (resume here):** move to WP-101, Reputation, trust,
cancellations and restrictions. Audit late revocation, hold/restriction
predicates, and cancellation/refund ownership across customer and approved
provider experiences before recording the next checkpoint.

WP-101 is currently an evidence checkpoint. Reputation and cancellation
statistics continue to derive from canonical jobs, appraisals, and participant
ids rather than from the selected account mode. Existing restriction middleware
rechecks account suspension and active `user_restrictions` at the owning
job-posting, bidding, checkout, and payment-confirmation actions, so approving
or revoking a helper capability cannot clear a prior hold. The reputation
controller now also protects private enforcement-state and cancellation-fee
history reads: only the subject or a platform admin may inspect them; public
reliability summaries remain the separate redacted signal.

`reputationPrivacy.test.js`, `businessPublicSignals.test.js`,
`offPlatformPayments.test.js`, `paymentPolicyHistory.test.js`,
`adminBundleD.test.js`, `paymentRoleMoneyMovement.test.js`, and
`sundayDataIntegrity.test.js` pass (81 tests). Source change is pushed in
`5a21a32e6`. The populated scenario that approves a restricted helper, then
revokes the grant while an existing job remains open, plus exact-head CI,
remains open.
**Exact next action (resume here):** move to WP-102, Legal records and policy
acknowledgements. Audit stale/missing acceptance during approval, preserve
customer access, and verify versioned terms evidence and idempotent retries.

WP-102 is currently an evidence checkpoint. `POST /api/legal/:documentType/accept`
retains the accepted document version, actor identity, signed name, timestamp,
request metadata, and an audit entry. Re-acceptance is safe for active rows,
repairs a missing mapped `user_consents` row, and reactivates a revoked row
without duplicating the unique acceptance tuple. Revocation clears only the
matching TermsGate consent for `terms_of_service` or `privacy_policy`; other
legal records remain record-only. The terms middleware reports each missing or
outdated prerequisite with its required/accepted versions and does not disable
the customer account, so a stale acceptance blocks only gated actions while the
customer experience remains available.

`legalRevocationConsentClearing.test.js`, `legalReacceptConsentSync.test.js`,
`legalAcceptancesParams.test.js`, `jobEditRace.db.test.js`, `bid.test.js`,
`helperOnboardingRedesign.test.js`, and `authImpersonationGuards.test.js` pass
(84 tests; 13 environment-gated skips). No source change was needed in this
checkpoint. A populated approval with missing/stale policy acceptance and
exact-head CI remain open.
**Exact next action (resume here):** move to WP-103, Maintenance operations and
rollback ownership. Audit readiness, migration compatibility, worker/outbox
observability, and rollback behavior across grant approvals and revocations.

WP-103 is currently an evidence checkpoint. Monitoring incident state changes
are behind the admin `manage_operations` gate and write audit entries. The
release/readiness control plane identifies the candidate release, migration,
worker, queue, backup, and audit-chain signals and fails closed when a required
signal is unavailable. Migration history remains append-only and timestamp
ordered, with the scoped-constraint guard check applied to new files. Access
outbox delivery and scheduled-worker lease fencing prevent duplicate delivery
or stale-replica writes, while deployment identity and rollback scripts require
the exact verified candidate before provisioning.

`monitoringRoutes.test.js`, `readinessPayload.test.js`, `applicationRuntime.test.js`,
`progressiveAccessOutboxCopy.test.js`, `progressiveAccess.db.test.js`,
`progressiveAccessHealth.db.test.js`, `scheduledWorkerScheduleFence.test.js`,
`migrationOrder.test.js`, `migrationRecovery.test.js`,
`deploymentReleaseWiring.test.js`, and `release.test.js` pass (90 tests; 17
environment-gated skips). The migration/deployment script run of
`migration-rehearsal.test.cjs`, `check-migration-history.test.cjs`,
`deploy-coolify.test.cjs`, `release-check.test.cjs`, and
`build-release-metadata.test.cjs` passes all 43 tests. The populated
`progressiveAccess.db.test.js`, `progressiveAccessHealth.db.test.js`, and
`progressiveAccessSignup.db.test.js` suites also pass against isolated
PostgreSQL (26 tests). The disposable migration rehearsal applied and
re-verified all 1,122 migrations in 136.1 seconds, including guard triggers and
legacy-value checks, then removed its container. No source change was needed
in this checkpoint.
**Exact next action (resume here):** check the latest exact-head CI run for PR
#794, then collect deployment identity/readiness evidence if CI succeeds before
closing the progressive-access goal. Do not merge or activate production from
this branch.

History of what is done (newest last):

WP-008 is now an evidence checkpoint. Business team approval continues to use
the canonical `business_members` row in the selected business context. The
route requires live business standing plus team-invite/role permission, the
controller updates only a pending row scoped to that business, and removal of
an active member is a separate action. Manager-issued manager-role access codes
are capped to representative, active code secrets are masked after creation,
and a stale workspace selection cannot lend authority to another business.
`businessHubBrokenG.test.js`, `vortexMembershipSecurity.test.js`,
`progressiveAccessWorkspace.db.test.js`, and
`progressiveAccessOverrides.db.test.js` pass together (40 tests; 15
environment-gated skips). The populated two-business pending-approval case,
approval after revoking the approver’s live membership, and exact-head CI remain
open.
**Exact next action (resume here):** move to WP-009, Invitations and Vortex
codes. Run the populated invite/code acceptance for double redemption, invalid
account, expiry/revocation races, retained prior memberships, and foreign-team
privacy.

WP-009 is now an implementation checkpoint. The existing Vortex token and
access-code controllers lock the invitation/code row before validation and
membership creation, consume one-use state atomically, preserve prior
memberships, and scope invitation acceptance to the authenticated account or
normalized invite email. The entry routes now also require the existing
`requireEmailVerified` guard before invitation listing/acceptance/decline,
Vortex preview, or either redemption path, so an authenticated but unverified
account cannot enumerate or consume a business relationship. The new route
contract and acceptance-boundary suites pass (11 tests), and the populated
workspace/membership/Vortex regression set passes (40 tests; 26 environment-
gated skips). A full populated concurrent double-redemption rehearsal remains
an evidence follow-up rather than a reason to weaken the atomic SQL boundary.
**Exact next action (resume here):** move to WP-010, Access policy and form
discovery. Audit the public-versus-reviewer policy revision contract, run its
focused tests, and update this ledger plus the next action in the same pushed
checkpoint.

WP-010 is now an implementation checkpoint. Public policy discovery, the
applicant's policy view, and the structured `platform_approval_required` gate
response now pass application schemas through a narrow applicant-question
projection. Reviewer-only or arbitrary admin metadata is not exposed, while
the full schema remains available to super-admin policy editing and server-side
validation. `modePlatformApprovalPublicSchema.test.js` and
`progressiveAccessDecisions.test.js` pass (39 tests).
**Exact next action (resume here):** audit WP-011, Applicant status and
resubmission, including needs-information history, stale client revision
handling, prefill/scope retention, and opaque cross-account case privacy.

WP-011 is confirmed as an implementation checkpoint. Applicant request reads
are scoped by `applicant_id`; opaque identifiers from another account return
the same not-found result. Reviewer `request_information` transitions persist
the public reason and information request, resubmission validates the current
policy and clears that request only on a successful submit, and every change
is retained in immutable `access_request_decisions` history with an explicit
request version. The populated progressive-access lifecycle, signup, and
health suites pass (26 tests).
**Exact next action (resume here):** audit WP-012, Platform review and audit,
for two-reviewer version conflicts, live scoped reviewer authority on reads
and writes, private evidence/notes, idempotent decisions, and foreign-subject
resource hiding.

WP-012 is confirmed as an implementation checkpoint. `reviewService` reloads
the reviewer's live authority inside the locked request transaction, binds
queue/detail/decision access to capability permissions, returns a version
conflict for a stale competing decision, keeps internal notes out of applicant
responses, and resource-hides unauthorized or foreign cases. The populated
progressive-access suite covers these cases and the append-only decision/outbox
records (26 tests).
**Exact next action (resume here):** audit WP-013, Role switch retirement.
Trace the retained switch endpoint and all ModeSwitcher callers, confirm no
legacy self-selection can acquire authority, and replace or hide navigation
that still presents mode switching while preserving customer workflows.

WP-013 is now an implementation checkpoint. The retained switch endpoint remains
server-compatible for legacy accounts, but with `ACCESS_LEGACY_SWITCH_RETIRED`
enabled its mode-lifting authority is still rejected unless the account holds the
corresponding capability. The progressive client branch now replaces the navbar
ModeSwitcher with a link to Applications and removes the Settings account-mode
self-switch controls and granted-mode instructions; customer navigation and the
customer foundation remain in place. The server mode-gate suite passes (5 tests)
and the client retirement contract passes (2 tests), with frontend-reference and
locale verification plus the local typecheck/build recorded for this checkpoint.
The legacy endpoint is intentionally retained for compatibility and must not be
removed until all consumers and rollout flags are retired.
**Exact next action (resume here):** run the four populated WP-008 business
workspace/membership suites together and record the exact-head CI result for the
pushed checkpoint. The new acceptance creates two businesses, approves a pending
member only in the manager's live business, rejects the other business, then
revokes that manager and proves a replacement pending request remains pending.
Keep the legacy compatibility endpoint and rollout flags intact while CI and the
remaining helper-only route audit are completed.

WP-019 now has a bounded native/PWA implementation checkpoint. When
`ACCESS_PROJECTION_ENABLED` is enabled (including the pilot allowlist),
`GET /api/mobile/profile` returns the same server-owned capability projection and
client flags as the browser bootstrap, marks the mobile mode contract as
`accessControlled`, and exposes only the customer mode as self-selectable. The
legacy mobile response is unchanged while the rollout is off. The focused mobile
profile suite passes all four tests; the existing service-worker reliability
contract continues to prove authenticated API reads are network-only and cannot
replay another account's cached response. The PATCH response applies the same
mode metadata after profile edits. No native app binary or live installed-PWA
acceptance was claimed.
The repository audit found no native profile consumer beyond this API contract;
the enabled/disabled mobile profile tests therefore serve as the compatibility
boundary for old clients and projected clients. The service worker's existing
network-only API policy remains unchanged. No native app binary or live
installed-PWA acceptance was claimed.
**Exact next action (resume here):** move to WP-018's remaining native WebAuthn
acceptance. If a native client is added later, make it consume `data.access`
optionally (never require the field from an old server) and add its contract to
this package before enabling the rollout for that client.

WP-018's browser acceptance is now covered by
`client/scripts/passkeyVirtualAuthenticator.browser-check.cjs`. It launches the
local Chrome channel with a CDP CTAP2 virtual authenticator and completes both a
resident-key registration and a required-user-verification assertion on a local
fixture origin; no production account, credential, or server is used. The
existing 16 server passkey/two-factor tests, 7 client passkey/session contract
tests, and locale verification remain green. This is synthetic browser evidence,
not physical-device or live-provider evidence.
**Exact next action (resume here):** run the combined WP-018 focused command
(`passkeysSetup.test.mjs`, `sessionsSetup.test.mjs`, the three server passkey/
two-factor suites, and `passkeyVirtualAuthenticator.browser-check.cjs`), record
the exact-head CI state, then continue with WP-021 Account deletion, export and
privacy while keeping the native-device limitation explicit.

WP-021 now has an access-specific privacy checkpoint. The verified self-serve
export includes applicant-owned progressive-access requests, grants, and
decision history while excluding reviewer IDs and internal notes. Account
deletion explicitly revokes every active access grant with an
`account_deleted` reason, advances the projection version, and marks pending
access outbox notifications failed; immutable request decisions remain retained
for audit. The focused unit tests pass (2), the populated disposable PostgreSQL
acceptance passes (1), and the existing privacy export/reauth suites pass (15).
The broader product retention matrix and live legal-operations acceptance remain
outside this checkpoint.
**Exact next action (resume here):** audit WP-022 Profile and public directory
for helper-application versus published-provider separation, current standing
on search/profile/slug/QR/embeds, and cross-account visibility. Start with the
helper listing/profile route tests and add only the smallest capability-aware
boundary, then run its focused tests plus the exact-head CI check.

WP-022 now has a helper-public-visibility checkpoint. Directory listing and
profile reads, plus status, availability, pricing, and slot lookups, accept a
customer-role account with an effective `helper.offer_services` grant when the
projection flag is enabled. Legacy helper/helper_pro/broker role behavior and
the existing listed, onboarding, account-standing, and admin-hidden predicates
remain unchanged when the flag is off. The focused contract suite passes (3),
the mobile browse regression passes (2), and the public-profile failure suite
passes (1). Business/restaurant public-directory separation and live populated
visibility acceptance remain open.
**Exact next action (resume here):** audit WP-023 Preferences, status and
localization for capability-aware settings labels, Arabic keyboard/focus flow,
long business-name rendering, and independent approved-choice persistence.
Start with the existing Settings and locale contract suites; keep all new copy
in the generated 20-locale catalogs and record any browser acceptance limits.

WP-023 now has a settings/localization checkpoint. The Applications page renders
long business subjects with bounded truncation and a title, returns focus to the
Continue control after the inline editor closes, and retains its polite live
status region. The browser fixture passes in Arabic RTL at a 320px viewport;
locale verification passes across the required catalogs. The helper onboarding
contract was updated to assert `hasHelperAccess`, so approved customer-role
helpers remain covered by the same derived onboarding rules. Focused client
checks pass (10 combined subtests); the broad `build:ci` was stopped after its
long prerequisite chain surfaced and was repaired for that stale assertion, so
run it again when a full local build result is needed.
**Exact next action (resume here):** audit WP-024 Public discovery and location
for guest/applicant/approved-helper parity, private projection cache safety,
explicit location retention, and stale-response handling. Start with the
discover, recommendations, and `ModeHomeRoute` contracts; add a capability-aware
boundary only where the server currently relies on legacy mode.

WP-024 now has a public-discovery and location checkpoint. Unified discovery,
popular results, helper products, and related-helper cross-links use the same
effective `helper.offer_services` standing predicate as the helper directory;
projection-off behavior remains the legacy role predicate. The recommendation
controller derives helper workflows from an active self grant without changing
`users.role`, so an approved customer-role helper receives helper recommendations
while guest/applicant/public discovery remains requester-independent. The Discover
page rejects late search/popular responses after a query or location change and
preserves explicit latitude/longitude, city/state, radius, and type when a recent
search or saved alert is reopened. Focused server tests (9), client contract tests
(2), frontend reference verification, and the full client `build:ci` chain pass;
the build emitted and verified 1,204 assets. No live populated discovery
acceptance has been claimed.

WP-025 now has a customer-first job-post checkpoint. The existing create-job
route intentionally accepts an authenticated customer account without requiring
a helper role or grant, while bid submission remains separately capability-gated
by WP-026. `job.test.js` adds the explicit regression and the existing lifecycle
and UI suites cover the customer-owned and assigned-helper state transitions.

WP-026 now has a formal-quote and provider-mutation capability checkpoint.
Helper profile, onboarding, bidding, reconfirm, and payout entry points already
use the progressive helper capability marker. The direct helper-quote create
boundary, helper quote share/revise routes, and helper-product create/update/
delete routes now run through `requireHelperCapability`; business quote sharing
and customer-readable product surfaces remain available through their existing
ownership/membership checks. The job bridge accepts an active self
`helper.offer_services` grant for a customer-role account only when that marker
was established by the enforced gate, while legacy helper/helper_pro/broker
roles remain compatible and `users.role` is never mutated. The focused bridge and
helper-enforcement suites pass (28 tests total), and all changed server files
pass syntax checks. No live populated quote or product acceptance has been
claimed.
**Exact next action (resume here):** begin WP-027 Bookings and calendar. Audit
booking-request creation, helper acceptance, calendar visibility, reschedule,
and cancellation for customer-first versus provider mutations; preserve the same
off/shadow/enforce rollout behavior and add focused server/client contracts
before pushing the next small checkpoint.

WP-027 is now in progress with its first provider-boundary checkpoint. Customer
booking creation remains available from the customer surface; direct and
recurring helper eligibility now use the same projection-aware public standing
predicate, so an approved customer-role helper can be booked when projection is
enabled while projection-off behavior stays legacy-compatible. Helper-scoped
accept/decline/counter-propose/helper-cancel mutations now run through a
business-aware capability wrapper; business-scoped bookings continue through
their existing membership authorization, and incoming reads remain
ownership-scoped. Customer cancel/respond/convert paths remain customer-owned
and are not helper-gated. The route/controller contract suite
passes together with the existing booking bridge tests; no populated live
calendar acceptance has been claimed.
WP-027's chat/calendar follow-up now covers in-chat provider actions. Chat
booking create/accept/decline/propose routes resolve the linked conversation or
booking before applying the helper gate, so business conversations still use
business membership authorization. Helper-scoped chat mutations use
`requireHelperCapability`, and chat booking's helper eligibility query accepts
the projection-aware standing predicate without changing `users.role`. Mobile
booking payment/confirmation remains customer-owned and intentionally ungated.
The existing CalendarPage already uses the projected `hasHelperAccess` client
flag, so no additional browser code change was needed; the client retirement
contract and frontend-reference verification remain green. The expanded server
set passes (73 tests across five suites), and no populated live calendar
acceptance has been claimed. WP-027 is implemented on this branch.
**Exact next action (resume here):** begin WP-028 Quotes and quote requests.
Audit direct helper quote creation, chat quote share/revise, customer response,
business quote coexistence, and quote-to-booking transitions for the same
customer-first versus provider-mutation boundary; retain the off/shadow/enforce
switch behavior and add focused server/client contracts before pushing the next
small checkpoint.

WP-028 is now implemented on the branch. Direct helper quote creation and the
job quote bridge accept an approved customer-role helper only through the
progressive capability gate; helper quote share/revise and helper-product
provider mutations follow the same rule. Business quote membership checks,
customer quote responses, customer-owned quote-request creation, idempotent
responses, expiry, and quote-to-booking scheduling remain available through
their existing scopes. The focused quote set passes 33 tests across seven
server suites. No live populated quote/payment acceptance has been claimed.
**Exact next action (resume here):** begin WP-029 Work agreements and disputes.
Audit agreement creation/revision/signature, dispute opening and resolution,
helper/customer ownership, payment/booking links, and any provider-only writes
for capability-aware authorization before adding the next focused checkpoint.

WP-029 is now in progress with its first helper-party boundary. Chat agreement
share/revise, work-agreement mutations, and user dispute evidence/message/open
paths resolve the linked helper party before applying `requireHelperCapability`.
Customer-party actions and reads, business conversation agreements, and admin
dispute review remain on their existing ownership, membership, MFA, and
permission gates. No role is changed, and no populated live agreement/dispute
acceptance has been claimed.
**Exact next action (resume here):** run the focused work-agreement, chat-
agreement, warranty-claim, and dispute suites together; repair any stale route
contracts, then add a customer-role approved-helper regression for agreement
signing or dispute evidence before closing WP-029.

WP-029 is implemented on the branch. The helper-party wrappers are based on the
agreement/job/dispute owner IDs rather than the legacy account role, so an
approved customer-role helper reaches the same agreement signing, evidence,
warranty, dispute opening, evidence, and message paths after the enforced
capability middleware sets the marker. Customer-party paths and admin dispute
review remain unchanged. The combined focused run passed 110 tests, with 21
documented environment-gated skips; no populated live agreement/dispute
acceptance has been claimed.
**Exact next action (resume here):** begin WP-030 Ratings and review
management. Audit who may submit, edit, hide, report, moderate, and publish
ratings across jobs, helper products, businesses, and bookings; preserve
customer/provider ownership and add capability-aware provider mutations where
the server still trusts a legacy role.

WP-030 is now in progress with the marketplace product-review checkpoint. The
product-review POST route uses `requireHelperCapability`, its controller accepts
the enforced capability marker for customer-role helpers, and
`ProductReviewsSection` derives the form visibility from `hasHelperAccess`
instead of `users.role`. Public review reads and customer-owned job/business/
food review flows remain unchanged. The focused server contract passes and the
new client contract confirms the role-only check is gone; no live review
submission or moderation acceptance has been claimed.
**Exact next action (resume here):** run the focused product/job/business/food
review and moderation suites together, then audit helper review edit/delete,
business response, booking completion eligibility, and report/hide paths before
closing WP-030.

WP-030 is implemented on the branch. Marketplace product reviews now use the
progressive helper capability on the server and `hasHelperAccess` in the client;
job review submission/eligibility remains party-owned, business review
submission remains customer-owned, food review submission remains order-owned,
and hide/report/respond operations retain their existing admin/business or
owner scopes. The focused server and client contracts pass, with no live review
or moderation acceptance claimed.
**Exact next action (resume here):** begin WP-031 Careers applications and
employer recruiting. Audit applicant creation, employer-only posting/review,
candidate messaging, interview scheduling, and offer/withdrawal mutations for
business membership versus helper/customer access, then add the smallest
capability-aware boundary and focused contracts.

WP-031 is implemented on the branch. Careers applicant creation, application
history, messaging, interview booking, and offer decisions remain personal
customer-compatible actions; they do not inspect a legacy helper/business role.
Employer posting and candidate access continue through `businessAccess`,
`resolveBusinessAccess`, hiring permissions, store scope, agency scope, and
record-level `assertCanManageOpening` / `applicationWithAccess` checks. This is
the smallest safe capability-aware boundary: adding a helper or business-owner
role gate would incorrectly block approved staff members whose authority comes
from the canonical employer membership. Focused unit/public tests passed (34
tests), and the disposable Careers end-to-end suite passed (28 tests). No
browser or production acceptance is claimed.
**Exact next action (resume here):** begin WP-032 Direct customer requests and
bookings. Audit customer-first access to direct catalog, request, quote,
booking, payment, and history routes; preserve helper-party capability gates,
canonical ownership, idempotency, and safe post-auth return state, then add the
smallest missing contract and focused tests.

WP-032 is implemented on the branch. Direct quote creation remains guest-capable
and customer-owned; authenticated reads and mutations check the request owner,
while staff paths retain their existing grant and step-up gates. Instant
booking is authenticated and sends anonymous users to sign in with the exact
path and query in `location.state.from`; `Login` restores that path after
session establishment. Quote drafts are stored in `sessionStorage` under an
account-and-service scope, and Direct message retries retain client idempotency
keys. Focused server tests passed 36/36 and the client contract plus frontend
reference check passed. No browser or payment-provider acceptance is claimed.
**Exact next action (resume here):** begin WP-033 Direct authorized operations.
Audit the internal Direct queue, catalog, schedule, job, receipt, team, report,
and payment-retry routes for operator grants plus canonical entity context;
confirm a customer (even with an approved business capability) cannot enter
the operations queue, then add the smallest missing contract and focused tests.

WP-033 is implemented on the branch. Direct’s server operator routes already
require `manage_operations` (with admin MFA) and sensitive customer-facing staff
reads reuse the same grant plus step-up check; customer-owned records remain
available only to their owner. The missing boundary was the SPA entry gate,
which previously checked only the admin role. `DirectAdminRouteGate` now wraps
the existing `GrantGuard` for `manage_operations`, so an approved business or
helper capability cannot imply Direct staff access and a regular admin without
the grant sees the grant-denied state before the queue shell. Targeted server
tests passed 15/15; admin route/grant contracts passed 14/14; the Direct client
contract and frontend reference check passed. The full `build:ci` reached the Vite
build and `verify:dist-assets` successfully (1,204 emitted assets); the wrapper exit
marker was not captured after the tool output limit, so no production acceptance is
claimed.
**Exact next action (resume here):** begin WP-034 Client message threads. Audit
the unified Messages surface across personal, helper, business, and Direct
threads for identity-bound membership, attachment/download scope, unread badges,
realtime cleanup, and revocation behavior; then add the smallest missing
capability-aware contract and focused tests.

WP-034 is implemented on the branch. The audit found one real cross-mode defect:
customer-to-business conversation creation checked `business_members.user_id`,
which is not the canonical membership column, so a delegated representative could
not open a thread even though every read/list route used `member_id`. The query now
uses `member_id`; focused server tests passed 19/19 and client message contracts
passed 43/43, with the frontend reference check clean. Existing route/controller
checks continue to bind lists, thread reads, sends, signed attachment URLs, unread
state and socket rooms to the current participant or active business membership;
no populated browser or live-revocation acceptance is claimed.
**Exact next action (resume here):** begin WP-035 Support from the customer
surface. Audit the customer-facing support entry, escalation handoff, ticket
identity, attachment scope, unread/realtime updates, and post-revocation behavior;
then add the smallest missing capability-aware contract and focused tests.

WP-035 is implemented on the branch. Pending access applications now expose a
customer-only “contact human support” handoff carrying a bounded numeric request
reference. The support routing controller validates that reference against the
authenticated applicant and stores it on the canonical conversation; a foreign
reference is ignored without revealing applicant details. Authorized conversation
detail resolves only a minimal application summary after customer/agent/business
conversation authorization, while guest support remains on its existing token
path. The additive migration, focused server tests (118/118), client contracts
(22/22), frontend reference check, migration-history gate and `build:ci` all pass;
no populated browser/live-agent acceptance is claimed.
**Exact next action (resume here):** begin WP-036 Business support agent queue.
Audit queue visibility, assignment/claim scope, business representative grants,
customer identity projection, attachment/download access, unread/realtime events,
and revocation behavior; then add the smallest missing capability-aware contract
and focused tests.

WP-036 is implemented on the branch. The audit found that queue visibility was
correctly employer-scoped, but an already-assigned support agent could retain
conversation actions after employer access was revoked, and the legacy socket
path trusted stale ticket-room membership. Assigned replies, attachments,
status/lifecycle actions, releases, ticket joins, and socket sends now re-check
active support employment for the conversation's business at action time.
Resource-scoped handlers also bind the URL business to the conversation before
loading or mutating a case. Company administration remains
owner/manager/representative scoped, while platform support remains separately
authorized. Focused server tests passed 124/124 across the progressive-access,
support route/live, routing, and socket join suites; all edited server files
pass `node --check`. No populated browser or live revocation acceptance is
claimed.
**Exact next action (resume here):** begin WP-037 Listings and rental participant
setup. Audit rent search, booking, listing publication, owner/inventory scope,
pending applicant drafts, listing policy checks, and post-revocation behavior;
then add the smallest missing capability-aware contract and focused tests.

WP-037 is implemented on the branch. Tool-rental listing creation and updates
now pass through `tool_owner.list_equipment` under the new
`ACCESS_TOOL_OWNER_ENFORCEMENT` off/shadow/enforce flag. In enforce mode a
pending customer can resume and save an owner-scoped private draft, but the
server forces `is_available = false` and returns an explicit publication-blocked
state; an effective approved grant (or existing admin path) may publish. Public
rent search, booking, payment methods, and booking lifecycle routes remain
customer-accessible and are not coupled to listing approval. Focused rental
tests passed 13/13 and the new progressive contract suite passed 3/3; edited
server files pass `node --check`. No populated browser or live approval/revoke
acceptance is claimed.
**Exact next action (resume here):** begin WP-038 Rental handoff, deposits and
disputes. Audit booking ownership, approval, pickup/return handoff, deposit
authorization, dispute evidence, replay/idempotency, and post-listing-revoke
behavior; then add the smallest missing capability-aware contract and focused
tests.

WP-038 is implemented on the branch. The existing rental state machine keeps
customer return confirmation before owner completion, and deposit resolution is
owner-bound, valid only for a completed/payment-confirmed booking, and guarded
by an atomic `deposit_status = 'held'` update so a replay cannot resolve the
same deposit twice. The rental report path now requires a valid booking owned
or rented by the reporter and derives the only permitted counterparty from that
booking, preventing guessed booking IDs and overexposed rider details. Focused
rental tests passed 19/19 and the progressive rental contract suite passed 5/5;
edited server files pass `node --check`. No populated browser, payment-provider,
or live dispute acceptance is claimed.
**Exact next action (resume here):** begin WP-039 Marketplace product catalog.
Audit public product reads, seller/member mutation scope, pending seller drafts,
approval-aware publication, checkout independence, and cross-business catalog
isolation; then add the smallest missing capability-aware contract and focused
tests.

WP-039 is implemented on the branch. Business product create/update/variant
operations remain scoped by the requested business and manager membership, while
the marketplace publish action now checks the existing `business.own` approval
policy whenever `ACCESS_BUSINESS_ENFORCEMENT` is enabled. Helper product writes
retain the helper capability gate. Public marketplace detail and full-text
search now apply the same active-and-available visibility filter as browse and
related-product reads, so an unpublished mirror is not exposed by a deep link.
Focused tests passed 13/13 and edited server files pass `node --check`. No
populated browser or checkout acceptance is claimed.
**Exact next action (resume here):** begin WP-040 Carts, saved baskets, and
checkout. Audit personal/shared/job-kit cart identity, collaborator visibility,
approval changes during checkout, stale-price and stock revalidation, share-token
rotation, idempotency, and duplicate-order prevention; then add the smallest
missing capability-aware contract and focused tests.

WP-040 is implemented on the branch. Cart ownership remains bound to the
authenticated cart owner across personal, job-linked, template, and shared
flows. Checkout/session now re-check product publication and availability before
pricing or creating a payment intent; cart and shared-cart item additions only
capture currently published products. Named shared carts now reject unrelated
viewers before returning metadata/items, while open links keep their existing
behavior. Approval writes run under a per-share/customer transaction advisory
lock and replay the existing approved row, preventing duplicate approvals and
approval events across tabs/retries. Focused tests passed 28/28 across the new
progressive contract, checkout lifecycle, order detail, shared-cart conversation,
and bearer-ownership suites; edited server files pass `node --check`. No
populated browser, Stripe, or live approval/revocation acceptance is claimed.
**Exact next action (resume here):** begin WP-041 Jobs materials and ordering.
Audit job-kit ownership and collaborator scope, material request creation,
catalog-to-job linkage, quote/checkout transitions, cancellation/refund
idempotency, and access changes while an order is open; then add the smallest
missing capability-aware contract and focused tests.

WP-041 is implemented on the branch. Job-linked kit carts now verify the
authenticated caller is the job customer, assigned helper, or broker before a
cart row is created; a guessed or foreign job ID fails closed and rolls back the
transaction. The shared cart builder now resolves product IDs only from active,
available marketplace rows and continues to derive every unit price from that
database snapshot, so a caller cannot inject a stale or invented price. The
existing authenticated job-kit route remains customer/helper compatible and
does not grant extra capabilities. Focused tests passed 11/11 across the new
progressive contract and job-kit service suites; the edited service passes
`node --check`. No populated browser, live ordering, or payment-provider
acceptance is claimed.
**Exact next action (resume here):** begin WP-042 Media publisher and
verification. Audit selected-author eligibility, draft/upload ownership,
moderation and verification state, public/private media visibility, share links,
and behavior after author access is revoked; then add the smallest missing
capability-aware contract and focused tests.

WP-042 is implemented on the branch. The existing Media draft and attachment
paths already re-check post ownership, private-draft state, active user state,
and safety processing before writes; publication also re-checks the selected
helper, business, or restaurant actor's authoritative verification. The missing
mutation boundary was editing an already-public represented post after that
verification was revoked. Public represented-post edits now require a current
verified actor, while ordinary user posts can still be edited and owners can
still delete their own content. Focused tests passed 86/86 across the new
progressive contract plus Media access, contracts, draft-attachment, and
publication suites; the edited controller passes `node --check`. No populated
browser, live moderation, or storage-provider acceptance is claimed.
**Exact next action (resume here):** begin WP-043 Media creator marketplace
and sharing. Audit creator gig/application ownership, deliverable visibility,
selected publisher scope, share/repost privacy, payment/tip boundaries, and
revocation during an active creator engagement; then add the smallest missing
capability-aware contract and focused tests.

WP-043 is implemented on the branch. The creator marketplace audit confirms
that gig creation/application and sponsorship offers require a current verified
selected actor; application, award, acceptance, deliverable, cancellation, and
work-review routes bind the acting party and the selected post; tips, boosts,
sponsorships, and gig awards use idempotency keys plus durable Credit
reservation/transaction matching. Settlement re-checks creator verification and
public safety, while delivered-work cancellation routes to an administrator
work review instead of releasing funds directly. Focused tests passed 59/59
across the progressive contract, creator marketplace lifecycle, work-review,
and notification suites. No source change was needed beyond the contract
coverage because these boundaries were already present; no populated browser,
live sharing, or Credit-provider acceptance is claimed.
**Exact next action (resume here):** begin WP-044 Learn, personal interests,
and resources. Audit customer-first access, private drafts and bookmarks,
resource ownership, authoring/publishing eligibility, link visibility, and
revocation or deletion behavior across Learn and personal resource surfaces;
then add the smallest missing capability-aware contract and focused tests.

WP-044 is implemented on the branch. Learn catalog reads, anonymous view
tracking, completions, badges, and applicant submission history retain their
customer-first or caller-owned boundaries. Guide authoring now passes through a
rollout-aware helper-or-consultant capability gate: legacy helper/consultant
compatibility remains available while enforcement is off or shadow, while an
enforced customer-class account must hold `helper.offer_services` or
`consultant.accept_paying_clients`; the API returns `access_required` when
neither path is available. The Learn page derives the authoring affordance from
the access projection as well as legacy compatibility fields. Media bookmarks
remain viewer-owned and public/safe-only, and author deletion remains owner
bound with delivery revocation and cleanup scheduling. Focused server tests
passed 41/41 across Learn, marketplace links, catalog, recommendations, and
the new progressive contract; `node --check`, frontend reference verification,
and `build:ci` passed with 1,204 emitted assets. No populated browser, live
moderation, or storage-provider acceptance is claimed.
**Exact next action (resume here):** begin WP-045 Personal finances and
planned needs. Audit personal wallet/statement visibility, planned-need
ownership and transitions, customer-versus-helper actions, recommendation
links, exports, and behavior after access revocation or account deletion; then
add the smallest missing capability-aware contract and focused tests.


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
   ignores the mode. Test `__tests__/progressiveAccessModeGate.db.test.js` now includes the
   populated login-path assertion. AC-005 is covered in the signup DB suite.
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
