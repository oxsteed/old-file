# Fifty additional restaurant fixes - 2026-10-22

These are additional to the prior 30-item batch. The review remains the requirements source; this checkpoint does not claim that the entire franchise review, every client/store workflow, or production acceptance is complete.

| # | Finding and implemented correction | Regression evidence |
|---|---|---|
| 1 | Accounting integration bodies could override the authorized restaurant ID. The server now supplies that ID after body fields. | Full-schema forged-body write test |
| 2 | Assigned-store staff could manage/read brand accounting integrations and export batches. These brand operations now require all-store access. | Five endpoint scope-denial cases |
| 3 | Accounting IDs accepted partial/coercible identifiers. Restaurant/export IDs now require full bounded decimal integers. | Route/service malformed-ID cases |
| 4 | The accounting service accepted arbitrarily long export periods. Periods are capped at 366 days. | Over-wide period rejected before integration lookup |
| 5 | Journal amounts accepted invalid, negative or over-precision values. Decimal amounts are validated and converted with exact integer cents. | NaN/infinity/negative/fraction/unsafe-range cases |
| 6 | Unbalanced accounting journals could be queued. Debits and credits must now balance exactly. | Balanced/unbalanced journal cases |
| 7 | Journal lines could disagree with their batch's currency or dates. Every line must match the export period/currency. | Period/currency mismatch cases |
| 8 | Export retries silently returned a different existing journal. Retries now compare canonical payloads, including after concurrent inserts. | Real JSONB retry/concurrency/conflict cases |
| 9 | Accounting status updates allowed invalid transitions and failed PostgreSQL parameter inference. Transitions are explicit, parameters typed, and identical posted evidence replays safely. | Full-schema pending/sending/posted and posted replay |
| 10 | Queued accounting journals lacked a required activity record. Queueing and auditing now share the transaction. | Audit failure causes rollback |
| 11 | Quality-audit IDs accepted coercible values. IDs now use strict bounded parsing. | Malformed resource-ID cases |
| 12 | audit.view authorized template/action management. Writes now require audit.manage as well as audit.view. | Real permission overrides and view-only denial |
| 13 | Audit template items accepted malformed/unbounded payloads and silently skipped rows. Item count, types and text lengths are checked. | Invalid item arrays/labels/counts |
| 14 | Audit weights/maxima accepted unsafe policies. Max scores and finite positive weights are bounded. | Invalid maximum/weight cases |
| 15 | String false could reactivate a quality template. Active flags now preserve explicit boolean semantics. | Boolean normalization cases |
| 16 | Concurrent template patches could overwrite unrelated changes. Updates lock the template and return their transaction's content. | Full-schema template edit/history tests |
| 17 | Deleting templates cascaded through audit history. Deletion now archives and hides the template; completed legacy screens render saved score rows. | Archive/history DB case and legacy browser fixture |
| 18 | Any member could change another auditor's run. Run mutations require the auditor or an authorized audit manager. | Other-auditor/view-only denial |
| 19 | Audit runs had no store identity and used database-local business dates. New runs require an authorized store and use its timezone. | Store-tagged full-schema run creation |
| 20 | Audit detail/list endpoints exposed sibling-store runs. Reads now enforce assigned-store scope. | Assigned member detail/list isolation |
| 21 | Invalid scores were silently clamped or converted to zero. Scores now require bounded integers within the run's item maximum. | Invalid score cases and valid scoring |
| 22 | Partial audits could complete with an inflated denominator, and template edits changed open runs. Items are snapshotted, legacy open runs pinned once, and every item must be scored. Completion returns saved scores/findings. | Partial completion denial, snapshot migration replay and edited-template completion |
| 23 | A finding could reference another template's item. The item must belong to the run snapshot. | Cross-template finding denial |
| 24 | Finding creation raced with audit completion. Both operations now lock the same audit row. | Concurrent finding/completion and closed-run denial |
| 25 | Finding client keys silently replayed changed payloads. Retries now bind note, item, severity, photo and creator. | Matching replay and changed-payload conflict |
| 26 | Corrective actions could skip states or reopen verified work. Updates now lock, validate transitions, preserve resolution evidence and treat verified as terminal. | Ordered verification and terminal-state tests |
| 27 | Corrective-action dates/assignees could reach SQL malformed or outside the team. Timestamps/UUIDs and active permitted staff are checked. | Invalid due dates and real assignment checks |
| 28 | Corrective-action reads/updates lacked store boundaries. Lists, creation and updates now use the audit's store. | Sibling-store list/update denial |
| 29 | Quality mutations lacked required transactional business audits. Template/run/score/finding/action events now commit with their writes. | Real audit-constraint rollback and controller coverage |
| 30 | Quality list limits accepted negative/invalid values. Run/action pagination now validates limits and offsets with deterministic ordering. | Invalid pagination cases |
| 31 | Training IDs accepted coercible values. Restaurant/module/assignment/rule IDs now reject partial and boolean identifiers. | Resource-ID validation and existing controller tests |
| 32 | Training policy updates accepted invalid pass marks and coercible attempt/validity values. Policy integers are bounded; nullable validity is explicit. | Invalid pass/attempt cases and lifecycle regressions |
| 33 | Checklist mutations omitted the transaction pool and acknowledgements bound a text value to UUID. Pool calls and UUID casts are corrected; run reads/writes enforce store scope. | Real checklist create/start/toggle and sibling-store denial |
| 34 | Malformed training questions were silently dropped, potentially leaving an empty passing quiz. Question arrays/counts/text are validated atomically. | Malformed question cases |
| 35 | Out-of-range correct answers were silently clamped. Correct indexes must now match the supplied option range. | Invalid correct-index case |
| 36 | Removing blank options could shift the correct answer. Blank/duplicate options are rejected while option positions remain stable. | Ambiguous/blank option cases |
| 37 | String false enabled modules and on-hire rules. Both flags now use explicit boolean parsing. | Module/rule boolean cases |
| 38 | Concurrent module edits could mix versions and snapshots. Version edits lock the module and return content through the same transaction client. | Concurrent distinct version/content snapshots |
| 39 | Deleting a module cascaded through assignments/completions. Archival now hides the module while retaining assignments, attempts and versions. | Real completed assignment retained after archive |
| 40 | Inactive modules could receive new assignments. Assignment creation locks and checks an active module. | Archived-module assignment denial |
| 41 | Archived modules could still start/accept attempts. Both paths now require an active module. | Archived assignment start denial and lifecycle checks |
| 42 | Training roster/assignment/completion lists ignored assigned stores. Manager reads now filter permitted staff memberships. | Store-scoped staff and assignment lists |
| 43 | Store managers could assign training to sibling-store staff. Assignment writes now validate target staff within the caller's permitted scope. | Cross-store assignee denial |
| 44 | Assignment due dates reached SQL without validation. Dates now require valid explicit-zone timestamps. | Impossible/ambiguous due-date cases |
| 45 | Quiz answers coerced booleans/null/strings and could mismatch the question count. Answer arrays are validated before attempts are consumed. | Invalid submissions leave attempt count unchanged |
| 46 | Retrying an already-started assignment returned not found. Repeated starts now remain idempotent without resetting attempts. | Repeated in-progress starts |
| 47 | Equal-time passing completions could reopen valid certifications. Recertification compares timestamp and completion ID together. | Equal-timestamp old/new passing completion test |
| 48 | Failed expiry notifications were acknowledged as delivered. Alerts now stamp completion only after confirmed delivery to every recipient, with expiry-specific retry keys. | Real failed/successful alert acknowledgement |
| 49 | HQ repeated brand compliance data for every store and allowed assigned members to manage the brand region tree. Compliance joins now use store audit/checklist/staff identity; region operations require all-store access and safe IDs. | Full-schema two-store HQ metrics and region regressions |
| 50 | HQ report dates accepted normalized impossible dates and used UTC/exclusive calendar endpoints. Ranges now validate real bounded restaurant-local dates with next-day exclusive bounds. | Impossible/over-wide/single-local-day cases |

