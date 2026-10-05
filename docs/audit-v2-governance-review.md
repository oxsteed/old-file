# Governance, corporate operations, and new workspaces: source audit v2

## Snapshot, scope, and evidence limits

Reviewed repository `/Users/oxsteed/Documents/GitHub/6` at HEAD `e47531c76b320c8145e15415774d05d698b456d1`, 2026-10-03. This is a read-only source review for the intended operation of 3,500 worldwide employees and six million users, not a complete security, financial, legal, accessibility, or production certification. Only this document is authored by this review. Existing reports and other untracked files are preserved. No fetch, deployment, credentials, real customer records, database writes, or product changes are part of the review.

The prior full audit is a discovery baseline only. The Customer360 mock correction, localization gate/debt update, process-state registry/Redis fencing, and the Legal acceptance `thisMonth` correction are credited as present changes, not repeated as unresolved defects. The later scale harness exists but has not been exercised here against six million users. The user reports latest CI run `37147612778` failed and readiness at 22:30 UTC was healthy with 661/661 migrations and null git SHA; neither observation proves this HEAD is deployed. Earlier green CI is historical. Production migration application, role ownership, provider approvals, rollout consistency, and live load behavior remain unverified.

Classification: **CONFIRMED DEFECT** means a current source path contradicts its intended behavior; it does not assert a production incident. **DESIGN GAP** means the existing implementation lacks an identified business/operator control. **UNVERIFIED** explicitly marks runtime or integration uncertainty. Recommended endpoints and screen elements below are requirements, not claims that those features already exist. Source links are one-based locations in this snapshot.

## Coverage and actual entry points

Route contracts are in [adminRouteManifest.js](/Users/oxsteed/Documents/GitHub/6/client/src/admin/adminRouteManifest.js:72), with corresponding guarded rendering in [AdminApp.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/AdminApp.jsx). The numbered scope is retained despite later navigation additions. Provider Health is main-owned; Restaurant Top-up Approvals is finance-owned and is not silently substituted for any assigned tab.

| Assigned tab | Actual browser route | Current page | API/controller/service paths |
| --- | --- | --- | --- |
| 53 Settings | `/admin/super/settings` | [PlatformSettings.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/PlatformSettings.jsx) | [admin.js](/Users/oxsteed/Documents/GitHub/6/server/routes/admin.js), [superAdminController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/superAdminController.js), [settingsChanges.js](/Users/oxsteed/Documents/GitHub/6/server/routes/settingsChanges.js), [settingsChangeController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/settingsChangeController.js) |
| 54 Audit Log | `/admin/super/audit-log` | [AuditLog.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/AuditLog.jsx) | [admin.js](/Users/oxsteed/Documents/GitHub/6/server/routes/admin.js), [superAdminController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/superAdminController.js), [auditService.js](/Users/oxsteed/Documents/GitHub/6/server/services/auditService.js) |
| 55 User Action Log | `/admin/super/audit-log/user-actions` | [AuditLogUserActions.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/AuditLogUserActions.jsx) | [auditController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/auditController.js), [auditService.js](/Users/oxsteed/Documents/GitHub/6/server/services/auditService.js) |
| 56 Legal, all routed subpages | `/admin/legal/acceptances`; `/admin/legal/audit-log`; `/admin/legal/compliance-metrics`; `/admin/legal/ccpa-requests` | [Acceptances](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/AdminLegalAcceptancesPage.jsx), [Legal audit](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/AdminLegalAuditLogPage.jsx), [Metrics](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/AdminComplianceMetricsPage.jsx), [Privacy requests](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/AdminCCPARequestsPage.jsx) | [legalDocuments.js](/Users/oxsteed/Documents/GitHub/6/server/routes/legalDocuments.js), [legalDocumentsController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/legalDocumentsController.js), [ccpaController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/ccpaController.js) |
| 57 Visitors | `/admin/super/visitors` | [VisitorHistoryPage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/VisitorHistoryPage.jsx) | [siteVisits.js](/Users/oxsteed/Documents/GitHub/6/server/routes/siteVisits.js), [siteVisitController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/siteVisitController.js), [siteVisitService.js](/Users/oxsteed/Documents/GitHub/6/server/services/siteVisitService.js) |
| 58 Profile Visibility | `/admin/super/profile-visibility` | [ProfileVisibilityPage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/ProfileVisibilityPage.jsx) | [profileVisibilityController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/profileVisibilityController.js), [profileVisibilityApprovals.js](/Users/oxsteed/Documents/GitHub/6/server/services/profileVisibilityApprovals.js) |
| 59 One Truth | `/admin/super/one-truth` | [OneTruthPage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/OneTruthPage.jsx) | [oneTruth.js](/Users/oxsteed/Documents/GitHub/6/server/routes/oneTruth.js), [oneTruthController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/oneTruthController.js) |
| 60 Franchise HQ | `/admin/super/franchises` | [FranchiseHQPage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/FranchiseHQPage.jsx) | [franchise.js](/Users/oxsteed/Documents/GitHub/6/server/routes/franchise.js), [franchiseController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseController.js), [franchiseTerritoryController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseTerritoryController.js) |
| 61 Careers | `/admin/super/careers` | [CareersAdmin.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/CareersAdmin.jsx), [HiringPipelineBoard.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/components/careers/HiringPipelineBoard.jsx) | [careers.js](/Users/oxsteed/Documents/GitHub/6/server/routes/careers.js), [careerController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/careerController.js) |
| 62 Country Packs | `/admin/super/country-packs` | [CountryPacks.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/CountryPacks.jsx) | [countryConfig.js](/Users/oxsteed/Documents/GitHub/6/server/routes/countryConfig.js), [countryPackController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/countryPackController.js), [countryPackService.js](/Users/oxsteed/Documents/GitHub/6/server/services/countryPackService.js) |
| 63 Corporate Setup | `/admin/super/corporate/departments`; dependent `/admin/corporate/org-chart`, `/admin/corporate/assignments` | [CorporateDepartments.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/CorporateDepartments.jsx) | [corporateRoles.js](/Users/oxsteed/Documents/GitHub/6/server/routes/corporateRoles.js), [corporateRolesController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/corporateRolesController.js), [corporateRolesService.js](/Users/oxsteed/Documents/GitHub/6/server/services/corporateRolesService.js) |
| 64 Mode Policies | `/admin/super/mode-policies` | [ModePolicies.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/ModePolicies.jsx) | [modePlatformApprovals.js](/Users/oxsteed/Documents/GitHub/6/server/routes/modePlatformApprovals.js), [modePlatformApprovalService.js](/Users/oxsteed/Documents/GitHub/6/server/services/modePlatformApprovalService.js) |
| 65 Mode Approvals | `/admin/super/mode-approvals` | [ModeApprovals.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/ModeApprovals.jsx) | [modePlatformApprovalController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/modePlatformApprovalController.js), [modePlatformApprovalService.js](/Users/oxsteed/Documents/GitHub/6/server/services/modePlatformApprovalService.js) |
| NEW Workforce | `/admin/super/workforce` | [WorkforcePage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/workspaces/WorkforcePage.jsx) | [workforce.js](/Users/oxsteed/Documents/GitHub/6/server/routes/workforce.js), [workforceController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/workforceController.js) |
| NEW Treasury | `/admin/super/treasury` | [TreasuryPage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/workspaces/TreasuryPage.jsx) | [treasury.js](/Users/oxsteed/Documents/GitHub/6/server/routes/treasury.js), [treasuryController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/treasuryController.js) |
| NEW Service Operations | `/admin/super/service-ops` | [ServiceOpsPage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/workspaces/ServiceOpsPage.jsx) | [serviceOps.js](/Users/oxsteed/Documents/GitHub/6/server/routes/serviceOps.js), [serviceOpsController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/serviceOpsController.js) |
| NEW Reliability | `/admin/super/reliability` | [ReliabilityPage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/workspaces/ReliabilityPage.jsx) | [reliability.js](/Users/oxsteed/Documents/GitHub/6/server/routes/reliability.js), [reliabilityController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/reliabilityController.js), [opsActionsController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/opsActionsController.js) |
| NEW Governance | `/admin/super/governance` | [GovernancePage.jsx](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/workspaces/GovernancePage.jsx) | [governance.js](/Users/oxsteed/Documents/GitHub/6/server/routes/governance.js), [governanceController.js](/Users/oxsteed/Documents/GitHub/6/server/controllers/governanceController.js), [investigationAccessService.js](/Users/oxsteed/Documents/GitHub/6/server/services/investigationAccessService.js) |

## 53. Settings

### Route and business purpose

`/admin/super/settings` controls platform configuration, feature flags, and proposed configuration changes. At worldwide scale, it is an operational change-control surface, not merely a preferences form: a valid change can alter fees, availability, or customer behavior across modules.

### Verified current implementation

Direct settings writes require `manage_settings`; change approval has the separate `approve_settings` permission in [settingsChanges.js:19](/Users/oxsteed/Documents/GitHub/6/server/routes/settingsChanges.js:19). The direct controller locks the setting, validates the value, increments its version, and commits audit evidence inside the transaction: [superAdminController.js:2228](/Users/oxsteed/Documents/GitHub/6/server/controllers/superAdminController.js:2228). Rollback creates a new validated version rather than deleting history. The page already offers previews, schedules, change requests, confirmations, flag controls, and dirty-state handling. Migration 023 defines settings/flags; migration 606 adds change requests. Focused request/applier tests exist.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — no stale-write rejection.** The update reads under a lock but never compares the operator's loaded version. A second editor can overwrite the first editor's committed value; serialization alone does not protect user intent ([controller:2236](/Users/oxsteed/Documents/GitHub/6/server/controllers/superAdminController.js:2236)).
- **DESIGN GAP — partial configuration bundles.** Save All sends individual requests and reports partial success, which is useful but cannot enforce an invariant across multiple settings ([page:1172](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/PlatformSettings.jsx:1172)). A fee pair or dependency pair can temporarily remain inconsistent.
- **DESIGN GAP — approval preview is not an execution contract.** Application rereads the then-current value without checking that it matches the reviewed baseline ([settingsChangeController.js:157](/Users/oxsteed/Documents/GitHub/6/server/controllers/settingsChangeController.js:157)). Direct writes also remain available alongside proposals; which keys mandate review is not encoded as a per-key business policy.

### Expansion failure scenario

Two country-launch teams edit shared settings. One approves a scheduled proposal; another directly changes the same key. The schedule later applies successfully to a different baseline. Audit rows exist, yet the approved impact no longer describes the actual change. A partially saved multi-key bundle makes incident reconstruction harder.

### Required changes and operator design

Add `expected_version` to direct writes and reviewed proposals; reject mismatches with 409 and the current value/version. Introduce transactional configuration bundles with cross-key validation. Classify review-required keys and explicit emergency overrides server-side. Connect changes to Country Packs rollout requirements and Reliability release evidence without making a settings approval equivalent to deployment approval.

#### Operator design recommendations

Retain the existing sectioned editor, but add a pinned header identifying environment, global/country applicability, last successful server read, and loaded configuration revision. KPI chips should count dirty keys, pending review requests, scheduled requests due within 24 hours, and failed applications; each opens its corresponding filtered queue rather than an unexplained total.

Use a settings grid with key, description, effective value, proposed value, version, dependency group, and review requirement. Search key/description; filter by group, modified state, and change stage. Save views such as “fee bundle changes” and “scheduled launches,” extending the current filters rather than replacing them. A detail drawer should show validation bounds, consumers, before/after diff, revision history, proposal reviewers, and application results.

Row actions are Edit, Propose, and View history; bundle actions are Preview, Submit for review, and Discard draft. Show the exact keys and predicted dependent effects before confirmation. Save All must not quietly imply atomicity while it remains a loop. On conflict preserve local drafts and offer a three-way comparison; after timeout query the change ID before retrying. Failed schedules need an assignee, error reason, and explicit re-preview action. Empty means no matching keys; no-access names the missing permission; unavailable preserves the last snapshot with writes disabled. On mobile use stacked diffs, accessible field errors, keyboard-operable drawers, and RTL-safe logical alignment so Arabic values and machine keys remain legible.

