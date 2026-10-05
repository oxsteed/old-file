# Operations review, version 2: Tabs 1–17

## Coverage and evidence boundary

Reviewed current source at `e47531c76b320c8145e15415774d05d698b456d1`, October 3, 2026, for a target operating model of 3,500 worldwide employees and six million registered users. Earlier sections were drafted at `893f1bc3`; their relevant source diff was rechecked after the shared fast-forward. This is a source-based engineering and operator-workflow review, not complete certification, a production penetration test, or a measured capacity claim. Only this document is written. No credentials, production APIs, databases, financial transactions, deployment actions, or product changes are used.

The user reports earlier green CI runs, including `37110020289`, followed by latest run `37147612778` failing and a healthy readiness response at 22:30 UTC with migrations 661/661 and null Git SHA. These operational assertions are attributed to the user, not independently queried here; the latest CI cause is being investigated separately. Earlier CI failure is historical. The Customer360 mock repair at `4fe5470d`, localization debt gates at `25790585`, and process-state registry/Redis fencing at `893f1bc3` must not be described as unchanged defects. The isolated scale harness added at `7c64513f` exists; measured global capacity remains unverified. Existing tests and migrations are inspected as source evidence; unless an execution result is explicitly recorded, their presence does not mean they were rerun or that migrations are applied in production. The prior `docs/admin-super-admin-full-audit-2026-10-02.md` supplies baseline questions only. Findings below are checked against current paths. Repository HEAD includes migrations 663–666; reported readiness 661/661 does not establish that these new features are deployed.

Citation convention: `path:line` points to the current checkout, relative to `/Users/oxsteed/Documents/GitHub/6`. CONFIRMED DEFECT identifies a demonstrable code/contract inconsistency, not observed exploitation. DESIGN GAP identifies missing operational capability in the inspected workflow. UNVERIFIED identifies a hypothesis requiring isolated or operational evidence. Proposed endpoints and screen elements are explicitly recommendations, not claims that they already exist. P1 is an expansion blocker for the affected workflow; P2 is an important improvement with a committed owner.

| Tab | Actual route | Page source | API/router and principal implementation |
| --- | --- | --- | --- |
| 1 Dashboard | `/admin/dashboard` | `client/src/admin/pages/super/Dashboard.jsx` | `server/routes/admin.js`; `server/controllers/adminController.js`; super variant `server/controllers/superAdminController.js` |
| 2 Operations Overview | `/admin/operations` | `client/src/admin/pages/OperationsOverview.jsx` | `GET /api/admin/operations/overview`; `server/controllers/adminOperationsController.js` |
| 3 Users | `/admin/users` | `client/src/admin/pages/UsersList.jsx` | `/api/admin/users`; `server/controllers/superAdminController.js` |
| 4 Jobs | `/admin/jobs` | `client/src/admin/pages/JobsList.jsx`; `JobDetail.jsx` | `/api/admin/jobs`; `server/controllers/superAdminController.js` |
| 5 Reports | `/admin/reports` | `client/src/admin/pages/ReportsList.jsx` | `/api/admin/reports`; `server/controllers/adminController.js` |
| 6 Moderation | `/admin/moderation` | `client/src/admin/pages/Moderation.jsx` | `/api/admin/moderation-queue`; `/api/admin/jobs/:jobId/action`; `server/controllers/adminController.js` and `superAdminController.js` |
| 7 Enforcement | `/admin/enforcement` | `client/src/admin/pages/AdminEnforcementDashboard.jsx` | `server/routes/enforcement.js`; `server/controllers/enforcementController.js` |
| 8 Content Removals | `/admin/content-removals` | `client/src/admin/pages/ContentRemovals.jsx` | `/api/admin/content`, bid/review remove/restore; `server/controllers/adminController.js` |
| 9 Skills | `/admin/skills` | `client/src/admin/pages/SkillsManager.jsx` | `/api/admin/skills-lookup`; inline handlers in `server/routes/admin.js` |
| 10 Support Tickets | `/admin/support` | `client/src/admin/pages/SupportTickets.jsx` | `/api/admin/support/tickets`; `server/controllers/supportController.js` |
| 11 Live Support | `/admin/support/chat` | `client/src/admin/pages/SupportAgentChat.jsx`; `client/src/components/support/SupportConversationWorkspace.jsx` | `server/routes/support.js`; `server/controllers/supportConversationsController.js`; `conversationAssignmentController.js` |
| 12 Quote Requests | `/admin/quote-requests` | `client/src/admin/pages/QuoteRequestsInbox.jsx` | `server/routes/quoteRequests.js`; `server/controllers/quoteRequestsController.js` |
| 13 Direct Ops | `/direct/admin`, with dashboard/inbox/calendar/job/payment/customer subroutes | `client/src/pages/DirectAdminPortalPage.jsx`; `client/src/App.jsx` | `server/routes/direct.js`; `server/controllers/directController.js`; `quoteRequestsController.js` |
| 14 Direct Service Areas | `/admin/direct-service-areas` | `client/src/admin/pages/DirectServiceAreas.jsx` | `/api/direct/admin/service-areas`; `server/services/directServiceAreas.js` |
| 15 Direct Catalog | `/admin/direct-catalog`; alternate `/direct/admin/catalog` | `client/src/admin/pages/DirectCatalog.jsx` | `/api/direct/admin/catalog`; `server/services/directCatalogService.js`; `directCapability.js`; `directSlotEngine.js` |
| 16 Messages | `/admin/messages` | `client/src/admin/pages/AdminMessages.jsx` | `/api/admin/messages/conversations`; `server/controllers/adminMessageController.js` |
| 17 Search | `/admin/search` | `client/src/admin/pages/AdminSearch.jsx` | `/api/admin/search`; `server/controllers/adminSearchController.js` |

The shared route contract starts at `client/src/admin/adminRouteManifest.js:21`; actual admin mounting is `client/src/admin/AdminApp.jsx:230–258`. Server admin authentication already verifies current active role, token revocation, and mandatory TOTP (`server/middleware/adminAuth.js:43–80`). Current permission middleware rejects region-only grants on global endpoints and verifies delegated grantor authority (`server/middleware/adminAuth.js:126–188`). This prevents regional grants becoming global access; it also means regional operations remain a product-design requirement rather than an existing scoped version of every page.

## 1. Dashboard

### Route and business purpose

`/admin/dashboard` is the shift-start summary for ordinary operations staff and also renders the richer dashboard for super administrators. It should answer whether marketplace work and customer problems are moving normally, then take staff directly to the workload requiring intervention. At the target size, a trustworthy definition of each number matters more than the number of attractive cards: a seven-day intake count must not masquerade as a selectable thirty-day performance metric.

### Verified current implementation

