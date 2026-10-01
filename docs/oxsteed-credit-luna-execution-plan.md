# OxSteed Credit: GPT-5.6 Luna Execution Plan

Prepared: 2026-09-16. Audience: the model continuing this existing task.

## 1. Mission And Working Agreement

Complete the entire agreed OxSteed Credit software system: a central credit
authority, separately accounted restaurant systems, all financial and operator
workflows, international support, security, integrations, and tested delivery
and recovery. The authoritative scope is
`docs/oxsteed-credit-code-completion-goal.md` and the user's active task goal.
This plan supplies execution order; it does not reduce that scope.

The user wants to keep hosting on this MacBook to preserve cost. Continue with
Colima and Coolify. Keep backups on this computer for now, as requested. Deliver
and test software support for an optional external backup destination; actual
storage purchases and off-device configuration can remain a launch handoff.
Do not reintroduce Docker Desktop or the retired restaurant Node server as a
dependency without finding a concrete requirement that the current stack lacks.

Licensing, business agreements, provider approval, custody arrangements, hardware
purchases, and human legal review are later launch activities. Finish all
independent code and tests. Where provider access is unavailable, use verified
contracts and isolated fixtures and state exactly which live checks remain.
Retain production activation controls and configuration validation.

Work in `/Users/oxsteed/Documents/GitHub/6`, the authoritative application repo.
The task's initial directory, `/Users/oxsteed/Superapp-Projects/Oxsteed Restaurant`,
is not a substitute for that repo. Preserve all existing uncommitted work.
Run npm commands from `client` or `server`; there is no root `package.json`.
Do not create a new task or restart the goal to follow this plan.

## 2. Starting Evidence And Immediate Corrections

Observed source baseline: HEAD
`0a0ec7853830d76fcbf7e4163a5354f01bc114ed` plus a dirty worktree containing
Credit, worker, localization, and recovery changes. HEAD alone does not identify
the changes being tested. Record the tested worktree files and their hashes,
including relevant untracked files, without collecting secrets.

Previous execution evidence, not rerun during this planning pass:

- Backend: 153 suites / 1,089 tests passed.
- Client: `build:ci` passed; Credit catalog has 321 matching keys in en/es/fr/ht/ar.
- Migration-516 database restore, selected concurrency, queue recovery, and small
  performance drills previously passed. Check their actual coverage before reuse.
- Runtime notes reported a healthy deployment, disabled Credit spending, and a
  missing production Sentry setting. Those runtime facts need fresh checks when
  they become relevant; they are not prerequisites to start coding.

Package A implementation is now present in the worktree. The focused tests below
cover the exact parser and API boundaries; authenticated browser evidence for the
form payload and visible localized error remains part of the broader verification
gate.

| ID | Finding | Evidence / next action |
| --- | --- | --- |
| F01 | Valid amounts failed decimal parsing | Resolved: `parseCreditMajorAmount` now uses exact digit arithmetic and returns 29 for `0.29 USD` and 1005 for `1.005 KWD`; covered by the client currency test. |
| F02 | Invalid optional limits became absent limits | Resolved in source: `parseOptionalCreditMajorAmount` distinguishes blank from invalid input and the single/bulk forms block invalid nonblank limits before `adminApi` calls; browser submission evidence remains. |
| F03 | Bulk currency selection could be incomplete | Resolved in source: selected agreement records are retained across lookup changes and every selected ID contributes to currency derivation; browser search-change evidence remains. |
| F04 | A displayed currency could differ from the bulk currency | Resolved in source: bulk selection takes precedence for the displayed limit currency, including a localized multiple-currency state; browser label evidence remains. |
| F05 | Bulk API had no mixed-currency limit check | Resolved: the service normalizes currencies from locked agreement rows and rejects non-null shared limits with `credit_entitlement_currency_mismatch`; service regression coverage is passing. |
| F06 | Existing currency tests did not test amount parsing | Resolved: the client test now covers two-, three-, and zero-minor-unit values, malformed precision, safe bounds, and optional blank/invalid semantics. |

Additional source findings to reproduce before claiming a defect is resolved:

- Customer 360 converts eligibility lookup failures to `null`, then displays an
  empty list. A failed lookup must not claim that the customer has no access.
- Partner-ledger loads retain an old ledger while another partner loads; funding
  controls are not uniformly disabled during loading. Test account switching,
  late responses, and failed loads before allowing a mutation.
- Several admin mutations generate a new idempotency key for every click. Test a
  lost response after a successful write; a retry must not create another write.
- Worker shutdown leaves interval handles running in the inspected source.
  Test shutdown with queued and in-flight work, then fix any continued claiming.
- Admin dialogs, tables, status labels, and Customer 360 contain untranslated
  text. Locale key parity alone does not prove those screens are localized.

## 3. How To Work Faster

1. Read this plan, the goal document, and the current requirements matrix once.
   Then inspect only the next work package's files and dependencies.
2. Use the smallest meaningful failing reproduction to choose a fix. Group
   related defects into one coherent package; do not stop after adding a label.
3. Extend existing utilities and test runners. Extract a helper only when it
   removes duplicated logic or makes a financial boundary directly testable.
4. Use `node --test scripts/creditCurrency.test.mjs` for currency utility work.
   Add a package script and connect it to CI so these tests cannot be forgotten.
5. Run focused tests during development. Run the full client build after a
   completed frontend package, and the full backend suite after a completed
   backend package. Documentation-only changes need no application rebuild.
6. Read independent files in parallel. On the MacBook, serialize expensive
   builds, database drills, and browser suites; start with one test worker.
7. Reuse one guarded isolated environment across packages. Keep fixture creation,
   reset, and cleanup reproducible so browser and API tests share real scenarios.
8. If a process is still running, poll that process handle. Do not restart because
   output is temporarily quiet. Never claim a test passed before its exit result.
9. If a patch fails, read the exact affected lines and use a smaller patch. Do
   not repeatedly guess translation strings or paste giant stale JSX lines.
10. Record a compact checkpoint after each package, then take the next ready
    package. If an external check is unavailable, continue independent work.

Do not measure progress by test count, locale-key count, repeated audits, or
successful compilation alone. Measure it by acceptance criteria newly satisfied.
Do not restate a previous turn's change as new work. The next checkpoint must
identify what changed or what new evidence changed the next action.

## 4. Execution Order

| Package | Priority | Depends on | Finished outcome |
| --- | --- | --- | --- |
| A. Amounts and entitlement limits | First | Current source | Exact parsing, explicit errors, consistent currency contract, behavioral tests |
| B. Shared isolated verification environment | First | Can begin alongside A | Repeatable PostgreSQL/Redis/API/browser fixtures and a smoke journey |
| C. Accounting and restaurant isolation | High | A, B | Every financial workflow has invariant, API, and real database evidence |
| D. Complete role workflows and international UI | High | A, B; C for final balances | Customer, restaurant, and Super Admin journeys work in browsers |
| E. Providers, retries, workers, monitoring, security | High | B; coordinate with C | Lost responses and outages recover without duplicate financial effects |
| F. Builds, migrations, backups, restore, performance | High | B; final run after C-E | The intended release artifact runs and recovers in an isolated deployment |
| G. Completion audit and launch handoff | Last | A-F | Every software requirement has inspected evidence; human actions are explicit |

Complete A first. Build B early: it unlocks C, D, E, and F. Do not postpone all
browser and integration testing until after another round of unit tests.

## 5. Package A: Exact Money And Entitlement Inputs

Primary files:

- `client/src/lib/creditCurrency.js`
- `client/scripts/creditCurrency.test.mjs`
- `client/src/admin/pages/super/OxsteedCreditEntitlements.jsx`
- `client/src/admin/pages/super/OxsteedCreditAdmin.jsx`
- `server/services/oxsteedCreditAdminService.js`
- `server/controllers/oxsteedCreditController.js`
- `server/__tests__/oxsteedCreditAdminService.test.js`
- `server/__tests__/oxsteedCredit.test.js`
- `client/src/i18n/locales/{en,es,fr,ht,ar}/credit.json`

Implementation sequence:

1. Add failing decimal cases before changing the parser. Convert decimal text to
   integer minor units using digit arithmetic or BigInt, with an explicit safe
   integer bound. Avoid floating-point multiplication followed by rounding.
2. Define accepted input syntax and currency precision explicitly. Do not silently
   strip ambiguous punctuation or convert malformed strings into a new amount.
   Audit existing callers before changing compatibility; support locale-aware
   entry where the interface promises it and show a clear error otherwise.
3. Distinguish blank optional fields from invalid fields. An intentionally blank
   optional limit may map to `null`; invalid nonblank text must block submission.
4. Derive the currency from all target agreements. Keep selected agreement records
   stable across search results, or clear inaccessible selections explicitly.
   Unknown IDs/currencies must not silently become USD.
5. Separate or clearly label single and bulk limit entry so the displayed currency
   always matches the operation. Preserve unrestricted-by-customer-limit access
   under the agreement's own rules when the operator leaves limits blank.
6. Enforce the same bulk rule on the server using the locked agreement rows.
   For the current shared-limit contract, reject mixed-currency non-null limits;
   allow mixed-currency access with no new per-customer limits. If the existing
   product contract requires per-currency values, implement that explicit payload
   instead of inventing a conversion. Preserve idempotent replay semantics.
7. Recheck every caller of the shared parser: grants, refunds, adjustments, holds,
   conversion, partner funding, and agreement creation. Invalid values must not
   remove optional controls in any of them.

Acceptance cases:

| Input or action | Required result |
| --- | --- |
| `0.29 USD`, `1.005 KWD`, `125 JPY` | Exactly 29, 1005, 125 minor units |
| Positive representable amounts in every supported precision | Exact conversion, including safe integer boundary cases |
| Negative, malformed, overflow, or fractional JPY amounts | Explicit rejection; zero policy follows the operation's contract |
| Blank optional limit | Intentional absent limit, with agreement rules still enforced |
| Nonblank invalid optional limit | Visible localized error; no mutation request |
| Search changes after bulk selections | All selected IDs retained accurately or explicitly cleared; never omitted from currency validation |
| Direct mixed-currency bulk API call with shared limits | Rejected atomically, including when UI checks are bypassed |
| Multi-currency bulk access without limits | Valid supported access changes remain possible |
| Retry after a lost response | Original result or explicit conflict; no duplicate access/audit effect |

Exit gate: utility and API behavior tests pass, browser form payloads match labels,
and the client CI build includes the currency tests. Update the matrix with those
specific tests; do not mark all international support complete.

### Package A checkpoint (2026-09-15)

- Changed `client/src/lib/creditCurrency.js` to parse decimal text into exact
  minor-unit integers with a `Number.MAX_SAFE_INTEGER` bound.
- Added `parseOptionalCreditMajorAmount` and connected it to both entitlement
  submission paths; nonblank invalid values now produce a localized error and no
  mutation request, while blank values intentionally send `null`.
- Retained selected bulk agreement records across search changes, made the
  displayed bulk currency authoritative, and added localized currency mismatch
  and invalid-limit messages in all five Credit locales.
- Added the server-side locked-row mixed-currency guard and a regression test;
  mixed-currency bulk access without limits remains allowed.
- Tests actually run: `node --test scripts/creditCurrency.test.mjs` from
  `client/` passed 5/5; `npx jest __tests__/oxsteedCreditAdminService.test.js
  --runInBand --silent --forceExit` from `server/` passed 41/41.
- Exact next action: use the reusable Package B harness for the next accounting
  and isolation drills; the client `build:ci` run passed before this checkpoint.

## 6. Package B: Reusable Isolated Test Environment

Start with the existing Dockerfile, migration runner, compose definitions, and
verification scripts. Build a dedicated test configuration rather than starting
the production compose project under its normal name.

1. Use a unique compose project/network, separate PostgreSQL and Redis volumes,
   loopback-only API/browser ports, and temporary credentials. Pin compatible
   runtime versions to the application. Do not attach production volumes.
2. Seed synthetic users with usable test authentication: a central administrator,
   any distinct approver the policy requires, two unrelated restaurant owners,
   a restricted staff member, two customers, and an unauthorized user.
3. Seed at least two restaurants in one currency and additional USD/JPY/KWD
   scenarios. Add active, suspended, expired, and restricted agreements. Include
   the existing restaurant wallet as well as network Credit.
4. Prefer migrations plus synthetic fixtures. If a production-shaped restore is
   required for upgrade testing, keep it isolated and prevent notifications,
   provider requests, or restored scheduled jobs from reaching real recipients.
5. Use a dedicated Redis instance for tests invoking normal application services;
   a custom queue name alone does not isolate feature flags, caches, or locks.
6. Reuse existing browser infrastructure if found. Otherwise add one pinned test
   runner with a browser harness; Playwright is a candidate, not an assumed
   installed dependency. Keep test authentication out of production code.
7. Add one command each to start, seed/reset, test, and remove only the resources
   created by this harness. Record exact commands after implementing them.
8. Make failures save sanitized request errors, browser traces, screenshots, and
   the fixture seed. Confirm the cleanup target belongs to this test run.

Exit gate: on the same MacBook, a clean isolated start runs migrations, logs in
through the real auth boundary, reads a wallet, executes one permitted mutation,
and verifies its journal. Repeat from reset and get the same expected result.

### Package B checkpoint (2026-09-15)

- Added `docker-compose.credit-test.yml` with unique project-scoped names,
  disposable PostgreSQL/Redis volumes, a dedicated network, loopback-only
  dynamic app port, temporary credentials, health checks, and no production
  network or volume references.
- Added `scripts/credit-isolated-seed.sql` with synthetic admin, approver,
  restaurant owners, staff, customers, unauthorized user, multiple restaurants,
  USD/JPY/KWD agreements and statuses, existing restaurant-wallet data, and a
  disabled Credit rail. The fixture uses verified synthetic customers so the
  real identity gate does not block the permitted smoke journey.