### Acceptance tests and owner

Platform Configuration owns implementation; Finance approves monetary keys. Two writes using the same version must produce one success and one 409 without a second audit event. A scheduled request whose baseline changed must require renewed review. A bundle containing one invalid key must commit zero changes. Reuse request/applier tests, then add rollback and timeout-recovery cases that assert database state, not only HTTP codes.

## 54. Audit Log

### Route and business purpose

`/admin/super/audit-log` is the cross-platform administrative evidence viewer. Security, Finance, and Legal need to reconstruct who changed a resource and correlate that change with an operational incident. Event storage and the ability to investigate those events are separate capabilities.

### Verified current implementation

The API requires `view_audit_log` and bounds page size at 100 ([superAdminController.js:2430](/Users/oxsteed/Documents/GitHub/6/server/controllers/superAdminController.js:2430)). The screen renders timestamp, administrator, action, target, description, and IP ([AuditLog.jsx:147](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/AuditLog.jsx:147)). Hash-chain serialization and update protection already exist in migration 406; migration 407 provides verification. Importantly, [migration 624:138](/Users/oxsteed/Documents/GitHub/6/server/migrations/624_ws5_audit_evidence_guards.sql:138) replaces silently swallowed deletes with raising triggers and revokes PUBLIC truncate privileges. These are real safeguards, not missing append-only storage. Actual non-owner production database privileges remain unverified.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — response ordering race.** The page effect has no cancellation or request-generation check; a slow earlier filter request can replace newer results ([page:19](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/AuditLog.jsx:19)). Investigators can see records for filters no longer displayed.
- **DESIGN GAP — unstable pagination contract.** The controller uses offset pagination ordered solely by creation time, without an ID tie-breaker or snapshot boundary ([controller:2442](/Users/oxsteed/Documents/GitHub/6/server/controllers/superAdminController.js:2442)). Identical timestamps and ongoing writes can cause repeats or omissions across pages.
- **DESIGN GAP — evidence hidden from the operator.** The table does not expose structured before/after changes, target-key search, or chain-verification results. Existing evidence is materially richer than the rendered description.
- **DESIGN GAP — storage integrity does not guarantee writer completeness.** [auditService.js:19](/Users/oxsteed/Documents/GitHub/6/server/services/auditService.js:19) supports transactional fail-closed logging, but standalone callers can remain best-effort. Governance's mutation paths and Workforce's post-write audit sequence illustrate different coverage semantics; the viewer supplies no distinction.

### Expansion failure scenario

A reviewer investigates a country-policy change during a high-volume incident. New entries shift offset pages while an earlier action-filter request arrives late. The screenshot appears authoritative but combines a different filter with incomplete traversal. A valid chain proves retained rows were not altered; it cannot prove every sensitive mutation emitted a row.

### Required changes and operator design

Add cursor pagination on `(created_at,id)` with a fixed upper boundary, structured event lookup by target key and correlation ID, and an explicitly privileged integrity-verification endpoint. Define mandatory audit producers with atomic mutation/evidence guarantees. Do not recommend rebuilding the existing hash chain or weakening its delete guards.

#### Operator design recommendations

Replace the bare log header with “Administrative evidence,” selected time interval, timezone, snapshot boundary, and last successful load. KPIs should report matching events, distinct actors in the selected interval, and last verified chain checkpoint; “not checked” is different from “valid.” Never infer completeness from zero broken links.

Retain existing table fields and add event ID, target key, correlation ID, and evidence availability. Search actor/resource/correlation independently; provide action-family, module, UTC interval, and integrity filters. Saved views should encode incident references and filter parameters, not cache personal data. A drawer should contain an immutable event envelope, structured before/after diff, linked resource, producer identity, and hash/checkpoint evidence. Sensitive IP details can require deliberate reveal with read logging.

Allowed row actions are Open resource, Copy evidence reference, and Add to investigation collection. Bulk action exports selected immutable references plus a manifest and filter snapshot; never offer edit/delete. Export preview states row count, restricted fields, and destination purpose before confirmation. Abort obsolete searches and pin results to the requested snapshot. On verification failure show the first broken reference and escalation path; on service failure preserve prior results under a stale banner. Assignment belongs to an investigation case with a named Security reviewer and next evidence request. Empty explicitly says no matching events, not “system compliant”; no-access offers permission-request guidance without revealing rows. Mobile shows compact event cards with a full-screen drawer. Keyboard focus, semantic diff labels, and bidirectional handling for actor names and opaque IDs are essential.

### Acceptance tests and owner

Security Engineering owns evidence contracts; Internal Audit owns investigation usability. Delay request A until request B finishes: only B may render. Insert concurrent same-timestamp events between cursor pages: every snapshot event must appear exactly once. Tampering must fail under migrations 406/624. Simulated audit failure on mandatory producers must leave neither mutation nor partial evidence. Confirm viewer “unchecked/unavailable” states never render as a successful integrity check.

## 55. User Action Log

### Route and business purpose

`/admin/super/audit-log/user-actions` specializes in administrative changes to users, including old/new values and notification evidence. It must support complaints, reversals, and access reviews without confusing a recorded change with successful communication to the affected person.

### Verified current implementation

The current page supports actor, target, action, region, and date filters, total counts, and abortable requests ([AuditLogUserActions.jsx:47](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/AuditLogUserActions.jsx:47)). API scope resolution fails closed when scope is unavailable ([auditController.js:19](/Users/oxsteed/Documents/GitHub/6/server/controllers/auditController.js:19)). CSV export already uses the exports database budget, no-store headers, and spreadsheet-formula neutralization ([controller:75](/Users/oxsteed/Documents/GitHub/6/server/controllers/auditController.js:75)). Migrations 116/124 establish action records and nullable principals; migration 624 raises on deletion. These existing protections should remain.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — incomplete export without disclosure.** Export fetches only 500 records at offset zero and ignores the matching total; the page downloads it without a truncation warning ([controller:84](/Users/oxsteed/Documents/GitHub/6/server/controllers/auditController.js:84), [page:76](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/AuditLogUserActions.jsx:76)). An investigator can mistake a capped file for the complete selected history.
- **CONFIRMED DEFECT — retained events disappear from the list.** The data query inner-joins both user principals while the count query counts the base log. Nullable/missing principals therefore yield inconsistent totals and invisible retained evidence ([auditService.js:221](/Users/oxsteed/Documents/GitHub/6/server/services/auditService.js:221)). This is a query-contract defect even without proving live deletion incidence.
- **CONFIRMED DEFECT — imprecise notification attribution.** Notification marking updates rows for the same administrator/target within 30 seconds rather than exact event IDs ([service:142](/Users/oxsteed/Documents/GitHub/6/server/services/auditService.js:142)). Separate edits can be marked notified by one notification attempt.
- **DESIGN GAP — truncated field evidence.** The table shortens old/new values and provides no dedicated evidence drawer; a boolean “notified” omits channel, delivery attempt, and failure reason.

### Expansion failure scenario

A support team changes a user's contact and access settings in quick succession. One email succeeds and a second fails, yet nearby events acquire the same notification flag. A later privacy deletion removes a principal join. A capped export then obscures both the missing event and the inaccurate delivery conclusion.

### Required changes and operator design

Return export counts/truncation metadata immediately; use a snapshot-bound asynchronous export for complete histories. Left-join principals and retain safe actor/subject snapshots. Associate notification jobs and delivery receipts with exact action IDs. Cross-link Workforce grants, Profile Visibility changes, and Legal revocations while preserving their distinct event schemas.

#### Operator design recommendations

Keep the current filters and add a header showing subject scope, selected interval, timezone, and last successful query. Define KPIs as matching action events, events with delivery failure, and events lacking a retained principal; do not count field-level rows as unique customers. Place export scope and completeness beside the download button.

Table columns should be event ID, time, actor snapshot, affected user reference, field/action, summarized before/after, region, and notification state. Add searches for exact user/event ID and a notification filter with queued, delivered, failed, and unknown states. Saved views can include “contact changes with failed delivery” and “offboarding changes,” using existing date/region filters. A drawer displays full redacted values, initiating request, related events, notification attempts, and linked reversal evidence.

Row actions are Open affected user, Inspect delivery, and Create follow-up task. Permit bulk export or assignment of follow-ups, not bulk reversal of arbitrary user fields. A notification retry must preview recipient/channel, redact sensitive content, and validate that the contact address is still appropriate. Confirm retries by exact event ID; recover timeouts by querying delivery-job status rather than sending again. Missing principals remain visible with a retained-reference label. A failed list request must not present the previous total as current. Empty, no-access, and export-unavailable states explain their different causes. Assign delivery failures to Customer Operations with a due next contact attempt. On narrow screens place old/new content in labeled stacked blocks; support keyboard disclosure and RTL names without reversing IDs or email strings.

### Acceptance tests and owner

Customer Operations owns delivery follow-up; Security Engineering owns retention and export integrity. Seed 501 matching events: synchronous export must declare truncation or asynchronous export must include all 501. Null either principal: list and count must still agree. Generate two edits in 30 seconds and deliver only one receipt: exactly one event becomes delivered. Existing audit-export safety and fail-closed tests should continue passing.

## 56. Legal: acceptances, legal audit, compliance metrics, privacy requests

### Route and business purpose

The four actual Legal routes in the coverage table share [LegalSubNav.jsx:5](/Users/oxsteed/Documents/GitHub/6/client/src/admin/components/LegalSubNav.jsx:5). They respectively track consent evidence, legal events, aggregate acceptance/request metrics, and privacy cases. Older document-editor/mock pages elsewhere in the tree are not these routed screens. Document draft/publish APIs remain relevant dependencies, not proof of a routed editor.

### Verified current implementation

Acceptances have filters, pagination, revocation, and CSV; Legal audit has filters and details. Each API has its own permission gate: operations for acceptances/metrics/privacy, audit permission for events, export permission for CSV ([legalDocuments.js:291](/Users/oxsteed/Documents/GitHub/6/server/routes/legalDocuments.js:291)). Drafts persist through migration 644; acceptance and audit schemas are established by migrations 162, 164, 587, and 588. The latest `ac2abcf7` date correction and its parameter tests are present and passed locally; the old `thisMonth` defect is not a finding.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — revoked consent still looks previously accepted.** Acceptance lookup ignores `deleted_at`; revocation sets that field. Reaccepting the same version returns `alreadyAccepted` and a newly fabricated timestamp rather than a new active record ([controller:53](/Users/oxsteed/Documents/GitHub/6/server/controllers/legalDocumentsController.js:53), [controller:515](/Users/oxsteed/Documents/GitHub/6/server/controllers/legalDocumentsController.js:515)).
- **CONFIRMED DEFECT — metrics do not measure current valid consent.** The denominator counts active undeleted users while the numerator counts every historical acceptance, including revoked or inactive subjects. Document workflow totals are hard-coded zero ([controller:309](/Users/oxsteed/Documents/GitHub/6/server/controllers/legalDocumentsController.js:309)). Rates can mislead even when the page renders correctly.
- **CONFIRMED DEFECT — filtered Legal exports are unfiltered.** Both CSV handlers ignore query filters and cap at 5,000 rows ([router:297](/Users/oxsteed/Documents/GitHub/6/server/routes/legalDocuments.js:297), [router:337](/Users/oxsteed/Documents/GitHub/6/server/routes/legalDocuments.js:337)). Their quoting helper is not the User Action export's formula-neutralization control.
- **DESIGN GAP — completion is a status, not verified fulfillment.** Privacy updates allow `completed` without a per-system manifest or transition precondition; all transitions log `ccpa_completed` ([ccpaController.js:350](/Users/oxsteed/Documents/GitHub/6/server/controllers/ccpaController.js:350)). Data compilation uses unrestricted `SELECT *` and returns an empty object on failure ([controller:525](/Users/oxsteed/Documents/GitHub/6/server/controllers/ccpaController.js:525)). Exact live field exposure and fulfillment coverage are **UNVERIFIED**, not assumed safe.

