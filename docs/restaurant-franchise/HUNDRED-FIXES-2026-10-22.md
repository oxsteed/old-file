# Restaurant operational fixes: 100-item resolution - 2026-10-22

Source list: [NEXT-100-AUDIT-2026-10-22.md](NEXT-100-AUDIT-2026-10-22.md). **99 candidates implemented; item 92 withdrawn with schema evidence.** This completes resolution of this batch, not the broader franchise review or production acceptance.

## Behavior and rollout

- Operational history is retained through archival, immutable SOP versions, checklist instruction snapshots, document tombstones and required transactional audits.
- Audit/checklist/hosting/payroll workflows explicitly select authorized stores. Documents, logbooks, brand announcements and order-linked support cases enforce the matching store boundary.
- Training grading and SOP signing bind to the content version the employee saw. Incomplete checklist evidence cannot be marked complete.
- Host stand supports editing, paging, store-local times, accessible table placement and actual party/table/POS-ticket linkage. Conflicting seating requests serialize, including the same guest targeting different tables.
- Payroll amounts use currency precision. Reports recover from failures and stale responses. HQ shares canonical net-collected facts and uses local business days; publishing previews include inherited resets and detect stale source/target policies.
- All new screen labels and starter content are present in en/es/fr/ht/ar. Existing unrelated locale entries are preserved.

Migration **99981_restaurant_operational_evidence.sql** is additive. It introduces archival/history fields, request identities, pinned training versions and table seating records. Existing migration bytes are unchanged. Previously deleted history and overwritten legacy SOP bodies cannot be reconstructed; the cutover pins the content still available.

API clients must send the displayed `sopVersion` for signing and `moduleVersion` for quiz submission after starting the assignment. New walk-ins require retry identity; the web client supplies it. Missing or conflicting identities fail explicitly. Physical printer, live messaging-provider and populated-store acceptance remain separate work.

No production migration/deployment, external accounting posting, live SMS/email or stored-value operation was performed. Credit behavior, consent rules, default-off growth/campaign controls and campaign approval remain unchanged.

## Verification

- Complete disposable migration runner: **1,001/1,001 applied and replayed**, including checksum/guard verification.
- Focused full-schema PostgreSQL regressions: **46 passed across three suites** (19 new operational cases, 21 retained fifty-fix cases, six training lifecycle cases).
- Browser/date regressions: **all eight restaurant browser checks and two date tests passed**, including actual API helper contracts, secondary-store audit starts, notified-party seating, keyboard floor movement, quiz answer identity, JPY/KWD amounts and 23/25-hour DST days. Commands from `client/`: `node --test scripts/restaurant*.browser-check.cjs` and `node --test scripts/restaurantOperationalDates.test.mjs`.
- Client `npm run build:ci` passed: localization, type/build checks, production bundle and **1,021 assets** verified.
- Growth instrumentation: **2,598/2,598 interactive controls named**, with activation gates unchanged.
- Wider restaurant regression run: **975 passed across 89 suites; 143 tests and three suites skipped**. Command: `npm --prefix server test -- --testPathPatterns="restaurant|franchiseOps|reviewW5Ops|partialIFixes|uploadVisibility"`, with explicit disposable full-schema database URLs and local FFmpeg/FFprobe supplied by the local test wrapper. Expected error-path logs are not test failures.
- Remote PR CI is pending publication. Local checks are not a production-readiness claim.

## Numbered resolution matrix