- Added `scripts/credit-isolated-env.sh` and
  `server/scripts/credit-isolated-smoke.js` for guarded start, seed, reset,
  smoke, failure-artifact capture, and scoped teardown. The harness requires
  the `colima` Docker context and never targets production resources.
- First clean run passed on Colima: migration 516, real customer login,
  customer account read, isolated rail enable, `1000 USD` admin load, and
  direct journal/balance verification. The reset-and-repeat run passed the same
  smoke result from fresh database and Redis volumes. `down` removed only that
  harness project, network, volumes, and temporary state.
- Commands actually run: `scripts/credit-isolated-env.sh seed` and `test`,
  `scripts/credit-isolated-env.sh reset` and `test`, then
  `scripts/credit-isolated-env.sh down`; both smoke runs returned
  `authenticatedCustomer=66666666-6666-4666-8666-666666666666`,
  `loadedCents=1000`, `currency=USD`, `journalVerified=true`.
- The PostGIS image reported `linux/amd64` on the ARM64 MacBook and ran under
  Colima emulation; this is recorded as an environment-performance caveat, not
  a production image change.
- The reusable runner's `test` command is the seeded smoke prerequisite for the
  race verifier; all commands remain guarded to the `colima` context and scoped
  project/volumes. The PostGIS image continues to run under ARM64 emulation.
- Exact next action: continue the remaining Package D browser and responsive
  evidence, then close the provider, failure-injection, and live-operations gaps.

## 7. Package C: Financial Correctness And Complete Accounting

Primary sources: `server/services/oxsteedCreditService.js`,
`oxsteedCreditAdminService.js`, `oxsteedCreditPartnerLedgerService.js`,
`oxsteedCreditCurrencyConversionService.js`, their routes/controllers/migrations,
and the existing restaurant Credit services and tests located with `rg`.

Write down account ownership, sign conventions, and expected journal entries
from the existing schema before modifying accounting. Prove that the central
authority and each restaurant have the required separately accounted system;
the existence of a payable/reserve table alone does not establish that scope.
Keep the existing restaurant wallet operational and distinguish it from network
Credit everywhere balances, statements, and payment types meet.

For each workflow below, cover success, authorization, invalid state, replay,
transaction rollback, and the appropriate race. Reuse fixture builders.

| Workflow | Required evidence |
| --- | --- |
| Issuance / loads / funding | Actor and funding reference recorded; configured issuance caps enforced atomically; external transfer evidence remains distinct from ledger posting |
| Accounts / balances | Journal totals reconcile to balances; available balance agrees with active holds; correct owner and currency on every row |
| Restaurant funding / reserves | Restaurant-scoped accounts; protected reserve rules; releases cannot exceed permitted funds or rewrite earned payable |
| Holds / captures / releases / expiry | One valid terminal outcome under concurrent capture/release/expiry; reservations released exactly once |
| Purchases / redemption | Eligibility and amount caps checked in the transaction; concurrent spending cannot exceed available funds |
| Refunds / adjustments | Aggregate refunds cannot exceed refundable value; same-key retries cannot refund twice; corrections preserve original entries |
| Transfers | Authorized source; allowed recipient and currency; correct fees and limits; atomic debit/credit or complete rollback |
| Clearing / settlement | Purchases assigned once; fees and net amounts reconcile; approvals and periods obey policy; no duplicate payout obligation |
| Settlement failure / reversal | Lost response and retry behavior; recovery reference; one compensating movement; original payout remains auditable |
| Disputes | Role-correct creation/review/resolution; history retained; resolution does not silently issue a second financial movement |
| Reconciliation / statements | Customer, restaurant, and consolidated views agree with the ledger; currency-separated totals and date filters |
| Audit / integrity | Existing immutable records reject edits/deletes; ownership, HMAC chain, key versions, and correction provenance verified |
| Conversion | Visible quote, rate, fees, expiry, source/target ownership and amounts; currency-specific balancing entries; one execution per quote/request |
| Existing restaurant wallets | Existing top-up, spend, refund, reporting, and POS behavior passes regression without mixing wallet and network Credit |

Mandatory real database races: spend/spend, capture/release, capture/expiry,
refund/refund, settlement/settlement, issuance at a cap, conversion at a cap,
same request key with identical and conflicting bodies, and two restaurants
accessing the same customer under different permissions. Check before/after
balances and journals, not only HTTP codes or the presence of a lock query.

For failure injection, interrupt before posting, during a multi-row write, after
commit before the response, and during reconciliation/provider acknowledgment.
Each interruption must have an explicit recovery outcome and no partial ledger.

Exit gate: every row links to executable scenarios and real transaction evidence;
tenant/currency leakage and invariant violations are resolved. Inspect SQL/schema
assertions as well as service results. Add migrations only for necessary changes,
preserving already-applied migration history.

### Package C checkpoint (2026-09-15)

- Found and fixed three production-path defects while running the real database
  drill: legacy inline account checks still rejected `partner_reserve`, partner
  funding omitted its validated `amountCents` when posting the journal, and two
  PL/pgSQL triggers had column/variable name collisions. Forward migrations
  `517_oxsteed_credit_partner_reserve_constraints.sql`,
  `518_oxsteed_credit_partner_funding_trigger_qualification.sql`, and
  `519_oxsteed_credit_hold_notification_trigger_qualification.sql` preserve
  applied migration history while repairing those paths.
- The first expanded settlement race found a fourth production-path defect:
  migration 515's shared settlement-evidence trigger could read
  `NEW.transaction_type` from a settlement row. Forward migration
  `520_oxsteed_credit_settlement_evidence_trigger_branching.sql` now branches
  on the trigger table before accessing table-specific fields.
- Added regression coverage for the reserve constraint replacement, qualified
  funding trigger, qualified hold notification trigger, and the funding amount
  handoff. Focused backend tests passed: 2 suites, 119/119 tests after the 520
  fix.
- The disposable Colima accounting drill passed after the fixes with the real
  service and PostgreSQL journal: load, partner funding, identical funding
  replay, reserve release, hold/capture, partial refund, customer transfer, and
  cross-restaurant denial. The verifier now snapshots starting balances and
  journal counts, so it remains valid after the smoke journey or an earlier
  failed attempt; the latest run proved deltas of customer one `+4300`, customer
  two `+200`, restaurant reserve `+1500`, plus an unchanged legacy restaurant
  wallet of `5000`.
- This drill used synthetic identities and never touched production data. The
  PostGIS dependency remains an amd64 image under Colima ARM64 emulation. The
  accounting verifier also confirms its expected cross-restaurant error while
  the Credit rail is enabled only in the isolated fixture.
- Added guarded `server/scripts/credit-isolated-races.js` and the `races` harness
  command. It uses real concurrent service calls and post-race SQL assertions;
  the expiry fixture ages a synthetic hold only while its immutable-authorization
  trigger is temporarily disabled, then restores the trigger before the race.
- Tests actually run: `bash -n`, `node --check`, and `git diff --check` passed;
  focused backend tests passed 2 suites, 119/119 tests; the rebuilt Colima
  fixture reported release `content-1c937d89ed58e72b`, migration runner
  expected/applied `521/521`, and zero pending migrations. After the seeded
  smoke prerequisite, the complete real race verifier passed capture/release,
  expiry/capture, refund/refund, issuance at cap, conversion at cap, settlement
  versus settlement, and two-restaurant permission contention with one
  committed outcome in each case. Identical idempotency replay used one
  transaction, conflicting-key reuse returned `credit_idempotency_conflict`,
  and final reserved balance was `0` cents. The race verifier now bootstraps
  only the minimum disposable balance and namespaces run keys for safe reruns.
- Exact next action: complete the authenticated restaurant-operator browser
  journey, then repeat customer and Super Admin workflows at 390, 768, and
  1440 pixels plus 200% zoom with keyboard/focus checks; remaining locale and
  responsive evidence stays open.

## 8. Package D: Complete Interfaces And International Journeys

Primary files: the three `OxsteedCredit*` customer/operator pages, the four Super
Admin Credit components, `RestaurantCreditPage.jsx`, `RestaurantCreditManager.jsx`,
`RestaurantCreditAdmin.jsx`, POS entry points, API client, locale files, and styles.

1. Fix stale account/partner responses, false empty eligibility, and requests
   completing after navigation. Disable mutations until the displayed target and
   currency match the loaded data. Preserve useful data while showing genuine
   loading/error states. Do not silently treat failed requests as zero balances.
2. Make every permitted workflow discoverable and connected end to end. Check
   customer transfers, conversion quote review, receipt/history, dispute review,
   restaurant statement/reserve views, and admin approval/reversal actions.
   An endpoint or a text box asking for an internal ID is not sufficient evidence
   of a complete customer workflow.
3. Keep one stable request identity for an unchanged mutation retry. On ambiguous
   failure, recover the original result. A refresh failure after a successful
   write must not tell the user that the financial operation failed.
4. Complete labels, errors, statuses, empty states, receipts, limits, dates, and
   actions across en/es/fr/ht/ar in coherent screens. Reuse keys where the meaning
   matches. Preserve brands and user-supplied evidence verbatim.
5. Check decimal entry, ISO currency display, timezone/date boundaries, DST,
   regional eligibility, and Arabic right-to-left layout. Test supported and
   unsupported conversion paths, expired quotes, fees, and rounding disclosure.
6. Verify dialog focus containment, Escape/cancel, focus return, field labels,
   keyboard access, error announcements, contrast, and touch targets. Reuse the
   established design system. Role attributes alone do not prove accessibility.
7. Run functional journeys at representative phone, tablet, and desktop widths
   (for example 390, 768, and 1440 pixels) and at 200% zoom. Test long translated
   strings and horizontally scrolling tables without hiding critical actions.

Browser acceptance journeys:

- Administrator enrolls a restaurant, configures an agreement, follows required
  approval, assigns customer access, and funds/records reserves and issuance.
- Customer sees the correct available balance, reviews eligibility, authorizes
  a payment, and gets a receipt after an authorized restaurant captures it.
- Operator sees only their restaurant's permitted data, refunds a valid amount,
  and downloads a matching statement; a second restaurant cannot read or mutate it.
- Customer transfers where enabled, reviews/executes a conversion, and files a
  dispute. Admin handles the dispute and any separate compensating action.
- Administrator reconciles, settles, records payment evidence, and reverses with
  recovery evidence. Restaurant and central statements agree afterwards.
- Emergency suspension blocks the operations defined by policy while preserving
  permitted history/recovery access. Re-enable only inside the isolated fixture.
- Reload, double-click, network timeout, server error, and expired login leave
  clear recovery choices and no duplicate mutations.

Exit gate: real authenticated browser journeys cover all three roles and the
legacy wallet. Full English functional coverage plus functional smoke and text,
layout, error, and keyboard checks in every supported locale. Automated
accessibility checks are supplemented by actual keyboard/focus inspection.

### Package D checkpoint (2026-09-15)

- The current dirty worktree now guards Customer 360 eligibility failures as an
  explicit unavailable state instead of an empty access result, ignores late
  profile/eligibility responses after the selected account changes, and keeps
  partner-ledger data tied to the active restaurant request. Partner funding
  controls remain disabled while the target ledger is loading, and unchanged
  funding retries reuse the same idempotency key.
- Made the Vite development proxy target injectable through
  `VITE_DEV_API_PROXY_TARGET`, while preserving `http://localhost:5000` as the
  default. This supports a disposable loopback API port without changing the
  production build or API contract.
- Added payload-scoped idempotency key storage in
  `client/src/admin/pages/super/creditIdempotency.js`. Super Admin agreement,
  settlement, settlement reversal, entitlement, bulk entitlement, load,
  adjustment, account-status, and refund actions now reuse a key for an
  unchanged retry, rotate it when the business payload changes, and clear it
  after a confirmed success. Single and bulk entitlement endpoints now both
  send the required key.
- Extracted the shared request freshness guard used by Customer 360 and the
  restaurant ledger into `client/src/admin/pages/super/creditRequestGuards.js`.
  The regression suite covers superseded responses, navigation invalidation, and
  independent customer/partner request scopes; `npm run test:credit-request-guards`
  passed `3/3` and is included in `client` `build:ci`.
- Hardened isolated browser transport by allowing only loopback origins in
  non-production CORS mode, so a dynamically published client port does not
  require a production allowlist change. Production continues to require its
  explicit configured origins. The isolated app can serve the built SPA only
  when `CREDIT_TEST_SERVE_STATIC=true`, keeping that switch out of production.
- Fixed realtime URL resolution for production-style static builds on a dynamic
  loopback port: when `VITE_API_URL` is absent, Socket.IO now uses the current
  page origin instead of assuming `localhost:5000`. Added
  `client/scripts/realtimeUrl.test.mjs`; `npm run test:realtime-url` passed
  `2/2`, and a fresh isolated operator tab reloaded without websocket warning or
  error logs.
- Added `client/scripts/creditAdminIdempotency.test.mjs`; the focused suite
  passed `2/2`, the amount parser suite passed `5/5`, and `npm run typecheck`
  plus `npm run build:ci` passed. The build retained only existing chunk-size
  and Impersonate dynamic-import warnings.
- Against isolated release `content-f48453f6de2348d9` with the built SPA served
  same-origin, authenticated
  browser evidence now covers the customer route: login through the real auth
  boundary, JPY balance/eligibility/limits/statement, a `7` JPY authorization,
  release, and the restored `¥700` available/`¥0` reserved state. The same
  session switched to Arabic and visibly rendered the Credit page RTL with
  localized labels, controls, error-safe history, and support links. The
  isolated browser transport now accepts only loopback origins in non-production
  mode, including dynamically published client ports.