### Expansion failure scenario

A new document version rolls out globally. Historical/revoked consent inflates adoption while privacy staff mark cases completed despite failed data collection. A filtered audit download unexpectedly includes unrelated subjects. Governance dashboards inherit those misleading metrics; none establish legal compliance.

### Required changes and operator design

Bind acceptances to immutable published document revisions and append revocation/reacceptance events. Compute current-version active acceptance populations consistently. Share scoped, formula-safe exports. Replace privacy completion with verified identity, jurisdiction-specific counsel-configured deadlines, system tasks, delivery receipts, and held-data exceptions.

#### Operator design recommendations

Use a shared Legal header with country/jurisdiction, document revision, timezone, and data freshness. Keep four navigation panels; do not merge evidence with fulfillment. Acceptance KPIs count eligible subjects, current valid acceptances, and revocations. Its list needs subject reference, document/version/locale, accepted time, revocation state, and evidence ID; filters include revision and validity. A drawer shows the exact published artifact and consent timeline. Revoke requires reason and an impact preview; bulk action is evidence export, not indiscriminate consent removal.

Legal audit needs actor, action, resource, case ID, time, and event status, with saved case views and immutable details. Export confirmation must name applied filters and capped/full scope. Compliance metrics should show numerator, denominator, exclusion rules, calculation time, and revision coverage; unavailable figures are unknown, never zero.

Privacy requests need type, jurisdiction, verified identity, deadline, stage, assigned specialist, outstanding system tasks, and delivery result. Search case/subject; save “identity pending” and “fulfillment blocked” views. The drawer contains identity evidence, allowlisted data manifest, deletion/hold exceptions, correspondence, and task receipts. Allow Assign, Request information, Generate preview, Approve fulfillment, and Retry delivery only when prerequisites pass. Timeouts recover via case/job status; conflicts preserve notes and require reload before transition. Empty panels distinguish no cases from no access and backend failure. On mobile, present deadlines and blocked tasks above attachments; keyboard announcements, RTL legal text, and accessible confirmation dialogs must survive translated long content.

### Acceptance tests and owner

Privacy Engineering and Legal Operations are jointly accountable; counsel owns jurisdiction policy. Revoke then reaccept must create valid new evidence without losing history. Metrics must exclude revoked/inactive/old-version records and disclose denominators. Filtered CSV must contain only matching rows and neutralize formulas. Failed collectors must prevent completion. Every privacy transition must emit its actual event type. Existing Legal parameter tests must remain green.

## 57. Visitors

### Route and business purpose

`/admin/super/visitors` provides pageview history and geography/device summaries. Growth and incident teams can use it to understand recorded traffic; it is not a customer census or an employee surveillance tool. Six million users require honest measurement definitions as well as bounded queries.

### Verified current implementation

Both visitor APIs require the dedicated `view_visitor_analytics` permission ([siteVisits.js:14](/Users/oxsteed/Documents/GitHub/6/server/routes/siteVisits.js:14)). The recording service respects DNT, strips query/hash components from paths, sanitizes referrers, and stores hashed rather than raw IPs ([siteVisitService.js:60](/Users/oxsteed/Documents/GitHub/6/server/services/siteVisitService.js:60)). Migration 613 adds history indexes and a nullable user relationship. The page fetches list and summary together and ignores obsolete effects ([VisitorHistoryPage.jsx:70](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/VisitorHistoryPage.jsx:70)). Existing tests verify sanitization, DNT, summary/filter behavior, and safe beacon failure.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — selected end day is largely excluded.** The UI sends date-only values; the controller parses the upper bound as midnight and uses `visited_at <= to` ([siteVisitController.js:31](/Users/oxsteed/Documents/GitHub/6/server/controllers/siteVisitController.js:31)). A range ending today excludes almost all today's events.
- **CONFIRMED DEFECT — country KPI is capped by a chart limit.** The summary returns only the top 15 countries, while the page labels array length as countries ([controller:128](/Users/oxsteed/Documents/GitHub/6/server/controllers/siteVisitController.js:128), [page:120](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/VisitorHistoryPage.jsx:120)). A worldwide footprint can appear to stop at 15.
- **DESIGN GAP — IP hashes are labeled unique visitors.** Counting distinct hashed IPs measures observed network identifiers, not distinct users or devices ([controller:123](/Users/oxsteed/Documents/GitHub/6/server/controllers/siteVisitController.js:123)). Shared networks merge people; network changes split them. DNT exclusions further limit coverage.
- **DESIGN GAP — stale results remain ambiguous after failure.** The page retains prior rows/summary with an error but lacks a snapshot-age label and dedicated retry workflow. The service has retention pruning code; actual job operation and production volumes are **UNVERIFIED** rather than declared absent.

### Expansion failure scenario

An executive reviews a launch-day report across 40 countries. The selected end date removes that day's traffic and the countries tile remains 15. Shared workplace IPs suppress apparent uniqueness. The team makes launch decisions from correctly stored but incorrectly described aggregates.

### Required changes and operator design

Specify date boundaries as `[start,endExclusive)` in an explicit timezone. Return a separate distinct-country count and top-country coverage. Rename the hash metric to an observed-network estimate; disclose collection exclusions. Keep identity-level inspection separate from aggregated analysis and connect retention policy to Legal without widening collection.

#### Operator design recommendations

The header should read “Recorded pageviews,” with timezone, inclusive dates, exact effective UTC boundaries, and last successful aggregation time. KPI definitions must distinguish pageviews, observed network hashes, signed-in subjects, and distinct countries. Add a collection-coverage note for DNT and missing attribution; do not imply coverage of all six million users.

Use a list with visit time, normalized path, referrer host, country/city confidence, device, and optional subject reference. Preserve country/path filters but debounce text searches and offer Apply for range changes. Saved views should include “launch landing pages” and “unexpected referrer traffic.” Top-country charts must show “top 15 of N” and the omitted share. A row drawer should expose sanitized collection fields and retention expiry, not reconstruct raw IP or stripped query parameters.

Allowed actions are Open normalized page, Inspect collection metadata, and Create a traffic investigation. Bulk exports should be aggregated by default with a preview of date scope and privacy exclusions. Identity reveal needs a separate recorded purpose if introduced. Collection outages display unknown coverage; query failure preserves a labeled stale snapshot and Retry. A conflict in saved-view dates should prompt timezone clarification rather than silently alter bounds. Route anomalies can be assigned to Growth Analytics or Security with a next collection/check task. Empty means no recorded visits in the range; no-access describes the dedicated grant; unavailable means no trustworthy summary. Mobile should prioritize range controls and totals, collapse geography into cards, label form controls programmatically, and isolate machine paths from RTL prose.

### Acceptance tests and owner

Growth Analytics owns metric definitions; Privacy Engineering owns collection boundaries. A visit at 23:59 on the selected end date must be included, the next day excluded, including DST transitions. With 16 countries the KPI must show 16 and chart 15. Shared-IP fixtures must not be called distinct people. Failure must display stale/unknown status rather than a fresh zero, while existing DNT/path tests remain passing.

## 58. Profile Visibility

### Route and business purpose

`/admin/super/profile-visibility` controls administrative hiding/restoration of public profiles. It affects discovery and livelihoods, so operators need precise change evidence, approval execution status, and protection for in-flight work, not a second generic moderation dashboard.

### Verified current implementation

The component already implements search, saved views, previews, active-work checks, reasons, bulk dry runs, scheduling, approval queues, history, notification state, and recovery. API routes require `manage_profile_visibility`. Migrations 614/617/618 add overrides, schedules, and approvals; 652–654 add durable claims, per-item outcomes, and recovery. Approval decisions reject self-review and atomically reassert pending state ([profileVisibilityApprovals.js:263](/Users/oxsteed/Documents/GitHub/6/server/services/profileVisibilityApprovals.js:263)). This is substantially implemented; the old missing-concurrency-guard finding is not current.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — executable approvals lose their payload.** The initial SELECT omits payload, but bulk/scheduled execution uses `approval.payload`, not the full `reviewed` RETURNING row ([service:258](/Users/oxsteed/Documents/GitHub/6/server/services/profileVisibilityApprovals.js:258), [service:312](/Users/oxsteed/Documents/GitHub/6/server/services/profileVisibilityApprovals.js:312)). Bulk execution can receive no items; scheduled execution receives no schedule payload despite a recorded approval.
- **CONFIRMED DEFECT — fabricated before-state.** Shared application records the logical opposite of the requested flag, not the actual previous flag/reason ([profileVisibilityController.js:340](/Users/oxsteed/Documents/GitHub/6/server/controllers/profileVisibilityController.js:340)). Repeating Hide on an already-hidden profile creates incorrect evidence and undermines Undo.
- **CONFIRMED DEFECT — Undo has a check/write race.** Undo reads the latest event and current state, then updates without a version predicate or enclosing lock ([controller:873](/Users/oxsteed/Documents/GitHub/6/server/controllers/profileVisibilityController.js:873), [controller:885](/Users/oxsteed/Documents/GitHub/6/server/controllers/profileVisibilityController.js:885)). Another operator can change the profile between those steps.
- **DESIGN GAP — approval versus completion remains ambiguous.** The review is recorded before execution, with best-effort review audit. Existing durable bulk recovery must be visibly connected to review execution failure, not replaced with blind resubmission.

### Expansion failure scenario

Country teams approve a large restoration after a false-positive incident. The decision says approved while no intended items execute. A manual retry generates misleading before-state; concurrent Undo then overwrites a fresh hide decision. Active-work checks exist, but the operator cannot reliably reconcile intent, decision, and effects.

### Required changes and operator design

Execute the reviewed immutable payload through the existing durable workflow. Capture actual prior values under lock, include a visibility revision, and compare that revision in Undo. Model approved, queued, executing, partially completed, and failed separately. Connect cases to User Action Log and moderation evidence without treating notification success as visibility success.

#### Operator design recommendations

Extend the present screen rather than rebuilding its already-rich controls. The header needs selected profile types/region, snapshot freshness, and current moderation case. KPI definitions should distinguish currently hidden profiles, pending decisions, approved-but-unexecuted work, partial batches, and failed notifications. Approval totals must never stand in for applied changes.

Keep saved views and add execution-stage filters. List columns should include profile reference/type, current hidden reason, active-work blockers, last visibility revision, proposed action, approval state, and execution outcome. The detail drawer needs current public-preview behavior, exact previous values, reason timeline, protected bookings, approval fingerprint, per-item results, and delivery attempts. Explain what Hide changes and what it deliberately does not cancel.

Allow row Preview, Request change, View history, and version-bound Undo. Bulk actions remain Dry run and Submit for review; recovery acts only on unresolved items from an existing operation ID. Before confirmation show eligible, blocked, already-in-state, and affected counts, with active-work exceptions requiring explicit authority. Approval requires a different reviewer and the unchanged payload fingerprint. On execution failure retain the approved decision and expose Recover execution, not another Approve button. After timeout query the durable operation before retrying. Assign partial batches to Trust Operations with a next-item remediation queue. Empty distinguishes no eligible profiles from no pending work; no-access and backend unavailable disable writes without erasing history. Mobile needs a sticky batch summary and full-screen review diff; accessible checkbox counts, status announcements, and RTL-safe profile previews support large multilingual reviews.

### Acceptance tests and owner

Trust Operations owns decisions; Marketplace Engineering owns effects. A bulk approval containing three items must execute exactly those three, and a scheduled approval must preserve time/payload. Repeating Hide must record the actual unchanged before-state. Concurrent Undo and fresh Hide must yield one conflict, not overwrite. Extend existing T58 race tests with executable-payload and durable-recovery assertions; verify audit/state rollback together.

