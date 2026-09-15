# OxSteed Credit: GPT-5.6 Luna Execution Plan

Prepared: 2026-09-15. Audience: the model continuing this existing task.

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
- Exact next action: run `npm run build:ci` from `client/`, then start Package B
  by inventorying existing compose, migration, seed, and verification scripts
  for a unique loopback-only isolated environment.

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

## 13. Checkpoint Template

Keep one compact current checkpoint in the progress index; avoid appending another
large duplicate history to AGENTS.md after every small edit.

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