- In that same-origin artifact, the Super Admin password-plus-TOTP flow reached
  `/admin/dashboard` and then `/admin/super/oxsteed-credit`. The visible Credit
  console showed the rail suspended, activation prerequisites, wallet and
  partner/agreement/entitlement controls, settlement/reconciliation, disputes,
  audit, recovery, and currency sections. The browser recorded no warning or
  error console logs. This is synthetic isolated evidence; it does not enable
  the production rail.
- Added guarded `server/scripts/verify-credit-admin-api.js`; against the rebuilt
  isolated artifact it completed the real password-plus-TOTP boundary as
  `super_admin`, verified all 11 Credit admin read surfaces, and confirmed
  `railEnabled=false` with 3 accounts, 4 partners, and 5 agreements. The
  authenticated browser console evidence is synthetic and does not replace
  production activation checks.
- Against the fresh disposable Colima fixture, restaurant owner one completed
  the authenticated `/restaurants/merchant?business=901&tab=store` journey and
  saw only restaurants `901/903`, the Store tab, partner status, and the
  `restaurant-credit:901:USD` ledger. Restaurant owner two was then
  authenticated with the same synthetic password and, even with the first
  owner's `business=901` query retained, saw only restaurants `902/904` and the
  `restaurant-credit:902:USD` ledger. The browser log was clean after the
  realtime fix. The fixture seed now marks synthetic identities as already
  onboarded so the real helper onboarding guard remains active without blocking
  an operator test.
- Tests actually run for this checkpoint: `npm --prefix server test --
  --runInBand __tests__/deploymentReleaseWiring.test.js` passed `16/16`; the
  focused request-guard suite passed `3/3`; and the full
  `npm --prefix client run build:ci` passed currency `5/5`, admin idempotency
  `2/2`, request guards `3/3`, locale/surface checks, typecheck, and the production Vite
  build. The CUA browser completed the same-origin admin password-plus-TOTP
  flow and rendered the Credit console without warning or error logs; the
  earlier Vite-proxy `Network Error` is retained only as the reason the
  same-origin fixture path was added.
- Tests actually run for this continuation: `npm --prefix client run
  test:realtime-url` passed `2/2`; the disposable fixture rebuilt with the
  patched client, completed both owner journeys, and remained rail-disabled.
- Tests actually run for this continuation: the rebuilt disposable fixture
  served release `content-9106be7e300be978`; the English operator Store/Credit
  page had no horizontal overflow at `390x844`, `768x1024`, or `1440x900`,
  keyboard traversal reached the restaurant selector and Credit controls, the
  synthetic restaurant pause mutation succeeded, and re-publishing was blocked
  by the existing menu-readiness safeguard with setup guidance. Full backend
  regression also passed `155/155` suites and `1107/1107` tests.
- Added spring-forward and fall-back regression cases for the UTC reconciliation
  period helper; `server/__tests__/oxsteedCreditReconciliation.test.js` passed
  `9/9`, confirming complete UTC-day boundaries across both DST transitions.
- Added provider-event ordering protection: migration `522` records the Stripe
  object and event timestamp on receipts and maintains a per-object watermark;
  stale deliveries are finalized without side effects while retries of the same
  failed event remain processable. The webhook contract suite passed `18/18`,
  including stale-event and same-failed-event retry regressions, and the fresh isolated artifact applied
  migrations `522/522` with zero pending.
- Exact next action: repeat customer, restaurant-operator, and Super Admin
  workflows at 200% zoom with keyboard/focus styling checks; then cover the
  remaining locale/timezone/DST matrix and the G-package completion audit.

## 9. Package E: Providers, Worker Recovery, Monitoring, Security

Primary sources: `server/services/paymentQueue.js`, `server/workerMain.js`,
`server/workers/paymentWorker.js`, Credit jobs/outbox/watchdog, actual provider
adapters/webhook routes, readiness/configuration middleware, and related tests.

1. Map which providers actually participate in Credit and restaurant-wallet
   flows. Do not add a new banking product or claim a configured Stripe key
   proves payment readiness. Verify versioned official provider contracts when
   implementing behavior that depends on them.
2. Test signed valid/invalid webhooks, duplicates, out-of-order events, unknown
   local payment references, partial refund payloads, timeouts, 429/5xx, and
   accepted operations whose responses are lost. Preserve authoritative final
   states when older events arrive. Prove one financial effect across retries.
3. Exercise real Redis claims and a real worker process: kill after claiming,
   restart, expire leases, recover retries, dead-letter, and replay. Test a slow
   handler exceeding its lease with two workers. Add renewal or fencing if needed;
   provider/database idempotency must protect side effects regardless.
4. Test SIGTERM under work: stop new polling/claims, drain safely, retain claims
   that could not finish, and close resources. Import-safe code is not proof of
   process shutdown. Test complete/retry failures when Redis is temporarily down.
5. Test Credit outbox, hold expiry, entitlement expiry, integrity, reconciliation,
   heartbeats, and alerts using an isolated clock/provider environment. Monitoring
   should detect deliberately introduced failures and clear after recovery.
6. Test credential/configuration validation, ledger signing-key rotation, secret
   redaction, tenant and field authorization, request limits, webhook replay,
   export safety, and production-disabled safeguards. Review relevant dependency
   findings for actual exposure; fix material unresolved security defects.
7. Supply a local capturing transport for monitoring tests when real Sentry or
   notification access is unavailable. Production still requires genuine valid
   configuration; never satisfy a gate with a placeholder credential.

Exit gate: controlled provider/worker outages recover without lost work or
duplicate ledger effects. Each provider row identifies contract, sandbox, and
live evidence separately; unavailable live checks have an exact handoff action.

### Package E checkpoint (2026-09-15)

- The guarded real Redis verifier `server/scripts/verify-payment-queue-recovery.js`
  passed inside the isolated Colima app with `PONG`, atomic enqueue duplicate
  suppression, stale lease reclamation, delayed retry promotion, dead-letter
  preservation, and operator replay.
- The focused worker/queue suite passed `3` suites and `15/15` tests, including
  Redis acknowledgment failure, provider outage retry/dead-letter, notification
  failure, unmatched Stripe payment handling, duplicate claims, and unknown
  processor recovery. Expected simulated failures were logged by the tests.
- The isolated artifact rebuild exposed and fixed two real notification-path
  defects: notification preference lookup referenced the removed
  `helper_profiles.push_token` column, and outbox completion reused a PostgreSQL
  parameter with conflicting `text`/`varchar` inference. The service now uses
  the current `mobile_push_tokens` registry for dead Expo tokens, and outbox
  status branches use dedicated typed parameters. Focused notification/outbox
  tests passed `9/9`; the rebuilt Colima app reclaimed 7 stale events and marked
  all 7 `sent` with no notification SQL or parameter errors.
- The rebuilt artifact also passed the live isolated two-factor flow for the
  synthetic approver after migration 521: password login returned an MFA token,
  the generated TOTP completed `/auth/login/2fa`, and the response contained a
  `super_admin` user and access token. The production gate remains unchanged.
- Added a guarded local Sentry capture transport and
  `server/scripts/verify-monitoring-capture.js`; the rebuilt artifact flushed a
  synthetic monitoring event to a temporary local file with no third-party
  network destination. The production guard rejects this mode when
  `NODE_ENV=production`.
- Fixed `server/workerMain.js` to stop both polling intervals before drain,
  prevent new claims after shutdown begins, and make shutdown idempotent. The
  lifecycle regression passed with fake timers; the broader Credit backend
  checkpoint passed 7 suites and `186/186` tests.
- Added guarded `server/scripts/verify-credit-monitoring-recovery.js`. Against
  the rebuilt isolated artifact it forced all 6 configured Credit worker
  heartbeats stale, persisted 6 critical incidents, locally captured 2
  monitoring events, then marked all 6 incidents recovered after healthy
  heartbeats were restored. The verifier returned `ok=true` with detected
  status `stale` and recovered status `healthy`.
- Exact next action: run the authenticated restaurant-operator browser journey,
  then repeat all required customer and Super Admin workflows at 390, 768, and
  1440 pixels plus 200% zoom with keyboard/focus checks; live Sentry/provider
  configuration remains a production activation check.

### Package F checkpoint (2026-09-15)

- Fixed `server/scripts/verify-credit-performance.js` so its fixture setup owns
  one PostgreSQL client for `BEGIN`/`COMMIT`/`ROLLBACK`; pooled `pool.query`
  calls can no longer make rollback evidence unreliable. Added deployment wiring
  coverage for the connection ownership contract.
- The current isolated Coolify-style artifact reported release
  `content-83788b351c579e99`, migrations `521/521`, zero pending migrations,
  healthy workers, and the expected Credit activation block because Sentry is
  intentionally absent from the synthetic environment.
- Measured performance against a disposable restored database passed with Redis
  `PONG`: 10/10 account reads p95 `564.73ms` under `3000ms`, 10/10 transaction
  reads p95 `816.94ms` under `2500ms`, 10/10 eligibility reads p95 `394.32ms`
  under `2000ms`, and 8/8 purchase writes p95 `2139.52ms` under `10000ms`.
  All 8 benchmark wallets ended at `9990` cents with zero reservations.
- The strengthened restore verifier passed against a fresh isolated dump with
  `521` migrations, all 11 Credit tables, all 5 required integrity triggers,
  zero disabled required triggers, and a rolled-back immutable currency-quote
  mutation probe.
- A clean reset now completes reliably: the PostgreSQL healthcheck probes TCP,
  and the isolated app waits for the PostgreSQL network socket before starting
  migrations. The reset returned normally, then the rebuilt artifact passed
  the accounting drill and full real race matrix with `521/521` migrations.
- Hardened `scripts/check-production-backup.sh` so only a timestamp-shaped,
  published snapshot can be selected; orphaned `.incomplete.*` manifests no
  longer mask a valid backup. Added injectable command paths for hermetic
  verification without changing production defaults.
- Added guarded `scripts/verify-local-backup-scheduler.sh` and the
  `verify:backup-scheduler` command. It uses isolated temporary state and real
  gzip/tar/checksum validation while covering a successful snapshot, monitor
  success, orphaned manifest, overlapping lock, stale lock replacement, failed
  dump with no publication, corrupt checksum, retention pruning, stale snapshot,
  disk-space failure, and both LaunchAgent plist syntax checks.
- Verification: `bash scripts/verify-local-backup-scheduler.sh` passed all
  listed cases; `npm --prefix server test -- --runInBand
  __tests__/deploymentReleaseWiring.test.js` passed `12/12`; all three backup
  scripts passed `bash -n`. No live backup directory, container, or production
  data was modified.
- Expanded `server/scripts/verify-credit-performance.js` with explicit bounded
  concurrency and configurable read/write sample counts, preserving the
  previous defaults. Against a separate disposable `oxsteed_performance_*`
  database, `50` account reads, `50` transaction reads, `50` eligibility reads,
  and `32` shared-partner purchases at maximum concurrency `10` all passed.
  Redis returned `PONG`; p95 values were `558.58ms`, `262.57ms`, `941.25ms`,
  and `3873.67ms` respectively, under the existing thresholds. All eight
  wallets ended at `9960` cents with zero reservations; the temporary database
  and Colima fixture were removed afterward.
- Found and repaired the host deployment gap: launchd was still pointing at a
  retired checkout and macOS denied execution from the protected `Documents`
  path. Added `scripts/install-production-backup-launchagents.sh`, which stages
  the reviewed scripts under `~/Library/Application Support/OxSteed/production-backup`
  and bootstraps both labels. The installer was run successfully; the current
  labels use `/bin/bash`, Colima, a six-hour backup interval, and a fifteen-minute
  monitor interval.
- A real local run of `npm --prefix server run backup:production` published and
  validated snapshot `20260915T140509Z`; the installed monitor then returned
  `state=OK` for that snapshot. The only backup output was the expected tar
  notice that a live Coolify SSH mux socket was skipped; tar listing and all
  integrity checks still passed.
- Restored the actual scheduled snapshot
  `20260915T140509Z/oxsteed-db.dump` into a temporary database on the healthy
  Colima PostgreSQL container. `npm --prefix server run verify:restore` passed
  with migrations `516`, all `11` Credit tables, all `5` required integrity
  triggers enabled, and the rolled-back immutable-quote mutation probe.
- Added `server/scripts/credit-isolated-readiness.js` and the guarded
  `scripts/credit-isolated-env.sh failures` command. The probe requires an
  explicit `503 not_ready` with the failed dependency identified, then a full
  `200 ready` recovery; the harness uses only its disposable Colima project.
- The first real Redis interruption exposed a singleton-client recovery defect:
  `server/utils/redis.js` stopped retrying after three attempts and nulled the
  configured client after a transient connect failure. It now retains the
  client and retries with a bounded five-second backoff; the lifecycle
  regression passed `13/13` with readiness coverage.
- Rebuilt isolated artifact `content-3653ce07320d1b0e` applied migrations
  `522/522`. Real Redis and PostgreSQL stop/start checks both degraded readiness
  on the correct check and recovered; isolated smoke, accounting, race, and
  queue-recovery commands then passed. The accounting/race fixture enabled the
  rail only inside the disposable database; production safeguards were not
  changed.
- After replacing the old harness readiness assertion, the full backend
  regression passed `156/156` suites and `1112/1112` tests. The expected
  simulated webhook, database, Redis, provider, monitoring, and worker failure
  logs remained covered without causing test failures.
- Extended `server/scripts/verify-credit-performance.js` to report an explicit
  `errorRatePct` for every workload and process RSS/heap/external/max-RSS/CPU
  snapshots before and after the workload plus deltas. The deployment-wiring
  suite passed `16/16`; this improves the evidence contract without claiming
  that process-level measurements replace the remaining sustained server-
  container resource capture. Added guarded `CREDIT_PERFORMANCE_DURATION_MS`
  sustained read phases and cgroup memory/CPU snapshots for the artifact
  container, while preserving the one-batch default.