The ordinary route requires `manage_operations` (`server/routes/admin.js:66`). The shared component chooses `/admin/dashboard` for regular admins and `/admin/super/dashboard?period=…` for super admins (`client/src/admin/pages/super/Dashboard.jsx:150–154`). Ordinary output contains six operational fields, including `new_users_7d` and `new_jobs_7d` (`server/controllers/adminController.js:24–42`). The super path counts both completions and cancellations over the same creation cohort; the historical mixed-lifetime completion-rate defect is fixed (`server/controllers/superAdminController.js:239–240`, `:357–363`). Auxiliary activity, geography, monitoring, and incidents load independently with settled promises (`client/src/admin/pages/super/Dashboard.jsx:159–188`). Incident resolution now collects a note (`:211–219`). Relevant schema includes the audit infrastructure in `server/migrations/005_admin.sql:11–30`; shared permission tests explicitly reject regional grants (`server/__tests__/adminPermissionScope.test.js:23–40`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: ordinary-admin metric contract does not match rendered cards.** The renderer expects `new_users_period`, `new_jobs_period`, and `open_support_tickets` (`client/src/admin/pages/super/Dashboard.jsx:362`, `:391`, `:408`), but the ordinary controller returns the seven-day fields and no ticket count. Values become unavailable despite real data. The period selector also refetches an endpoint with no period parameter. This is distinct from the fixed super completion calculation.
2. **DESIGN GAP, P1: optional-query failure can look like zero activity.** Super statistics catch failed queries into empty objects or initialized zeros (`server/controllers/superAdminController.js:199`, `:212–224`). The component receives no per-metric failed-source flag. A partial database issue can therefore suppress a staffing or fraud signal while the overall page succeeds.
3. **DESIGN GAP, P2: summary freshness is not panel freshness.** `lastUpdated` changes when statistics arrive, while auxiliaries are fetched on the super-role dependency and manual refresh (`client/src/admin/pages/super/Dashboard.jsx:157`, `:188`, `:227–229`). An operator can read fresh totals beside older incidents or activity. The eight-row geography display (`:111`) is a ranking sample, not global market coverage.

### Expansion failure scenario

A regional incident produces thousands of tickets. Ordinary operations staff see unavailable ticket/new-user cards; a super administrator sees a freshly updated main summary alongside old incident information. A failing optional count becomes zero. Staffing is directed to the wrong queue even though authentication works correctly. Operations Overview, Support Tickets, and Incident Management must share definitions and source freshness, rather than each producing a different understanding of the incident.

### Required changes and operator design

Normalize the ordinary response to a documented operational metric contract, or render a separate six-field ordinary view. Return metric-level `value`, `window`, `cohort`, `asOf`, and `availability`, with explicit failure codes. Keep money cards on the existing super path. Use aggregate snapshots for repeated counts and preserve links to authoritative work queues. Completion percentage must be labeled as the share of terminal jobs in the selected creation cohort, unless product deliberately adopts a completion-event cohort.

### Operator screen design recommendations

Replace the regular-admin view's unsupported cards with a header reading “Marketplace operations,” its effective global scope, selected interval, and independent statistics/incident refresh times. Restrict interval choices to those actually supported by the endpoint. Four primary cards should show published jobs, in-progress jobs, pending reports, and active support cases; define active cases explicitly, including waiting-user cases if they remain company obligations. Put cohort intake and trend cards below, with accessible definition popovers.

Add a compact “Needs intervention” list beneath the cards: workload type, current count, oldest outstanding item, deterioration since previous snapshot, responsible queue, and a link carrying the matching filter. A support count should open the relevant active-state filter rather than an unfiltered inbox. Saved views should store metric window and chosen operational domains; avoid saving customer details in browser state.

Selecting a card opens a side drawer containing its definition, source, query interval, last successful sample, trend, and underlying queue link. Incident rows may acknowledge or open the existing resolution-note dialog only where authority permits; ordinary KPI rows have no destructive bulk actions. Add “Create incident from signal” as a separately authorized, previewed handoff with metric evidence attached.

On partial failure retain the last sample with a stale badge and source-specific retry; never draw zero as healthy. Empty means zero measured work in the displayed scope. No access names the missing domain permission without exposing its count. On mobile stack the intervention list before secondary charts; use logical spacing for RTL and textual severity labels beside colored dots.

### Acceptance tests and owner

Operations product and analytics engineering own the metric contract; SRE owns signal freshness. Test ordinary-role rendering with the actual controller response: every supported card displays its fixture count and every unsupported card is absent. Selecting seven/thirty days must alter the declared query window or be unavailable. Inject one failed source: its card becomes unavailable/stale, never zero, while others remain usable. Seed historical cancellations outside the selected cohort: completion rate remains unchanged. Verify a support card opens exactly its counted statuses, and keyboard users can read definitions and resolve an authorized incident with a mandatory note. These are required future acceptance tests, not executed certifications.

## 2. Operations Overview

### Route and business purpose

`/admin/operations` is the cross-domain command center for an operations shift. It should reveal which service needs action and which facts cannot currently be trusted. Its value is coordination between delivery, jobs, food orders, support, disputes, privacy, CRM, and financial exceptions. It must preserve the independent authority of those systems instead of inventing another payment ledger or dispatch engine.

### Verified current implementation

The route and API require `manage_operations` (`client/src/admin/adminRouteManifest.js:22`, `server/routes/admin.js:69`). The controller probes relation columns and groups table statuses (`server/controllers/adminOperationsController.js:15–47`), then loads fifteen sections concurrently (`:114–207`). Financial, settings, audit, and credit cards have additional access decisions; inaccessible financial cards are redacted (`:109–112`, `:132–134`, `:183–184`). Every successful/degraded section carries a correlation ID (`:79–102`). The browser refreshes every thirty seconds only while visible (`client/src/admin/pages/OperationsOverview.jsx:193–216`). Existing tests cover bounded section output and finance/credit redaction (`server/__tests__/adminOperationsController.test.js:26`, `:61`) and regional denial (`:85`). This is an existing command center, not a recommendation to build a replacement dashboard.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: delegated-domain authority is inconsistent.** `permissionGranted` queries only `admin_permission_grants` (`server/controllers/adminOperationsController.js:62–72`); authoritative middleware also permits validated `delegation_grants` (`server/middleware/adminAuth.js:143–156`). An admin authorized through delegation for financials/settings/audit can reach the domain endpoint yet sees its overview card denied. This is erroneous denial, not disclosure.
2. **DESIGN GAP, P1: response limits do not limit aggregation work.** `statusSummary` groups every row before `LIMIT 50`; `countTable` counts an entire selected relation (`server/controllers/adminOperationsController.js:33–38`, `:55`). Fifteen concurrent sections contain multiple queries each. With hundreds of active employee sessions, the thirty-second poll can create heavy repeated scans. Actual plans and concurrency capacity are **UNVERIFIED**, so no specific overload rate is asserted.
3. **DESIGN GAP, P2: table totals are weak action signals.** Jobs/orders include all historical statuses, and SLA uses open breach flags but no oldest breach, accountable queue, or breach duration (`server/controllers/adminOperationsController.js:123–130`, `:160–166`). Security failures and failed webhook totals are counts without a specific recovery task (`:168–174`, `:192–198`). A card cannot tell the commander whether today's actionable failures are growing.

### Expansion failure scenario

Delivery and support incidents occur simultaneously. Thousands of employees open the command center; repeated historic counts contend with operational queries. A delegated financial responder cannot see the finance card despite having access to Payments. Large lifetime totals conceal a handful of newly stuck events. The correct dependency chain is incident signal → scoped exception queue → domain action → refreshed evidence, with finance and privacy data remaining controlled by their existing endpoints.

### Required changes and operator design

Reuse one authority resolver for direct and delegated grants; test its result against the actual downstream middleware. Produce bounded, periodically computed summary snapshots with domain-specific freshness rather than promising that `LIMIT` bounds aggregate cost. Add active-window counts, oldest unresolved timestamps, severity and exception IDs, each mapped to an existing recovery queue. New overview drilldown endpoints should accept domain/window/cursor and return permitted exception summaries, not full customer records. An unavailable source must not be inferred from a missing table as an empty workload.

### Operator screen design recommendations

Keep the current section cards but split the screen into “Urgent exceptions,” “Service workload,” and “Restricted management signals.” The header shows effective scope, a shift-window selector, overall fetch time, and the number of degraded sources. Give each card its own source timestamp and observation interval; a single generated response time is insufficient to prove that the underlying information is current.

The urgent list should have domain, exception class, unresolved count, oldest age, latest change, incident linkage, and destination. Define delivery backlog as pending/processing events beyond their retry deadline, support breach as unresolved first-response/resolution breach, and webhook backlog as due uncompleted deliveries. Saved views should support delivery-command, customer-care, and incident-response presets with window and severity filters, not a fifteen-card wall for every employee.

A card drawer displays source coverage, active versus historical totals, recent exceptions, and the exact filter used in its “Open queue” action. The command center may assign an incident coordinator or attach a signal to an incident, after previewing linked systems; financial settlement/retry decisions stay in their existing specialist workflows. Bulk actions here should be limited to acknowledging selected signals with a shared incident reference, never changing domain records.

When a section fails, show its last successful sample and retry only that section. A schema/configuration absence says “Source not configured,” separate from “No unresolved work.” A restricted card offers the existing access-request route and no count. Collapse normal cards on narrow screens, announce changed exception counts without stealing focus, and use RTL-compatible arrows and accessible table headings.

### Acceptance tests and owner

Operations command-center engineering owns the interface; domain leads own definitions; database/SRE teams own query budgets. A delegated finance grant must show the same authorized aggregate as an equivalent direct grant, while expired/revoked grants expose neither. Fail one relation and verify fourteen independent cards retain truthful state and correlation IDs. In an isolated six-million-user-equivalent dataset, execute a declared 250-viewer polling workload; pass only if API p95 is under two seconds and domain mutation latency remains within its established SLO. Agree that budget before implementation. Drilldowns must reproduce the counted exception predicate, include records beyond page one, and preserve incident linkage across a shift handoff.

## 3. Users

### Route and business purpose

`/admin/users` is the customer/helper account operations directory. It should support finding a person, understanding their current lifecycle, and making a narrowly defined intervention with traceable consequences. It is not the employee-administration directory: workforce accounts belong in the existing corporate/admin workspaces. At six million users, staff need precise identity resolution and lifecycle context, especially before bulk suspension or recovery.

### Verified current implementation

The server requires `manage_users` for listing, detail, name changes, and ban actions, while verification and privileged role/deletion operations use separate stronger gates (`server/routes/admin.js:140–154`, `:194–202`). Listing excludes admin/super-admin and internal placeholder accounts, permits bounded pages, and restricts SQL sort fields (`server/controllers/superAdminController.js:546–585`). It joins helper/subscription context and computes job/earnings summaries (`:589–627`). The client maintains URL-driven filters and clears page selection when filters change (`client/src/admin/pages/UsersList.jsx:440–463`). Ban writes compare the fetched active state in the update, returning conflict on concurrent change (`server/controllers/superAdminController.js:854–874`). Shared scope tests confirm regional grants cannot silently authorize this global list (`server/__tests__/adminPermissionScope.test.js:23–40`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: list-level financial data crosses the neighboring financial boundary.** A `manage_users` list request calculates and returns `earnings_total` from paid payouts without requiring `view_financials` (`server/controllers/superAdminController.js:616–627`; compare `server/routes/admin.js:137`). This is a server response issue even if a table omits that column. Separate finance field authorization is required; no public access is alleged.
2. **CONFIRMED DEFECT, P1: bulk “suspend/reactivate” uses a toggle contract.** The UI chooses eligible users from a stale list, then calls `/ban` without the desired state (`client/src/admin/pages/UsersList.jsx:540–553`). The server recomputes a toggle from current state. If another operator already suspended a chosen active user, the bulk suspension can reactivate them. The server's comparison guard protects its own read/write race but cannot recover the client's omitted intent.
3. **DESIGN GAP, P2: account suspension has competing meanings.** The list's active/banned filter is `is_active` only (`server/controllers/superAdminController.js:562–563`), whereas Enforcement writes `is_suspended`/`suspended_until` (`server/controllers/enforcementController.js:48–55`). A person operationally suspended through Enforcement can appear active here. Bulk failures are swallowed and summarized as successful-count feedback (`client/src/admin/pages/UsersList.jsx:548–553`), losing actionable per-user recovery.

### Expansion failure scenario

A trust team suspends compromised accounts while customer-care runs a bulk suspend view. Toggle requests accidentally reverse some decisions. The directory calls enforcement-suspended users active and discloses earnings to staff whose task is identity support. Customer360, Enforcement, financial reporting, and account restoration must use one explicit lifecycle vocabulary, while employee access stays in workforce administration.

### Required changes and operator design

Add an intent-based account-state endpoint accepting desired state, expected version, reason, and operation ID. It must reject stale conflicting intent and return individual bulk results. Apply financial projection gates before constructing list SQL. Return effective access state with causes, including inactive account, active enforcement, scheduled deletion, and restoration eligibility. Keep existing exclusion, pagination, URL filters, and privileged gates. Extend list filtering with exact user ID and country, and make summary cards explicitly global or filter-scoped. No password or credential workflow is audited or exercised in this assignment.

### Operator screen design recommendations

Preserve the current searchable directory and URL filters. Its header should identify “Customer and provider accounts,” effective geographic access, snapshot time, and matched versus total counts. Replace the ambiguous active badge with a compact effective-access badge plus cause chips: account disabled, timed enforcement, or deletion scheduled. KPI cards must state whether they describe all accessible accounts or the current search, and link to the exact corresponding predicate.

Use columns for stable user ID, name, role/persona, masked contact, country/region, effective access, verification evidence age, subscription, last activity, and pending lifecycle action. Provide exact-ID lookup beside the existing text/location search; saved views should include deletion-due, verification-followup, and enforcement-active with named scopes. Reveal sensitive contact or earnings only in authorized drawer sections.

The drawer should show identity references, access causes, jobs/business links, Customer360 link, deletion timeline, notes, and action history. Row actions specify “Suspend account” or “Reactivate account,” never “Toggle.” Require a reason and preview active work/deletion implications; use existing stronger authority for deletion and role changes. Bulk preview lists selected IDs, desired state, exclusions, and expected versions; finish with applied/conflicted/failed rows and retry only explicitly selected failures.

Conflicts display the current access cause and preserve the operator's reason without reapplying automatically. No results offers clear filters and exact-ID entry; no access explains customer-directory permission; unavailable retains cached rows labeled stale with mutations disabled. Mobile uses an identity summary card and full drawer, keeping action confirmation above the keyboard. Contact identifiers use bidi isolation, and row selection/check-state announcements work without color cues.

### Acceptance tests and owner

Account operations engineering and Trust & Safety jointly own lifecycle intent; Security owns field projections. A `manage_users`-only API response must omit payout totals. Race a bulk suspension with another operator's completed suspension: no selected user may become active. Every failed bulk row must retain its ID, reason, retry eligibility, and current state. Seed an active `is_suspended` enforcement with `is_active=true`: directory and Customer360 must display the same effective restriction. Verify internal/admin accounts remain excluded, filters survive navigation, exact-ID lookup is deterministic, and duplicate timestamps do not duplicate or skip users in the eventual cursor-based list. Current guarded toggles must remain covered while the intent endpoint replaces them.
## 4. Jobs

### Route and business purpose

`/admin/jobs` and `/admin/jobs/:jobId` support investigation and intervention in marketplace work. Staff must distinguish hiding objectionable content from cancelling an accepted commercial commitment. At global scale, the page should expose the job's lifecycle, participant obligations, and financial dependencies before offering a destructive action.

### Verified current implementation

Listing/detail/action require `manage_operations`; hard deletion requires `delete_jobs` (`server/routes/admin.js:77–81`). List pagination is bounded and search/status/category parameters are bound (`server/controllers/superAdminController.js:1033–1045`). `JobsList` preserves prior data on refetch failure (`client/src/admin/pages/JobsList.jsx:47–61`), and delete requires a reason in both UI and API (`:80–89`; `server/controllers/superAdminController.js:1097`). Deletion rechecks permitted statuses in its SQL, returning conflict if eligibility changes (`:1101–1108`). Migration 188 adds terminal-state constraints and a locking transition function (`server/migrations/188_job_state_transition_safety.sql:11–24`, `:30–64`). The customer cancellation path already has a specialized transactional service with payment checks (`server/services/jobCancellationService.js:99–108`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: administrative cancellation bypasses the established cancellation workflow.** Force action changes status directly, without cancellation timestamp/reason, bid cleanup, or payment prerequisite checks (`server/controllers/superAdminController.js:1060–1064`). The existing service records cancellation and handles related obligations. This is a path discrepancy; no production money loss is asserted.
2. **CONFIRMED DEFECT, P1: successful job mutations can lack audit evidence.** Force action and hard deletion catch and ignore audit failure after mutation (`server/controllers/superAdminController.js:1087`, `:1110–1119`). The existing cancellation service explicitly supports fail-closed transactional audit (`server/services/jobCancellationService.js:34`). A staffing mistake can become untraceable.
3. **DESIGN GAP, P2: budget display lacks its financial contract.** The list omits `budget_type`/currency but the renderer branches on `budget_type` and prints `$` (`server/controllers/superAdminController.js:1043`; `client/src/admin/pages/JobsList.jsx:175–178`). Detail formatting also assumes USD (`client/src/admin/pages/JobDetail.jsx:24–29`). International monetary interpretation is unsupported; actual non-USD job population is **UNVERIFIED**.

### Expansion failure scenario

A moderation employee cancels an accepted job whose payment remains held. The job disappears from active operations without the participant/financial cleanup used by normal cancellation. Another employee exports all jobs while believing the export matches a filtered queue: current export sends no filters (`client/src/admin/pages/JobsList.jsx:70`). Support and finance then reconcile different records.

### Required changes and operator design

Route administrative cancellation through the existing cancellation service with explicit actor/reason. Treat content visibility separately. Preview live commitments and payment dependencies; do not perform automatic refunds from this screen. Make audit success part of the state transaction. Return currency/budget type and export-filter receipts, and replace deep offset traversal with stable cursors when measured plans require it.

### Operator screen design recommendations

Retain the list/detail route pairing, but put an effective territory, snapshot time, and active-work interval in the header. Define queue KPIs as published without accepted bid, accepted not started, overdue in progress, and disputed awaiting response. Every KPI opens its matching filter. Extend existing text/status search with exact job ID, category, scheduled-date range, assignee, payment dependency, and administrative flag; save “Unassigned accepted,” “Overdue work,” and “Financially blocked cancellation” views.

List columns should show job ID/title, city/country, customer, assigned helper, scheduled local start with timezone, lifecycle, age in current state, price with ISO currency, and exception chips. Detail becomes a drawer or existing detail page with sections for work description/evidence, participant commitments, accepted bid, payment/escrow references, dispute history, and chronological administrative decisions. Preserve stable links to Support and Payments rather than copying their mutation controls.

Row actions are open, flag/unflag, hide content, and request cancellation. A cancellation preview shows present state, affected participant/bid, notification plan, and blocking payment IDs; confirmation requires reason and expected version. Deletion must preview retention/foreign-key impact and remain restricted to eligible states. Bulk work is limited to flagging or assigning review, with individual receipts; no bulk cancellation/deletion at launch.

On conflict refetch the job and show which prerequisite changed. On timeout recover by operation ID before retrying. Empty says no jobs match the selected lifecycle; unavailable keeps stale rows with actions disabled. No access distinguishes operations read from delete authority. Mobile presents job/exception cards, RTL uses logical column alignment, and confirmation dialogs trap focus and return it to the acted row.

### Acceptance tests and owner

Marketplace operations engineering owns lifecycle; payments engineering owns cancellation prerequisites. Seed an accepted job with pending payment: admin cancellation must reject with the same actionable block as normal cancellation. Successful cancellation must atomically record reason/timestamp/audit and participant effects. Inject audit failure: neither cancel nor delete commits. Verify open budgets and explicit foreign currency display without `$` substitution. Export receipt must match applied filters or clearly declare global export. Existing migration constraints must remain effective under concurrent completion/cancellation.

## 5. Reports

### Route and business purpose

`/admin/reports` handles individual content complaints, with reporter evidence and a review decision. Its purpose differs from the job-centric Moderation queue and the user-behavior reports dashboard. Operators need to see what was reported, decide what rule applies, and route an escalation to a named reviewer without prematurely clearing the case.

### Verified current implementation

List/review require `manage_operations` (`server/routes/admin.js:72–73`). The API returns bounded oldest-first pages (`server/controllers/adminController.js:55–80`). Pagination now exists in the browser (`client/src/admin/pages/ReportsList.jsx:233–253`); the old unreachable-page finding is fixed. Review locks the report and rejects already-reviewed cases (`server/controllers/adminController.js:101–118`). Unsupported removal targets are rejected (`:121–126`), and the UI uses shared confirmation (`client/src/admin/pages/ReportsList.jsx:46–53`). Job/user deep links exist (`:163–176`). Schema allows job/user/bid/review targets (`server/migrations/005_admin.sql:84–101`); report idempotency coverage exists in `server/__tests__/communicationEdges.test.js:196`.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: job removal directly cancels commercial work.** Report review writes `status='cancelled'` with a generic reason (`server/controllers/adminController.js:143–151`) rather than the transactional cancellation service. This path has the same obligations problem as Jobs, but is reachable from a complaint decision.
2. **DESIGN GAP, P1: escalation becomes a status without an executable followup.** Review writes `escalated`, while eligibility accepts only pending/open (`server/controllers/adminController.js:113`, `:137`). The UI exposes action buttons only on pending (`client/src/admin/pages/ReportsList.jsx:188–199`). There is no assignment or escalated-case decision path in these handlers. Escalation can move work out of the actionable queue rather than to a reviewer.
3. **DESIGN GAP, P2: decisions lack durable rationale/delivery context.** Client `action_taken` is the translated button label (`client/src/admin/pages/ReportsList.jsx:58–61`), not policy evidence. Warning notification occurs before report commit, failure is tolerated, and audit is subsequently best-effort (`server/controllers/adminController.js:198–224`). The user can receive a warning without durable review if commit fails; the browser ignores the returned delivery result.

### Expansion failure scenario

Hundreds of complaints during a regional abuse campaign are escalated across timezones. No reviewer owns the escalated backlog. A reported accepted job is cancelled without financial handoff, and failed warning notifications appear as generic success. Reports, Enforcement, Content Removals, and job cancellation need a linked case ID and explicit next decision.

### Required changes and operator design

Persist policy code, evidence snapshot, review owner, escalation destination, due time, and decision history. Extend the existing locked decision endpoint with expected case version and a supported escalated-review transition. Use post-commit notification outbox receipts. Delegate removals to domain services; retain the current target validation and review conflict response. Add evidence detail for bids/reviews rather than relying on unrelated navigation.

### Operator screen design recommendations

Replace long report cards with a triage table and a case drawer. Header shows content-report scope, last successful queue load, pending count, escalated awaiting decision, and oldest unreviewed age. These KPIs use complete server counts, not visible-page length. Filters include target type, complaint reason, country/language, submitted interval, owner, escalation destination, and evidence completeness; save “Urgent harm,” “My escalations,” and “Missing target evidence.” Preserve existing pagination and status tabs.

Columns are report ID, target link/type, rule allegation, brief description, reporter trust/context indicator, age, owner, status, and next deadline. Mask reporter contact until required for outreach. The drawer separates allegation/evidence, current target snapshot, prior related reports, policy decision, and notification/audit receipts. Links to Jobs and Users remain, while bid/review evidence is rendered directly with source IDs.

Allowed decisions are dismiss, warn, domain-safe removal request, or escalation. Show only target-supported actions. Require policy reason and rationale; removal preview must identify live-work/payment blockers before confirmation. Escalation requires a destination and acknowledged handoff, not only a new status. Bulk actions may assign cases or combine duplicate reports after preview; bulk punitive decisions should be unavailable.

On 409 retain the rationale and show the other reviewer's decision. After a response timeout look up the decision receipt before repeating. Empty pending means no pending reports in this scope, with escalated backlog still visible. A missing target becomes “Evidence unavailable/target removed,” not dismissible by assumption. Permission denial hides evidence; source outage preserves stale case IDs. On mobile prioritize allegation and deadline; provide keyboard case navigation, focus-safe confirmation, bidi-isolated IDs, and text severity indicators.

### Acceptance tests and owner

Trust & Safety operations owns policy and escalation, with marketplace engineering owning domain effects. More than 25 pending reports must remain reachable. Two decisions on one case yield one commit and one 409. An escalated case must have a named queue and be decidable there. Warning outbox failure must display retryable delivery status without duplicating the decision. A job-removal decision with a pending payment must not silently cancel. Each decision must retain machine policy code and operator rationale independent of display language.

## 6. Moderation

### Route and business purpose

`/admin/moderation` is a consolidated queue of flagged or reported jobs. It should reduce repeated investigation by grouping complaints around a target, while keeping report adjudication and commercial cancellation separate. A moderator must know whether they are resolving allegations, clearing an internal flag, or changing marketplace availability.

### Verified current implementation

The page is grant-guarded for `moderate_content` (`client/src/admin/AdminApp.jsx:239`); its list API uses the same grant (`server/routes/admin.js:74`). Current loading is abortable and errors are distinguished from a clear queue (`client/src/admin/pages/Moderation.jsx:17–20`, `:64–77`). SQL includes either `metadata.admin_flagged` or pending content reports, excludes cancelled jobs, and sorts by report count/creation age (`server/controllers/adminController.js:265–276`). Job deep links exist (`client/src/admin/pages/Moderation.jsx:86–90`). Actions call the shared job action endpoint (`:25–39`), whose conditional flag updates already return conflicts (`server/controllers/superAdminController.js:1069–1084`). The content-report schema and independent moderation queue are distinct (`server/migrations/005_admin.sql:84`; `server/migrations/016_phase5_create_moderation_queue.sql:9–22`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: list and mutation authority disagree.** A moderator with only `moderate_content` can load this queue, but action requests require `manage_operations` (`server/routes/admin.js:79`). The screen presents dismiss/flag/remove without reflecting that extra requirement. This is a broken least-privilege workflow, not a public endpoint.
2. **CONFIRMED DEFECT, P2: “Dismiss” cannot dismiss report-only items.** It sends `unflag` (`client/src/admin/pages/Moderation.jsx:109–115`), while SQL also selects pending-report targets. A job without an admin flag receives “not flagged” conflict (`server/controllers/superAdminController.js:1080–1084`); clearing a flag still leaves pending reports. The button label suggests adjudication that does not occur.
3. **DESIGN GAP, P1: queue retrieval is unbounded and evidence is thin.** The complete grouped query has no limit/cursor (`server/controllers/adminController.js:250–277`). Cards show a two-line description and report count, without reasons or complaint evidence (`client/src/admin/pages/Moderation.jsx:92–105`). “Remove” routes to direct cancellation, coupling moderation to the Jobs financial-path gap.

### Expansion failure scenario

A mass-reporting attack floods the queue with tens of thousands of jobs. An authorized moderator loads a large payload, repeatedly tries Dismiss on report-only rows, and cannot resolve anything without broader operations grants. Senior staff cancel jobs to clear the queue, potentially affecting accepted obligations. Reports should supply allegations; Content Removals supplies visibility decisions; Jobs supplies safe commercial intervention.

### Required changes and operator design

Add bounded target-case pagination, total count, and per-target reason aggregates. Separate `clear_admin_flag`, `review_reports`, and `hide_listing` capabilities; attach commercial cancellation as an explicit handoff with existing prerequisites. Rename Dismiss to Clear internal flag unless it genuinely adjudicates reports. Persist claimed review ownership and an expected target/case version. Reuse report decisions rather than create another incompatible moderation case store.

### Operator screen design recommendations

Create a target-based triage workspace with header scope, sample time, distinct counts for internally flagged targets, reported targets, and targets awaiting evidence. Current subtitle uses loaded item count; replace it with complete scoped totals and separately display rows loaded. Search by job ID/title; filters cover flag source, reason cluster, report volume, oldest unresolved report, job lifecycle, region, and assigned reviewer. Saved views should distinguish “Reported only,” “Internal flag only,” and “Accepted work requiring commercial review.”

Columns show job identity, lifecycle, country, report reasons/count, first report age, flag source, reviewer, and evidence state. The drawer contains original listing/media, grouped reports with reporter privacy protected, prior decisions, participant/accepted-work context, and policy rationale. Display both active allegation count and previous dismissed allegations to make mass-reporting patterns visible.

Row actions must be explicit: claim review, clear internal flag, open grouped-report adjudication, hide public listing, or request safe cancellation. Preview lists the exact reports or visibility effect being changed. A moderator-only grant should allow authorized moderation effects and show why cancellation requires another function. Bulk actions may assign review or clear selected internal flags with individual versions; no bulk commercial cancellation. Require rationale for punitive visibility and link its receipt back to Reports.

After conflict refresh only the affected target and retain investigation notes. Outages retain a stale queue and disable effects. Empty must say no targets matching selected flag/report predicates; missing category/evidence should appear as an exception, not vanish silently. Mobile collapses target evidence into ordered sections; media has alt text where available, keyboard review navigation preserves focus, and RTL layouts avoid English-only reason alignment.

### Acceptance tests and owner

Trust & Safety engineering owns target review; marketplace operations owns cancellation handoff. A moderator-only account must complete permitted flag/visibility decisions without gaining general operations access. A reported-only unflagged job must never offer a misleading Dismiss action. Seed 10,000 targets: response page is bounded, totals accurate, and every target is reachable. Clear a flag with pending reports: row remains until those reports are decided. Evidence failures must show a recoverable case state. Concurrent reviewers must get one successful versioned effect and one conflict, with audit receipts linked to the underlying reports.
## 7. Enforcement

### Route and business purpose

`/admin/enforcement` records warnings, feature restrictions, and account suspensions. It must let trust staff reason about overlapping decisions and reversals without accidentally removing another team's protection. Enforcement differs from the Users account-disable toggle and from report dismissal; all three need linked evidence and consistent effective-access state.

### Verified current implementation

Issue/list/deactivate use `manage_users`; audit reads require `view_audit_log` (`server/routes/enforcement.js:14–18`). Issuing an action, applying its effect, and writing enforcement audit are transactional (`server/controllers/enforcementController.js:125–177`). Restriction deactivation now targets only the rows tied to that enforcement ID; suspension deactivation checks other active suspensions (`:388–405`). These safeguards exist and should remain. The screen has action/active filters and a deactivate confirmation (`client/src/admin/pages/AdminEnforcementDashboard.jsx:143–169`, `:380–382`). Appeals already have a persistent schema (`server/migrations/173_enforcement_appeals.sql:4–30`); it would be incorrect to recommend building appeals storage from scratch. The relevant current shared authentication regression tests include TOTP enforcement (`server/__tests__/adminAuthSecurity.test.js:54`); overlap behavior still requires targeted isolated tests.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: temporary suspension destroys underlying restriction effects.** Issuing suspension calls `liftUserRestrictions` for all active restrictions (`server/controllers/enforcementController.js:150–154`, `:63–68`). Lifting suspension clears user flags but does not restore those previously active restrictions (`:75–83`, `:396–405`). The original restriction actions can remain active while their enforcement rows are inactive.
2. **CONFIRMED DEFECT, P1: invalid restriction input broadens to “all.”** Unsupported `restrictions.type` silently defaults to `all` (`server/controllers/enforcementController.js:24–31`). A typo in “bidding” can block checkout and job posting rather than produce validation failure. Operators need explicit effect validation.
3. **DESIGN GAP, P1: overlapping suspension changes lack serialization.** Deactivation reads the action before its transaction and queries other suspensions without a user-level lock (`server/controllers/enforcementController.js:365–405`). Concurrent issue/deactivate can produce inconsistent derived user flags. Actual race outcome is **UNVERIFIED** until reproduced. Audit rationale on deactivation is a constant string (`:413`), preventing review of why a sanction was reversed.

### Expansion failure scenario

Different timezone teams apply bidding restriction and temporary suspension. The temporary suspension ends, unexpectedly removing the bidding safeguard. A reversal lacks an operator rationale. Users may show active while other enforcement records say restricted. Trust staff need one effective restriction calculation, linked to appeals and underlying reports.

### Required changes and operator design

Keep restrictions as independent active decisions; derive their effective union rather than deleting them when a stronger sanction applies. Lock the user's enforcement state during issue/reversal and recalculate suspension end from remaining decisions. Reject unsupported restriction types, require explicit expiry/reversal reason, and connect existing appeals to the case drawer. Persist expected version and original policy/evidence references.

### Operator screen design recommendations

Use a two-pane sanction workspace. Header states effective enforcement scope, snapshot time, and policy-version reference. KPI tiles are active warnings, active feature restrictions, active suspensions, and appeals awaiting review; distinguish decisions from unique affected users. Filters should include exact user/action ID, sanction type, affected feature, expiry window, policy code, issuing team, and appeal status. Saved views include “Expires this shift,” “Overlapping sanctions,” and “Appeal awaiting evidence.”

The table shows sanction ID, user identity reference, action, exact features blocked, effective/expiry times, issuing reviewer, linked report, appeal indicator, and current effect. Clicking opens a drawer with allegation/evidence, user enforcement timeline, effective-access union, live work/payment implications, and existing appeal history. A visual effect preview should show which restrictions survive a proposed reversal; do not imply that deactivating one action restores unrestricted access.

Issue warning/restriction/suspension and deactivate are explicit row actions. Require validated feature selection, policy code, reason, expiry or deliberate indefinite choice, and preview of impacted capabilities. Reversal requires rationale and expected version. Bulk actions should be limited to assigning reviews or exporting permitted case references; sanctions need individual evidence at launch. Route appeals to a separate reviewer and show the next required decision.

On conflict reload the user's full sanction set and preserve draft rationale. Retry timed-out issue requests only after operation-receipt recovery. Empty means no sanctions match filters; no appeal data must be distinguished from an appeal-service outage. Permission denial names sanction/audit access separately. Mobile stacks the effect preview above confirmation; keyboard users can inspect feature chips and deadlines, and RTL preserves chronological meaning with explicit timestamps.

### Acceptance tests and owner

Trust & Safety policy engineering owns effect composition. Issue a bidding restriction, then temporary suspension, then reverse suspension: bidding must remain blocked. Invalid feature strings must return 400 without rows/effects. Race two reversals with a new suspension: final flags equal the remaining active decision set. Reversal audit must retain actor, policy rationale, versions, and appeal reference. Existing per-action restriction reversal must remain isolated from unrelated sanctions.

## 8. Content Removals

### Route and business purpose

`/admin/content-removals` lets moderation staff remove bids and hide/restore reviews. A bid is also an offer in a work agreement; a review affects public reputation. The operator must see those consequences, distinguish reversible visibility from contractual cancellation, and retain the reason for each restoration.

### Verified current implementation

List/remove/restore all require `moderate_content` (`server/routes/admin.js:84–87`). Search is debounced, pages are bounded, and failed reads retain previous results (`client/src/admin/pages/ContentRemovals.jsx:104–124`). The removal dialog displays target evidence and requires a reason (`:46–75`). Bid/review effects and audit rows are committed together, with conditional state predicates protecting duplicate effects (`server/controllers/adminController.js:467–493`, `:529–555`, `:589–613`). Restore errors now surface (`client/src/admin/pages/ContentRemovals.jsx:148–156`). The base audit schema exists (`server/migrations/005_admin.sql:11–30`), while other review systems have separate tables; this page is not a universal content console. Shared admin authentication tests cover role/TOTP boundaries (`server/__tests__/adminAuthSecurity.test.js:28–54`), not every content consequence.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: accepted bids can be marked removed without agreement handling.** The update accepts every state except already removed (`server/controllers/adminController.js:463–475`). No job assignment, accepted agreement, payment, or cancellation prerequisite is checked. Existing job cancellation coordinates these obligations; this visibility action does not.
2. **DESIGN GAP, P2: restoration has no rationale or case reference.** The client posts an empty request (`client/src/admin/pages/ContentRemovals.jsx:150`), and audit stores rating/reviewer but no restoration reason (`server/controllers/adminController.js:605–611`). A mistaken hide can be reversed, but an appeal or coordinated restoration cannot be explained from that receipt.
3. **DESIGN GAP, P2: audit before-state can be stale.** Bid/review details are fetched before the transaction; update rechecks only removed/public state (`server/controllers/adminController.js:463`, `:474`, `:525`, `:536`). A concurrent edit can make recorded evidence differ from removed content. Reputation-cache effects are **UNVERIFIED**: these handlers do not recalculate ratings, but an independent trigger/consumer may do so.

### Expansion failure scenario

A provider's accepted bid is removed during abuse review while their assigned job remains active. Another team restores a hidden review after an appeal without recording why. Support cannot reconcile agreement status and trust staff cannot reconstruct evidence. Content Removals must link to Jobs, report decisions, reputation recalculation, and enforcement appeals.

### Required changes and operator design

Lock and snapshot the target inside the transaction. Restrict bid removal to noncontractual states or route accepted bids into safe job/financial handling. Require restoration rationale, original decision/case reference, and expected version. Verify and document reputation propagation with a targeted test before claiming correctness or a defect. Add media-review queue links to the new restaurant moderation API (`server/routes/adminRestaurantMedia.js:20–29`); reuse its existing flag/DMCA workflow rather than rebuilding it here.

### Operator screen design recommendations

Keep Bids and Reviews as explicit tabs, with a header that says these are marketplace entities and links to restaurant-media moderation. Display last successful load, matched count, hidden-review count, and accepted-bid exceptions; define counts server-side. Search supports target/job/user ID and text; filters include bid lifecycle, review visibility, reason, removal date, reviewer, and linked appeal. Save “Hidden awaiting appeal,” “Accepted bid requires job review,” and “My recent removals.”

Bid columns include job, provider, offer amount/currency, status, accepted commitment, and removal decision. Review columns show reviewer/reviewee, rating, snippet, visibility, original decision, and pending appeal. The detail drawer contains the full content snapshot, linked job and participants, prior decisions, original report/appeal evidence, and reputation propagation receipt. Avoid forcing staff to infer commercial risk from the current simple amount-only modal.

Row actions are preview removal, hide review, preview restoration, or open contractual review. Before removal show exact visibility effect and accepted-work blockers; before restoration show the original rationale and current policy checks. Both require reason and expected version. Bulk actions may assign review or hide independently eligible spam reviews after individual evidence preview; accepted bids and restoration with appeals remain single-case decisions.

Conflicts show fresh content alongside the original draft and require renewed confirmation. Failed mutations remain in the modal with retry guidance; timed-out decisions recover their receipt first. Empty means no targets under selected filters, unavailable preserves stale rows, and no access withholds evidence. Mobile presents content first and agreement warning second; use focus-managed dialogs instead of the current generic modal shell, accessible rating text, and bidi-isolated monetary/user identifiers.

### Acceptance tests and owner

Moderation engineering owns visibility; marketplace engineering owns contractual bids. Removing an accepted bid must block or coordinate a documented safe transition. Audit failure must roll back content state. Concurrent content edit/removal must record the exact removed snapshot. Restoration requires a rationale and points to its prior hide. Hide/restore a rated review and verify the public reputation pipeline's defined result before release. Restaurant media must remain on its existing correctly gated workflow.

## 9. Skills

### Route and business purpose

`/admin/skills` maintains the searchable skills vocabulary used in provider discovery and job requirements. It is reference-data governance, not provider qualification approval. At worldwide scale, a rename or deletion must preserve historical meaning and downstream matching rather than merely changing a row in a lookup table.

### Verified current implementation

The page supports name/category search, paging, edit, active toggle, and super-only hard-delete UI (`client/src/admin/pages/SkillsManager.jsx:16`, `:91–129`, `:247–258`). API gates are `manage_operations`; hard deletion checks super role (`server/routes/admin.js:666`, `:753–762`). SQL limits and offsets are bounded (`:669–670`). The initial schema has unique names, category, and active state (`server/migrations/037_skills_and_licenses_lookup.sql:5–12`). Sanitization has a later trigger (`server/migrations/197_skill_input_sanitization.sql:3–20`). Dependencies differ: business skills have a restrictive FK (`server/migrations/079_business_skills.sql:7`), jobs store skill IDs in an array (`server/migrations/080_job_required_skills.sql:6–13`), and user skills also use free-text names (`server/migrations/039_user_skills_and_tool_rentals.sql:10–18`). Pagination contract tests cover bounded admin handlers (`server/__tests__/adminPaginationContracts.test.js:8`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: schema/query mismatch in listing.** The list selects `created_at` (`server/routes/admin.js:672`), but migration 037 creates no such column and the inspected skill-altering migration 197 adds only sanitized name. A migration-built schema cannot satisfy that query. Actual production schema drift is **UNVERIFIED**; this is a repository contract defect, not a claimed live outage.
2. **CONFIRMED DEFECT, P2: creating an existing name overwrites it.** POST uses `ON CONFLICT(name) DO UPDATE` to change category and active state (`server/routes/admin.js:709–723`). An employee expecting a duplicate warning can reclassify/reactivate an established term, with no preview or expected version.
3. **DESIGN GAP, P1: taxonomy change lacks dependency and audit workflow.** Update/delete handlers write directly without audit/version receipts (`server/routes/admin.js:732–772`). Restrictive business FKs may block deletion, but job arrays and free-text user skills cannot provide equivalent referential protection. Renaming does not define aliases or historical display semantics.

### Expansion failure scenario

Regional editors create translated variants of the same skill, reclassify an existing name through POST, or delete a term still referenced by jobs. Business-linked terms error; array-based job requirements become unresolved. Direct Catalog and provider qualification use related vocabularies but cannot safely assume this lookup is their canonical identity.

### Required changes and operator design

Repair the migration/read contract with a new migration or remove unsupported fields. Make create reject duplicate canonical names and add a distinct merge/alias workflow. Introduce stable canonical IDs, translated labels, aliases, deprecation replacements, and versioned audited changes. Dependency-preview endpoints must count business FKs, job arrays, and free-text mappings before deprecation. Do not equate a skill label with license verification.

### Operator screen design recommendations

Frame the screen as a taxonomy editor. Header shows vocabulary version, editing scope, last successful load, and pending change requests. KPI chips are active canonical terms, deprecated terms awaiting replacement, unmapped legacy names, and duplicate-label candidates. Extend current name/category controls with active/deprecated state, locale, usage count, and unmapped dependency filters; save “Unused candidates,” “Missing locale,” and “Replacement required.”

The list shows immutable skill ID, localized label, canonical name, category, active/deprecated status, downstream usage, replacement ID, and last reviewed change. A drawer contains translations/aliases, dependency counts by module, sample linked jobs/businesses, qualification notes, and revision history. Current category autocomplete can remain, but category clearing must have an explicit remove option rather than silently preserving `COALESCE` values.

Actions are propose create, edit labels, reclassify, deprecate with replacement, merge aliases, and inspect deletion eligibility. Preview duplicate names and affected modules before confirmation. Publishing a rename must show before/after labels and expected version. Hard delete requires zero dependencies and a typed identity confirmation; default deprecation preserves IDs. Bulk operations may recategorize or deprecate after per-term previews, with excluded dependencies and receipts.

Conflict recovery compares saved versus edited fields and keeps translation drafts. Duplicate create opens the existing term instead of overwriting it. Empty means no vocabulary matches, while migration/query failure says taxonomy unavailable with editing disabled. No access describes taxonomy authority without offering broad user-management grants. On mobile place term identity and dependency count above the editor; provide labeled locale tabs, Arabic text direction within fields, keyboard autocomplete selection, and screen-reader warnings for irreversible deletion.

### Acceptance tests and owner

Marketplace taxonomy/data governance owns vocabulary; discovery engineering owns mappings. Apply migrations to an isolated empty schema: list must succeed. Duplicate POST must leave category/active state unchanged. Renaming preserves job/business references and legacy aliases; deprecation removes new selection while historical jobs remain readable. Hard delete with any dependency must return a specific blocker. Every change records actor/reason/version; conflicting edits produce 409 and no partial taxonomy change.
## 10. Support Tickets

### Route and business purpose

`/admin/support` handles asynchronous cases, public submissions, internal notes, and customer replies. It must give each obligation an accountable handler and recoverable communication history. This ticket workflow is separate from Live Support conversations, although linking and escalation should carry context between them.

### Verified current implementation

Reads/claim/status use `manage_support`; replying uses `message_users` (`server/routes/admin.js:280–288`). Claims now reassert assignment and nonterminal status in the update, and release rechecks ownership (`server/controllers/supportController.js:592–616`, `:650–664`). The former claim race is fixed and covered by `server/__tests__/supportClaimT10Repro.test.js:35–90`. Migration 600 prevents closed/resolved cases from jumping directly into active work (`server/migrations/600_support_ticket_terminal_integrity.sql:10–26`). Reply handling supports optional UUID idempotency and checks ownership/terminal state (`server/controllers/supportController.js:764–822`). The screen has priority/owner/status filters, detail actions, realtime refresh, and pagination controls (`client/src/admin/pages/SupportTickets.jsx:829–859`, `:640–645`, `:901`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: pagination controls send the wrong contract.** The browser sends `page` and `limit` (`client/src/admin/pages/SupportTickets.jsx:591–592`); the controller consumes `offset`, defaulting to zero, and never reads page (`server/controllers/supportController.js:417–422`, `:502`). Clicking subsequent pages reloads the first page despite the newly added controls. This is a current integration defect, not the old absence of controls.
2. **CONFIRMED DEFECT, P1: reply idempotency is not used by this UI.** The composer sends only content/internal flag (`client/src/admin/pages/SupportTickets.jsx:297–300`). A committed reply with a lost response can be resent as a second message because the server permits a null client ID (`server/controllers/supportController.js:764–767`, `:801–808`).
3. **DESIGN GAP, P1: status changes and reply effects are not one ownership/versioned transition.** Status updates target ID alone (`server/controllers/supportController.js:692–697`). Reply checks owner, inserts message, and updates case separately (`:778–850`). A transfer/close between those steps can produce misleading ownership or partially recorded reply effects. Terminal DB protection exists but does not make these operations atomic.

### Expansion failure scenario

A team sees 1,000 urgent cases but can navigate only the first fifty. A network timeout prompts a duplicated reply; another employee closes the case while the original handler is composing. Support SLA, Live Support handoffs, and Customer360 now disagree about ownership and last customer response.

### Required changes and operator design

Align page-to-offset conversion or adopt a cursor response end to end. Generate a stable client-message UUID for each draft and retain it through retries. Lock or version case status/owner through message creation and case effects; return separate durable-send and external-delivery receipts. Keep existing claim/release guards and terminal trigger. Make assignment/closure actions enforce the owner's authority and require a resolution reason.

### Operator screen design recommendations

Keep the current inbox/detail arrangement, but header scope and counts must distinguish active company obligations from waiting-customer cases. Show last queue refresh separately from connection status. KPI tiles are unassigned urgent, mine due today, waiting-customer followups due, and unresolved beyond target; clicking applies their exact predicates. Existing status/priority/owner filters should gain category, source, last customer reply, due interval, and exact ticket number, with saved “My due cases” and “Unowned urgent” views.

Table columns include ticket number, subject/category, customer, priority, status, accountable agent, last customer/admin event, response deadline, and communication failure. The drawer separates customer-visible thread, clearly marked internal notes, linked conversation/Customer360 context, assignment history, next promised action, and resolution summary. Display whether a message is saved, externally queued, delivered, or failed rather than collapsing these into sent.

Row actions are claim, release, request transfer, reprioritize, reply, wait for customer, resolve, and explicitly reopen. Preview transfer/closure with current owner and outstanding followups; resolution requires reason/summary. Bulk actions may assign or reprioritize with per-case versions and receipts; customer replies/closure remain individual. Preserve drafts and UUIDs on timeout and recover by receipt before retrying.

On 409 show new owner/status and offer save draft or request handoff. Empty distinguishes no matching cases from all selected work completed. A statistics failure must not erase an otherwise usable inbox, unlike the current combined load. No access differentiates read/claim from reply permission; unavailable retains stale cases with actions disabled. Mobile opens a full-height drawer, internal-note mode has a persistent text warning, keyboard users receive live send status, and RTL isolates ticket IDs and customer contact.

### Acceptance tests and owner

Customer support engineering owns the workflow. Seed 125 cases: pages 1–3 contain distinct complete records. Lose a reply response and retry: one message and one notification receipt remain. Race transfer/close/reply: stale actions return 409 without partial messages or owner overwrite. Existing claim-race tests stay green. A stats outage must preserve a loaded list and display degraded statistics; resolution/reopen must satisfy migration 600 and retain their decision history.

## 11. Live Support

### Route and business purpose

`/admin/support/chat` is the live conversation workspace for platform support, embedded around the shared conversation component. It must let agents accept work within capacity, respond through the right channel, and hand over conversations without losing context. Availability preference, websocket presence, and actual staffed capacity are different facts.

### Verified current implementation

The wrapper already distinguishes live-ready, connecting, and offline preference (`client/src/admin/pages/SupportAgentChat.jsx:8–19`). Platform-wide list now requires `manage_support` or eligible platform employment, with customer fallback for grantless admins (`server/routes/support.js:282–303`); the historical pure-role list defect is fixed. Claims lock agent capacity and conditionally acquire an unassigned conversation (`server/controllers/conversationAssignmentController.js:50–101`). Persistent message idempotency and lifecycle history exist (`server/migrations/394_support_message_idempotency.sql:4–9`; `server/migrations/405_support_conversation_lifecycle_history.sql:1`). Tests cover lifecycle transitions and audited/replayed email delivery (`server/__tests__/supportConversationStateMachine.test.js:27–36`; `server/__tests__/supportConversationEmail.test.js:23–119`). Customer360 mock repair is historical resolved work, not a new defect.

### Concrete flaws and gaps

1. **DESIGN GAP, P1: a bounded conversation count still includes entire transcripts.** Global list aggregates every message into JSON before limiting conversations (`server/routes/support.js:343–374`). Fifty long-running cases can produce a large sensitive payload. List metadata should not require all message content; actual payload/capacity impact is **UNVERIFIED**.
2. **CONFIRMED DEFECT, P2: delegated support authority is omitted from list resolution.** Inline grant lookup considers only direct grants (`server/routes/support.js:291–299`), unlike common permission middleware's validated delegations (`server/middleware/adminAuth.js:143–156`). An authorized delegate can fall into a customer-only view and mistake it for a clear operations queue.
3. **DESIGN GAP, P2: supplementary evidence failures become empty state.** Customer360/lifecycle rejected requests become null/empty; reminder/template/knowledge failures also become empty arrays (`client/src/components/support/SupportConversationWorkspace.jsx:284–299`, `:307–318`, `:384–400`). These are production UI error states distinct from the fixed mock. An agent cannot tell “no followup/history” from “source unavailable.”

### Expansion failure scenario

Hundreds of agents reconnect during a provider incident. Conversation metadata calls retrieve full histories; some context requests fail silently. An agent misses an existing promise and sends an inappropriate followup. Support Tickets, SLA monitoring, channel-delivery recovery, and workforce shifts must share the handoff evidence.

### Required changes and operator design

Return metadata-only lists with cursor, last-message excerpt, unread count, SLA deadline, and source status. Fetch transcript pages only for the selected conversation. Reuse the common authority resolver and expose per-context loading/failed state. Preserve existing transactional capacity claim, channel recovery, idempotency, and lifecycle services. Measure reconnect behavior with the new isolated scale harness rather than treating its existence as a capacity result.

### Operator screen design recommendations

Use a three-column desktop layout: queue, selected transcript, and context/action panel. Header should show employer/queue scope, staffed availability, socket connection, current chats versus capacity, and last successful queue sync. KPIs are waiting beyond first-response target, mine awaiting agent reply, channel sends failing, and handoffs awaiting acceptance. Preserve channel search and paging while adding department, language, age, agent, and response-due filters; saved views are “My replies due” and “Unclaimed language match.”

Queue rows show conversation/customer reference, channel, language, subject excerpt, unread count, wait age, SLA deadline, assignment, and failure chip. The context panel contains Customer360, related ticket/job references, lifecycle/assignment events, promises/reminders, and channel-delivery receipts, each with its own unavailable status. Transcript loading should use newest-page-first with earlier-history controls rather than entire histories in list payloads.

Actions are claim within capacity, reply/internal note, transfer with summary and destination, schedule followup, request escalation, resolve with reason, and retry a specific failed channel send. Preview recipient/channel before sending; transfer remains pending until another agent accepts or a supervisor explicitly overrides. Bulk actions only triage/assign queue cases, never send mass transcript replies. Maintain a stable message ID and visible saved/queued/delivered/failed states.

On disconnect retain draft and show reconnecting; recover transcript and receipts before resending. Capacity/ownership conflict displays the new assignment, not generic failure. Empty states distinguish no eligible work, no queue access, and missing employment; unavailable context must never read as no history. Mobile becomes queue→transcript navigation with a context sheet. Provide keyboard composer shortcuts, announce new messages without stealing focus, and render customer Arabic text with appropriate direction independently of interface locale.

### Acceptance tests and owner

Support platform engineering owns live staffing and channel evidence. Two concurrent claims at capacity must yield one eligible assignment. A 50-case list with 10,000 messages per case must stay metadata-bounded. Direct and delegated authority must produce equivalent eligible views. Fail Customer360/reminders independently: labeled unavailable panels remain retryable. Reconnect and replay sends must create one message/delivery; unresolved transfer cannot remove accountability. Exercise browser keyboard/RTL use and the isolated reconnect workload with declared payload/latency limits.

## 12. Quote Requests

### Route and business purpose

`/admin/quote-requests` is intake triage for customer service requests. It records contact preferences, requested service, review state, and notes before Direct dispatch/quotation. Staff need a reliable lead queue and a clear handoff to pricing and scheduling; financial markers must not be mistaken for provider-confirmed payment.

### Verified current implementation

List, detail, and update now share `manage_operations` (`server/routes/quoteRequests.js:10–12`). Detail loading guards rapid selection (`client/src/admin/pages/QuoteRequestsInbox.jsx:82–104`). Omitted currency now stays null so update preserves the stored value (`server/controllers/quoteRequestsController.js:648–660`, `:846`); the prior USD-reset defect is fixed and tested (`server/__tests__/quoteCurrencyT12Repro.test.js:29–67`). Money/status validation and confirmed-amount guard exist (`server/controllers/quoteRequestsController.js:772–807`; `server/__tests__/quoteRequestsAuditGuards.test.js:154–231`). Scheduling has a DB advisory-lock overlap guard (`server/migrations/420_direct_schedule_conflict_guard.sql:17–36`). The original persistent intake schema is migration 374 (`server/migrations/374_quote_requests.sql:4–33`).

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P2: KPI counts mix total scope with visible-page scope.** Total is server-provided, but new/active tiles count only the current twenty requests (`client/src/admin/pages/QuoteRequestsInbox.jsx:198–213`). Paging changes apparent intake workload without changing the underlying queue.
2. **CONFIRMED DEFECT, P1: confirmed price currency remains mutable.** The existing guard checks amount only when amount/payment is supplied (`server/controllers/quoteRequestsController.js:775–807`). Explicit currency alone bypasses that guard and writes through `COALESCE` (`:846`). A confirmed 10,000-cent price can be relabeled another currency. This changes a quote record, not proven movement of money.
3. **DESIGN GAP, P1: general PATCH is not versioned and can erase omitted notes.** It requires status, defaults notes to empty text, and writes `admin_notes=$2` unconditionally (`server/controllers/quoteRequestsController.js:639–640`, `:813`, `:843–844`). Direct scheduling edits using the same controller can clear notes; concurrent intake editors overwrite state. Audit is limited to schedule/assignment changes (`:877–885`), leaving notes/status without equivalent history.

### Expansion failure scenario

Regional intake agents triage the same request while dispatch changes its schedule. Notes disappear, last writer wins, and the new-request tile understates the backlog on later pages. Pricing may accidentally relabel confirmed value. The shared record ties this tab to Direct Ops, Catalog eligibility, Service Areas, and customer communications.

### Required changes and operator design

Add complete status-summary counts matching filters, versioned partial-field semantics, decision history, and intake ownership. Lock price currency alongside confirmed amount; route approved monetary corrections through a separate explicit amendment with evidence. Preserve the fixed omitted-currency behavior and DB scheduling guard. Quote approval/payment confirmation should be distinct domain actions with clear receipts, not a broad status dropdown masquerading as settlement.

### Operator screen design recommendations

Keep the two-pane inbox, adding effective intake scope, last list/detail refresh, and a visible dispatch-handoff status in the header. KPI definitions should be all matching new requests, requests awaiting staff response, and overdue promised contacts. Replace page-local calculations with server aggregates. Search supports request/reference/email/service and exact ID; filters add country/service area, contact method, intake age, owner, assigned dispatch member, and catalog linkage. Save “New unowned,” “Contact promised today,” and “Ready for dispatch.”

Rows show reference, customer, service/category, location, preferred contact, received age, intake owner, status, and next promised contact. Drawer sections are original request/photos, customer/contact consent, service-area/catalog evidence, staff notes/history, quotation terms, and Direct handoff. Existing notes/status editing should show changed fields and current version; a read-only price block includes ISO currency and confirmation provenance.

Actions are claim intake, record contact outcome, add append-only note, request quotation, and hand off to dispatch. Preview the fields and notification effect before state change. Currency/amount corrections after confirmation require a dedicated authorized amendment, rationale, and before/after terms. Bulk actions may assign leads or mark contact attempts with per-request receipts; pricing/payment states remain individual.

Conflict recovery compares versions and preserves unsaved notes. A list failure must show stale results explicitly, and a detail failure cannot leave another person's data under the selected identity. Empty means no requests match; no-access means intake grant absent; unavailable catalog/coverage means eligibility unknown rather than service approved. Mobile makes list/detail separate navigable views, RTL uses contact bidi isolation, and photo evidence/notes remain keyboard-accessible with clear form labels.

### Acceptance tests and owner

Service intake engineering owns partial edits; Direct pricing owns financial terms. Notes-only edits preserve currency, and currency-only edits on confirmed quotes fail. Schedule-only PATCH preserves notes. Two editors receive a deterministic conflict instead of silent overwrite. New/active KPI counts remain unchanged across pagination and match server predicates. Every contact/handoff creates history and a named next queue; notes/status changes must be auditable without relying on calendar-only events.
## 13. Direct Ops

### Route and business purpose

`/direct/admin` is the Direct service-operation portal, with inbox, calendar, work-order, payment-review, customer, and management subroutes. It coordinates company service delivery using shared quote-request records. Staff need to keep a customer commitment, dispatch assignment, payment proof, and actual completed work distinct.

### Verified current implementation

Routes are mounted in the main SPA (`client/src/App.jsx:357–369`), rendering `DirectAdminPortalPage`. Admin APIs use `manage_operations`, with settings/export/audit separately gated (`server/routes/direct.js:80–112`). Calendar range, pages, and page sizes are bounded (`server/controllers/directController.js:1883–1895`). Scheduling uses persistent blocks/history and a database overlap guard (`server/migrations/416_direct_calendar_blocks.sql`; `418_direct_calendar_audit_history.sql`; `420_direct_schedule_conflict_guard.sql:17–36`). Slot capacity/hold recheck tests already exist (`server/__tests__/directSlotEngine.test.js:45`, `:131`). The browser has paginated calendar loading and export (`client/src/pages/DirectAdminPortalPage.jsx:1047–1069`). This is a substantial dispatch foundation, not an empty portal.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: customer-facing Direct routes bypass admin grant/MFA handling for role-based staff access.** `/requests/:id` and message routes have ordinary authentication only (`server/routes/direct.js:70–72`), while `canAccessRequest` permits any admin/super-admin role (`server/controllers/directController.js:527–530`). These paths serve details/messages to staff denied equivalent admin endpoints. Common `requireAdmin` checks are absent on this alternate staff branch; anonymous access is not alleged.
2. **CONFIRMED DEFECT, P1: payment-proof confirmation creates completion evidence.** Confirming proof sets `completedAt` to now if absent (`server/controllers/directController.js:1767–1779`). A receipt review can therefore produce a work-completion timestamp without completing the service. The operator's commercial record becomes misleading.
3. **DESIGN GAP, P1: manual payment markers have weaker decision controls than their significance.** Proof confirmation requires operations authority and a note is optional (`server/routes/direct.js:78`; `server/controllers/directController.js:1767`). It checks cancellation but not submitted proof/evidence reconciliation. This is marking a request, not proof of Stripe capture or settlement. Quote PATCH shares the currency/partial-edit gaps documented in Tab 12.

### Expansion failure scenario

A dispatch-only employee reviews payment through an alternate authenticated route, marks it confirmed, and the customer history appears to contain completed work. Multi-country crews rely on a calendar with versionless shared quote edits. Direct Ops depends on Catalog capacity, Service Areas, Quote Requests, customer messaging, and financial evidence reconciliation.

### Required changes and operator design

Apply one staff access resolver to both customer and admin routes, retaining customer ownership. Separate proof accepted, funds verified, and work completed with independent timestamps/authority. Require evidence references and explicit reconciliation outcome before financial confirmation. Keep scheduling guards, assignee pools, blocks, and history; use versioned amendments for shared quote/dispatch data.

### Operator screen design recommendations

Treat the portal as a dispatch workspace with header territory, dispatch timezone, date range, last schedule refresh, and capacity-source status. KPI definitions are unassigned accepted jobs, today's scheduled work, overdue arrivals, and unresolved payment evidence; calculate them over displayed scope rather than all lifetime requests. Provide saved views for “Today by crew,” “Unassigned tomorrow,” and “Payment evidence exception.” Search/filter by reference, city/service area, skill/catalog service, assignee, status, time range, and financial blocker.

Calendar lanes represent assignees or crews, with explicit timezone, duration, travel buffer, and unavailable blocks. An adjacent queue shows reference, service, customer, local start, crew, commercial state, proof state, and next dispatch decision. Selecting work opens sections for customer/access instructions, scope/accepted quote, assignment/capacity, scheduling history, messages, and payment evidence. Keep financial records accessible by authorized links rather than turning calendar actions into settlement controls.

Actions are assign, reschedule, acknowledge arrival, start, complete with work evidence, contact customer, or request cancellation. Preview conflicts and affected customer commitments before rescheduling; require reason/version and confirm notification. Proof review shows amount/currency, uploaded evidence, provider reference, reviewer, and separate verification result. Bulk actions may assign eligible unassigned work after capacity preview; no bulk payment confirmation or completion.

A schedule 409 shows competing booking/block and retains the draft. Recover uncertain writes by operation receipt before retrying. Empty calendar explicitly states no scheduled work in the range, with unscheduled queue still visible. Unavailable capacity disables booking; no access distinguishes settings/audit/financial denial. Mobile uses an agenda instead of narrow lanes, offers accessible time inputs, and renders RTL customer text without reversing chronological order.

### Acceptance tests and owner

Direct operations engineering owns dispatch; financial operations owns evidence verification. An admin lacking operations grant or TOTP must not access another customer's Direct details through alternate routes. Proof confirmation must never create work-completion time. Concurrent booking/block changes must return precise conflicts and preserve one assignment. Customer notifications must reference committed schedule versions. Test calendar range/pagination beyond 100 jobs and currency/notes preservation through dispatch-only updates.

## 14. Direct Service Areas

### Route and business purpose

`/admin/direct-service-areas` configures where Direct service can be requested through geographic radius checks. This is an offer-of-service boundary, not evidence that a crew is available. A worldwide launch requires country/postal semantics and a controlled activation decision connected to service-specific capacity.

### Verified current implementation

Admin list/create/update require `manage_operations` (`server/routes/direct.js:101–103`). The page supports editing radius/anchor coordinates, ZIP lookup, active state, notes, and filtered coverage cards (`client/src/admin/pages/DirectServiceAreas.jsx:174–210`). Public listing projects area data separately (`server/controllers/directController.js:1146–1155`). Availability uses haversine distance over active areas (`server/services/directServiceAreas.js:197–223`). The persistent table and geocode cache are migration 377 (`server/migrations/377_direct_service_areas.sql:5–33`). Tests exist for the service and public page (`server/__tests__/directServiceAreas.test.js`, `directServiceAreaPage.test.js`); their existence is not worldwide coverage proof.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: accepted coordinates are not geographically bounded.** Validation requires finite latitude/longitude but no ±90/±180 bounds (`server/services/directServiceAreas.js:227–239`). Schema stores numeric values without corresponding range checks (`server/migrations/377_direct_service_areas.sql:9–11`). A typo can activate meaningless coverage.
2. **DESIGN GAP, P1: address model is US-specific.** ZIP geocoding uses `/us/`; address geocoding forces `countrycodes=us` (`server/services/directServiceAreas.js:106–126`). The input strips nondigits and truncates to five (`client/src/admin/pages/DirectServiceAreas.jsx:179`). This cannot represent many worldwide postal systems; the limitation is scope support, not an outage in supported US locations.
3. **DESIGN GAP, P1: publishing coverage has no version/impact/audit control.** Update reads a row then rewrites all normalized fields by ID (`server/services/directServiceAreas.js:273–305`); it has no expected version or transactional audit. Active input is boolean-coerced, so string `false` becomes true (`:248`). Coverage availability is geometric only, distinct from Catalog/Slot Engine capacity.

### Expansion failure scenario

A regional editor activates an oversized radius or unintended true state while another narrows coverage. Customers request service outside staffed territory, while foreign postal addresses fail or are mis-geocoded as US. Quote intake and Catalog advertise inconsistent eligibility, and operators cannot reconstruct the launch decision.

### Required changes and operator design

Validate geographic bounds and strict boolean types in API and schema. Add country, postal format, timezone, supported services, effective dates, and versioned activation history. Introduce preview-impact and point-check endpoints with provider/confidence information; preserve explicit supported-US mode until international geocoding is verified. Keep radius checks, but distinguish covered, requestable, and currently bookable.

### Operator screen design recommendations

Replace the coordinate-first form with a coverage editor alongside map and textual area list. Header identifies country/territory, editing version, published-versus-draft coverage, and last geocode/capacity refresh. KPI chips show active areas, uncovered demand, pending activation changes, and areas without staffed services; geometric area count must not be labeled available crews. Search by area name/postal anchor; filters include country, active/draft state, supported service, and pending review. Save “Launch pending,” “Capacity missing,” and regional coverage views.

List columns are area ID/name, country/postal anchor, shape/radius with units, supported services, activation dates, version, and last approver. Selecting opens boundary/coordinate details, provider/confidence, sample address checks, overlapping areas, linked catalog capacity, affected open requests, and change history. Supply a text equivalent for every map geometry so operators can review without mouse/map access.

Actions are draft boundary, test addresses, preview expansion/contraction, request activation, activate/deactivate, and restore a prior version. Preview includes affected scheduled commitments and newly allowed/denied sample locations. Require reason/version and explicit confirmation before publishing. Bulk changes may deactivate selected areas only after per-area impact review and named responsible queue; editing an anchor must not silently re-enable coverage.

On geocoder failure preserve existing coordinates and show provider unavailable; never treat it as out-of-area. Conflicts show the newer boundary and allow draft merge. Empty means no configured areas under the chosen country, while no matches invites filter reset. No access is operations configuration denial; unavailable coverage prevents launch decisions. Mobile uses text-first boundary cards, keyboard-accessible address testing, localized kilometer/mile display, and RTL-compatible coordinate fields with signed values isolated.

### Acceptance tests and owner

Regional launch operations and geo-platform engineering jointly own coverage. Reject latitude 91, longitude 181, and string booleans without writes. US ZIP and approved non-US postal fixtures must resolve only within their explicit country. Two edits yield version conflict rather than lost boundaries. Activation audit records before/after geometry and sample effects. Deactivation must preserve existing scheduled commitments through an explicit operations handoff; failed geocoding must never overwrite valid coordinates.

## 15. Direct Catalog

### Route and business purpose

`/admin/direct-catalog`, also `/direct/admin/catalog`, manages service/tool categories, translated content, pricing, lifecycle, and staffing preferences. It determines what customers can see, request, or book. Catalog publishing must keep marketing claims consistent with actual availability and prevent a shortcut archive from bypassing lifecycle safeguards.

### Verified current implementation

APIs require `manage_operations` (`server/routes/direct.js:88–100`). The UI has five-language validation, review issues, lifecycle filtering, and bulk-transition confirmation (`client/src/admin/pages/DirectCatalog.jsx:121–153`, `:252`). Capability derivation already distinguishes visible/requestable/bookable and checks lifecycle, operational flag, pool, and capacity (`server/services/directCapability.js:47–87`). Single-save transactions lock the row, optionally compare `expectedUpdatedAt`, and block retiring categories with live children (`server/services/directCatalogService.js:663–708`). Bulk transition locks selected rows and validates translations (`:817–835`). Migration 414 supplies lifecycle foundations; capacity/pool migrations 589 and tests `server/__tests__/directCapability.test.js` / `directCatalog.test.js` cover existing behavior. Do not recommend rebuilding lifecycle or translation guards.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: archive bypasses category retirement prerequisites.** The archive route calls `removeEntity` (`server/controllers/directController.js:688–693`), which directly retires the entity without the live-child check or transition validation (`server/services/directCatalogService.js:763–778`). It can hide a category containing live services even though ordinary save refuses that transition.
2. **CONFIRMED DEFECT, P2: the UI does not use the existing edit-conflict mechanism.** Single save supports `expectedUpdatedAt`, but the form/payload does not submit it (`client/src/admin/pages/DirectCatalog.jsx:150–152`; `server/services/directCatalogService.js:668–677`). Serialized writes still overwrite another editor's full record when no expected value is provided.
3. **DESIGN GAP, P1: admin listing is whole-catalog and staffing failures look empty.** It selects all three entity tables and enriches every service (`server/services/directCatalogService.js:514–548`). Pool load failure becomes zero pools (`:523–524`); browser assignee failure becomes empty (`client/src/admin/pages/DirectCatalog.jsx:104–113`). This can look like configuration removal rather than a dependency outage. Measured scale impact is **UNVERIFIED**.

### Expansion failure scenario

Regional editors publish services while another archives the category. Live children become invisible, staffing enrichment fails, and an editor overwrites translations from an old form. Quotes and Slot Engine may still reference those services. Service Areas, Skills, translated marketing, dispatch capacity, and open bookings must remain linked in publishing previews.

### Required changes and operator design

Route archive through the existing guarded transition service; require expected version for edits and selected-version receipts for bulk changes. Add server-paged admin search/review summaries and explicit staffing-source availability. Show derived public capability reasons alongside preferences. Preserve existing AI preview/apply separation, translation checks, transactional audit, and capacity engine.

### Operator screen design recommendations

Keep category navigation, list, and editor, but header shows editing territory/locale, catalog version, last source refresh, and pending publication changes. KPI tiles are items needing translation/review, live but not requestable, bookable preference without capacity, and retirement blocked by dependencies. Filters should use server search with category, lifecycle, locale issue, operational state, pool/capacity reason, and service-area association. Save “Translation blockers,” “Live without crew,” and “Retirement review.”

List columns show immutable ID/slug, localized title, category, price with ISO currency, lifecycle, derived visible/requestable/bookable badges, staffing status, and revision. Drawer sections cover names/descriptions, pricing/terms, coverage, crew pool/slot rules, linked requests/bookings, publication history, and AI proposal diff. Preserve current accessible locale tabs, while Arabic editing direction is independent from tab order. A zero crew count must be visibly different from crew-service unavailable.

Actions are draft/save, preview public card, transition lifecycle, manage crew pool, and request guarded archive. Preview must show customer-visible changes, affected open bookings, missing locales, and blocked prerequisites. Bulk transitions show each selected version and exact effects; provide separate confirmation for cascading child pauses. AI apply requires selected field diff review and cannot implicitly publish.

A 409 retains translation drafts and opens side-by-side current/edited values. Failed staffing data disables capacity-dependent publishing decisions, not text drafting. Empty means no items match filters; no access names catalog authority; source outage retains a stale list with publication disabled. Mobile makes list/editor separate views, exposes capability explanations as text, and supports keyboard row selection and focus-safe transition confirmation.

### Acceptance tests and owner

Direct catalog engineering owns lifecycle; regional service operations owns launch readiness. Both ordinary retire and archive must reject categories with live children unless an explicit guarded cascade applies. Two UI edits must send versions and yield one conflict. Failed pool lookup must display unavailable, never confirmed zero staffing. Paginated admin review reaches all items without full catalog transfer. Verify published five-language cards, capability invariants, and existing bookings after pause/retirement using isolated fixtures.
## 16. Messages

### Route and business purpose

`/admin/messages` is staff-to-user correspondence, distinct from Live Support and private marketplace chat. Operators need continuity across staff handoffs, complete message history, and truthful delivery/read states. A supervisor inspecting another employee's conversation must not accidentally start a different conversation under their own identity.

### Verified current implementation

APIs require `message_users` (`server/routes/admin.js:656–658`). Regular admins list their own conversations; super admins can list all (`server/controllers/adminMessageController.js:36–80`). Thread loading is abortable and sequence-guarded (`client/src/admin/pages/AdminMessages.jsx:79–99`). Sending sanitizes content, validates optional UUIDs, rejects admin recipients, and transactionally finds/creates a thread (`server/controllers/adminMessageController.js:195–249`). Message idempotency exists and has replay tests (`server/__tests__/adminMessageIdempotency.test.js:99–144`). Migration 060 prevents duplicate jobless participant pairs (`server/migrations/060_conversations_null_job_unique.sql:11–13`). Thus duplicate-thread protection and server retry support already exist; browser integration is the residual problem.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: displayed thread identity differs for supervisor inspection.** Super admins list another admin's conversation, but click loads by user ID (`client/src/admin/pages/AdminMessages.jsx:102–104`). Server resolves a thread for the current admin/user pair (`server/controllers/adminMessageController.js:126–132`). The selected row can show another employee's identity while the transcript is empty or belongs to the supervisor's own conversation.
2. **CONFIRMED DEFECT, P1: unread is cleared beyond what was displayed.** GET marks all unread messages read before returning oldest-first limited history (`server/controllers/adminMessageController.js:146–163`). Client requests no history offset and ignores total (`client/src/admin/pages/AdminMessages.jsx:88–90`). A 200-message conversation can mark recent unseen messages read while displaying only its first fifty.
3. **CONFIRMED DEFECT, P1: the browser omits retry identity and loses failed draft text.** Send submits content alone, clears composer before response, and removes the optimistic bubble on failure (`client/src/admin/pages/AdminMessages.jsx:119`, `:133–145`). A response timeout can duplicate an already saved message on resend. List also hard-limits 100 conversations without exposing total/paging (`:56–57`).

### Expansion failure scenario

A supervisor responds to an escalated correspondence but receives a different thread. Recent customer replies are marked read without being visible, and timeout-driven resends create duplicates. Support handoffs and case audit cannot explain which employee actually communicated. This workflow must link into ticket/case history without giving ordinary employees global private-message surveillance.

### Required changes and operator design

Resolve inspection by immutable conversation ID with participant/supervisor authority, and make send identity explicit. Use newest-first cursor pages plus a separate acknowledge-through-message-ID endpoint. Integrate existing client-message UUID support and recover receipts before retries. Add list pagination, employee handoff/ownership state, and delivery-state linkage without replacing the established messaging service.

### Operator screen design recommendations

Keep inbox/transcript layout, but header shows “My correspondence” or an explicitly authorized supervisor scope, current sender identity, connection state, and last inbox sync. KPI chips are unread threads, customer replies awaiting staff response, failed deliveries, and handoffs awaiting acceptance. Existing recipient search should gain conversation ID, unread/reply-needed state, assigned employee, linked case, and last-contact range; saved views include “My followups” and “Supervised escalations.”

Inbox rows show conversation ID, customer, responsible staff member, linked case, latest excerpt, latest time, unread count, and delivery exception. Selecting opens that exact conversation, with newest messages visible and “Load earlier” preserving scroll position. A context drawer contains recipient/contact preference, participant/sender identities, case history, handoff notes, and delivery/read receipts. Viewing another employee's thread must display a prominent supervisor banner and require an explicit choice before replying as self or using an approved shared sender.

Actions are send, save draft, create/link case, request handoff, acknowledge displayed messages, and retry a failed delivery by message ID. Bulk actions may assign threads or mark only explicitly displayed items acknowledged; no bulk customer message sends. Before sending show recipient/sender/channel, enforce length, and preserve a stable UUID with optimistic pending bubble. Failure keeps editable draft and a retryable bubble; timeout first checks persistence.

Empty means no threads in the selected scope, while a thread with no messages invites a clearly identified first contact. No access withholds transcript; unavailable history keeps the selected identity and disables sending until context is recovered. Mobile separates inbox and transcript with a stable back route. Keyboard composer use, live delivery announcements, bidi-isolated IDs, and per-message language direction prevent RTL confusion.

### Acceptance tests and owner

Messaging engineering owns identity/history; customer operations owns handoff policy. Supervisor selection must return the exact listed conversation. With 200 messages, newest unread content must display and only acknowledged IDs become read. More than 100 conversations must remain reachable. Lost send response/retry must yield one message/audit/notification. Failed sends preserve draft and UUID. Unauthorized staff cannot inspect unrelated conversations; existing participant-pair uniqueness and replay tests must remain valid.

## 17. Search

### Route and business purpose

`/admin/search` locates entities across users, jobs, messages, disputes, payments, tickets, reviews, and bids. It should be a safe discovery interface into domain workflows, not an alternative route around their permissions. At six million users, operators need exact identifier lookup, truthful per-source completeness, and controlled investigative access.

### Verified current implementation

The API requires `view_search_logs` (`server/routes/admin.js:295`). Search validates query length, escapes wildcards, and bounds per-type pages (`server/controllers/adminSearchController.js:38–83`). Payment/message type grants now exist: explicit unauthorized types return 403, default types exclude restricted domains (`:17–20`, `:55–71`). Historical unqualified payment-search access is fixed and covered by `server/__tests__/federatedSearchT17Repro.test.js:28–80`. The UI has abort/sequence handling and per-type pages (`client/src/admin/pages/AdminSearch.jsx:414–479`). Migration 657 adds message trigram indexing (`server/migrations/657_message_search_trgm_index.sql:12–13`); index presence is not measured multi-domain performance.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: current UI defaults contradict restricted-type behavior.** All types start selected and the browser always sends them explicitly (`client/src/admin/pages/AdminSearch.jsx:404`, `:440`). An ordinary search-only employee gets 403 on their initial search rather than automatic safe exclusions. The server fix is correct for explicit requests, but the UI is not permission-aware.
2. **CONFIRMED DEFECT, P1: residual message scope remains broader than correspondence authority.** `manage_support` permits searching the generic `messages` table with no conversation-participant predicate (`server/controllers/adminSearchController.js:18`, `:143–156`). Ordinary Messages APIs restrict threads to the employee's own correspondence (`server/controllers/adminMessageController.js:75–76`, `:129`). Adding a type grant did not align record scope. Other entity types also lack equivalent domain gates in the requirements map.
3. **CONFIRMED DEFECT, P2: failed sources become zero matches.** Rejected queries are extracted as empty/zero (`server/controllers/adminSearchController.js:306–312`). Response has no failed-source flags. Empty later pages also erase totals because count comes from the first returned row. An operational search can appear complete while a domain failed.

### Expansion failure scenario

A search-only employee cannot use initial defaults. A support grantee with search access reads unrelated private marketplace messages. During a database slowdown, failed domain searches appear as no results and the investigator wrongly closes a case. Users, financial records, disputes, participant chat, and purpose-limited investigation access must use matching authority and evidence boundaries.

### Required changes and operator design

Return permitted entity types and field scopes from one shared authority resolver, including valid delegations. Scope records before querying, with elevated private-content search tied to approved investigation purpose. Separate exact-ID lookup from broad substring search. Return per-domain success/unavailable/denied status, stable counts/cursors, and search receipt. Keep query bounds/escaping and indexes; benchmark realistic cardinality rather than calling output limits bounded query cost.

### Operator screen design recommendations

Header should show effective search scope, approved investigation purpose where required, submitted query, and source completion time. Type chips come from server-permitted domains; disabled chips explain required authority without issuing failing requests. Replace global “results” totals with per-domain matched/returned counts and failed-source indicators. Filters include exact ID/reference mode, domain, country, created range, lifecycle, and limited field choice. Saved views retain non-sensitive filters and purpose templates, not customer search text by default.

Results remain grouped by entity with domain-specific columns: identity/state for users, job/assignment for work, ticket/owner/deadline for support, amount/currency/status for permitted payments, and case/outcome for disputes. Sensitive message snippets require approved purpose and bounded context. Each result drawer shows identity, match reason, permitted summary, source/version, related references, and a link to its authoritative screen. Search itself performs no punitive or financial mutation.

Allowed actions are open entity, link result to an existing case, request investigative access, and export permitted references with explicit filter/purpose receipt. Bulk selection should only attach references to a case; do not bulk contact users or alter financial state. Preview count, fields, and scope before export. Maintain independent domain pagination so a large user result set does not hide a small ticket match.

When one source fails, label that group unavailable and allow source-specific retry; never call the overall search complete. Stale results retain their query label. Empty means successful zero matches in listed authorized sources; no-access explains excluded domains. Mobile uses expandable domain groups and full-height summaries, keyboard users can traverse chips/results without losing query focus, and bidi-isolated identifiers/RTL snippets prevent identity confusion.

### Acceptance tests and owner

Search platform and Security jointly own discovery scope. A search-only employee's first query must succeed for permitted domains. Restricted message search must fail without participant or approved investigation authority. Fail one domain query: result identifies failure, retaining successful groups. Empty later pages preserve total or return a valid cursor endpoint. Tests must cover delegated grants, revoked investigation access, output-field redaction, and exact-ID lookup. Run the isolated scale harness plus representative query plans; no live capacity certification is implied.

## Additional review: Restaurant Top-up Approvals

### Route and business purpose

`/admin/super/restaurant-topups` is the newly added restaurant eligibility queue for customer wallet funding. Despite the super-path name, it is delegatable with `manage_financials`. It must connect eligibility decisions to money already received, uncredited payments, and chargeback recovery, while preserving restaurant-specific wallet isolation.

### Verified current implementation

The route is manifest-defined and grant-guarded (`client/src/admin/adminRouteManifest.js:112`; `client/src/admin/AdminApp.jsx:325–326`). All eligibility/clawback APIs require current admin authentication and financial management authority (`server/routes/adminRestaurantTopups.js:16–24`). Approval rechecks active restaurant and connected payouts; decision and audit are transactional (`server/services/restaurantTopupService.js:268–304`). Webhook completion locks the top-up, rechecks eligibility, and posts idempotent wallet credit (`:527–571`, `:585–608`). Clawback locks the top-up and uses deterministic ledger replay, explicitly allowing/flagging negative balance with two transactional audits (`:905–911`, `:939`, `:953–1005`). Migration 663 supplies tables and the exceptional negative-balance mechanism (`server/migrations/663_restaurant_topup_eligibility.sql:14–42`, `:73–92`). Tests cover duplicate credit, in-flight suspension, negative clawback, and replay (`server/__tests__/restaurantTopups.test.js:787–817`, `:959–1003`). These controls exist; deployment of migration 663 is **UNVERIFIED** against reported readiness 661/661.

### Concrete flaws and gaps

1. **CONFIRMED DEFECT, P1: stale eligibility decisions overwrite newer ones.** Service reads eligibility without locking/version and upserts any target state (`server/services/restaurantTopupService.js:137–142`, `:277–289`). The UI constrains actions by loaded state but sends no expected version (`client/src/admin/pages/super/RestaurantTopupApprovals.jsx:183–206`). A stale approval can reverse a newer suspension.
2. **DESIGN GAP, P1: captured-but-uncredited money lacks an operator recovery queue here.** Ineligibility at webhook credit parks the row as failed, raises an incident, and future nonpending completion is ignored (`server/services/restaurantTopupService.js:536–571`, `:637–643`). Admin routes offer eligibility and clawback, not preview/reconcile/refund/recredit for this exception (`server/routes/adminRestaurantTopups.js:20–24`). Reapproval alone does not settle received money.
3. **DESIGN GAP, P1: clawback evidence/approval is under-specified.** The endpoint accepts a top-up ID and reason; the service debits the full credited amount, with no required provider dispute reference or independent approval (`server/controllers/adminRestaurantTopupController.js:107–113`; `server/services/restaurantTopupService.js:927–949`). Existing replay and audits prevent duplicate debits, but do not establish why a debit is justified. No missing wallet isolation is alleged.

### Expansion failure scenario

One reviewer suspends a restaurant while another approves stale data. In-flight captured funds become failed/uncredited records, then are overlooked because the screen only lists eligibility applications. A chargeback clawback creates negative balance with no visible debt-resolution owner. Support, provider incidents, restaurant Credit, reconciliation exceptions, and finance must share transaction evidence.

### Required changes and operator design

Serialize/version eligibility decisions and require approval rationale. Add a permitted top-up exception list/detail and recovery preview with captured amount/currency, wallet ledger, provider event, and receipt status. Recovery must be an explicit idempotent finance operation, never blind webhook replay. Link clawback to verified dispute evidence and threshold-based independent approval; preserve the exceptional negative flag, restaurant isolation, and append-only ledger replay. Compare webhook amount/currency to the stored intent as a proposed integrity check; mismatch behavior is currently **UNVERIFIED** rather than an asserted exploited defect.

### Operator screen design recommendations

Keep the existing status queue and decision dialog, adding a header with financial scope, source revision/readiness status, and separate eligibility/payment-data refresh times. KPI tiles are pending eligible applications, approved merchants, captured-but-uncredited payments, and negative wallets awaiting recovery. Do not infer the latter two from application count. Filters should include restaurant ID/name, country/currency, payout readiness, application age, reviewer, and exception type; save “Pending ready for review,” “Captured uncredited,” and “Chargeback debt followup.”

Application rows show restaurant identity, operating state, currency, application age, eligibility version, payout-readiness timestamp, and last decision. Drawer sections contain restaurant/business links, payout prerequisites with provenance, prior decisions/reasons, pending and succeeded top-ups, uncredited incidents, wallet/reconciliation evidence, and accountable finance case. Keep approval separate from customer funding initiation.

Actions are approve with rationale, reject/suspend, inspect a top-up exception, request recovery, and preview evidence-backed clawback. Before eligibility suspension show in-flight intent count and the resulting exception workflow. Clawback preview shows provider dispute, amount/currency, exact wallet, current/projected balance, negative outcome, and approval requirement. Bulk actions may assign application reviews; monetary recovery/clawback remains individual with receipt and independent approval where required.

On conflict reload current decision and preserve rationale. A timeout recovers the decision/ledger receipt before retry. Empty pending queue must still show unresolved money exceptions. Missing migration/source is unavailable, not zero applications; no access differentiates read from financial decision authority. Mobile prioritizes projected negative balance and evidence before confirmation, with accessible dialog focus, keyboard paging, localized currency units, and bidi-isolated financial references.

### Acceptance tests and owner

Restaurant payments engineering and financial risk own this launch gate. Race approval/suspension: stale approval returns 409. Suspend after capture: exactly one visible reconciliation case retains provider/wallet evidence and a documented recovery outcome. Repeat recovery/clawback: one ledger effect, consistent audit/receipt. Unjustified or mismatched dispute evidence blocks clawback; approved negative balance creates a named followup case. Isolated migration 663 and transactional replay tests must pass before deployment; current readiness/CI evidence must identify the actual feature revision.