## 59. One Truth

### Route and business purpose

`/admin/super/one-truth` combines platform statistics, user dossiers, and suspected duplicate-account signals. At six million users its useful purpose is a trustworthy investigation index and reconciled business overview, not an assertion that every displayed statistic is exhaustive truth.

### Verified current implementation

The router requires super-admin access ([oneTruth.js:6](/Users/oxsteed/Documents/GitHub/6/server/routes/oneTruth.js:6)). The controller probes available schema columns, paginates ordinary user results, enriches dossiers, and reports regional/filter limitations. Suspect detection has explicit weights and a bounded candidate load ([oneTruthController.js:674](/Users/oxsteed/Documents/GitHub/6/server/controllers/oneTruthController.js:674)). The component has metric groups, suspect/user tabs, filters, warnings, and user-detail display ([OneTruthPage.jsx:469](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/OneTruthPage.jsx:469)). The dynamic schema behavior is a compatibility feature; it is not proof that every optional metric exists in production.

### Concrete flaws and gaps

- **DESIGN GAP — suspect coverage selects the oldest 5,000.** The query orders ascending creation time with a 5,000 limit and computes pairs in memory ([controller:698](/Users/oxsteed/Documents/GitHub/6/server/controllers/oneTruthController.js:698)). The existing warning is valuable, but recent abuse beyond this candidate window remains outside detection. Increasing the cap alone worsens pairwise work.
- **CONFIRMED DEFECT — monetary presentation loses currency semantics.** Payment/commerce aggregates sum amounts without grouping currency; the renderer formats monetary values as dollars ([controller:966](/Users/oxsteed/Documents/GitHub/6/server/controllers/oneTruthController.js:966), [page:129](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/OneTruthPage.jsx:129)). Multi-currency production incidence is **UNVERIFIED**; the source contract cannot safely represent it.
- **DESIGN GAP — scope warning can accompany global data.** If a requested region cannot be resolved, the controller warns and returns unscoped results ([controller:98](/Users/oxsteed/Documents/GitHub/6/server/controllers/oneTruthController.js:98)). Super-admin authority is present, so this is reporting-scope confusion, not a demonstrated unauthorized disclosure.
- **DESIGN GAP — dossier reads lack the purpose contract used elsewhere.** Detail includes identity/business/login history ([controller:1022](/Users/oxsteed/Documents/GitHub/6/server/controllers/oneTruthController.js:1022)); the router does not attach Governance's purpose-limited investigation read controls. Super-only is not an investigation-purpose trail.

### Expansion failure scenario

A reviewer sees “no suspects” for a new market because its accounts were created after the oldest candidate window. Meanwhile a currency-mixed revenue card appears as USD and an unresolved region silently broadens the report. The same reviewer opens detailed dossiers without creating a case or recorded purpose.

### Required changes and operator design

Create indexed candidate signals and a scheduled investigation pipeline with incremental coverage watermarks; retain explainable pair evidence. Return currency-separated totals or explicit conversion basis. Fail scope resolution visibly before displaying differently scoped results. Reuse controlled investigation access for sensitive dossier sections and link financial cards to Treasury/reconciliation rather than presenting incomparable sums.

#### Operator design recommendations

Place a coverage header above current metric groups: selected geography, actual resolved scope, source timestamps, and suspect-pipeline watermark. Define KPIs as evaluated accounts, unevaluated new accounts, open suspect pairs, and confirmed cases. Display monetary cards per currency with source ledger and reconciliation status; hide combined dollar totals until a conversion contract exists.

The suspect queue should show pair references, signal types, weighted score, latest shared evidence time, candidate coverage period, and case disposition. Filters need signal, country, creation cohort, score, and reviewed/unreviewed state. Saved views such as “new-market shared contact” must disclose coverage gaps. A drawer compares two identities side by side, explaining each matched signal, counterevidence, and permitted redacted fields. Dossier tabs require a case/purpose before sensitive history opens.

Allowed actions are Assign investigation, Mark explained, Escalate, and Open linked moderation case; a score must not automatically merge or suspend accounts. Bulk assignment is allowed after a duplicate-case preview, but sanctions require separate evidence and confirmation in the responsible module. On stale evidence show recalculation status and block final disposition until refreshed; unresolved geographic scope needs an explicit switch to Global. A failed enrichment preserves the base identity with missing-section labels. Empty means no candidates within the disclosed evaluated population. No-access distinguishes aggregate access from sensitive dossier access. Mobile uses alternating comparison cards rather than compressed side-by-side PII; keyboard-accessible evidence expansion and RTL-safe names/IDs prevent mismatches during review.

### Acceptance tests and owner

Trust Analytics owns candidate coverage; Finance Data owns monetary semantics. A new account beyond the first 5,000 must enter incremental detection. USD and another currency must remain separate without declared conversion. Unknown region must not silently render a scoped-looking global report. Every elevated dossier read must record case/purpose or reject. Validate scoring against false-positive fixtures and measure candidate-query plans in an isolated scale environment.

## 60. Franchise HQ

### Route and business purpose

`/admin/super/franchises` manages franchise applications, agreements, training/checklists, and store activation. Worldwide expansion requires a distinction between a pipeline label, an executed agreement, and an actually provisioned operating business.

### Verified current implementation

The API permits authorized admins with `manage_operations`, whereas navigation is super-only ([franchise.js:28](/Users/oxsteed/Documents/GitHub/6/server/routes/franchise.js:28)). This is an explicit UI/API audience difference, not a public endpoint. Migration 247 supplies agreements and checklists. The page has application detail, notes, checklist updates, agreement editing, and activation. Activation locks the application and checks ownership, approval, signed/waived agreement, completed training, ready launch state, and checklist completion ([franchiseController.js:875](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseController.js:875), [controller:910](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseController.js:910)). Those guards already exist.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — first-page pipeline masquerades as totals.** The server defaults to 20 applications; the page loads without pagination controls and computes metrics from `applications.length` ([controller:362](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseController.js:362), [FranchiseHQPage.jsx:197](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/FranchiseHQPage.jsx:197)). Older applications and their next steps become practically invisible.
- **CONFIRMED DEFECT — editable launched state bypasses launch meaning.** General PATCH accepts `status=launched`, sets launch time/readiness, and does not run activation prerequisites ([controller:503](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseController.js:503)). This does not create a business, but falsely permits the state that should describe guarded activation.
- **DESIGN GAP — agreement replacement is not executed-version history.** Agreement upsert replaces terms for an application instead of retaining immutable signed versions ([controller:770](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseController.js:770)). Manually entered signature metadata is not independent proof of execution.
- **CONFIRMED DEFECT — territory aggregates omit country.** Territory ownership is checked, but helper/job geographic predicates use city/state without the loaded country ([franchiseTerritoryController.js:72](/Users/oxsteed/Documents/GitHub/6/server/controllers/franchiseTerritoryController.js:72)). Repeated place names can contaminate franchise-owner reports across countries; exact live collisions are unverified.

### Expansion failure scenario

A territory in a repeated city name receives another country's helper/job totals. HQ sees only 20 applications and marks one launched through editing despite unresolved training. Country Packs, revenue planning, and Workforce staffing then depend on a launch that has no activated business.

### Required changes and operator design

Paginate the queue and supply independent stage aggregates. Derive launched exclusively from successful activation; require controlled transitions for pipeline states. Version agreements and link counsel-approved country/entity evidence. Use canonical country/territory identifiers in every aggregate and reconcile franchise royalties with Treasury rather than generic platform totals.

#### Operator design recommendations

Create an HQ header with country/program filters, reporting date, and pipeline snapshot time. KPIs must count all matching applications by stage, ready-but-not-activated stores, and overdue checklist tasks, not the loaded page. Display provisioned store count separately from applications labeled approved.

The queue needs application ID, applicant, country/territory, stage, executed agreement revision, training state, readiness blockers, linked business, and next launch milestone. Search contact/application/territory; saved views should include “training blocked” and “ready for activation.” A detail drawer should group applicant identity, territory boundaries, agreement versions, financial terms, checklist evidence, training receipts, and activation history. Existing notes remain a case timeline, not substitutes for evidence fields.

Allowed row actions are Assign reviewer, Request information, Update permitted stage, Record checklist evidence, and Preview activation. Bulk actions may assign owners or export the pipeline, never mark stores launched. Activation preview must name the business owner, proposed entity/territory, all waived requirements and approvers, and expected business record. Confirm only against an unchanged application revision. After timeout retrieve linked-business/activation status before retrying; conflicts reload blockers while preserving notes. Agreement failure leaves the prior signed artifact intact. Empty distinguishes no applications from no applications meeting readiness; no-access explains operations permission; unavailable disables activation while retaining a stale pipeline label. Field staff need mobile checklist uploads and readable evidence status, keyboard-accessible stages, and RTL territory names with isolated agreement IDs. Assign blockers to the relevant Legal, Training, or Franchise Operations function with one explicit next milestone.

### Acceptance tests and owner

Franchise Operations owns pipeline truth; Legal owns executed agreements. With 21 applications, all must be traversable and totals remain 21. Direct PATCH to launched must reject; activation with any blocker must create no business. Duplicate activation must not create another business. Same city/state in two countries must produce isolated territory reports. Signed terms must remain retrievable after amendment.

## 61. Careers

### Route and business purpose

`/admin/super/careers` mounts the shared hiring board with platform employer type. It should turn approved requisitions into controlled offers and onboarding handoffs. At 3,500 worldwide employees, candidate progression must remain distinct from creating corporate permissions or employment/payroll records.

### Verified current implementation

[CareersAdmin.jsx:6](/Users/oxsteed/Documents/GitHub/6/client/src/admin/pages/super/CareersAdmin.jsx:6) reuses HiringPipelineBoard. Opening/application listings are already paginated; stage transitions use transactions and a transition map ([careerController.js:584](/Users/oxsteed/Documents/GitHub/6/server/controllers/careerController.js:584)). Platform management checks role/global operations permission; business hiring has separate ownership checks. Offer decisions atomically require pending status ([controller:797](/Users/oxsteed/Documents/GitHub/6/server/controllers/careerController.js:797)). Migration 531 supplies application events, interviews, and offers. Existing hiring tests exercise these workflows; do not repeat an obsolete claim that all hiring lists are unbounded.

### Concrete flaws and gaps

- **CONFIRMED DEFECT — expired offers remain acceptable.** Offer acceptance checks pending status but never `expires_at`, then writes application stage hired ([controller:767](/Users/oxsteed/Documents/GitHub/6/server/controllers/careerController.js:767)).
- **CONFIRMED DEFECT — terminal candidates can be resurrected through offers.** CreateOffer inserts regardless of current terminal stage; DecideOffer accepts and sets hired regardless of current rejected/withdrawn stage ([controller:729](/Users/oxsteed/Documents/GitHub/6/server/controllers/careerController.js:729), [controller:801](/Users/oxsteed/Documents/GitHub/6/server/controllers/careerController.js:801)). The normal stage transition map therefore does not cover every hiring path.
- **CONFIRMED DEFECT — interview timezone comes from unrelated edit state.** Booking uses a prompt and `form.timezone`, not the selected opening/candidate's explicit scheduling context ([HiringPipelineBoard.jsx:151](/Users/oxsteed/Documents/GitHub/6/client/src/components/careers/HiringPipelineBoard.jsx:151)). Browser date parsing plus an unrelated timezone can describe inconsistent appointments.
- **DESIGN GAP — offer composition and staff handoff are incomplete.** The board sends title/currency/team role without compensation/start/expiry fields ([board:167](/Users/oxsteed/Documents/GitHub/6/client/src/components/careers/HiringPipelineBoard.jsx:167)); platform hired status does not itself establish a Workforce/HR onboarding record. Employer API routes use ordinary authentication rather than the admin middleware's TOTP contract, despite platform authority checks; browser/MFA behavior remains unverified.