- Ran the instrumented verifier through
  `bash scripts/credit-isolated-env.sh performance` against a fresh disposable
  Colima project using rebuilt artifact `content-3653ce07320d1b0e` and
  migrations `522/522`. Account, transaction, eligibility, and shared-partner
  purchase workloads all returned `0%` errors and remained below their p95
  thresholds (`421.29ms`, `311.85ms`, `406.87ms`, and `3070.06ms`); eight
  wallets ended at `9990` cents with zero reservations. Measured process RSS
  increased `1.11 MB` and max RSS `1.81 MB`. The disposable project and
  volumes were removed after verification.
- Ran the sustained verifier through the isolated harness with
  `CREDIT_PERFORMANCE_READ_SAMPLES=20`, `CREDIT_PERFORMANCE_PURCHASES=32`,
  `CREDIT_PERFORMANCE_CONCURRENCY=10`, and
  `CREDIT_PERFORMANCE_DURATION_MS=5000` against rebuilt artifact
  `content-88c11f95a2cfbf0e` and migrations `522/522`. It produced `860`
  account reads, `280` transaction reads, and `200` eligibility reads over
  approximately five-second phases, plus `32/32` shared-payable purchases;
  every workload reported `0%` errors and stayed below its p95 threshold.
  Container cgroup memory-current moved from `155.56 MB` to `153.20 MB`, CPU
  increased by `3.69 s`, and max RSS increased by `10 MB`; all eight wallets
  ended at `9960` cents with zero reservations. The disposable project and
  volumes were removed afterward.
- Extended `server/scripts/verify-credit-performance.js` with guarded
  `CREDIT_PERFORMANCE_PARTNERS=1..4` support. Multi-partner mode creates a
  separate disposable business, restaurant, partner, and active agreement for
  each fixture, distributes concurrent purchases across them, and verifies
  every linked `partner_payable` account has the exact expected balance and
  no reservation. The harness forwards the control and the deployment wiring
  suite passed `16/16`.
- Rebuilt the isolated artifact `content-88c11f95a2cfbf0e` and ran
  `CREDIT_PERFORMANCE_READ_SAMPLES=20`, `CREDIT_PERFORMANCE_PURCHASES=32`,
  `CREDIT_PERFORMANCE_CONCURRENCY=10`, `CREDIT_PERFORMANCE_DURATION_MS=5000`,
  and `CREDIT_PERFORMANCE_PARTNERS=2`. Migrations were `522/522`, Redis was
  `PONG`, all `880/360/240` read requests and `32/32` purchases succeeded with
  `0%` errors, read p95 values were `93.08ms`, `201.27ms`, and `287.79ms`, and
  purchase p95 was `4121.92ms`, below the `10000ms` bound. Both independent
  payable accounts ended at `160` cents with zero reservations; Node max RSS
  delta was `10.11 MB`, cgroup memory-current delta was `-40.57 MB`, cgroup
  peak delta was `9.96 MB`, and cgroup CPU delta was `3.88 s`. The disposable
  project and volumes were removed afterward. The performance gap is now only
  longer production-duration observation.
- Rebuilt the isolated artifact again and ran the same two-partner workload
  with `CREDIT_PERFORMANCE_READ_SAMPLES=10`,
  `CREDIT_PERFORMANCE_PURCHASES=48`, `CREDIT_PERFORMANCE_CONCURRENCY=10`,
  `CREDIT_PERFORMANCE_DURATION_MS=30000`, and
  `CREDIT_PERFORMANCE_PARTNERS=2`. Migrations were `522/522`, Redis was
  `PONG`, all `5960/1670/1350` read requests and `48/48` purchases succeeded
  with `0%` errors, read p95 values were `75.16ms`, `222.44ms`, and
  `267.76ms`, and purchase p95 was `4397.33ms`, below the `10000ms` bound.
  Both payable accounts ended at `240` cents with zero reservations; Node max
  RSS delta was `12.5 MB`, cgroup memory-current delta was `-34.59 MB`, peak
  delta was `5.66 MB`, and cgroup CPU delta was `14.92 s`. The disposable
  project and volumes were removed afterward. Isolated artifact-duration
  evidence is satisfied; live production observation remains unavailable
  while the Credit rail is intentionally disabled.
- Rebuilt isolated artifact `content-88c11f95a2cfbf0e` for the browser
  continuation. The synthetic customer reached the paused Credit page, and
  the synthetic Super Admin completed password-plus-TOTP, reached
  `/admin/super/oxsteed-credit`, and saw the suspended rail plus the full
  Credit console. Customer and Admin pages had no horizontal overflow at
  `390x844`, `768x1024`, or `1440x900`; keyboard traversal reached the
  relevant Credit filters and controls, and the browser captured no warning or
  error logs. The in-app browser has no supported zoom setter and the shortcut
  did not alter its measured zoom, so 200% remains an explicit open check.
- Closed the code-side Credit dialog accessibility gap in
  `client/src/admin/pages/super/OxsteedCreditAdmin.jsx`: both transaction and
  action dialogs now contain keyboard focus, close on `Escape`, and restore
  focus to the invoking control. Strengthened `:focus-visible` in
  `client/src/index.css` so utility classes cannot hide the indicator. The
  deployment wiring suite passed `21/21`, and `client` `build:ci` passed all
  Credit tests, locale/surface checks, typecheck, and the production bundle.
  Runtime authenticated failure-path browser checks and 200% zoom remain
  unverified.
- Corrected Credit timestamp formatting across customer, restaurant, and Super
  Admin surfaces by routing dates through `client/src/lib/creditDateTime.js`.
  The formatter follows the selected app language, falls back safely for an
  unavailable locale, and preserves the runtime timezone. Added deterministic
  English/Spanish/Arabic and invalid-date regression coverage (`2/2`), wired
  into `client` `build:ci`; the deployment wiring contract now passes `21/21`.
- Repaired the preserved restaurant-wallet flow in
  `client/src/pages/food/RestaurantCreditPage.jsx`: USD/KWD/JPY inputs now use
  the exact minor-unit parser, and transfer/credit-request retries retain the
  same payload-scoped idempotency key through ambiguous refresh failures. A
  successful write now remains a success even if the follow-up wallet refresh
  fails, with an explicit refresh warning; the deployment wiring contract
  covers these legacy-wallet guards.
- Hardened Package E worker recovery with an atomic active-lease renewal in
  `server/services/paymentQueue.js` and renewal timers around slow handlers in
  `server/workerMain.js`. Queue reliability and worker tests passed `10/10` and
  `4/4`; the fresh disposable Colima Redis verifier returned `PONG` and proved
  `activeLeaseRenewed=true` plus `reclaimedLeaseNotRevived=true`. The isolated
  project and volumes were removed after the check.
- Localized the preserved restaurant-wallet page and its payment, transfer, and
  proof-request dialogs through the shared `credit.restaurantWallet` namespace.
  Added matching values for en/es/fr/ht/ar and expanded `verify-i18n.mjs` so the
  page's translation keys are checked alongside the central Credit surfaces.
  `npm run verify:i18n` passed with `422` keys across all five catalogs, and
  `npm run build:ci` passed the Credit regressions, parity/surface checks,
  typecheck, and production bundle. This closes the code-side raw-English
  localization gap for the preserved wallet; browser locale/timezone/zoom and
  authenticated failure-path evidence is still open.
- Normalized known wallet, transfer, and request status codes through the Credit
  status catalog so the preserved wallet does not expose raw API status values.
  The follow-up `npm run build:ci` passed again after this change, including the
  Credit tests, five-locale verifier, typecheck, and production bundle.
- Localized the Super Admin entitlement table and filters in
  `client/src/admin/pages/super/OxsteedCreditEntitlements.jsx`, including
  status badges, date labels, reason/search controls, pagination, empty states,
  and agreement metadata. Added matching en/es/fr/ht/ar values and included the
  page in `verify-i18n.mjs`; `npm run verify:i18n` passed with `433` Credit keys,
  and the full `npm run build:ci` passed with exit code `0`. This closes another
  code-side localization slice; the broader authenticated locale/timezone/DST,
  long-string, zoom, and failure-path browser matrix remains open.
- Exact next action: run the authenticated restaurant-operator and Super Admin
  browser matrix at desktop/mobile widths and keyboard focus, then continue the
  G-package evidence audit; observe at least one unattended backup interval and
  keep monitoring the public readiness dependency. Off-device storage, live
  Sentry/provider checks, and human launch approvals remain explicitly
  unperformed dependencies.
- G-package browser check attempted on 2026-09-15: the available Chrome session
  was the public OxSteed home page, with no authenticated operator or Super
  Admin session. No live mutation or real-wallet test was attempted. The exact
  next browser action therefore requires a disposable authenticated fixture
  session; independent code verification continues without changing the live
  Credit rail.
- Backup scheduler checkpoint on 2026-09-15: the loaded
  `com.oxsteed.production-backup` LaunchAgent uses `DOCKER_CONTEXT=colima` and
  `StartInterval=21600`. A launchd `kickstart` completed with `runs=1` and exit
  code `0`, publishing `20260915T191849Z`; the installed monitor and SHA-256,
  PostgreSQL, gzip, and tar validations passed. This proves the staged LaunchAgent
  path works, but it does not replace observing an actual unattended six-hour
  interval, which remains the exact backup acceptance action.
- Disposable infrastructure failure checkpoint on 2026-09-15: a fresh
  `bash scripts/credit-isolated-env.sh reset` fixture built and migrated cleanly
  at `522/522`, then `bash scripts/credit-isolated-env.sh failures` stopped Redis
  and PostgreSQL independently. Each outage produced the expected `503
  not_ready` dependency result, and each service recovered to `200 ready`; the
  isolated app, network, and volumes were removed with `bash
  scripts/credit-isolated-env.sh down`. This strengthens E/F recovery evidence;
  live worker recovery and production monitoring remain unobserved.
- Shared Credit status checkpoint on 2026-09-15: added
  `client/src/lib/creditStatus.js` so the main Super Admin Credit console and
  entitlement table translate known lifecycle codes consistently and render an
  unavailable label for unknown provider states. Added five-locale values for
  the expanded status contract and `client/scripts/creditStatus.test.mjs`; the
  focused suite passed `2/2`, `npm run verify:i18n` passed with `445` keys, and
  the full `npm run build:ci` passed with exit code `0`. This is code-side
  localization evidence only; the authenticated browser locale/failure matrix
  remains open.
- Corrected the shared status contract's final edge case: `revoked` now maps to
  the localized rejected state and red severity styling on both the main Credit
  console and entitlement table, while unknown provider states remain safely
  unavailable. The focused status suite passed `2/2`, `npm run verify:i18n`
  passed with `445` keys, `npm run typecheck` passed, and the post-edit
  `npm run build` passed with exit code `0`. This does not close the remaining
  authenticated browser, provider/Sentry, or unattended-backup evidence.
- Rebuilt the isolated artifact after adding the missing customer Credit load
  failure state in `client/src/pages/food/OxsteedCreditPage.jsx`. A real
  PostgreSQL stop while the authenticated synthetic customer was on the Credit
  page produced a localized `role=alert` and `Retry` control while preserving
  the last balance/limit data; after PostgreSQL restart and re-authentication,
  the same page recovered to the paused-rail balance, limits, and empty states.
  `npm run typecheck`, `npm run build`, and the exact-decimal regression suite
  passed; readiness returned `200` with migrations `522/522` before and after
  the disposable outage. Production was not modified. This closes the basic
  authenticated customer failure/retry gap; 200% zoom and deeper operator/Admin
  failure journeys remain the next browser evidence.

Operator error-surface checkpoint (2026-09-15): added
`client/src/lib/creditErrors.js` and applied one safe error-display policy
across customer Credit loading/mutations and the Super Admin Credit console,
including profile/detail actions and CSV exports. Concise API validation
messages remain actionable, while raw transport status, database, and
authentication details fall back to stable user-facing messages. The new
`creditErrors` regression suite passed `3/3`; `client npm run build:ci`
passed all focused Credit tests, five-locale verification, TypeScript, and
the Vite production build. This closes the identified raw-client-error
exposure slice; live authenticated admin failure journeys and genuine
monitoring configuration remain open.

Restaurant-wallet locale checkpoint (2026-09-15): corrected the preserved
`RestaurantCreditPage.jsx` loader dependency so translated recovery messages
remain current after a language change, and routed wallet, transfer, request,
hold, and payment-QR timestamps through the selected locale with localized
unavailable fallbacks. `npm run test:credit-date-time` passed `3/3`,
`npm run typecheck` passed, and the subsequent `npm run build:ci` passed all
Credit regressions, five-locale verification, TypeScript, and the production
bundle. The code-side wallet localization slice is complete; authenticated
locale/timezone/DST/zoom and failure-path browser evidence remains open.

Fresh isolated browser matrix checkpoint (2026-09-15): rebuilt the current
loopback-only artifact with migrations `522/522` and the Credit rail suspended.
The authenticated customer Credit page rendered Arabic RTL without horizontal
overflow. The authenticated restaurant operator page had no horizontal
overflow at `390x844`, `768x1024`, or `1440x900`; keyboard traversal reached
the restaurant selector, Credit report/refresh controls, and mutation controls.
The in-app browser probe exposed Retina `devicePixelRatio=2` but no separate
controllable page-zoom value, so 200% zoom remains explicitly unverified. The
isolated project and volumes were removed after the run. Exact next action:
continue the remaining timezone/DST/long-string and deeper operator/Admin
failure-path evidence, then complete the G-package audit without enabling live
Credit.