| Item | Resolution | Implementation | Verification path |
|---|---|---|---|
| 1 | Implemented | Audit helper domain objects match start, read and completion consumers. | Actual-helper Chrome flow and audit-history browser regression |
| 2 | Implemented | Audit management uses audit.view + audit.manage; brand template controls additionally require brand access. | Catalog permission guards and client build |
| 3 | Implemented | Audit/checklist execution explicitly selects an authorized store and sends locationId. | Secondary-store Chrome flow; store-scoped PostgreSQL run cases |
| 4 | Implemented | Corrective-action due dates become store-local end-of-day instants. | Operational date/DST cases and strict audit API validation |
| 5 | Implemented | Audit history supports previous/next pages. | Client build; existing bounded list API |
| 6 | Implemented | Audit starter content is translated in all five required languages. | Localization parity/build checks |
| 7 | Implemented | Resolved actions remain outstanding until verified in UI and run counters. | Shared completion definition and client build |
| 8 | Implemented | Managers have a personal-training view and can take their own assignments. | Ownership-marked assignment API and client build |
| 9 | Implemented | Deleting an earlier option preserves answer identity; deleting the correct option requires a new choice. | Chrome quiz editor regression |
| 10 | Implemented | Training due dates use explicit restaurant-local end-of-day timestamps. | Operational date/DST cases and training validation |
| 11 | Implemented | Assignment start pins and returns the displayed version; submission grades only that version. | PostgreSQL edit-during-training regression and training lifecycle suite |
| 12 | Implemented | Training starter lessons/questions are translated in all five languages. | Localization parity/build checks |
| 13 | Implemented | The editor rejects duplicate options before submit. | Editor validation and server question-policy regressions |
| 14 | Implemented | Quiz answers recover from session storage keyed by assignment and version. | Client build; bounded assignment/version identity |
| 15 | Implemented | Inactive modules cannot be assigned through the card controls. | Client build and inactive-module API regressions |
| 16 | Implemented | Training statistics count distinct valid passing assignments instead of attempts. | Passing-completion definition and client build |
| 17 | Implemented | Training management follows crew.manage rather than generic restaurant/settings grants. | Permission resolver and training controller suites |
| 18 | Implemented | Lesson-only modules can start and submit an empty quiz consistently. | Training module policy; client build |
| 19 | Implemented | Checklist templates archive instead of cascading through saved runs. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 20 | Implemented | Completion requires all tasks done and required notes present. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 21 | Implemented | A required-note item cannot be marked done without a note. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 22 | Implemented | Inactive or archived templates cannot start new runs. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 23 | Implemented | A run requires at least one active task. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 24 | Implemented | Stable start identity replays the original run and rejects actor/store/template conflicts. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 25 | Implemented | Run items retain the original task instructions. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 26 | Implemented | Malformed/empty task entries are rejected rather than dropped. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 27 | Implemented | More than 50 task entries are rejected rather than truncated. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 28 | Implemented | Unknown boolean representations are rejected. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 29 | Implemented | Sort values must be complete bounded safe integers. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 30 | Implemented | Checklist/SOP enum values are validated consistently. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 31 | Implemented | Configuration changes and their required business audits commit together. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 32 | Implemented | Task changes append before/after actor evidence to the activity log. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 33 | Implemented | Run business day uses store timezone and day-start policy. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 34 | Implemented | Ordinary staff cannot retrieve unpublished SOP bodies. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 35 | Implemented | SOP archival retains signed acknowledgements. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 36 | Implemented | SOP body/title versions are retained with acknowledgements. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 37 | Implemented | An identical SOP save does not bump version. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 38 | Implemented | Published SOPs require a nonempty body. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 39 | Implemented | Repeated successful completion returns the original completed run. | Operational PostgreSQL checklist/SOP cases; controller suites |
| 40 | Implemented | Document and signature-report access is restricted to authorized staff/store membership. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 41 | Implemented | Document dates require real date-only calendar values. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 42 | Implemented | Issued dates cannot follow expiry dates. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 43 | Implemented | Document/signature pages bound query size and signed-URL work; UI exposes paging. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 44 | Implemented | Document reviews serialize on the row to avoid stale updates. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 45 | Implemented | Deletion leaves a tombstone and a durable retryable storage-deletion queue entry. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 46 | Implemented | Duplicate/error signature uploads go through cleanup instead of being orphaned. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 47 | Implemented | Signatures must have PNG bytes when stored as PNG. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 48 | Implemented | Signing requires the exact SOP version displayed and checks it under lock. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 49 | Implemented | Identifiers and expiry windows use strict bounded integer validation. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 50 | Implemented | Staff UUID inputs are validated before SQL. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 51 | Implemented | Document titles are bounded before storage writes. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 52 | Implemented | Upload retry identities bind to content/metadata and serialize concurrent retries. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 53 | Implemented | Reviews/deletions retain required business audit records. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 54 | Implemented | Signed-download errors are logged by document id/code and returned as explicit unavailable state. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 55 | Implemented | Dates and metadata validate before upload. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 56 | Implemented | Pending/rejected status does not retain verified-by/time stamps. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 57 | Implemented | Signature upgrades serialize and preserve the first accepted signature. | Operational PostgreSQL vault/signature cases; training lifecycle suite |
| 58 | Implemented | Host stand reads/writes use the selected authorized store. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 59 | Implemented | Reservation wall times convert using store timezone. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 60 | Implemented | Reservation list supports bounded pages and date windows. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 61 | Implemented | Reservation rows show start/end, store-local times and assigned table. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 62 | Implemented | Hosts can reschedule and reassign active reservations. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 63 | Implemented | Table name/capacity/section/status/position can be edited. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 64 | Implemented | Floor plan supports arrow keys, dragging, pointer movement and coordinate editing. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 65 | Implemented | Floor plan size/positions remain in bounds with larger table counts. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 66 | Implemented | Waitlist UI consumes status filters, offsets and hasMore. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 67 | Implemented | Notified parties retain a Seat action. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 68 | Implemented | Terminal waitlist states cannot reopen or contradict seated timestamps. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 69 | Implemented | Quoted waits are strict integers between 0 and 1440 minutes. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 70 | Implemented | Walk-in retries retain a stable payload-bound identity. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 71 | Implemented | Active SMS claims fence competing mutations until acknowledgement/expiry. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 72 | Implemented | Merchant reservation creation carries a stable retry identity. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 73 | Implemented | Active waitlist entries can be cancelled from the host screen. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 74 | Implemented | Hosts can revise quoted wait and notes. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 75 | Implemented | Guest-facing operational status labels are translated. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 76 | Implemented | Seatings link tables/parties to existing POS tickets, validate store/capacity and serialize competing parties/tickets. | Operational PostgreSQL hosting/concurrency cases; Chrome host-stand flow; date/DST tests |
| 77 | Implemented | Cash-tip forms send an explicit authorized store. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 78 | Implemented | Cash-tip retries retain a stable identity. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 79 | Implemented | Amounts parse exactly using currency precision rather than multiplying by 100. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 80 | Implemented | Activity requests include the selected date range. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 81 | Implemented | Activity pages use offset and total. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 82 | Implemented | Activity load failures show an error/retry state. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 83 | Implemented | All labor-access 403 variants produce a denial state. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 84 | Implemented | Exception-load errors no longer masquerade as no data. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 85 | Implemented | Tip settings require payroll.manage plus brand access in the UI. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 86 | Implemented | Activity timestamps render in the selected store timezone. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 87 | Implemented | Generation checks discard stale report/activity responses. | JPY/KWD Chrome flow; payroll controller/service suites; client build |
| 88 | Implemented | HQ uses the canonical collected-minus-refunded facts. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 89 | Implemented | HQ reporting reads accept report permission without requiring settings authority; publishing still requires settings authority. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 90 | Implemented | HQ sales use each store timezone and business-day start. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 91 | Implemented | Clearing a source override removes a stale target override during publishing. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 92 | Withdrawn | Withdrawn: archived is not a legal store status in migration 319. No invented status restriction added. | Real PostgreSQL CHECK violation 23514 regression |
| 93 | Implemented | Menu publishing shows before/after changes and validates the preview revision. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 94 | Implemented | HQ renders net sales and order counts separately per currency. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 95 | Implemented | HQ region forms support rename/reparent/archive with server cycle/root guards. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 96 | Implemented | Region load errors remain visible rather than becoming an empty hierarchy. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 97 | Implemented | HQ date range is visible, local-date based and uses an inclusive selected end day. | Canonical-sales and stale-preview PostgreSQL cases; HQ suites; client build |
| 98 | Implemented | Brand announcements require all-store authoring authority. | Assigned-manager announcement rejection in PostgreSQL suite |
| 99 | Implemented | Assigned managers cannot read or create global shiftless logbook records. | Store-scoped logbook PostgreSQL regression |
| 100 | Implemented | Support listing, detail, mutations and summaries enforce the order store. | Sibling-store support PostgreSQL regression |

## Next action

Review the PR and its final CI result. Deployment and production migration need their own commit-specific verification; check readiness, store isolation, operational hardware/provider behavior and rollback planning before any launch claim. The shared storage-deletion worker processes queued document cleanup after reference checks; its existing activation policy is retained.