### Expansion failure scenario

A candidate rejects an opening, later accepts an old pending offer, and becomes hired after its intended expiry. Recruiters in different timezones schedule conflicting interviews. The platform board shows a successful hire while Corporate Setup and Workforce still lack a controlled start-date/access handoff.

### Required changes and operator design

Apply terminal-stage/expiry predicates inside the offer transaction. Require explicit reopening approval before new offers to terminal candidates. Add a structured timezone-aware interview editor and a versioned offer draft/review/send flow. Create an idempotent onboarding handoff to HR, never automatic broad admin grants on offer acceptance.

#### Operator design recommendations

Retain the existing pipeline board and pagination. Its header should identify platform employer, requisition, approved headcount, location/timezone, and refreshed time. KPIs need open requisitions, active applications, interviews awaiting confirmation, pending unexpired offers, and accepted offers awaiting onboarding, with explicit definitions.

Each candidate card/list row needs application ID, stage, stage age, recruiter, next interview in candidate and recruiter time, offer revision/expiry, and onboarding handoff state. Search candidate/requisition; filter location, stage, recruiter, and blocked next step. Save views like “offers expiring this week” and “accepted without onboarding.” A drawer contains candidate consent/contact, stage history, interview participants/calendar status, offer terms/revisions, approval evidence, and handoff receipts.

Replace the browser prompt with a labeled interview form that chooses timezone, resolves ambiguous DST times, and previews both participants' clocks. Offer actions are Draft, Request approval, Send, Withdraw, and Inspect decision; sending requires compensation currency/period, entity, start date, expiry, and an approved requisition. Bulk assignment is allowed; bulk hiring or offer sending is not. Transition confirmations explain terminal effects and preserve historical offers. On timeout resolve interview/offer ID before retrying; on concurrent stage change show a refreshed transition comparison. Failed onboarding remains a separate assigned task, not a reversed acceptance. Empty states distinguish no requisitions, no candidates, and no matching filter; no-access and unavailable states suppress employer writes. Mobile cards must preserve next appointment and expiry, with accessible stage selectors and RTL-safe candidate names alongside isolated date/currency values.

### Acceptance tests and owner

Talent Acquisition owns candidate workflow; People Operations owns onboarding. Expired pending offers must reject without stage change. Terminal applications must require explicit reopening. Simultaneous accept/withdraw must yield one decision. DST scheduling must preserve intended instant and displayed timezone. Accepted platform offers must produce one durable onboarding handoff, and no admin access before its separate approval.
## 62. Country Packs

### Business purpose and observed implementation

Country Packs controls the database-owned list of launch countries, locale/currency metadata and country configuration. It is not legal permission to operate in a jurisdiction. The current service explicitly fails closed on registry failure: no fallback US-active response is returned (`server/services/countryPackService.js:76`). Reserved row metadata cannot be shadowed by JSON configuration (`server/services/countryPackService.js:20`, `:112`). Those earlier audit findings are repaired and must not be repeated as open. The registry uses a 60-second cache and an update operation that clears the local process cache.

### Findings, expansion scenario and required changes

**P1 launch-governance gap:** activation is still a status update, without an embedded launch-evidence package proving supported payments, refunds, tax treatment, identity requirements, customer support, language and service coverage. An active picker entry is not a working full-country customer journey. Create versioned country/product launch decisions linked to accountable owners and evidence; country-level activation must not automatically advertise products not supported there. **P2 consistency gap:** update uses no expected revision, and invalidation is process-local (`server/services/countryPackService.js:198`). A second worker can serve old config until TTL. Define acceptable propagation, shared invalidation/version reads and behavior during country suspension. Existing committed orders must remain supportable even when new intake closes.

Currency validation accepts a three-letter pattern, not proof that a payment provider supports that currency. Locale and configuration fields require schemas and provider/product-specific validation. Separate an administrative country pack from record-level region authorization and data residency. Worldwide growth requires an explicit staged launch/suspend/drain model rather than deleting records or reinterpreting historical amounts in a new default currency.

### Operator design recommendations

Create a country-product readiness grid. Rows identify country and product; columns show customer intake, fulfillment availability, payment/refund capability, language coverage, required legal evidence, support coverage and current approved configuration revision. The screen distinguishes disabled, preparing, approved for launch, active, intake suspended and draining existing commitments. Filters include missing evidence, provider restriction, unsupported language and expiring launch approval. A country's flag and currency remain orientation aids, not its readiness indicators.

The pack drawer combines canonical metadata with a schema-driven configuration editor. Show the exact products affected, old/new locale and currency defaults, and the evidence owner for each prerequisite. A preview simulates a new customer journey in that country using provider test mode and authorized fixture records. Historical invoices and balances retain their stored currency; the preview must explicitly state that a default-currency change does not convert them.

Activation requires approved evidence and a bounded rollout scope. Suspension asks whether to stop new requests, new financial authorizations or all unsafe activity, and lists open commitments requiring continued support. Never offer “disable country” as a destructive shortcut to cancel everything. Version conflicts show the current pack and preserve the proposed diff. Shared-cache propagation is displayed separately from “change saved.” The offline state explains that availability cannot be verified rather than substituting an active country. Arabic and international operators see local dates and canonical ISO identifiers side by side; keyboard access reaches the full readiness grid without depending on flags or map interaction.

### Acceptance and ownership

Market Launch owns approvals; Payments, Legal, SRE and Support each sign their prerequisites. Test unavailable registry, reserved-field patches, unknown locale/currency, stale parallel edits and two-worker propagation. Suspend new intake while resolving an existing refund and support case. Run a full authorized country/product journey and preserve its evidence package. Certification is specific to country, product and version, never “worldwide ready” from a single active status.

## 63. Corporate Setup

### Business purpose and observed implementation

Corporate Setup manages department configuration and defaults; title assignment and effective authority are related but separate. The resolver combines active assignments, department defaults and allow/deny overrides, with a bounded cache and country context (`server/services/corporateRolesService.js:30`, `:117`). Department-default updates now validate unknown permission codes and use a transaction before replacing the set (`server/controllers/corporateRolesController.js:160`). The old “unknown defaults are silently accepted” finding is closed. Corporate permissions and legacy admin grants remain distinct systems; a department label must not be presented as equivalent to every admin entitlement.

### Findings, expansion scenario and required changes

**P1 authority-model gap:** at 3,500 employees the company needs a single explanation of effective authority across corporate assignments, legacy grants, delegations, internal gates and product-team membership. Consolidate evaluation/provenance, not data by deleting one system. Verify actual route adoption before suggesting that creating a title secures every business endpoint. **P2 change-control gap:** department defaults replace an entire set without an expected-version predicate and are followed by local cache invalidation (`server/controllers/corporateRolesController.js:193`). Two editors can overwrite changes. Introduce an impact-reviewed revision, explicit approver for high-risk expansion and shared revocation propagation.

Time-bounded acting assignments, sponsorship, reporting-line cycles, inactive departments and separation-of-duties rules need complete operational coverage. A country filter is not proof of record-level territorial enforcement. Verify future/end-dated assignments and denials across multiple simultaneous titles. Keep HR organization, compensation authority and application capability distinct; naming someone CFO must not automatically authorize all customer refunds or credit approvals.

### Operator design recommendations

Use three coordinated panes: organizational structure, department permission templates and affected staff. The structure shows department code, owner, parent, country scope and lifecycle status. The template pane groups capabilities by business risk and distinguishes read, approve, execute and export. The affected-staff pane shows which current and future assignments inherit a change. Filters expose unowned departments, inactive titles with active staff and high-risk combinations requiring review.

Editing defaults opens a before/after authority preview with explicit new capabilities and removed capabilities. Show the actual routes that enforce each capability and label unimplemented mappings as unavailable, rather than advertising a permission that never gates a server action. Reviewers can inspect one employee's effective authority including denies and legacy grants; this diagnostic must not modify the employee or elevate the viewing operator.

Publish template revisions through an approval workflow proportional to risk. An organizational rename can be low risk; expanding financial execution or customer-data export requires independent approval and propagation evidence. Retirement previews assignments and owned work, offers a controlled successor and retains old organizational history. Conflicts preserve the draft and list the approved revision; no silent full-set overwrite is acceptable. The audit drawer records intent, impact set, decision, effective date and revocation reconciliation. Mobile starts with ownership and unresolved staff impact, then offers the structural tree as an accessible text hierarchy. Keyboard and screen-reader users can distinguish a collapsed department from one with no employees.

### Acceptance and ownership

Corporate IAM and People Operations own the model. Test unknown capabilities, simultaneous title holds, explicit denies, future/end dates, country context and cache loss. Verify conflicting template changes and route-level enforcement for each risk class. Retire a department with open staff responsibilities and prove no implicit privilege widening. Produce one effective-authority explanation matching direct API denials, export behavior and realtime access for a regional employee.

## 64. Mode Policies

### Business purpose and observed implementation

Mode Policies configures platform approval for selected role actions; it does not replace account mode switching, business membership or financial authorization. Current service validation, expected policy version, row locks, revision records and change reason are substantial repairs (`server/services/modePlatformApprovalService.js:95`, `:207`, `:247`). Approval validity is tied to the policy revision (`server/services/modePlatformApprovalService.js:372`). The gate middleware returns a retryable 503 on verification errors (`server/middleware/requirePlatformApproval.js:61`); the earlier fail-open recommendation is no longer current.

### Findings, expansion scenario and required changes

**P1 adoption verification gap:** source search of current routers found no direct `requirePlatformApproval(...)` installations. The gate exists, but editing a policy must not be represented as protecting every relevant action without an explicit caller/route manifest and tests. Verify indirect invocation too before declaring all business actions ungated. Register each supported mode/action pair against an authoritative server operation and its necessary permission, ownership and financial checks. A descriptive action string that no route uses creates false confidence.

**P2 operating-model gap:** policy changes invalidate old approval versions, but the company needs a clear migration/review path for already approved people, active bookings and pending applications. Provide impact preview and a re-review queue rather than silently halting existing commitments. Retain schema revisions with application evidence; field labels, document requirements and notifications require localization. Auto-approval must have narrow objective eligibility and measurable risk, never substitute for a regulated provider decision. Missing policy behavior is a product decision requiring an explicit default, not an accidental unrestricted action.

### Operator design recommendations

Make a mode/action policy matrix showing mode, canonical action, enforcing route/service, current policy revision, approval requirement, auto-approval rule, required evidence and affected approved/pending population. A mapping column explicitly says enforced, not installed, or verification incomplete. Filters include high-risk actions, inactive modes, unmapped actions and policy changes awaiting application review. This prevents a clean-looking toggle from implying protection the backend does not apply.

The policy editor is schema-driven, showing field type, requiredness, acceptable evidence, privacy retention and localized label. Next to each field, preview the applicant form and reviewer evidence panel. Model the exact action restriction separately from role selection. Changing a financial action includes its existing payment/ownership checks in the impact preview; approval can unlock eligibility only, not execute a payment or grant a different user's resource.

Before publish, display old/new revision, changed actions, applicants needing re-review and the treatment of already committed work. Require a reason and a separate approver for high-risk expansions or auto-approval. A conflict shows the newly committed policy and offers a reviewed rebase, not automatic overwrite. After save, expose propagation and enforcement-test status separately from configuration success. A support link directs affected users to reapplication or appeal with their policy revision. Empty or unavailable policy data is labelled, and unsafe gate-dependent actions pause. Keyboard, RTL and mobile layouts preserve the action mapping and risk summary above the publication button.

### Acceptance and ownership

Product Policy owns mode eligibility; IAM owns gate adoption. Build direct endpoint tests for every registered action, including no policy, policy outage, expired/stale approval and admin bypass semantics. Prove a changed schema does not reinterpret old evidence. Run a policy revision with pending/approved users and active work, showing re-review plus unchanged committed financial obligations. Test concurrent policy edits and two-worker invalidation. A configuration-only screenshot is not closure evidence.