Authenticated isolated runtime checkpoint (2026-09-15): the rebuilt loopback
artifact accepted the synthetic customer login after the exact registered-name
signature was supplied, loaded `/oxsteed-credit`, and rendered the paused-rail
state, JPY currency selector, guardrails, conversion form, partner eligibility
empty state, statement summary, and support path. The synthetic admin password
login and full seeded TOTP verification also worked once, reaching the admin
dashboard; that dashboard exposed its own failed-stats recovery state with
`Try again`. A second admin identity was not retried after the application
enforced its 15-minute MFA lockout following invalid browser codes. No MFA
control was weakened or bypassed. Customer authentication and the admin MFA
gate are therefore runtime-verified in the disposable environment, while the
authenticated Super Admin Credit console and admin failure-path journey remain
open. The fixture project, containers, network, and volumes were removed after
the run. Exact next action: localize the next bounded main-console workflow
slice in `client/src/admin/pages/super/OxsteedCreditAdmin.jsx`, then rebuild a
fresh fixture and run the admin browser matrix with a clean synthetic session;
keep the Credit rail disabled.

Super Admin timestamp locale checkpoint (2026-09-15): the main Credit
console's shared timestamp formatter now reads the selected document language,
covering worker, transaction, settlement, notification, account,
reconciliation, dispute, and audit timestamps without silently using the
browser default locale. The existing `credit-date-time` regression passed
`3/3`, TypeScript passed, and the subsequent `client npm run build:ci` passed
all focused Credit tests, five-locale verification, TypeScript, and the
production bundle. Full main-console text localization and authenticated
locale/timezone/zoom coverage remain open.

Super Admin health/readiness localization checkpoint (2026-09-15): localized
the reusable integrity summary, worker-health panel, and Credit activation
prerequisite panel, including worker state badges, operational descriptions,
readiness statuses, and variable-based integrity failure details. Added the
main admin module to the Credit translation-surface verifier and kept all five
locale catalogs in parity. Credit locale JSON parsing passed, `npm run
verify:i18n` passed with `475` keys across `en/es/fr/ht/ar`, `npm run typecheck`
passed, and `git diff --check` passed. Exact next action: continue localizing
the remaining main-console workflow text in coherent slices, then rerun the
authenticated admin locale/timezone/zoom and failure-path browser matrix; keep
the Credit rail suspended.

Super Admin transaction-dialog localization checkpoint (2026-09-15): localized
the transaction detail dialog's operator labels, journal and audit empty
states, fallback values, and partial/full refund controls. Existing refund
eligibility, immutable posting, amount handling, idempotency, and focus-trap
behavior were preserved. `npm run build:ci` passed all seven focused Credit
suites, the five-locale verifier passed with `507` keys across
`en/es/fr/ht/ar`, TypeScript passed, locale JSON parsing passed, and
`git diff --check` passed. Exact next action: localize the next bounded main
console workflow slice and then rerun the authenticated admin locale/timezone/
zoom and failure-path browser matrix; keep the Credit rail suspended.

Super Admin settlement-evidence localization checkpoint (2026-09-15): localized
the read-only payout-evidence panel's settlement trail, fallback partner name,
approval/payment fields, paid state, and recent-record summary across all five
Credit catalogs. Settlement transitions and payout values were unchanged.
`npm run build:ci` passed all seven focused Credit suites, the five-locale
verifier passed with `517` keys across `en/es/fr/ht/ar`, TypeScript passed,
locale JSON parsing passed, and `git diff --check` passed. Exact next action:
localize the next bounded main-console workflow slice and rerun the
authenticated admin locale/timezone/zoom and failure-path browser matrix; keep
the Credit rail suspended.

Super Admin operational-section localization checkpoint (2026-09-15): the
reusable `Section` renderer now localizes the Credit audit-history, coverage,
notification delivery, ledger activity, and risk guardrail headings, titles,
and explanations in all five catalogs, while preserving the existing filters,
pagination, audit behavior, and financial controls. `npm run build:ci` passed
all seven focused Credit suites, the five-locale verifier passed with `532`
keys across `en/es/fr/ht/ar`, TypeScript passed, and the production Vite bundle
completed successfully. Exact next action: localize the next bounded
main-console workflow slice, then rebuild a fresh isolated fixture and rerun
the authenticated admin locale/timezone/zoom and failure-path browser matrix;
keep the Credit rail suspended.

Authenticated Super Admin Credit-console checkpoint (2026-09-15): rebuilt a
fresh loopback-only Colima artifact from the current source with migrations
`522/522` and `railEnabled=false`. Synthetic Super Admin password and MFA
authentication reached `/admin/super/oxsteed-credit`. The browser verified the
real Credit console, suspended-rail emergency control with `Enable rail`
disabled, production prerequisites, worker health, multi-currency customer
wallets, seeded restaurant network, agreement/access views, and the
settlement, reconciliation, dispute, audit, and localized operational
sections. No financial, activation, or emergency mutation was attempted. The
fixture project, containers, network, and volumes were removed after the run.
This closes the previously open authenticated Super Admin route observation,
but not admin mutation, locale/timezone/DST, long-string, 200% zoom, or
failure/retry journey evidence. Exact next action: perform the remaining safe
authenticated admin accessibility and failure-path checks where supported,
then continue the next unresolved software requirement with the Credit rail
still suspended.

Super Admin rail-entry localization checkpoint (2026-09-15): localized the
main Credit console header, stored-value control, refresh and retry actions,
emergency rail labels, required audit-reason label, state-specific placeholders,
and suspend/enable actions across `en/es/fr/ht/ar`. Rail behavior and the
disabled activation safeguard were unchanged. `client npm run build:ci` passed
all seven focused Credit suites, five-locale verification passed with `546`
keys, TypeScript passed, the production Vite bundle completed, and
`git diff --check` passed. Exact next action: localize the next bounded
main-console form or table slice, then run the remaining safe authenticated
admin locale/timezone/DST, long-string, keyboard, and failure-path checks with
the Credit rail still suspended.

Super Admin coverage and delivery localization checkpoint (2026-09-15):
localized the coverage-watch cards for agreement gaps, expiring agreements,
pending activation, and operator guidance, plus notification-health cards for
queue/backlog state, terminal failures, durable outbox behavior, retry reason,
and requeue actions across `en/es/fr/ht/ar`. Financial state and mutation
behavior were unchanged. `client npm run build:ci` passed all seven focused
Credit suites, five-locale verification passed with `567` keys, TypeScript
passed, the production Vite bundle completed, and `git diff --check` passed.
Exact next action: localize the next bounded customer-wallet or partner-form
slice, then continue the safe authenticated admin locale/timezone/DST,
long-string, keyboard, and failure-path checks with the Credit rail suspended.

Authenticated Super Admin database outage and auth-refresh checkpoint
(2026-09-15): a fresh loopback-only Colima fixture at `127.0.0.1:32941` reached
the real `/admin/super/oxsteed-credit` route after synthetic password-plus-MFA
authentication against the patched artifact, with migrations `522/522` and
`railEnabled=false`. Stopping only the disposable PostgreSQL service made the
read-only dashboard refresh show its accessible
`Unable to load OxSteed Credit administration.` alert and `Retry dashboard`
action without invoking any financial or activation control. After PostgreSQL
returned healthy and `/ready` returned `200`, the retry restored the console in
place without re-authentication. Browser diagnostics returned no error or
warning entries. The fixture was torn down through the isolated-environment
script with no production container or wallet touched. The client auth
interceptor preserves stored credentials for transient refresh failures (`408`,
`429`, `5xx`, and network failures) while still clearing definitively invalid
sessions; `client/scripts/authRefreshPolicy.test.mjs` passed `2/2`, and the
prior `client npm run build:ci` passed the focused client checks, five-locale
verification, TypeScript, and the production bundle. This closes the patched
runtime auth-refresh outage gap. Exact next action: continue the next
unresolved Package G requirement with Credit disabled.

Customer-wallet localization checkpoint (2026-09-15): the authenticated
Customer 360 detail now localizes spend permissions, restaurant assignments,
effective eligibility guidance, reserved funds, holds, risk-limit summaries,
disputes, wallet transactions, audit history, and transaction-type labels
across `en/es/fr/ht/ar`. Currency formatting, read-only controls, eligibility
decisions, and financial mutation behavior were unchanged. `client npm run
verify:i18n` passed with `629` Credit keys and all Credit/admin surfaces,
`client npm run typecheck` passed, the full `client npm run build:ci` completed
with exit `0` including the configured focused regressions and production Vite
bundle, and `git diff --check` passed. Only the existing bundle chunk-size
warning remains. Exact next action: continue the next unresolved Package G
requirement with Credit disabled, including authenticated locale/timezone/DST,
responsive, keyboard, and deeper failure-path evidence.

Partner-ledger loading safety checkpoint (2026-09-15): partner ledger requests
now scope their loading cleanup to the current request, allow an operator to
switch partners while a prior read is pending, invalidate the old response,
and disable every funding control while the selected ledger is loading. Funding
submission also exits before parsing or posting when a load or save is active.
The deployment wiring regression passed `23/23`, client typecheck passed, and
`git diff --check` passed. Ledger data, idempotency keys, currency parsing,
and external funding semantics were unchanged. Exact next action: continue the
next unresolved Package G workflow or failure-path requirement with Credit
disabled.

Credit rail stale-operator protection checkpoint (2026-09-15): the Super Admin
rail mutation now sends the state it observed with its requested target. The
controller validates that optional precondition as a strict boolean, and the
service checks it after acquiring the existing transaction lock. A stale tab
receives public `409 credit_rail_state_conflict` before any feature-flag update
or audit write; the shared error handler intentionally omits internal conflict
details. `server/__tests__/oxsteedCredit.test.js` and
`server/__tests__/deploymentReleaseWiring.test.js` passed together at
`144/144`, client TypeScript passed, and `git diff --check` passed. Production
activation prerequisites and the disabled rail safeguard were unchanged. Exact
next action: continue the next unresolved Package G requirement with Credit
disabled.

Super Admin partner workflow localization checkpoint (2026-09-15): the main
partner enrollment and directory workflow now uses the Credit namespace for
enrollment guidance, restaurant and currency fields, accessible search/filter
labels, status options, CSV action, empty states, pagination, and partner
controls. The five catalogs share the complete `687`-key Credit contract;
`client npm run verify:i18n` passed all namespace and surface checks, the full
`client npm run build:ci` passed with exit `0`, the focused deployment wiring
suite passed `24/24`, client TypeScript passed, and `git diff --check` passed.
Existing enrollment validation, status transitions, and activation safeguards
were unchanged. Exact next action: localize the next bounded agreement or
settlement operator slice, then run its affected checks with Credit disabled.

Agreement lifecycle localization checkpoint (2026-09-15): the Super Admin
agreement lifecycle table now uses the Credit namespace for its CSV action,
empty state, lifecycle headings, coverage and limit fallbacks, partner/date
values, and submit/approve/suspend/reactivate actions across `en/es/fr/ht/ar`.
Agreement validation, approval prerequisites, lifecycle transitions, and
activation safeguards were unchanged. `client npm run verify:i18n` passed with
`702` Credit keys and all surface checks, `client npm run typecheck` passed,
the full `client npm run build:ci` passed with exit `0`, the focused deployment
wiring suite passed `24/24`, and `git diff --check` passed. The build retained
only the existing dynamic-import and chunk-size warnings. Exact next action:
localize the next bounded settlement/operator slice, then run its affected
checks with Credit disabled.

Settlement queue localization checkpoint (2026-09-15): the Super Admin
settlement queue now localizes its queue heading, filtering description,
partner/status filter labels, accessible filter names, status options, CSV
export, and pagination action across `en/es/fr/ht/ar`. The underlying snapshot,
payment, reconciliation, and settlement controls were unchanged.
`client npm run verify:i18n` passed with `714` Credit keys and all surface
checks, `client npm run typecheck` passed, the focused deployment wiring suite
passed `24/24`, and `git diff --check` passed. The compressed snapshot form and
deeper settlement failure-path browser coverage remain open. Exact next action:
continue the bounded settlement form localization and operator failure-path
coverage with Credit disabled.

Settlement stale-transition protection checkpoint (2026-09-15): settlement
status mutations now accept an optional observed status in camel- or
snake-case. After the existing row lock, the service rejects a stale view with
`409 credit_settlement_state_conflict` and structured current/expected fields
before payment, settlement updates, or audit writes; the client sends the
observed status on every transition. The admin service and deployment wiring
suites passed `67/67`, client TypeScript and five-locale verification passed,
and `git diff --check` passed. Existing transition rules, payment-reference
requirements, reversal controls, and Credit-disabled activation safeguards were
unchanged. Exact next action: continue the next unresolved Package G
failure-path/browser requirement with Credit disabled.

Credit lifecycle stale-state protection checkpoint (2026-09-15): partner,
agreement, and settlement status mutations now accept strict optional observed
states and compare them after their existing row locks. A stale operator view
receives a resource-specific `409` before lifecycle updates or audit writes;
the Super Admin client sends the observed state for each transition. The admin
service and deployment wiring suites passed `69/69`, client TypeScript and
five-locale verification passed at `714` keys, and `git diff --check` passed.
Existing lifecycle transition rules, approval prerequisites, payment and
reversal controls, and Credit-disabled activation safeguards were unchanged.
Exact next action: continue the next unresolved Package G provider/outage or
deployment verification requirement using isolated environments.