## Verification

- **178 tests passed across nine focused suites**, including **21 new full-schema PostgreSQL cases** and the existing training lifecycle/database suite.
- **15 permission-resolver cases passed** against a separate explicitly named disposable database. Total: **193 server tests across 10 suites**, not a full-server-suite claim.
- **One Chrome browser regression passed**, checking snapshot scoring after template edits and distinct saved rows from legacy completed audits whose items were deleted.
- `npm run build:ci` in `client/` passed: localization parity, typecheck, production build and verification of 1,020 emitted assets.
- `DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000` passed: **970/970 migrations**, fresh apply plus complete replay/checksum verification.
- CI YAML and its new PostgreSQL step's shell syntax passed local validation. CI explicitly clones the already-migrated disposable database into `franchise_fifty_test` and runs the new full-schema suite.
- JavaScript syntax checks and `git diff --check` passed. Expected injected rollback errors in test logs are passing error-path coverage.

Commands used for the focused server checks (URLs are synthetic loopback targets):

```sh
FRANCHISE_FIFTY_TEST_DATABASE_URL=<disposable-url> STAFF_TRAINING_TEST_DATABASE_URL=<disposable-url> npm --prefix server test -- --testPathPatterns='restaurantFiftyFixes|restaurantTrainingLifecycle.db.test|restaurantAuditsController|restaurantTrainingController|restaurantAccountingService|restaurantHQController|restaurantHQService|restaurantThirtyFixes.test'
PERMISSION_RESOLVER_TEST_DATABASE_URL=<disposable-fr_t9-url> npm --prefix server test -- --testPathPatterns='permissionResolver.db.test'
node --test client/scripts/restaurantAuditSnapshot.browser-check.cjs
npm --prefix client run build:ci
DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000
```

## Rollout and remaining boundaries

Migration **995** adds `audit.manage`, archive timestamps, retained audit-item activation, audit/checklist store identity, tenant foreign keys, indexes and run snapshots. Existing `audit.view` grants do not gain management authority. Owners retain their implicit catalog access; other audit managers need an explicit management grant.

Only unambiguous single-store historical runs receive a store backfill. Ambiguous runs stay unassigned and are excluded from assigned-store/HQ store totals. Open legacy runs pin the items available at cutover; previously deleted records cannot be reconstructed. Completed legacy screens use their recorded score labels/values.

Run APIs accept `locationId`. Legacy clients default to the primary store or a sole assigned store; clients managing multiple assigned stores must supply the selection. Completing the shared store-picker experience across every operational client remains part of the broader review.

Accounting integrations/export batches are brand operations. Queued journals are validated durable records; no accounting provider worker was activated and no external journal was posted. No live SMS/email, production migration/deployment, stored-value activation or Credit change was performed. Provider acceptance, complete cross-client workflows and populated production-store acceptance remain open.