## 65. Mode Approvals

### Business purpose and observed implementation

This queue handles individual applications against platform mode policy. Current decisions use expected status: approve/reject requires requested, and revoke requires approved (`server/services/modePlatformApprovalService.js:486`). Rejection needs a reason, and a lost competing decision reports conflict. These repairs close the older unconditional-decision race. Policy-version matching also prevents an old approval satisfying a newer policy. The UI confirms approval and offers reasoned rejection (`client/src/admin/pages/super/ModeApprovals.jsx:26`).

### Findings, expansion scenario and required changes

**P2 evidence-history gap:** resubmission upserts the user/mode record and replaces application data and review fields (`server/services/modePlatformApprovalService.js:458`). Policy revisions are stored, but a separate immutable application-attempt/decision history is needed to preserve what each reviewer saw across reapplication. Do not infer that the current row contains every prior decision. Decisions should bind the application and policy revision, evidence version, reviewer authority and case reason, with no-self-review/separation rules where appropriate.

At large population, bounded pending API retrieval needs exposed navigation, truthful totals, aging and routing to qualified reviewers. The current screen uses fixed dark styling and raw mode values; light theme, localized mode/date labels and typed boolean/zero evidence need explicit checks. Design an appeal/re-review path, expiry and suspension that remains separate from account ban, identity verification and payout readiness. Application approval cannot make an uninstalled gate enforce policy or make a Stripe account ready to receive funds.

### Operator design recommendations

Use an oldest-first application queue with applicant identity, mode/action eligibility requested, policy revision, submission attempt, evidence completeness, age/SLA, reviewer owner and current state. Filters include missing evidence, policy changed since submission, duplicate/related applications, appeals and review country. Work assignment depends on authority and locale expertise; queue claims must not silently become the eligibility decision itself. Display the entire predicate backlog and oldest age, with stable cursor navigation.

The review drawer keeps applicant-provided evidence separate from independently verified facts. Show typed values correctly: false and zero are not missing answers. Attach the immutable policy/form revision and compare any prior rejected attempt without overwriting it. Clearly state which exact actions approval enables and which further memberships, provider checks or financial approvals remain required. Sensitive attachments use scoped access and retention controls rather than inline public links.

Approve requires a decision preview and confirms the applicant is still eligible under the displayed revision. Reject records a structured reason, applicant-safe explanation and internal notes separately. Request-more-information and appeal route back to a tracked attempt instead of manufacturing a new approved record. Revocation previews the future action restriction and open commitments requiring support; it does not retroactively refund or cancel them. A competing reviewer outcome replaces stale buttons with the committed event. Unknown responses recover by decision reference. Responsive light/dark and RTL layouts preserve evidence labels, actionable errors and keyboard focus; confirmation should name the applicant and policy version, not merely ask “Are you sure?”

### Acceptance and ownership

Eligibility Operations owns review; Privacy owns evidence handling. Test two competing reviewers, policy change mid-review, resubmission history, typed fields, denied reviewer, appeal, revocation and decision timeout. Verify actual downstream gate denial/allowance and continued account/payment checks. Seed thousands of applications and reach the oldest unresolved case. Produce an immutable decision receipt and applicant notification in all five languages without disclosing internal investigation notes.

## Workforce Identity and Access Lifecycle workspace

### Existing capability and business purpose

This is already a primary workspace, not a missing tab. It provides a staff roster, delegation registry and lifecycle events. The roster covers admin/super-admin identities and is limited to 200 (`server/controllers/workforceController.js:52`). Delegation validates active recipients, recognized scopes and the grantor's global authority (`server/controllers/workforceController.js:197`). Self-delegation is rejected; revoke is conditional. Preserve these existing improvements. The workspace is not yet evidence that every corporate employee, restaurant employee or business-team member participates in a company-wide joiner/mover/leaver model.

### Findings and long-term requirements

**P1 confirmed atomicity gap:** delegation INSERT commits before a fail-closed audit call (`server/controllers/workforceController.js:237`). Throwing after the insert can return failure while the authority record remains active. Revoke has the same write-then-audit separation. Put authority and durable decision evidence in one transaction and provide command-status recovery. Verify how delegated authority is consumed by every relevant permission check; registry presence alone does not prove effective entitlement. Delegations must not outlive parent authority and must be revoked when sponsor/grantor authority disappears.

**P2 workforce coverage gap:** a capped privileged roster is not a 3,500-employee HR directory or recertification program. Add identity links and workflow states for invitation, start, transfer, leave, termination and emergency coverage. Reuse Corporate Setup and Admin Accounts, preserving non-admin staff roles. Assign sponsored authority, periodic review and handoff tasks. Integrate a chosen workforce identity provider only through approved provisioning and revocation, not by importing broad admin flags. Access review completion must reference actual effective permissions and server denials.

### Operator design recommendations

Use a lifecycle command center with named queues for onboarding blockers, transfers pending old-access removal, leavers awaiting revocation, delegations expiring and recertification overdue. The roster includes employee identifier, employment source, sponsor, organization/country, identity health, effective capability bundles, earliest expiry and open responsibilities. Separate corporate employees from customer-business staff. Counts report the whole authorized workforce predicate, with cursor search and per-country visibility rather than truncating to the newest privileged identities.

The employee drawer presents a chronological authority graph: employment record, corporate assignments, direct grants, delegations, route gates and provider connections. Each edge has purpose, source, effective time and expiry. A transfer preview shows removed old authority before added new authority and names unresolved cases, approvals and resource ownership. Handoff delegates work objects explicitly; it never transfers an entire person's access tokens or implicitly makes a replacement super-admin.

Leaver action starts with an immediate deny/revoke command and independent follow-up tasks for cases, devices, partner access and managerial acknowledgement. Display complete, failed and unverified revocation targets separately, plus an incident escalation when access cannot be verified. Recertification compares business need, effective authority and actual use, requiring a named reviewer; an unanswered review expires according to approved policy. Temporary emergency access includes short expiry, sponsor and post-use review. On audit/storage failure stop authority expansion and show a recoverable command state. Mobile prioritizes urgent leavers and expiring coverage, while a fully keyboard-operable graph alternative lists every authority edge and decision.

### Acceptance and implementation ownership

People Operations, Security IAM and Corporate Engineering jointly own this workspace. Test hire, transfer, leave, termination, sponsor departure, delegation parent expiry, audit failure and competing revocation. Prove an employee does not require admin role for ordinary work. Verify API/export/socket denial after departure across two workers and one unavailable provider, with unresolved tasks still visible. Closure requires one complete multi-system offboarding drill and a retained quarterly review, not merely populated roster cards.

## Treasury and Entity Accounting workspace

### Existing capability and business purpose

Treasury is already implemented as an entity/account/period registry and double-entry journal foundation. Posting locks the accounting period, checks entity ownership, account currency and open period, and commits inside a transaction (`server/controllers/treasuryController.js:181`). Closing uses a conditional open-state update (`server/controllers/treasuryController.js:333`). This is substantially safer than an unaudited balance-edit tool. It must remain distinct from authoritative customer payment/credit ledgers and must not become a second mutable source of customer balance.

### Findings and long-term requirements

**P1 retry risk:** posting inserts a journal entry without a command idempotency key or unique externally meaningful source-event reference (`server/controllers/treasuryController.js:205`). A timed-out manual or imported posting can be repeated. Bind every posting to immutable source evidence and ensure one accepted command/event yields one journal effect. Verify audit and independent approval requirements for manual adjustments. **P2 accounting scope gap:** an entity journal alone does not establish bank/provider settlement reconciliation, intercompany balancing, FX evidence, jurisdiction-specific tax reporting or a controlled close. Build these as workflows over existing ledgers with an approved accounting model, not generated rules presented as legal/tax advice.

Periods currently validate date shape/order, but enterprise close needs checks for overlapping periods, late-arriving source events, unresolved exceptions and reopening authority. Bound journal retrieval with stable paging and asynchronous scoped exports. Currency minor-unit handling and FX valuation must remain explicit. At six million users, reconciliation should be incremental and partitionable with freshness/completeness evidence, not a complete cross-ledger scan on every dashboard request.

### Operator design recommendations

Give finance a close-and-reconcile workspace with legal entity, currency and accounting period pinned in the header. Show source coverage, settlement lag, unmatched count/amount, control total, journal balance and close blockers separately. Never aggregate unlike currencies into one unexplained total. Queue views include unmatched settlements, duplicate source references, aged receivables/payables, manual journals awaiting approval and period-close exceptions. Rows carry source transaction/reference, entity, currency/minor amount, expected accounting treatment, discrepancy, age and accountable owner.

The journal drawer shows immutable source evidence, debit/credit mapping, period, currency and approval chain. Manual entries require balanced preview, reason, documentation and reviewer authority. Imported events cannot be approved by changing a customer balance; correction uses a reversal/adjustment under the existing ledger rules and a new accounting entry. A command timeout offers lookup by source reference before retrying. Duplicate source posting returns the existing outcome without another entry.

The close checklist identifies incomplete provider windows, unapproved adjustments, unresolved material exceptions and missing entity signoff. Closing records the exact evidence snapshot; reopening is a new authorized event, not deletion of the old close. Entity/country filters restrict detail, exports and actions consistently. Export is a background job with predicate, as-of timestamp and retention expiry. Mobile prioritizes due exceptions and approval previews; keyboard navigation traverses debit/credit fields in a predictable order. Accounting owners must explicitly approve currency, tax and materiality policy before the interface labels a period compliant.

### Acceptance and implementation ownership

Finance Engineering and the accountable controller own this workspace. Test duplicate journal commands, timeout/retry, cross-entity/currency rejection, post-versus-close races and source reversal. Run one complete provider settlement reconciliation and period close with unresolved exceptions blocked, then controlled reopen. Validate exports and totals against source ledgers and accounting review. Demonstrate recovery from partial provider imports without duplicating a charge, customer balance or journal effect.

## Global Service Operations workspace

### Existing capability and business purpose

Service Operations already exposes capacity-related counts and a versioned runbook registry. Its controller explicitly acknowledges that booking records lack authoritative admin-region linkage and labels attribution unavailable/proxy where appropriate (`server/controllers/serviceOpsController.js:9`). Dynamic relation discovery is constrained by safe identifier checks. Do not repeat the old recommendation to fabricate a regional utilization graph from unlinked bookings. This workspace should support actual delivery and service capacity, safety and accountable operational decisions across business units.

### Findings and long-term requirements

**P1 decision-quality gap:** booking/job demand counts are not supply, utilization or promised fulfillment capacity. There is no capacity denominator in these aggregates: people, shifts, equipment, availability, capability and actual reservations must come from their authoritative services. Add explicit service-area attribution, not merely reuse staff grant territories. A high booking count cannot justify accepting work without verifying constraints. **P2 coordination gap:** runbooks are useful registry records, but execution needs incident/task ownership, revision-aware steps, approvals and evidence. Update increments version without a supplied expected version (`server/controllers/serviceOpsController.js:283`), so conflicting editor changes can overwrite content.

For global operations, define service-specific demand queues and capable supply with freshness. Internal delivery and marketplace fallback must remain mutually exclusive and price-neutral according to domain rules. Regional emergencies need intake throttles, staff safety escalation, provider outages and customer communication without unsafe bulk cancellation. Record operator intent, approval and reconciliation across orders, deliveries, jobs and bookings rather than building another copy of them.

### Operator design recommendations

Present a service-area command view with confirmed demand, pending requests, capable available resources, reserved resources, projected risk and source freshness. Distinguish actual measurements from forecasts and unavailable attribution. Filters select operational area, service type, promised window, priority, capability requirement and exception. A geographic display is supplementary; a textual queue must expose unmapped work and timezone. Alert cards lead to specific blocked work, not a count that lacks a recovery action.