Fresh current-artifact isolated verification (2026-09-15): the rebuilt
loopback-only Colima project `oxsteed-credit-test-20260915t23051789513551z-72424`
started from the current worktree with migrations `522/522`, Redis `PONG`,
dedicated ledger signing configuration, and `railEnabled=false` by default.
Its synthetic smoke and accounting flows passed; real race checks passed with
one winner for capture/release, expiry/capture, refund/refund, issuance-cap,
conversion-cap, settlement-overlap, and restaurant-permission contention, plus
identical replay suppression and conflicting-key rejection. Queue recovery
passed atomic duplicate suppression, delayed retry, lease renewal, stale-lease
reclamation, dead-letter preservation/replay, and reclaimed-lease fencing.
Redis and PostgreSQL stop/restart probes returned expected `503 not_ready` and
recovered to `200 ready` without touching production. The two-partner
30-second workload passed with `0%` errors for `6650` account reads, `1340`
transaction reads, `1130` eligibility reads, and `48` purchases; p95 values
were `56.09ms`, `330.45ms`, `340.56ms`, and `3428.79ms` respectively, below
all thresholds. Both independent partner payables ended at `240` cents with
zero reservations; process RSS delta was `12.55 MB` and container memory
delta was `15.84 MB`. The isolated containers, network, and volumes were
removed after verification. Exact next action: complete the remaining
authenticated 200%-zoom/locale browser evidence and live-configuration
handoff checks; keep the production Credit rail disabled.

Credit worker localization checkpoint (2026-09-15): the maintenance-worker
panel now uses stable translated labels for notification outbox, hold expiry,
entitlement expiry, reconciliation, integrity, restaurant-wallet watchdog jobs,
and common result fields across `en/es/fr/ht/ar`. Checkpoint status, failure
detection, result values, and recovery behavior were unchanged. `client npm run
verify:i18n` passed with `645` Credit keys and all Credit/admin surfaces,
`client npm run typecheck` passed, the full `client npm run build:ci` completed
with exit `0`, and `git diff --check` passed. Only the existing bundle
chunk-size warning remains. Exact next action: continue the next unresolved
Package G requirement with Credit disabled, including authenticated
locale/timezone/DST, responsive, keyboard, and deeper failure-path evidence.

Restaurant-ledger localization checkpoint (2026-09-15): the Super Admin
partner-ledger funding table now localizes its headings, retry and empty-state
labels, amount placeholder, and system actor fallback across
`en/es/fr/ht/ar`. Ledger account statuses use the shared Credit status mapping
and timestamps use the selected document language; funding validation,
idempotency, currency selection, and mutation payloads were unchanged. The
Credit surface verifier passed with `573` keys, TypeScript passed, and
`client npm run build:ci` passed all configured focused regressions, i18n
verification, and the production bundle with only existing chunk/import
warnings. The patched runtime retry proof is recorded above. Exact next action:
continue the next unresolved Package G requirement with Credit disabled.

## 10. Package F: Deployable Artifact, Recovery, And Performance

Primary sources: `Dockerfile`, `docker-compose.coolify.yml`, `server/migrate.js`,
readiness/release scripts, `scripts/backup-coolify-production.sh`,
`scripts/check-production-backup.sh`, `scripts/verify-production-restore.sh`,
the two backup LaunchAgent templates, and the production runbook.

1. Build from locked dependencies and identify the exact source and output image
   digest. Verify API and client belong to the same release. Start the built
   artifact in the isolated environment and exercise its readiness and UI.
2. Test fresh installation and upgrade from the supported existing schema using
   the actual migration runner. Repeat startup; migrations must not run twice.
   Include interrupted/failed upgrade recovery and documented compatible rollback.
3. Inspect the verifier scripts: some current fixture creation uses `BEGIN` on a
   pool rather than a single acquired connection. Correct harness transaction
   ownership where needed before treating its rollback evidence as reliable.
4. Exercise configured backup scheduling locally: successful run, overlap lock,
   stale lock, failed dump, incomplete manifest, corrupt checksum, retention,
   disk-space error, and a monitor that reports stale or failed backups.
5. Restore into a separate database/container, start the intended artifact against
   it, run integrity checks and a representative financial journey, and verify
   uploads/configuration recovery. Counting tables/triggers alone is insufficient.
   Prove trigger behavior after restore, including disabled-trigger detection.
6. Keep the user's local-only storage choice. Test any implemented optional
   off-host adapter with a local compatible target/contract; document that the
   actual independent recovery copy remains a user launch/storage action.
7. Verify restart/recovery behavior for the supported Colima/Coolify setup. Before
   changing networking, inspect actual exposure and listeners. Respect existing
   user authorization for repairs; retain the disabled financial activation state.
8. Read workload targets already encoded in the performance script/runbook.
   Document target latency, throughput, error rate, memory, pool size, dataset,
   concurrency, warmup, and sample count before testing. Do not raise thresholds
   after a failing result merely to pass. Ten reads are preliminary evidence;
   use enough measured samples to support the intended percentile and workload.
9. Test same-restaurant contention and multiple restaurants, concurrent API and
   workers, bounded exports/pagination, and recovery under load. Run on the
   MacBook with one expensive test workload at a time and record resource use.

Exit gate: the identified image installs/upgrades, passes functional readiness,
survives tested recovery paths, restores correctly, and meets documented resource
and performance targets. Live configuration and human launch steps stay explicit.

## 11. Commands And Test Discipline

These commands exist in the inspected source. Run each from the shown directory.
Use the package's focused tests first, not every command after every edit.

Client directory: `/Users/oxsteed/Documents/GitHub/6/client`

```sh
node --test scripts/creditCurrency.test.mjs
npm run verify:i18n
npm run typecheck
npm run build:ci
```

Server directory: `/Users/oxsteed/Documents/GitHub/6/server`

```sh
npm test -- __tests__/oxsteedCreditAdminService.test.js __tests__/oxsteedCredit.test.js
npm test -- __tests__/paymentQueueReliability.test.js __tests__/workerMain.test.js __tests__/paymentWorker.test.js
npm test
npm run verify:i18n
```

The following existing commands require the isolated environment to be prepared
first. Inspect their guards, destinations, prerequisites, and cleanup before use.
Load credentials through protected environment configuration without printing them.

| Command from server | Existing requirement |
| --- | --- |
| `npm run verify:credit-concurrency` | `CREDIT_CONCURRENCY_TEST_MODE=true`; disposable DB named `oxsteed_verify_*` or `oxsteed_concurrency_*`; isolated database and Redis URLs |
| `npm run verify:credit-performance` | `CREDIT_PERFORMANCE_TEST_MODE=true`; disposable DB named `oxsteed_verify_*` or `oxsteed_performance_*`; isolated database and Redis URLs |
| `npm run verify:queue-recovery` | `QUEUE_RECOVERY_TEST_MODE=true`; isolated Redis URL; script creates its own queue namespace |
| `npm run verify:credit` | Inspect production configuration gates and DB target; preserve those gates |
| `npm run verify:readiness` | Inspect arguments/environment and verify the target artifact |
| `npm run verify:restore -- /absolute/path/to/verified.dump` | Inspect Docker context and target PostgreSQL container; creates a temporary database |

Reusable isolated Colima harness from the repository root:

```sh
bash scripts/credit-isolated-env.sh reset
bash scripts/credit-isolated-env.sh test
bash scripts/credit-isolated-env.sh accounting
bash scripts/credit-isolated-env.sh races
bash scripts/credit-isolated-env.sh queue-recovery
bash scripts/credit-isolated-env.sh performance
bash scripts/credit-isolated-env.sh failures
bash scripts/credit-isolated-env.sh down
```

`failures` stops only the harness PostgreSQL or Redis service, requires the
dependency-specific readiness failure, and verifies recovery before returning.
It must never be pointed at the production Coolify project.

From the repo root, run `git diff --check` before each package checkpoint.
Do not mistake a static source assertion for an executed financial test. Confirm
mock-based suites really exercise the relevant behavior; use real database/cache
tests when concurrency, transactions, leases, or triggers determine correctness.

## 12. Evidence Ledger And Completion Audit

Use the existing `docs/oxsteed-credit-requirements-matrix.md` as the single progress
index. Expand its broad rows into individually verifiable acceptance criteria.
Use the IDs below as a minimum scope checklist, not a replacement for newly found
requirements. Every item starts UNVERIFIED until its evidence is inspected.

| ID | Required capability | Principal packages |
| --- | --- | --- |
| CR01 | Central issuance authority, ownership and chart of accounts | C |
| CR02 | Separate restaurant subledgers, reserves, funding and obligations | C |
| CR03 | Existing restaurant wallet compatibility | C, D |
| CR04 | Issuance, loads, caps, funding provenance | A, C |
| CR05 | Balances, available funds and reservations | C |
| CR06 | Holds, capture, release and expiry | C, E |
| CR07 | Purchases, redemption and eligibility | C, D |
| CR08 | Refunds, adjustments and correction entries | C, D |
| CR09 | Transfers and limit enforcement | C, D |
| CR10 | Disputes, review and resolutions | C, D |
| CR11 | Clearing, settlement, failures and reversals | C, E |
| CR12 | Reconciliation and customer/restaurant/consolidated statements | C, D |
| CR13 | Immutable journal, audit evidence and signing-key rotation | C, E |
| CR14 | Authentication, roles, tenant isolation and approval rules | C, D, E |
| CR15 | Double-spend prevention, idempotency and replay defense | A, C, E |
| CR16 | Complete customer workflows | D |
| CR17 | Complete restaurant and POS workflows | D |
| CR18 | Complete Super Admin and emergency workflows | D |
| CR19 | Responsive and accessible UI, recovery and empty states | D |
| CR20 | Five locales, precision, rounding, timezones and regional rules | A, C, D |
| CR21 | Explicit supported conversion workflows and rejected unsupported paths | A, C, D |
| CR22 | Provider adapters, webhook contracts and outage recovery | E |
| CR23 | Background jobs, queues, crash recovery and shutdown | E |
| CR24 | Monitoring, diagnostics, secrets and configuration validation | E, F |
| CR25 | Reproducible build, migrations, deployment and release identity | F |
| CR26 | Automatic local backups, restoration and recovery tooling | F |
| CR27 | Meaningful unit/API/integration/browser/security/failure/race evidence | B-G |
| CR28 | Documented performance and MacBook resource targets | F |

For each criterion record implementation paths, test scenario, command, source
identity, environment, timestamp, exit result, sanitized artifact path, and limits
of the evidence. Proposed artifact directory:
`docs/evidence/oxsteed-credit/<run-id>/`. Do not commit raw production data, secrets,
session cookies, or unsanitized traces. Reference protected local artifacts when
their contents should not be versioned.

Use distinct states: TODO, IN_PROGRESS, VERIFIED_SOFTWARE, LIVE_CHECK_PENDING,
HUMAN_LAUNCH_ACTION. A deferred live check needs a reason, passing isolated/contract
evidence where possible, and an exact remaining action. It must not conceal an
independently testable software defect.

Resolve contradictory matrix wording. For example, a row still saying migration
515 needs application conflicts with a recorded migration-516 environment; check
the target once and correct the row. Separate a deployment activation setting
from code verification, and the optional off-host destination from the user's
requested local backup implementation. Do not invent engineering exceptions.

Final audit procedure:

1. Freeze the release candidate identity and inventory all relevant dirty and
   untracked files. Avoid unrelated modifications during final verification.
2. Read every CR item and all additional agreed acceptance criteria against actual
   implementation and recorded evidence. Missing or indirect evidence stays open.
3. Run the final affected regression, browser journeys, migration/restore checks,
   and artifact verification against that candidate. Fix discovered defects and
   rerun the affected checks; invalidate earlier evidence when dependencies change.
4. Confirm no in-scope production stubs, disconnected workflows, known acceptance
   failures, unexplained security issues, or ignored financial errors remain.
5. Document human launch actions and unavailable live checks with exact owners or
   required access. Do not make purchases, move real funds, or enable the Credit
   rail merely to make a completion indicator green.
6. Mark the active goal complete only when the user's full software definition is
   supported. Otherwise keep it active and continue the next actionable package.

Full backend regression checkpoint (2026-09-15): after adding strict observed
state preconditions to partner, agreement, and settlement transitions, the
complete server command `npm test -- --silent` passed `156/156` suites and
`1127/1127` tests. Its error output was limited to expected simulated failure
fixtures for validation, unavailable providers, database/Redis outages,
webhook rejection, integrity mismatch, queue failure, and malware scanning;
the command exited successfully. This verifies the current backend regression
surface, not the remaining browser, provider-sandbox, live-artifact, or
production-duration requirements. Exact next action: localize the compressed
settlement snapshot/reconciliation form and table controls in
`client/src/admin/pages/super/OxsteedCreditAdmin.jsx`, then run focused client
verification with Credit activation still disabled.

Settlement snapshot and payout-control localization checkpoint (2026-09-15):
the compressed Super Admin settlement form and payable table now render through
a dedicated localized component. Partner/agreement selection, period fields,
payment and reconciliation reasons, integrity output, payable provenance, and
approve/paid/void controls use stable Credit translation keys in
`en/es/fr/ht/ar`; guarded observed settlement status wiring remains intact.
`npm run verify:i18n` passed with `741` Credit keys, TypeScript passed, the
deployment wiring suite passed `27/27`, `npm run build:ci` exited `0`, and
`git diff --check` passed. The legacy inline block is no longer rendered and
Credit activation remains disabled. Exact next action: localize the
reconciliation-history and dispute operator controls in the same file, then
run focused client verification.

Operator evidence-surface localization checkpoint (2026-09-15): reconciliation
history, disputes, audit history, and payout recovery now render through
dedicated components using stable Credit translation keys across
`en/es/fr/ht/ar`. Filters, empty states, immutable evidence labels, resolution
controls, and reversal recovery wording are localized while pagination,
idempotency, observed-state guards, and compensating-journal safeguards remain
unchanged. `npm run verify:i18n` passed with `792` Credit keys, TypeScript
passed, the deployment wiring suite passed `27/27`, `npm run build:ci` exited
`0`, and `git diff --check` passed. Exact next action: authenticated browser
verification at available zoom and locale/timezone combinations, followed by
provider-sandbox and live-artifact handoff checks; keep Credit disabled.

Verifier coverage for webhook ordering migration (2026-09-15): the production
verifier now requires `522_webhook_event_ordering.sql`, the
`webhook_event_receipts` and `webhook_event_watermarks` tables, their required
ordering columns, and both receipt indexes before reporting a healthy
database. The focused webhook, Credit verifier, and deployment wiring suites
passed `166/166` tests; the full backend regression passed `156/156` suites and
`1129/1129` tests, with only expected simulated failure logs. `git diff
--check` passed. This strengthens read-only deployment verification without
changing Credit activation or production data. Exact next action: continue
the next unresolved Package G provider-sandbox/live-artifact evidence gap,
keeping Credit disabled.

Fresh-volume concurrency harness correction and artifact evidence (2026-09-16):
the disposable race verifier now enables its isolated rail before bootstrap,
uses a bounded `2500`-cent synthetic balance target for the complete workload,
and counts empty expiry batches correctly. Fresh rebuilt Colima project
`oxsteed-credit-test-20260916t00021789516959z-79041` applied migrations
`522/522`; the artifact verifier passed with no missing webhook schema,
indexes, or ledger/audit violations. Fresh-volume races passed one-winner
capture/release and expiry/capture, issuance/conversion caps, settlement
overlap, refund/refund, identical replay, conflicting-key rejection,
restaurant isolation, and final reserved balance `0`. Real Redis queue
recovery passed atomic enqueue, delayed retry, lease renewal/reclamation,
dead-letter preservation/replay, and duplicate suppression. Focused
Credit/webhook/deployment tests passed `168/168`; full backend regression
passed `156/156` suites and `1131/1131` tests; `git diff --check` passed. The
disposable project and volumes were removed, and Credit remains disabled in
production. Exact next action: continue provider-sandbox/event-delivery and
live-artifact handoff checks.

Guarded Stripe test-mode delivery evidence (2026-09-16): the isolated harness
now calls the actual `/api/webhooks/stripe` HTTP route with signatures produced
by the installed Stripe SDK. Fresh Colima artifact
`oxsteed-credit-test-20260916t00131789517586z-80038` reached readiness at
migrations `522/522`; the verifier passed valid delivery, duplicate replay
suppression, stale-event suppression, invalid-signature rejection, receipt
persistence, and newest-event watermark persistence. It is fail-closed to
`NODE_ENV=test`, the disposable database and project naming convention,
loopback API, and explicit provider-test mode. The disposable project and
volumes were removed after the run. Focused wiring/Credit/webhook tests passed
`169/169`. This is synthetic provider-sandbox evidence, not live Stripe
Dashboard event-delivery proof; the Stripe CLI and shell test secret were not
available. Exact next action: run the remaining authenticated browser
locale/timezone, 200%-zoom, and failure-path matrix, then keep the live
provider, monitoring, and unattended-backup checks as explicit handoffs while
Credit remains disabled.

Isolated startup race hardening evidence (2026-09-16):
`scripts/credit-isolated-env.sh` now waits up to 60 seconds for the disposable
app port to publish before checking readiness, so normal PostgreSQL startup
cannot be mistaken for a failed isolated environment. Fresh Colima project
`oxsteed-credit-test-20260916t00221789518121z-81114` built from the current
worktree, reached `200 ready` at migrations `522/522`, passed the guarded
Stripe provider verifier and isolated customer smoke, and was torn down with
its network and volumes. The deployment wiring suite passed `28/28` and shell
syntax validation passed. Production containers, wallets, database, and the
Credit activation safeguard were untouched. Exact next action: continue the
remaining authenticated browser locale/timezone, 200%-zoom, and failure-path
matrix.

Audit-filter localization evidence (2026-09-16): the Super Admin Credit audit
history filters now use the shared Credit namespace for action, resource,
partner, and request-correlation labels, including the all-partners option and
partner fallback. All five catalogs remain in parity at `793` Credit keys;
`client npm run build:ci` passed the configured Credit regressions, i18n
surface verification, TypeScript, and the production Vite bundle. Filtering,
pagination, and immutable audit behavior were unchanged. Exact next action:
continue authenticated browser locale/timezone, 200%-zoom, and failure-path
evidence while keeping Credit disabled.

Current isolated package checkpoint (2026-09-16): fresh Colima artifact
`oxsteed-credit-test-20260916t00341789518841z-82591` built from the current
worktree, reached `200 ready` at migrations `522/522`, and passed the guarded
Stripe test-mode HTTP verifier, customer smoke, accounting, concurrency,
performance, and Redis/PostgreSQL failure-recovery checks. The synthetic
Super Admin password-plus-TOTP verifier passed all 11 Credit read surfaces with
`railEnabled=false` after the reusable harness was hardened to suspend the
disposable rail before and after mutating checks. CUA browser evidence showed
Spanish localization, Arabic RTL rendering, USD/JPY currency switching, no
horizontal overflow at the available viewport, and keyboard focus reaching
Credit controls without warning/error console logs. Focused backend
regressions passed `151/151`, i18n parity and surface checks passed, shell
syntax validation and `git diff --check` passed. The disposable artifact was
not used to touch production containers, wallets, database, or Credit
activation state. Exact next action: complete exact viewport/200%-zoom,
timezone/DST, long-string, and deeper operator failure-path browser evidence;
then validate the patched release artifact and live monitoring/provider
handoffs without enabling Credit.

Responsive tablet defect correction checkpoint (2026-09-16): exact CUA browser
verification found the authenticated Restaurant Credit hero action row
overflowing at `768x1024` (`scrollWidth 815` vs `clientWidth 762`) while
`390x844` and `1440x900` were clean. `client/src/pages/food/RestaurantCreditPage.css`
now stacks that hero at `max-width: 900px`. The rebuilt Docker artifact
`oxsteed-credit-test-20260916t00491789519782z-84412` passed exact authenticated
checks at `390x844`, `768x1024`, and `1440x900` with no horizontal overflow and
no warning/error console logs; `client npm run build:ci` passed. The same
artifact's guarded Stripe test-mode HTTP verifier passed valid delivery,
duplicate and stale suppression, invalid-signature rejection, receipt
persistence, and watermark advancement; the disposable artifact and volumes
were removed. Browser keyboard and localized/RTL checks remain source-dependent;
exact 200% zoom remains unavailable in the current browser capability. Exact
next action: continue timezone/DST, long-string, 200%-zoom, and deeper operator
failure-path evidence, then validate live provider/monitoring/backup handoffs
without enabling Credit.

Super Admin transaction and currency-surface localization checkpoint
(2026-09-21): the main Credit console's currency summary and transaction-history
filters, table headings, empty state, pagination, inspect action, risk guardrail
labels, and loaded audit-event count now use localized Credit keys across
`en/es/fr/ht/ar`.
`client/scripts/creditAdminLocalization.test.mjs` is wired into
`client npm run build:ci`; the focused test passed `1/1`, Credit locale parity
and surface verification passed with `915` keys, and the customer-wallet,
grant/clawback/account-safety, partner lookup, and agreement-builder surfaces
now use the Credit namespace, including their placeholders and restriction
guidance. The messenger and public-profile prop mismatches were closed with
explicit optional contracts. The complete `client npm run build:ci` gate passed,
including all focused suites, TypeScript, and the Vite production bundle; the
bundle still reports only the existing dynamic-import, CSS-property, and
chunk-size warnings. Exact next action: continue the remaining authenticated
locale/timezone/DST, long-string, 200%-zoom, and deeper operator failure-path
evidence, then publish and verify the current catalog/quote-flow release
artifact without enabling Credit.

Current-source isolated release checkpoint (2026-09-21): the disposable seed
was corrected to give each synthetic restaurant its own business, matching the
one-restaurant-per-business invariant enforced by migration `539` while keeping
the multi-currency JPY/KWD cases. Fresh Colima artifact
`oxsteed-credit-test-20260922t01581790042283z-44667` applied `539/539` migrations
with zero pending or unexpected migrations and reached `200 ready` with Redis,
the dedicated ledger key, workers, and the disabled Credit rail healthy. The
live Direct Catalog verifier passed with `1,000` services, `40` tools, and `5`
categories. Bounded catalog performance passed `20` requests at concurrency
`4` with p50 `44.44ms`, p95 `206.99ms`, and max `328.23ms`. Redis and PostgreSQL
outage checks each returned the expected `503` degraded readiness response and
recovered to `200`; the disposable project, network, and volumes were removed.
The same current-source artifact also passed accounting workflows, all race
invariants with one-winner transitions and zero final reserved balance, guarded
Stripe test-mode delivery (valid, duplicate, stale, and invalid-signature
cases), and Credit performance with zero failed requests: account-read p95
`218.86ms`, transaction-read p95 `288.64ms`, eligibility-read p95 `288.81ms`,
purchase-write p95 `1759.65ms`, and `1.82MB` maximum process RSS increase.
A separate fresh `539/539` artifact
`oxsteed-credit-test-20260922t02191790043578z-47363` also passed the real Redis
queue-recovery verifier: atomic enqueue, duplicate suppression, delayed retry
promotion, stale-lease reclamation, active lease renewal, reclaimed-lease
non-revival, dead-letter preservation, and dead-letter replay.
The guarded Super Admin API verifier on fresh artifact
`oxsteed-credit-test-20260922t02231790043807z-47936` passed password-plus-TOTP
authentication and all 11 Credit read surfaces with `railEnabled=false`
(`3` accounts, `4` partners, `5` agreements).
Added `scripts/credit-isolated-seed.test.cjs` and wired it into CI; the focused
fixture regression passed `1/1`, enforcing unique business ownership for
restaurants and matching partner-to-restaurant business references.
Exact next action: publish the current source through the approved release path
and repeat live API, browser, request-metadata, restore, and monitoring checks;
preserve the observed production rail state and do not toggle it from this
engineering pass.

Client build-warning cleanup checkpoint (2026-09-21): the production bundle
warning caused by Tailwind interpreting chat marker documentation as an
arbitrary `quote:` CSS utility was traced to five client-side marker comments.
Those comments now describe the runtime fields without utility-like bracket
syntax; runtime marker construction and parsing are unchanged. `client npm run
build:ci` passed again with no malformed CSS-property warning. The remaining
bundle advisories are the pre-existing ImpersonatePage dynamic/static import
notice and large-chunk size notices. Deployment and isolated-fixture
regressions passed `10/10`; the messenger regression passed `56/56`, the
readiness payload/capability suites passed `17/17`, and `git diff --check`
passed. Exact next action:
continue the live release-path and remaining browser/restore/monitoring
evidence gaps; preserve the observed production rail state and do not toggle it
from this engineering pass.

Read-only live release recheck (2026-09-21 local / 2026-09-22 UTC):
`https://oxsteed.com/ready` and `https://api.oxsteed.com/health` returned `200`
for release `content-22d5628ed07a4bfa`, with migrations `539/539`, zero pending
or unexpected migrations, healthy Redis/ledger/realtime/workers/traffic and
shutdown checks, and a healthy monitoring prerequisite. The production Credit
rail reports `enabled=true`; this is an observed operational state, not proof
of human launch approvals. No toggle or financial mutation was performed.
Unauthenticated Credit API requests returned `401`. The read-only five-locale
Direct catalog verifier passed against production with `1020` services and
`40` tools per locale and bounded latency `219ms`. The local source candidate
is still dirty, so live/source identity remains an explicit release-audit gap.

Release identity gate checkpoint (2026-09-21): extracted the Dockerfile's
fallback `content-<hash>` algorithm into
`scripts/compute-content-release.cjs`, preserving raw-byte hashing and the
existing exclusions for dependencies, runtime data, build output, and env files.
Added deterministic/exclusion regression tests and changed the deployment job to
accept only the exact `GITHUB_SHA` or the content release computed from that same
checkout. `server/scripts/verify-readiness-payload.js` now supports one or more
expected release identities and rejects a healthy stale artifact with a release
mismatch. The focused root deployment/content tests passed `11/11`, the focused
server readiness/deployment suites passed `40/40`, the calculator matched the
previous shell implementation byte-for-byte, and an isolated Colima Docker
`release-meta` build produced the same `content-5cf18d36ea828c79` identity.
`git diff --check` passed.
The current read-only production release remains `content-22d5628ed07a4bfa` at
migrations `539/539`; the local candidate is dirty, so its source/live comparison
remains a publication handoff rather than an unverified completion claim.

Restore freshness checkpoint (2026-09-22 UTC): strengthened
`scripts/verify-production-restore.sh` to compare the restored `_migrations`
filename set with the current source and to require the current 12-table Credit
schema, including `oxsteed_credit_cards`. The previous local snapshot
`20260921T214419Z` was rejected with `532/539`, proving the new check catches a
backup taken before the latest deployment. A fresh local snapshot
`20260922T025200Z` was created and restored into a temporary database; the
verifier passed with `539` migrations, six Direct catalog migrations, migration
`529`, the quote relation, `1,000` services, `40` tools, the tool-category FK,
12 Credit tables, and five enabled Credit integrity triggers. The temporary
database was removed automatically. Static restore/deployment wiring passed
`33/33`, shell syntax and `git diff --check` passed; unattended six-hour and
off-device backup evidence remain launch handoffs.

Credit card localization checkpoint (2026-09-22 UTC): localized the customer
`OxsteedCreditCardsPage.jsx` and Super Admin `OxsteedCreditCards.jsx` through a
shared `credit.cards.*` namespace. Status, fulfillment, validation, error,
confirmation, one-time secret, and operator action text now has translations
in `en/es/fr/ht/ar`; the customer card form's duplicated nickname input was
also removed. Added `client/scripts/creditCardsLocalization.test.mjs` and
wired it into `client npm run build:ci`. The focused test passed `2/2`, Credit
locale parity and surface verification passed with `1042` keys, the full
client CI build passed through TypeScript and Vite, and only the existing
dynamic-import/large-chunk advisories remain. Exact next action: continue the
remaining authenticated locale/timezone/DST, long-string, 200%-zoom, and
failure-path checks, then publish and verify the current release identity
without toggling the observed Credit rail or performing financial mutations.