Selecting work opens the authoritative request plus constraints: handling/capacity, assignment, time windows, current milestone, owner and safe next transition. Staff can drill into a driver's/resource's actual busy intervals without declaring every displayed calendar item busy. An assignment preview lists conflicts, source freshness and required review; it must not overwrite dispatch ownership or broaden employee permissions. Fallback release shows the operator reason and customer commitment preserved by the delivery service.

Runbook launch binds the run to a fixed revision, affected scope, commander and approvals. Steps have owner, due time, prerequisite and completion evidence; changing the registry does not change an ongoing execution silently. A regional incident banner separates new-intake restrictions from support for existing commitments and gives a planned update time. Competing actions show committed ownership and require re-review. Dependency outage retains evidence timestamps and pauses unverifiable commitments while allowing pending requests. Mobile orders urgent assigned work before capacity charts, with large milestone controls and required proof. Accessibility includes readable status labels, logical RTL ordering and local operational time alongside UTC references.

### Acceptance and implementation ownership

Service Operations and Dispatch Engineering own this workspace. Test missing attribution, stale resource data, conflicting intervals, timezones/DST and one shared resource across product types. Demonstrate incident intake suspension with existing fulfillment/support continuing. Run an approved runbook revision with one blocked step and a shift handoff. Verify every command uses the existing authoritative service and keeps internal/marketplace ownership and payment invariants intact.

## Reliability and Release Operations workspace

### Existing capability and business purpose

Reliability already has release history, migration inventory and database budget snapshots. Its controller explicitly calls release history manually recorded, not a CI/deployment feed (`server/controllers/reliabilityController.js:7`). Read failures return unavailable errors rather than fake empty success. Budget snapshots expose web/jobs/exports/realtime categories (`server/controllers/reliabilityController.js:92`). These are foundations for a release command center, not proof of independent recovery or production promotion controls.

### Findings and long-term requirements

**P1 evidence gap:** a manual “deployed” row accepts a nonempty commit string and operator notes, without binding an actual artifact digest, CI execution, deployment ID or readiness result (`server/controllers/reliabilityController.js:39`). It can record intent, not certify deployment. In the final refresh CI at `2f93a426` is green, but `/ready` still has null git SHA/digest/deployment ID. Connect signed/verified CI and Coolify evidence to a release state machine with separate built, approved, migrating, deployed, verified and rollback-requested events.

**P1 recovery gap:** backups have successful R2-upload metadata, but no current restoration-test row was found in the earlier live evidence query. This is unverified recovery, not proof backups do not exist. Add immutable restore-run evidence and a second-operator drill against an isolated target. **P2 visibility gap:** migration inventory is not checksum compatibility or a production-sized upgrade rehearsal; local workload budget state is not necessarily fleet aggregate. Tag scope/source/process and aggregate appropriately. Keep failure drills off the production Mac and provider live money operations.

### Operator design recommendations

Use a release-and-recovery timeline linking commit, CI run, artifact digest, migration set, environment, deployment operation and verified readiness. The header states current observed release identity and any missing metadata. Queues show red/insufficient checks, pending promotion, migration divergence, verification incomplete, stale backup/restore evidence and exhausted workload budgets. Distinguish a manual note from an automatically verified event using explicit provenance labels.

The release drawer shows changed domain surfaces, required tests, migration expand/contract compatibility, rollback constraints and accountable approver. Promotion must be impossible through this interface while critical checks fail or required coverage is skipped. Emergency override has a reason, named authority, expiry and mandatory retrospective; it is not a permanent green checkbox. Deployment progress reads actual infrastructure events and finishes only after release identity, readiness, worker health and queue behavior are verified.

The recovery panel pins one backup object/evidence reference, integrity result, recovery profile, isolated restore target and measured RPO/RTO. Show database recovery, uploads, configuration dependencies, financial invariants and representative journey checks as separate stages. A dry run cannot be labelled recovered. Failed stages lead to a retry/reconciliation task without deleting the previous attempt. Fleet budget panels state process/fleet scope and sample age; investigation remains possible during partial monitoring loss. Mobile prioritizes active rollout and recovery blockers rather than graphs. Keyboard-accessible timelines and textual stage summaries work without animation or status colors.

### Acceptance and implementation ownership

SRE and Release Engineering own this workspace. Prove rejected red/insufficient promotion, digest mismatch, repeated deployment callback, migration failure, worker startup failure and controlled rollback. Restore a current offsite snapshot into an independent environment, validate domain invariants and measure recovery time. Complete a shift handoff using only retained runbooks/evidence. Latest green unit CI is credited, while real recovery, scoped authenticated coverage and capacity certification remain explicitly unverified until executed.

## Governance, Policy and Contract Obligations workspace

### Existing capability and business purpose

Governance already offers a versioned policy registry and contract records with create/update/retire/terminate operations (`server/controllers/governanceController.js:64`, `:184`). The comments correctly distinguish registry text from policy automatically enforcing platform behavior. Every mutation attempts an admin audit event. It is a useful governance foundation; it is not yet a complete worldwide obligations calendar, evidence-retention engine or vendor compliance program.

### Findings and long-term requirements

**P1 confirmed update-validation gap:** contract update checks date order using submitted fields, then applies a partial patch without validating the merged existing dates (`server/controllers/governanceController.js:236`). Changing just signed or expiry date can violate the relation to the retained other date. Read/lock the current record, validate the merged revision and persist it with expected-version protection. **P2 evidence gap:** policy version increments and contract audit calls follow standalone writes. Preserve actual previous revisions, decisions and atomic evidence; a higher version number alone does not retain all old wording. Distinguish operational retirement from erasing a policy needed to explain historic approvals.

For six million users and worldwide operations, track jurisdiction, legal entity, product, accountable owner, required reviews, acceptance version, contractual obligations, renewal/notice dates and evidence expiry. Connect work to an approved policy revision rather than matching text labels. Liability/insurance, data-processing obligations and partner response SLAs require specialist business/legal review. This audit identifies engineering controls; it does not certify legal compliance in every country or generate binding legal interpretations.

### Operator design recommendations

Use a policy-and-obligation register with separate views for active rules, approval pending, obligations due, contracts nearing notice date and missing evidence. Rows show stable identifier, entity/country/product scope, owner, approved revision, effective dates, evidence completeness and next obligation. Filters distinguish published policy from draft, external contract from internal rule, legal hold from routine retention and customer acceptance requirement from staff procedure.

The detail drawer renders the signed contract/reference or approved policy revision beside structured obligations and linked workflows. Owners see notice dates, renewal terms, insurance/evidence expiry, data-processing commitments and the actual responsible task. A storage reference is not marked “signed evidence verified” until authorized verification succeeds. Sensitive documents require record-level access and safe previews; queue summaries avoid distributing private contract terms to every administrator.

Edits open a redlined before/after preview with merged dates, affected products, required reacceptance or training and proposed effective date. High-risk changes require a qualified independent approver. Retirement/termination lists open obligations and surviving commitments, then records a new lifecycle event; it cannot clear outstanding tasks automatically. Conflicts show the current approved version, while failed audit/evidence writes prevent ambiguous publication. The obligation calendar groups tasks by owner and due date with escalation and vacation coverage. Mobile leads with upcoming notice deadlines, not full contract text. Accessible revision comparisons, locale-aware dates and explicit timezone/working-day definitions keep worldwide operators from misreading a deadline.

### Acceptance and implementation ownership

Legal Operations and Governance Engineering own this workspace. Test one-sided date patches, parallel edits, missing documents, expired evidence, renewal notice, terminated contracts with surviving duties and legal holds. Demonstrate a policy revision through approval, publication, required acceptance, operational enforcement and retained historical explanation. Run a cross-country obligation handoff with an unavailable owner and proof of escalation. Compliance readiness requires qualified legal signoff plus executed controls, not a successful registry CRUD test.
## Proposed workspace 1: Workforce Recertification and Continuity

### Why this management capability needs a dedicated view

Admin Accounts, Permissions, Corporate Setup and Workforce already contain pieces of identity management. What is not established is a complete enterprise review campaign linking all those authority sources to employment, sponsor accountability and continuity of owned work. This proposed view extends those services; it is not a new employee identity database. At 3,500 employees, spreadsheet reviews and personal knowledge cannot reliably handle transfers, long leave, departing approvers and overlapping acting roles. The business needs an answer to “who is still authorized, why, and who covers the work if they leave?”

### Workflow and data contract

A campaign freezes an authorized evidence snapshot: identity, employment status, sponsor, effective authority by source, last use, owned approvals/cases and expiry. Review tasks are assigned to qualified independent reviewers with deadlines, reminder/escalation and explicit keep/reduce/revoke decisions. Changes execute through existing grant/assignment services; a review conclusion is not itself an access mutation. A reconciliation step verifies that actual authority now matches the decision across API, exports and realtime. Departure triggers immediate revocation separately from continuity handoffs, which remain visible until resolved.

Persist campaign ID, snapshot version, authority edge IDs, reviewer authority, decision reason, implementation command and verification outcome. Never rebuild permissions from display labels. Limit reviewer visibility to their scope and mask sensitive use details unless justified. Support evidence retention/legal hold and time-bounded emergency coverage. Integration with an HR/identity provider needs explicit source-of-truth ownership and idempotent provisioning; failure to synchronize must generate a task, not silently preserve access indefinitely.

### Operator design recommendations

The command center has campaign overview, reviewer inbox and continuity exceptions. Overview shows review coverage, high-risk unreviewed authority, overdue decisions, execution failed and verification incomplete as separate figures. It must not mark a campaign complete because every checkbox was clicked. Filters select country, department, sponsor, authority type, risk and due interval. Each task row identifies employee, effective role/scope, source grant count, last use, owner and unresolved obligations.

The reviewer drawer explains authority provenance and the business responsibilities it supports. It shows direct grants, delegated grants, corporate assignments and internal gates separately, including conflicts and explicit denials. “Reduce” offers a reviewed diff to existing role bundles; it does not invent a free-text permission. High-risk self-review is disabled with an alternate reviewer path. The continuity section lists cases, financial approvals, customer obligations and scheduled work needing named successors, with acceptance by the receiving employee.

Submitting a decision opens a preview of exact authority edges and handoff objects. A stale snapshot requires refreshed comparison. Revoke can proceed immediately for a leaver even if a task handoff fails; the remaining handoff is escalated with a deadline. Verification panels name each downstream target and evidence time, never aggregate partial revocation into a green success. Campaign exports are scoped asynchronous jobs with retention and reveal logging. On mobile, the employee's risk, decision and unresolved continuity tasks stay visible above long permission lists. Keyboard and screen-reader workflows identify the person, edge and final outcome unambiguously.

### Acceptance and business ownership

People Operations and Security jointly own campaigns; department heads own business need. Run a seeded 3,500-person campaign including cross-country reviewer scope, self-review denial, sponsor termination, mid-campaign transfer and an unavailable downstream system. Prove authority changes are executed once, old decisions cannot overwrite newer roles and completion waits for verification. Demonstrate a departing finance approver's work handoff without transferring credentials or widening their successor's money authority. Closure evidence is a completed campaign and offboarding drill, not a new navigation link.

## Proposed workspace 2: Financial Reconciliation Exceptions

### Why this management capability needs a dedicated view

Money, Credit, Restaurant Credit, Payouts and Treasury already own financial data and parts of reconciliation. The missing enterprise operating contract is one scoped exception queue linking unresolved source outcomes, customer exposure, ownership and approved recovery across those products. It must not merge OxSteed Credit with Restaurant Credit or introduce a new balance ledger. At six million users, occasional partial webhooks, duplicate callbacks, settlement delays and unknown provider outcomes become daily operational work. The business needs to recover safely without repeated manual charges or an operator mentally joining several dashboards.

### Workflow and data contract