Provider delivery checkpoint (2026-09-22 UTC): a fresh Colima artifact
`content-1dbff90e09f14263` reached `200 ready` with `539/539` migrations and
the Credit rail disabled. `bash scripts/credit-isolated-env.sh provider`
exercised the real loopback Stripe webhook route with the Stripe SDK: valid
delivery succeeded, an exact duplicate was suppressed, an older event for the
same object was suppressed, an invalid signature was rejected, two processed
receipt rows were persisted, and the newest watermark was retained. The
disposable project, network, and volumes were removed after the run. Exact next
action: verify live provider event delivery and the end-to-end outage path on
the approved published artifact without toggling Credit or performing financial
mutations.

Application outage recovery checkpoint (2026-09-22 UTC): added the guarded
`server/scripts/verify-isolated-app-recovery.js` probe and wired it into
`bash scripts/credit-isolated-env.sh failures`. The probe refuses production,
non-loopback, non-test, and non-disposable project targets; it verifies that a
stopped app refuses `/health`, then after restart verifies `200 /health`,
`200 /ready`, and a bounded electrical catalog response. A fresh current-source
Colima artifact `content-db770b1e03b83ca8` reached `539/539` migrations and
passed Redis and PostgreSQL degraded-readiness recovery plus the full app
stop/restart route check. The harness rediscovered the dynamic published port
after restart; focused server wiring and guard tests passed `36/36`. The
isolated project, network, and volumes were removed afterward. Exact next
action: repeat this recovery check on the approved published artifact and
observe live provider delivery without toggling Credit or performing financial
mutations.

Transaction failure-injection checkpoint (2026-09-22 UTC): added
`server/__tests__/creditTransactionFailureInjection.test.js` with the real
transaction wrapper enabled. Synthetic journal failure during partner reserve
funding and synthetic settlement-insert failure both propagated the original
error, issued `ROLLBACK`, issued no `COMMIT`, and prevented downstream funding,
settlement, and audit writes. The focused card, conversion, partner-ledger, and
failure-injection suites passed `20/20` in the latest run. Exact next action:
complete the authenticated browser mutation/failure-path checks without
touching production balances.

Disposable financial rollback checkpoint (2026-09-22 UTC): rebuilt the current
source as artifact `content-dff55cafe6c74935` in a fresh Colima project with
`539/539` migrations, seeded synthetic Credit accounts, and ran
`bash scripts/credit-isolated-env.sh failure-injection`. The real service paths
injected failures after purchase, transfer, adjustment, hold capture, refund,
journal, partner-reserve funding, cross-currency conversion, and card cash-out
writes; all nine errors propagated, customer account, existing target wallet,
hold, conversion quote, and card state remained unchanged, the unused partner
ledger and both partner accounts were removed by rollback, no
funding/journal/audit/conversion/cash-out artifacts survived, and the Credit
rail ended disabled. The disposable project, network, and volumes were
removed afterward; production containers remained healthy. Remaining software
evidence is the authenticated browser mutation/failure-path check; live
provider delivery and published production outage observation remain
launch-operations evidence.

Admin localization gap checkpoint (2026-09-22 UTC): the Super Admin Credit
console no longer renders partner-picker counts/help, the Find partners action,
agreement example placeholders, partner fallback/status labels, or the
restricted-stored-value operational boundary as English-only literals. Added
the corresponding keys to `en/es/fr/ht/ar` and expanded
`client/scripts/creditAdminLocalization.test.mjs`; the focused admin/card
localization tests passed `3/3`, and `npm run verify:i18n` passed with `1055`
Credit keys and exact locale parity. Remaining localization evidence is the
authenticated browser locale/timezone/DST and long-string/responsive matrix,
not a source translation gap.

Admin derived-label localization checkpoint (2026-09-22 UTC): transaction
types, customer/partner/system parties, agreement geography labels, Customer
360 transaction/timestamp fallbacks, and failed-notification event, attempt,
and recipient labels now use the Credit namespace instead of raw English or
snake-case values. Added settlement, reserve, conversion, cash-out,
unknown-transaction, not-posted, and notification-state translations to all
five locales; the remaining settlement partner fallback now uses the same
localized path. The focused admin/card localization tests passed `3/3`,
`npm run verify:i18n` passed with `1074` exact-parity Credit keys, the full
`client npm run build:ci` passed through TypeScript and Vite, the backend
deployment/readiness wiring checks passed `42/42`, and
`git diff --check` passed. Current source identity is
`content-8229cd7f2cb928b3`. Remaining evidence is the authenticated browser
locale/timezone/DST, long-string/responsive, and failure-path matrix.

Admin operator-feedback localization checkpoint (2026-09-22 UTC): localized
the remaining Super Admin agreement, partner-status, settlement, reversal,
reconciliation, customer-adjustment, rail, notification, dispute, refund,
wallet-selection, and CSV feedback paths. Added a 97-key feedback block in
`en/es/fr/ht/ar` (95 new keys plus two existing keys moved out of duplicate
definitions), added the wallet-selection key, and added regression guards
against literal admin
errors, notices, dialog titles, and fallback messages. The focused admin/card
localization tests passed `3/3`; `npm run verify:i18n` passed with `1172`
exact-parity Credit keys; the full `client npm run build:ci` passed through
TypeScript and Vite; the deterministic release test passed `2/2`; and
`git diff --check` passed. Current source identity is
`content-d96e394ea72ac304`. Remaining evidence is authenticated browser
locale/timezone/DST, long-string/200%-zoom/responsive checks, deeper operator
failure-path browser checks, and publication against this source identity. The
same regression guard verifies every literal admin section has a translation
mapping and unknown worker names use a stable localized fallback.

Admin timestamp locale checkpoint (2026-09-22 UTC): corrected the Super Admin
Customer 360 and entitlement timestamp helpers to pass the selected app
language into `formatCreditDateTime`, and corrected the remaining Customer 360
dispute timestamp call that omitted the translator. This prevents those
surfaces from silently formatting dates in the browser locale when the app is
using another supported language. The focused client date-time and admin
localization tests passed `4/4`; the backend deployment/readiness wiring suite
passed `35/35`; the full client `npm run build:ci` passed through TypeScript and
Vite; `npm run verify:i18n` passed with `1172` exact-parity Credit keys; and
`git diff --check` passed. Current source identity is
`content-d81b26fcd8ce6f19`. Remaining evidence is the authenticated browser
locale/timezone/DST, long-string/200%-zoom/responsive checks, deeper operator
failure-path browser checks, and publication against this source identity.

Credit status and order-type label checkpoint (2026-09-22 UTC): centralized
customer and operator rendering of order types and agreement lifecycle values
through shared localized helpers. Known values such as `pickup`, `dine_in`,
`delivery`, and `draft` now use the selected locale; unknown provider values
fail closed to the localized unavailable label instead of exposing raw machine
codes. The focused Credit status/date-time/admin localization checks passed
`7/7`, the backend deployment/readiness wiring suite passed `35/35`, the full
client `npm run build:ci` passed through TypeScript and Vite, exact locale
parity passed with `1173` Credit keys across `en/es/fr/ht/ar`, and
`git diff --check` passed. Current source identity is
`content-e1480cf67ba9ad6a`. Remaining evidence is the authenticated browser
locale/timezone/DST, long-string/200%-zoom/responsive checks, deeper operator
failure-path browser checks, and publication against this source identity.

Credit transaction-label checkpoint (2026-09-22 UTC): extended the shared
label contract to customer transaction history and the restaurant partner
manager. Known transaction types now use stable localized keys, while unknown
transaction types resolve to `transactionUnknown`; disputed and reversed
partner lifecycle states now use localized status keys instead of raw fallback
text. The focused Credit status/date-time/admin localization checks passed
`8/8`, the backend deployment/readiness wiring suite passed `35/35`, the full
client `npm run build:ci` passed through TypeScript and Vite, exact locale
parity remained `1173` Credit keys across `en/es/fr/ht/ar`, and
`git diff --check` passed. Current source identity is
`content-942f153d54734401`. Remaining evidence is the authenticated browser
locale/timezone/DST, long-string/200%-zoom/responsive checks, deeper operator
failure-path browser checks, and publication against this source identity.

## 13. Checkpoint Template

Current implementation checkpoint (2026-09-22 UTC): the authenticated browser
matrix exposed and the source fixed a locale race in
`client/src/context/LanguageContext.jsx`. `syncLanguageFromServer` now respects
an explicit saved `oxs:language` choice, with
`client/scripts/languagePreference.test.mjs` covering both saved-choice and
first-login initialization behavior (`2/2`). A rebuilt disposable Colima
fixture rendered the customer Credit page in Arabic RTL after asynchronous
loading, then authenticated the synthetic Super Admin through password plus
TOTP and rendered the complete read-only Credit console with the rail still
suspended. The same fixture also verified operator recovery: stopping only
fixture Postgres produced the localized load-error alert and retry control;
restoring Postgres passed readiness with `539/539` migrations, and retry
restored the dashboard. The admin API verifier passed all 11 read surfaces,
isolated readiness reported `railEnabled:false`, the admin failure contract
regression passed `1/1`, and `client/npm run build:ci` passed. Current source
identity is `content-2e9328951e1670de`. The current-source browser matrix now
also passes English and Arabic RTL customer checks at `390x844`, `768x1024`,
and `1440x900`, long customer/operator search strings without page overflow,
and the client New York DST formatter cases (`4/4`); the server reconciliation
DST suite passed `9/9`. A second fresh disposable fixture completed the
five-locale customer matrix at `390x844`, `768x1024`, and `1440x900` with no
horizontal overflow, and completed the authenticated financial journey:
suspended-rail grant rejection with a visible failure alert, fixture-only rail
enablement, synthetic grant, customer hold, and hold release with the balance
restored. The later browser rail-suspend 403 followed the fixture Redis reset
that invalidated the admin session; the current source rail contract tests
passed `7/7`, direct fixture cleanup left the rail suspended, and the
stale-session observation is excluded from product-defect counts. The fixture
was removed and production remained untouched. Next exact action: repeat the
authenticated checks with fresh sessions under at least two browser time zones,
close or document the exact 200% zoom limitation, then publish the approved
source identity and repeat readiness, restore, provider-delivery, and outage
checks against that artifact. Do not enable or mutate production Credit as part
of this engineering pass.

Keep one compact current checkpoint in the progress index; avoid appending another
large duplicate history to AGENTS.md after every small edit.

Current implementation checkpoint (2026-10-01 UTC): Phase 5 of the OxSteed
Credit central-bank model built the code machinery for the KYC/AML/sanctions
compliance perimeter (gap 8), on branch `old-files-claude`. Migration 638
adds `oxsteed_credit_identity_verifications` (tiers 0/1/2, provider references
only, no raw ID documents), `oxsteed_credit_sanctions_screenings`
(customer|partner, fail-closed manual review), `oxsteed_credit_compliance_cases`
(open/investigating/resolved/escalated with SLA), and
`oxsteed_credit_stepup_challenges` (HMAC code hashes only). The fiat funding
choke point now checks rail, amount, identity tier (tier 0 blocks all fiat,
tier 1 caps per top-up), and sanctions before any persistent side effect;
denials write `fiat.funding_compliance_denied` outside the rolled-back check
transaction. Settlement payouts require a fresh admin step-up challenge plus a
fresh sanctions screen of the beneficiary partner. The nightly
`oxsteed-credit-compliance-monitor` job runs four transaction-monitoring rules
(structuring, velocity spike, rapid fund-out, first large payout) with
per-rule/per-subject/per-period dedupe and raises critical incidents on SLA
breaches. A super-admin compliance queue UI (verifications, sanctions hits,
cases) ships with decisions recorded with reason plus audit events, and five
locales carry the new keys (en/es/fr/ht/ar). Verification: new
`server/__tests__/oxsteedCreditCompliance.test.js` `24/24`; fiat compliance,
top-up, settlement payout, settlement cycle, credit, reconciliation, food
wallet, webhook, payment, and QR suites green; `verify:i18n` passed and client
`build:ci` passed. Two real defects were found and fixed during the build: the
new services destructured an unexported `insertAudit` (now exported from
`oxsteedCreditAdminService`), and the admin-load compliance gate ran before the
cheap reason validation (reason check moved ahead of the gate). Human launch
actions that remain outside code: legal/compliance review sign-off, sanctions
and identity vendor contracts, regulatory filings, and jurisdiction licensing;
the rail stays disabled (migration 422) until those complete, and migration
638 has not been rehearsed against a real PostgreSQL instance (standing
caveat for all recent credit migrations). Next exact action: commit the
Phase 5 files and push on `old-files-claude`, then verify the remote tip
matches the local HEAD.

```text
Package / criterion:
Current source or artifact identity:
Newly completed behavior:
Verification command and outcome:
Evidence path and what it proves:
Known defect or remaining acceptance case:
Live process handle, if any:
Next exact action and first file:
External dependency, if any, and independent work continuing:
```

## 14. Ready-To-Use Continuation Prompt

> Continue the existing OxSteed Credit code-completion goal using
> `/Users/oxsteed/Documents/GitHub/6/docs/oxsteed-credit-luna-execution-plan.md`.
> Preserve the entire user scope and existing dirty worktree. Start with Package A:
> reproduce and fix exact decimal parsing, reject invalid optional limits, and
> align single/bulk entitlement currencies in the UI and API. Extend the existing
> currency tests and add meaningful entitlement behavior tests. Then build the
> shared isolated environment in Package B and continue through C-G. Complete
> independent engineering without waiting for human launch activities. Reuse
> verified evidence when its dependencies are unchanged, but do not claim broader
> coverage than the tests provide. At each checkpoint record the next exact action
> and continue. Keep production activation safeguards intact.