Existing financial workers create exception references carrying domain/source IDs, expected versus observed outcome, amount/currency, reconciliation window, age, severity and correlated event/command. One case can link several records but each authoritative service decides its own mutations. Classify delayed, missing, duplicate, inconsistent and unverifiable outcomes separately. Investigator assignment, evidence refresh, proposed remedy, independent approval, execution and verification are durable states. “Retry webhook,” “refresh provider evidence” and “refund” must be different actions with different authority.

Require provider/domain idempotency, unique source references and explicit limits. A retry after timeout queries the existing command/provider status first. Reconciliation can reopen after later contradictory evidence, preserving its prior decision. Use materiality policy approved by finance, separate currencies and privacy-scoped exports. Do not auto-write a balancing credit simply because a provider read failed. Connect support/customer notices only to confirmed customer-visible facts.

### Operator design recommendations

Default the workspace to unresolved customer-impacting exceptions with oldest/material exposure first. Columns show exception ID, domain, legal entity, currency/minor amount, source completeness, expected/observed state, age, owner and safe next investigation action. Filters include provider, settlement window, missing webhook, repeated command, unknown outcome, approved recovery and customer complaint. Counts and amounts are grouped by currency; “evidence unavailable” is separate from zero discrepancy.

The case drawer displays a joined chronological timeline of provider events, domain commands, ledger entries, receipts and reconciliation runs without copying them into a new ledger. Each item links to its authoritative record with fresh access checks. Evidence timestamps identify stale provider reads. A comparison panel explains what is inconsistent and what is merely delayed. Customer notes remain separate from internal financial investigations and are revealed only when needed.

Recovery preview names the exact service action, source IDs, idempotency reference, amount/currency, ledger effect and required independent approver. A duplicate-safe retry returns its earlier outcome; an uncertain external result disables another financial execution while status refresh remains available. Approval cannot be performed by the requester where separation rules apply. Verification checks settlement/ledger/receipt consistency before closure, and leaves follow-up support tasks visible. Mobile prioritizes exposure, evidence freshness and the approved action; keyboard order follows investigation, proposal, approval and verification. Asynchronous export includes the predicate and as-of evidence time, not an unbounded download of every customer transaction.

### Acceptance and business ownership

Financial Operations owns the queue; Payments/Credit Engineering retain mutation authority. Test duplicate/out-of-order webhooks, missing settlements, provider read timeout, charge timeout, concurrent investigators and approved refund retries. Prove one command causes at most one money movement, currencies stay separate and unauthorized regional staff cannot read another scope. Close a customer complaint using a verified reconciliation outcome and retained receipt. SLOs measure oldest unresolved exposure and verified recovery, not merely worker success rate.

## Proposed workspace 3: Country Launch Readiness and Obligations

### Why this management capability needs a dedicated view

Country Packs is configuration; Governance holds policies/contracts; Legal and payment integrations provide additional evidence. The business still needs a coordinated launch approval linking those facts per product and jurisdiction. This proposed workspace is the review/obligation view over those systems, not a new legal rules engine. Worldwide expansion cannot be certified by an active country row, translated navigation or a provider API key. A country may support one product but not delivery, payouts or credit; launch scope must reflect that distinction.

### Workflow and data contract

Represent country-product launches as draft, evidence gathering, specialist review, approved bounded launch, active, restricted and suspended/draining. Each prerequisite has owner, evidence reference/revision, effective dates, expiry and reviewer decision: legal entity/agreements, payment and refund support, identity/insurance, privacy/residency, tax/invoicing, support hours/languages and actual operational coverage. Qualified specialists set requirements; engineering does not infer legal approval from a generic questionnaire. Publication changes existing launch configuration through its authorized service and verifies customer routes/offers afterwards.

Obligations continue after launch: insurance expiry, contract notice, policy update, provider restriction, locale/support coverage and mandated reports. Escalate missed evidence before expiry and record a proportionate response. Suspension stops specified new actions while supporting old commitments. Evidence retention and access follow legal/financial policies. Versions bind launch decisions to the real product configuration; unrelated country defaults cannot rewrite historic transactions.

### Operator design recommendations

Provide a matrix of country by product with readiness, authorized launch scope, next deadline and accountable market owner. Tabs separate pending launches, active obligations and restrictions/draining commitments. Filters include missing specialist signoff, evidence expiring, provider capability unavailable and unsupported customer language. Status names explain whether a product is unavailable, coming soon, restricted or active; a single green country flag is never the summary.

The readiness drawer renders each prerequisite with source owner, independent reviewer, evidence revision, expiry and test outcome. A journey panel links representative test-mode intake, payment/refund, fulfillment and support evidence for that country/product. “Configured” and “successfully executed” appear as distinct states. An obligations calendar groups due tasks by country, working calendar and owner, with timezone and absence coverage explicit. Sensitive contracts remain behind their record-level access controls.

Approve launch previews exact public offers/routes, capacity bounds and rollback/suspension behavior. It lists unresolved limitations requiring explicit business acceptance and blocks mandatory gaps. A policy/provider restriction opens an impact queue of existing obligations and the approved new-intake limitation. The system must not cancel orders or redistribute money as a side effect of a launch-status edit. Conflicting readiness evidence forces a refreshed approval decision. During evidence outage show the last verified state and freeze unsafe publication. Mobile leads with due signoffs and expiring obligations; accessible textual grids work without map or flag interpretation and correctly isolate ISO codes within RTL layouts.

### Acceptance and business ownership

The market owner coordinates Legal, Finance, Risk, Support and Operations signoff. Test a country with only food enabled, provider loss after launch, expiring insurance, absent reviewer and a language gap. Demonstrate launch approval, configuration publication, offer verification, restriction and continued resolution of historic refunds/support. Use one real specialist-approved country/product package as evidence. Do not label the business globally compliant without jurisdiction-specific review and ongoing control execution.

## Proposed workspace 4: Recovery and Release Certification

### Why this management capability needs a dedicated view

Reliability, backups, provider health and CI already supply pieces of evidence. What is not established is a single release/recovery certification workflow binding them to the exact artifact and to a business-usability decision. This proposed view extends Reliability rather than adding another manual release list. With a production Mac as a shared failure domain, a green uptime card cannot prove survival of host loss, corrupted data, expired provider access or an interrupted migration. The company needs an executed recovery drill that a second operator can reproduce.

### Workflow and data contract

A certification run binds source revision, immutable artifact, migration checksums, tested configuration capabilities, CI coverage, scoped authenticated journeys, restore object/profile, load/failure evidence and approver. Record required, passed, failed, skipped and insufficient checks explicitly. Promotion requires applicable critical gates, with emergency exception decision/expiry and later review. Recovery uses an isolated target, private offsite retrieval, integrity checks, database/media/configuration restoration, invariant validation and representative business journeys before timing completion. No live charge is necessary.

Use additive compatibility across old/new workers and clear forward-recovery procedures. Separate backup age/RPO, offsite confirmation and usable-service RTO. Rehearse a populated upgrade, not merely two applications of migrations on an empty database. A disaster drill may intentionally fail but preserves its evidence and assigned remedy. The workflow verifies infrastructure observations; a self-reported checkbox is not equivalent to a measured test.

### Operator design recommendations

The screen presents certification runs with artifact, environment, critical coverage, deployment identity, restore verification, measured recovery and final decision. Filters separate release candidates, verification incomplete, recovery overdue, failed drills and accepted temporary limitations. The header compares running identity to the approved artifact and labels missing metadata. A test that executed zero required scenarios is insufficient, not green because latency calculations returned no errors.

The run drawer lists mandatory evidence in dependency order: build, migration compatibility, provider capability, authenticated journeys, restored invariants, failure drills and operational signoff. Each result links to its actual run and names execution scope/time. Coverage includes denied/stale/concurrent paths, not only happy-path page loads. An operator can open unresolved findings and their closure tests directly; copying an old certificate to a new revision is forbidden.

The recovery wizard pins the chosen offsite object and isolated target, previews restore scope, and asks for explicit safety confirmation before any destructive target operation. Stages show verified checksum, restore, upgrade, workers, media and business checks. RTO starts at incident declaration and ends at usable verified service. A rollback panel explains non-reversible committed-domain effects and forward remedies. Emergency release requires named authority, reason and expiry, displayed prominently until review closes. Mobile puts an active drill/rollout and stop/escalation controls before charts. Screen readers receive stage transitions and scope warnings; no animation is required to understand progress.

### Acceptance and business ownership

SRE/Continuity own execution; accountable business owners accept residual risk. Demonstrate one failed required gate blocking promotion, skipped authenticated coverage classified insufficient, wrong digest detection, production-sized upgrade and independent offsite recovery. Verify financial and inventory invariants and resume background work without duplicates. Have a second employee execute the runbook without relying on the first employee's memory. A successful certificate is revision/environment/time-specific and expires under the approved review cadence.

## Proposed workspace 5: Cross-product Incident and Customer Impact

### Why this management capability needs a dedicated view

Incident management, Support, Provider Health and Service Operations already handle portions of incidents. The enterprise need is a cross-product command view connecting measured customer impact, incident ownership, mitigations, communications and recovery verification. This is a coordination layer over existing incident/support records, not a parallel ticket system. At six million users, a provider outage can affect subscriptions, orders, delivery, messages and payout confidence at once. Separate teams must not issue contradictory status or retry financial work blindly.

### Workflow and data contract

An incident links source alerts, affected capabilities/scopes, confirmed impact queries, commander, workstream owners, severity and communication cadence. Establish declared, investigating, mitigation proposed/approved, recovering, verified resolved and review states. Customer-impact sets are authorized, versioned predicates/IDs; estimates and confirmed records are distinguished. Mitigation commands use domain services with explicit scope and rollback/reconciliation plans. Customer notification uses existing localized infrastructure and approved factual templates, with per-recipient deduplication and consent handling.

Handoffs record outgoing/incoming commander acknowledgement and outstanding actions. Preserve timeline, evidence, unknown provider outcomes and decisions. Recovery verifies affected business journeys and queue health, not merely HTTP readiness. Post-incident actions become assigned engineering/runbook tasks with closure evidence; deleting an incident cannot clear obligations. Where safety, privacy or legal reporting is implicated, specialist escalation governs communications and retention.

### Operator design recommendations

The command view shows declared severity, commander, affected products/regions, confirmed versus estimated customer impact, current mitigation and next communication deadline. Dedicated queues track unowned workstreams, blocked mitigations, provider outcome unknown, support escalation and recovery verification. Filters stay incident-scoped so a responder does not accidentally apply an action to the whole platform. A customer count includes measurement time and query completeness; missing telemetry is not zero affected people.

The incident timeline separates observations, proposals, approved actions, committed results and customer notices. Workstream cards identify responsible team, due time, dependency and recovery check. Provider Health links show probe scope versus actual transaction impact. The affected-record panel uses existing authorization, masked summaries and domain links; it does not expose every user's private messages to the incident room. Staff can inspect a representative failure and its correlation chain without dumping all payloads.

Mitigation preview names exact records/scope, authority, anticipated business effect and reconciliation. Replay is distinct from refund, cancel or suspend. Unknown external results block repeated money movement while evidence refresh remains possible. Communication preview shows localized copy, factual basis, affected audience and deduplication reference; internal routing details stay out of routine customer updates. Commander handoff is acknowledged explicitly, with next update time retained. Resolution requires journey/queue checks and lists residual support obligations. Mobile places commander, urgent tasks and communication deadline first; keyboard-accessible timelines and text severity labels support long shifts and RTL use without color dependence.

### Acceptance and business ownership

Incident Command, Support and domain owners jointly operate this view. Run a test-mode provider outage affecting food and delivery, with lost webhook, stale realtime screen and customer escalation. Verify one consistent approved notice per recipient, no duplicate financial action, safe scoped mitigation and acknowledged shift handoff. Restore service and prove representative journeys plus reconciliation before resolution. Retain a post-incident action whose completion requires a real regression test, not only a written apology.
