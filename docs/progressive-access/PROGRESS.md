# Progressive account access — progress ledger

Single source of truth for what is done. Update this file (and HANDOFF.md) in the same push as every WP commit.

Status values: `planned` · `in progress` · `implemented` (code + tests on branch) · `verified` (CI green on branch) · `open dependency` (needs Emile / live env).

## Phase 0 / cross-cutting

| Item | Status | Commit | Tests |
| --- | --- | --- | --- |
| Handoff + ledger docs | implemented | (this commit) | n/a |
| Decisions-already-made product tests (D1–D7) | implemented | 3e19ebd25 | server/__tests__/progressiveAccessDecisions.test.js (35) |
| Baseline inventory of mode/role authority (docs/progressive-access/BASELINE.md) | planned | | |
| Legacy backfill (services/access/backfill.js, scripts/access-backfill.js) | implemented | 4eb2e22eb | progressiveAccess.db.test.js backfill case |
| Access outbox delivery job | implemented | 7d936e6fb | progressiveAccess.db.test.js outbox case |

## Work packages

| WP | Title | Phase | Status | Commit | Tests |
| --- | --- | --- | --- | --- | --- |
| WP-001 | Signup entry and intent selector | P2 | implemented (server + JoinPage continuation) | 242cb47a6, c55e4966e | progressiveAccessSignup.db.test.js; JoinPage follows access.nextStep |
| WP-002 | Registration start and pending identity | P2 | implemented | 242cb47a6 | progressiveAccessSignup.db.test.js |
| WP-003 | OTP finalization and bootstrap | P2 | implemented | 242cb47a6 | progressiveAccessSignup.db.test.js |
| WP-004 | Login and legacy mode inputs | P2 | in progress | bb9a413fa | login mode gate (modeGate.js); dedicated login test pending |
| WP-005 | Signed-in profile edit and account type removal | P2 | implemented | bb9a413fa | progressiveAccessModeGate.db.test.js (profile, mobile, switch) |
| WP-006 | Dedicated helper registration | P2 | implemented (server, flag-gated) | dd02c9826 | progressiveAccessHelperEnforcement.test.js (dedicated registration closed → general signup) |
| WP-007 | Verification and provider callbacks | P2 | implemented | da21ff6fe | progressiveAccess.db.test.js (WP-007) |
| WP-008 | Business team access requests | P2 | planned | | |
| WP-009 | Invitations and Vortex codes | P2 | planned | | |
| WP-010 | Access policy and form discovery | P1 | implemented (server) | 3e19ebd25, fc9a8422d, 87a95318e | progressiveAccessDecisions.test.js; progressiveAccess.db.test.js |
| WP-011 | Applicant status and resubmission | P1 | implemented (server + client page) | 87a95318e, d47c5ff86 | progressiveAccess.db.test.js; client verify-i18n + esbuild |
| WP-012 | Platform review and audit | P1 | implemented (server API + admin queue page) | 87a95318e, c141d6f82 | progressiveAccess.db.test.js; adminRouteContracts + adminLocaleNamespaces; verify-i18n |
| WP-013 | Role switch retirement | P5 | in progress | bb9a413fa | switch-role authority gate behind ACCESS_LEGACY_SWITCH_RETIRED; UI retirement pending |
| WP-014 | Current-user projection and resume | P1 | implemented (server + Settings entry) | 87a95318e, d47c5ff86, 47fcd2ff2 | progressiveAccess.db.test.js; signupResume and account ID in GET /api/me/access; accessProjection.browser-check.cjs for late responses after an identity change. |
| WP-015 | Home and dashboard routing | P2 | implemented | f3e3f2985 | homeModeRouting.test.mjs (WP-015) |
| WP-016 | Navigation, notices and settings | P2 | implemented | f3e3f2985 | navbarNavigation.test.mjs (WP-016) |
| WP-017 | JWT, CSRF and cross-tab session safety | P2 | planned | | |
| WP-018 | Two-factor authentication and passkeys | P2 | planned | | |
| WP-019 | Sessions on native API and PWA | P2 | planned | | |
| WP-020 | Notification and application messages | P2 | implemented | cba40e04e | progressiveAccess.db.test.js (outbox, real in-app), progressiveAccessOutboxCopy.test.js |
| WP-021 | Account deletion, export and privacy | P4 | planned | | |
| WP-022 | Profile and public directory | P4 | planned | | |
| WP-023 | Preferences, status and localization | P4 | planned | | |
| WP-024 | Public discovery and location | P4 | planned | | |
| WP-025 | Customer job post and job lifecycle | P2 | planned | | |
| WP-026 | Helper bidding and acceptance | P2 | implemented (server gate: bids + hire; bid UI) | bf1d63418, d199d6c05, 5ce4bb0ec | progressiveAccessHelperEnforcement.test.js (13); JobDetailPage access_required link |
| WP-027 | Bookings and calendar | P2 | planned | | |
| WP-028 | Quotes and quote requests | P2 | planned | | |
| WP-029 | Work agreements and disputes | P2 | planned | | |
| WP-030 | Ratings and review management | P4 | planned | | |
| WP-031 | Career applications and employer recruiting | P4 | planned | | |
| WP-032 | Direct customer requests and bookings | P4 | planned | | |
| WP-033 | Direct authorized operations | P4 | planned | | |
| WP-034 | Client message threads | P4 | planned | | |
| WP-035 | Support from the customer surface | P4 | planned | | |
| WP-036 | Business support agent queue | P4 | planned | | |
| WP-037 | Listings and rental participant setup | P4 | planned | | |
| WP-038 | Rental handoff, deposits and disputes | P4 | planned | | |
| WP-039 | Marketplace product catalog | P4 | planned | | |
| WP-040 | Carts, saved baskets, and checkout | P4 | planned | | |
| WP-041 | Jobs materials and ordering | P4 | planned | | |
| WP-042 | Media publisher and verification | P4 | planned | | |
| WP-043 | Media creator marketplace and sharing | P4 | planned | | |
| WP-044 | Learn, personal interests, and resources | P4 | planned | | |
| WP-045 | Personal finances and planned needs | P4 | planned | | |
| WP-046 | Business setup and existing ownership | P3 | implemented | e97008ac9 | progressiveAccessBusiness.db.test.js (4), businessCategories.test.js |
| WP-047 | Workspace context and multiple organizations | P3 | implemented | f2809f22b | progressiveAccessWorkspace.db.test.js (2), navbarNavigation.test.mjs (switcher roles) |
| WP-048 | Permission overrides and delegated administration | P3 | implemented | a6378a15a | progressiveAccessOverrides.db.test.js (4), permissionResolver.db.test.js |
| WP-049 | Staff scheduling and dispatch | P3 | implemented | cbd90883c | progressiveAccessSchedule.db.test.js |
| WP-050 | Business communications and representative scope | P3 | implemented | 8a225c5bc | __tests__/progressiveAccessMessages.db.test.js, attentionInbox.test.js |
| WP-051 | Business client records and customer insight | P3 | implemented | 21792ad15 | __tests__/progressiveAccessCustomer360.db.test.js |
| WP-052 | Business leads, campaigns and follow-ups | P3 | implemented | 1de6f2ee1 | __tests__/progressiveAccessLeads.db.test.js, businessLeadPipeline.test.js |
| WP-053 | Catalog, pricing rules and marketplace publishing | P3 | implemented | b4df83b25 | __tests__/progressiveAccessCatalog.db.test.js |
| WP-054 | Invoices, quotes and recurring billing | P3 | implemented | 483d26942 | __tests__/progressiveAccessInvoices.db.test.js |
| WP-055 | Business packages, services and waitlists | P3 | implemented | f4e383d43 | __tests__/progressiveAccessPackages.db.test.js |
| WP-056 | Integrations and brand linkage | P3 | implemented | 629700658 | __tests__/progressiveAccessIntegrations.db.test.js |
| WP-057 | Property and maintenance workflows | P3 | implemented | b9b0f50ba | __tests__/progressiveAccessMaintenance.db.test.js |
| WP-058 | Trades, creative, professional and appointment templates | P3 | implemented | e560de691 | __tests__/progressiveAccessTemplates.db.test.js |
| WP-059 | Continuity and operating health | P3 | implemented | a32d433bd | __tests__/progressiveAccessHealth.db.test.js |
| WP-060 | Restaurant application and activation | P3 | implemented | 5e4727225 | __tests__/progressiveAccessRestaurant.db.test.js |
| WP-061 | Restaurant membership and assigned store scope | P3 | implemented | 31d63875f | __tests__/progressiveAccessRestaurantStores.db.test.js, restaurantLocationAccess.test.js |
| WP-062 | Dining and public menu | P3 | implemented | f8c1857ea | __tests__/progressiveAccessRestaurantMenu.db.test.js |
| WP-063 | Restaurant order management and service cycle | P3 | implemented | 2c87ceef8 | __tests__/progressiveAccessRestaurantOrders.db.test.js, foodController.test.js |
| WP-064 | Restaurant menu and catalog management | P3 | implemented | e5c7fd666 | __tests__/progressiveAccessRestaurantCatalog.db.test.js |
| WP-065 | Restaurant host stand and reservations | P3 | implemented | 51792b4db | __tests__/progressiveAccessRestaurantHost.db.test.js |
| WP-066 | Cashier POS and drawer operations | P3 | implemented | 0d5143fcd | __tests__/progressiveAccessRestaurantInventory.db.test.js; POS/drawer/device: restaurantStoreIsolation.db.test.js (CI) |
| WP-067 | Kitchen and queue displays | P3 | implemented | fa69c958d | __tests__/progressiveAccessRestaurantDisplays.db.test.js |
| WP-068 | Inventory and purchase operations | P3 | implemented | 854754dc6 | __tests__/progressiveAccessRestaurantStock.db.test.js |
| WP-069 | Crew shifts, time clock, and reports | P3 | implemented | 908a8477b | __tests__/progressiveAccessRestaurantCrew.db.test.js |
| WP-070 | Restaurant runner and delivery | P3 | implemented | 11a779423 | __tests__/progressiveAccessRestaurantRunner.db.test.js, runnerWorkspace.test.js |
| WP-071 | Training, SOPs and operational quality | P3 | implemented | 7516fe043 | __tests__/progressiveAccessRestaurantOps.db.test.js |
| WP-072 | Restaurant offline POS and store hub | P3 | implemented | cf470a04d | __tests__/progressiveAccessRestaurantHub.db.test.js |
| WP-073 | Restaurant and multi-location statements | P3 | implemented | 8a9ff51c5 | __tests__/progressiveAccessRestaurantStatements.db.test.js, statementCenter.test.js |
| WP-074 | Consultant profile and referral pipeline | P4 | implemented | 40573c463 | progressiveAccessConsultantNetwork.db.test.js; client navbar navigation and build:ci |
| WP-075 | Consultant booking, scheduling and billing | P4 | implemented | 8fbe8b4e7 | progressiveAccessConsultantNetwork.db.test.js; 5 existing scheduling, notifications and payment suites; isolated migration and immutable history check |
| WP-076 | Business launch journey | P4 | implemented | 954117d8a, 13a79c2aa, 3b7991c1a, 3e2fded67, 50032e617, 19c531b5b | PostgreSQL verifies signed-in and guest intake, pending Owner access, consultant match/reassignment, scoped action items, applicant-only case links, and private shared/applicant/adviser attachment authorization. Chrome verifies Applications → linked intake, the applicant status modal's shared/applicant-only controls, and the consultant referral attachment workspace. `verify:frontend-references`, i18n, inline-style, `build:ci` (1,203 assets), and focused server tests pass locally. Live acceptance and exact-head CI remain open. |
| WP-077 | Investor reporting and audience access | P4 | in progress | e48738e84, 0b45ff681, ad95b1a09, d2346b1e4, 04e097b34, 1a9775db2, eb280311e | Mounted `/api/investor/kpis` coverage reproduces and fixes the variadic role-array denial, preserves customer denial in legacy mode, and proves `ACCESS_INVESTOR_ENFORCEMENT=enforce` admits an approved `investor.reporting` grant without mutating `users.role`. Migration `20261116170000_investor_reporting_audiences.sql` ties each approved grant to a named audience and dataset list; KPI/revenue route checks enforce live audience, expiry, revoke, and dataset narrowing in the disposable DB case. Settings Applications captures the audience and requested datasets in Chrome; reviewer approvals require explicit audience/dataset confirmation; the customer-class dashboard reads the real `{ access, flags }` projection, renders only allowed datasets, and omits restricted API calls. `investorDashboard.browser-check.cjs` proves narrowed loading; `investorDashboard.revocation.browser-check.cjs` proves revoke clears the workspace before delayed KPI/chart data can render. Focused route/DB tests, `verify:frontend-references`, i18n, inline-style, `build:ci`, and `verify-dist-assets` pass locally. Evidence/export acceptance and exact-head CI remain open. |
| WP-078 | Franchise application, review and territory | P4 | in progress | 83c6c82a9, 5bc7bec68, 0dd3848bf, 4140a091a, 179378c97 | Added `ACCESS_FRANCHISE_ENFORCEMENT` (`off|shadow|enforce`) and mounted capability gating for territory stats/helpers. Store activation now atomically issues or reinstates the owner's self `franchise.operate` grant only after a linked business exists, bumps the access projection, and revokes the prior owner grant when a launched application is ended or reassigned. Disposable PostgreSQL coverage proves activation grants only the owner, a foreign user remains denied, and status revocation removes the grant; mounted off/enforce route tests and franchise contract tests pass. The territory page now reads the real `{ access, flags }` projection, makes no territory calls while a progressive grant is absent, loads after grant refresh, and clears data after revoke. The application/status surface and franchise quick links now hide territory operations until the projected grant exists and restore them after grant refresh; `franchiseTerritoryAccess.browser-check.cjs` and `franchiseApplicationAccess.browser-check.cjs` cover grant/revoke transitions. `franchiseAdminAccess.browser-check.cjs` exercises the actual HQ controls through activation, owner reassignment, and rejected-status revocation. Frontend references, inline-style, and `build:ci` (1,203 assets) pass. Populated live territory acceptance and exact-head CI remain open. |
| WP-079 | Logistics buyer and checkout | P4 | in progress | 61042175e, c3d7c081e | The shared projection now treats `logistics.ship` as the backing capability for the logistics preference: a revoked/unapproved logistics preference falls back to Customer Home, while an approved logistics grant adds a Buyer workspace shortcut without replacing the user's selected Customer view. Existing buyer checkout, history, shipment, support, claim, and refund routes remain available to signed-in customers; foreign record scoping stays enforced by the existing logistics controllers. A dedicated pending-organizer checkout case passes (customer identity remains the buyer), the existing buyer warehouse/payment/refund suites pass 65/65, and `logisticsCompletion.browser-check.cjs` passes with a pending customer through checkout plus account isolation. `navbarNavigation.test.mjs`, frontend references, inline-style, and `build:ci` (1,203 assets) pass. Exact-head CI and populated live checkout acceptance remain open. |
| WP-080 | Logistics pooled campaigns | P4 | in progress | e5c66e332, b3e5cfcf3, 46e21611c, 20983e644, 77e317c06 | With projection rollout enabled, an active self `logistics.ship` grant derives the ordinary customer's logistics role as `organizer` without writing `users.role`; pending/revoked grants fall back to `individual_buyer`, and explicit business/operations roles remain authoritative. Customer navigation exposes both Buyer and Organizer workspace shortcuts for the approved grant. `logisticsPooledOrders.test.js` covers approved customer create/edit/submit/review-state reads, Operations publish-on-review and placement approval visibility, pending customer public browse/join, and foreign draft submit/edit denial with the server-derived role context. `logisticsProgressiveOrganizer.browser-check.cjs` follows the customer-view Organizer shortcut into the real new-campaign page and back. The organizer-only rollover endpoint creates a clean draft only for an expired below-MOQ campaign and resets participant/funding/supplier-quote/approval state; `CampaignPreview` shares the canonical read-only public URL through Web Share or clipboard. Focused server suites (109 tests), browser fixture, frontend references, inline-style, and `build:ci` (1,203 assets) pass locally. Populated live campaign acceptance and exact-head CI remain open. |
| WP-081 | Business procurement and restocking | P4 | in progress | 1e89d5ca2 | Recurring programs now require a canonical `business_id` and server-side procurement authority (owner, manager, or effective procurement-style permission); unscoped personal programs are excluded from procurement listings. Sourcing requests use the same business authority for create/list/detail, and linked request references must match the selected business. `BusinessProcurementPage` requires a business selection, filters linked requests to that business, and sends the business ID on create. Focused server suites (138 tests) and client `build:ci` (1,203 assets) pass locally. Populated live procurement acceptance and exact-head CI remain open. |
| WP-082 | Logistics distribution and fulfillment | P4 | in progress | 5f666d8cc | `requireDeliveryActor()` now gates delivery status writes to operations staff or the currently assigned reseller/franchise buyer; a changed or revoked `assigned_to` value fails closed before the update. Assigned distributors can read their own delivery records while ordinary buyers remain recipient-scoped, and the canonical delivery state machine remains authoritative. `logisticsDistributorAssignment.test.js`, warehouse transition tests, and buyer warehouse-read tests pass together (149 tests). Browser evidence, populated live fulfillment acceptance, and exact-head CI remain open. |
| WP-083 | Logistics internal operations and compliance | P4 | in progress | c5c9c975b | Internal operations and compliance read surfaces now use route-specific internal workspace approval: operations/compliance staff can read restrictions and supplier records without receiving mutation authority. Restriction writes remain compliance-only; supplier writes remain admin plus the explicit procurement grant; restricted-PO approval remains compliance-only and now records before/after state, staff identity, notes, and request IP in the logistics audit entry. `logisticsInternalWorkspaceBoundary.test.js`, admin route contracts, procurement gates, and refund route contracts pass (50 tests). Browser workspace evidence, populated live approval acceptance, and exact-head CI remain open. |
| WP-084 | Payment roles and money movement | P4 | in progress | 5850cee40 | Offline payment confirmation now re-checks `checkout` restrictions at confirmation time, alongside authentication, impersonation rejection, job-party ownership, offline-rail validation, and idempotent confirmation writes. `paymentRoleMoneyMovement.test.js` proves the route contract; the real-PostgreSQL `paymentLayers.db.test.js` remains environment-gated (9 tests skipped locally without `JOB_EDIT_TEST_DATABASE_URL`). Populated retry/denial acceptance and exact-head CI remain open. |
| WP-085 | Helper earnings and payouts | P2 | in progress | 7c9f70fe2 | Payout-method create/update/delete now pass through `requireHelperCapability` before TOTP and completed-onboarding gates, so a customer-class account needs an enforced helper grant before changing a payout destination. `payoutAccessBoundary.test.js`, `progressiveAccessHelperEnforcement.test.js`, and existing payout controller/security suites pass (26 tests). Existing payout-method ownership and TOTP evidence remains; populated revoked-helper payout acceptance and exact-head CI remain open. |
| WP-086 | Personal and merchant Credit | P2 | in progress | existing Credit ledger | The existing conversion and wallet paths already enforce customer/actor equality, quote ownership and amount matching, per-customer currency wallets, sanctions at commit, append-only journal posting, and idempotent replay. `oxsteedCreditCurrencyConversion.test.js`, `oxsteedCreditPhase6.test.js`, and `oxsteedCreditControllerAmountAliases.test.js` pass locally (38 tests). Disposable Credit isolation, kiosk/merchant scope, and exact-head CI remain open; no new mutation was needed in this checkpoint. |
| WP-087 | Statements, exports and archives | P4 | in progress | 5216d9091 | Statement Center business scopes now use the canonical `payouts.view` finance standing for manager members; owners remain allowed. Restaurant statement-document standing now applies the same permission and store-scope check instead of treating any active membership as finance authority. `statementFinanceBoundary.test.js` and `statementCenter.test.js` pass together (15 tests). Disposable export/download revocation and exact-head CI remain open. |
| WP-088 | Disputes, refund delegation and support | P4 | in progress | existing dispute/refund controls | Existing dispute and refund paths pass focused ownership, idempotency, impersonation, grant, two-person, and wrong-scope checks: `disputeOpenIdempotency.test.js`, `disputeEvidence.test.js`, `disputeW2.test.js`, `agentFoodRefundActions.test.js`, and `agentCreditAdjustments.test.js` pass locally (75 tests). The view-only support versus refund actor acceptance, populated wrong-business retry, and exact-head CI remain open; no new mutation was needed in this checkpoint. |
| WP-089 | Platform staff grants and governance | P4 | planned | | |
| WP-090 | Provider and internal identity entry | P4 | planned | | |
| WP-091 | Analytics and telemetry audiences | P4 | planned | | |
| WP-092 | Scheduled growth and operational outreach | P4 | planned | | |
| WP-093 | Connector and partner service accounts | P4 | planned | | |
| WP-094 | Moderation, safety and holds | P4 | planned | | |
| WP-095 | Uploads and protected evidence retrieval | P4 | planned | | |
| WP-096 | Subsidiary product and paid entitlements | P4 | planned | | |
| WP-097 | Referrals, affiliates and partner attribution | P4 | planned | | |
| WP-098 | Release visibility and startup bootstrap | P4 | planned | | |
| WP-099 | Email, SMS and provider retry handling | P4 | planned | | |
| WP-100 | Audit, finance and exceptional administration | P4 | planned | | |
| WP-101 | Reputation, trust, cancellations and restrictions | P4 | planned | | |
| WP-102 | Legal records and policy acknowledgements | P4 | planned | | |
| WP-103 | Maintenance operations and rollback ownership | P4 | planned | | |

## Acceptance cases

| AC | Title | Status | Evidence |
| --- | --- | --- | --- |
| AC-001 | Guest finds a task and signs up | planned | |
| AC-002 | Helper intent survives OTP | in progress | signup DB test; bid denial pending WP-026 |
| AC-003 | Owner intent with application failure | in progress | signup DB test; retry-from-resume pending client |
| AC-004 | Unverified email and pending account | planned | |
| AC-005 | OTP retry, expiry and resend | server evidence | progressiveAccessSignup.db.test.js (resend → old code fails, new code keeps intent) |
| AC-006 | Same email and two signup entry points | server evidence (partial) | dedicated helper start closed under flag (WP-006); duplicate OTP finalize → 409 account_already_created |
| AC-007 | Legacy mode forged on signup | implemented | progressiveAccessSignup.db.test.js (server) |
| AC-008 | Resume application on second device | planned | |
| AC-009 | Withdraw then reapply | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-010 | Needs information and revision history | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-011 | Draft attachment confidentiality | browser + server evidence (partial) | `progressiveAccessConsultantNetwork.db.test.js` verifies private object keys, shared/applicant-only/consultant-only reads, copied-case denial, uploader deletion, reassignment denial, and signed download authorization. `businessLaunchAttachments.browser-check.cjs` verifies the applicant modal keeps shared/applicant-only choices and uploads within the selected request; consultant controls are covered in the referral workspace. Admin reviewer browser flow, deletion acceptance, and live storage acceptance remain open. |
| AC-012 | Public form policy versus evidence data | planned | |
| AC-013 | Reviewer privilege narrows mid-session | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-014 | Two competing approval decisions | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-015 | Duplicate application on two tabs | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-016 | Policy changes during review | planned | |
| AC-017 | Admin rejects without harming customer access | planned | |
| AC-018 | Revoke and reinstate distinct rights | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-019 | Fixture identity changes across tabs | browser evidence (partial) | accessProjection.browser-check.cjs rejects late responses across account/session changes and responses for a different cookie account. Full cross-tab login and navigation acceptance pending. |
| AC-020 | No role mutation on ordinary page navigation | server evidence (partial) | progressiveAccessModeGate.db.test.js: mode writes never raise role |
| AC-021 | Capability refresh during unsaved editing | planned | |
| AC-022 | Arabic approval status keyboard flow | planned | |
| AC-023 | Feature flag unavailable at boot | planned | |
| AC-024 | Mobile notification deep-link identity | server evidence (partial) | progressiveAccess.db.test.js WP-020 real in-app case: link owner 200 / other user 404 / signed-out 401; native deep-link parsing pending |
| AC-025 | Provider and customer work side by side | planned | |
| AC-026 | Verified identity with approval still pending | server evidence (partial) | progressiveAccess.db.test.js WP-007 case: verified identity, no grant until a fresh decision; bid deny under enforce in progressiveAccessHelperEnforcement.test.js |
| AC-027 | Approved helper suspended or unlisted | server evidence (partial) | progressiveAccessHelperEnforcement.test.js: suspended/revoked grant blocks bids and hiring under enforce |
| AC-028 | Existing contract after new-work revoke | planned | |
| AC-029 | Apply to create a new business | browser and server evidence (partial) | Chrome starts the Owner proposal draft in Applications; real PostgreSQL verifies the submitted proposal and independent linked advisory case. Full approval-to-activation acceptance remains open. |
| AC-030 | Competing claims for an existing business | planned | |
| AC-031 | Membership approval by actual employer | planned | |
| AC-032 | Invite link across logged-out state | planned | |
| AC-033 | Business staff promotion while work is open | planned | |
| AC-034 | Customer also manages a company | planned | |
| AC-035 | Staff financial read restricted to a named account | planned | |
| AC-036 | Business representative cannot assume owner | planned | |
| AC-037 | Cross-tenant template child record | planned | |
| AC-038 | Business marketing and late revocation | planned | |
| AC-039 | Carrier context on material order | planned | |
| AC-040 | Merchant private draft becomes eligible | planned | |
| AC-041 | One manager grant in two restaurant locations | server evidence (partial) | progressiveAccessRestaurantStores/Menu/Orders/Crew.db.test.js (store A vs B: list, row, PATCH, export) |
| AC-042 | Existing guest order after owner approval | planned | |
| AC-043 | Cashier attempts foreign ticket | planned | |
| AC-044 | Reconcile offline terminal after revocation | planned | |
| AC-045 | Device and human cross-scope isolation | planned | |
| AC-046 | Runner sees one assigned delivery | server evidence (partial) | progressiveAccessRestaurantRunner.db.test.js (inbox vs direct claim, foreign task; proof upload not yet) |
| AC-047 | Inventory transfer permissions | planned | |
| AC-048 | Tips, payroll and view-only employee | planned | |
| AC-049 | Careers hiring from an approved business | planned | |
| AC-050 | Assigned consultant eligibility | server evidence (partial) | progressiveAccessConsultantNetwork.db.test.js: approval/revoke, customer redaction, off/shadow parity, paid booking with exact assignee and expiry denial. Business Launch market matching, assignment, reassignment, and customer-only action item visibility pass with an independently pending Owner application. Browser and live provider checks pending. |
| AC-051 | Investor report and metric evidence | planned | |
| AC-052 | Franchise applicant to territory operator | planned | |
| AC-053 | Tool owner publication versus renter | planned | |
| AC-054 | Tool reservation after listing hold | planned | |
| AC-055 | Pool organizer and personal buyer | server + browser evidence (partial) | `logisticsPooledOrders.test.js` proves an approved-grant customer is passed as `organizer` through campaign create/edit/submit and can read review state; Operations approval publishes the campaign and placement approval is returned to the organizer; a pending customer remains `individual_buyer`, can publicly browse/join, and is denied foreign draft submit/edit. `pooledOrderRollover.test.js` proves organizer-only rollover creates a clean draft after expiry below MOQ and does not carry quote, participation, funding, or approval state. `logisticsProgressiveOrganizer.browser-check.cjs` proves the customer-view Organizer shortcut and new-campaign return path; the preview share action uses the canonical read-only public URL. Populated live campaign acceptance and exact-head CI remain open. |
| AC-056 | Procurement and distributor grant separation | server evidence (partial) | `recurringProcurementAccess.test.js` and `sourcingBusinessScope.test.js` prove owner/manager/permission-based procurement access, active employee denial without procurement permission, business-scoped request listing, and cross-business request mismatch rejection. UI business selection and canonical business IDs are covered by the client build/reference/i18n gates. Distributor assignment/revocation and populated live evidence remain open. |
| AC-057 | Marketplace Direct quote after approval | planned | |
| AC-058 | Media selected author after revoke | planned | |
| AC-059 | Media report and share visibility | planned | |
| AC-060 | Creator payment wallet and role | planned | |
| AC-061 | Statements permission revoked mid-export | server evidence (partial) | progressiveAccessRestaurantStatements.db.test.js (archive re-checks standing per request; export jobs not yet) |
| AC-062 | Credit cashier and account isolation | planned | |
| AC-063 | Payout retry and expired grant | planned | |
| AC-064 | Authorized and unauthorized refund reviewer | planned | |
| AC-065 | Workforce and capability reviewer separation | planned | |
| AC-066 | Support queue authorization after role removal | planned | |
| AC-067 | Consent and offer attribution with pending access | planned | |
| AC-068 | Connector loses organization scope | planned | |
| AC-069 | Read-only issued report on closed entity | planned | |
| AC-070 | Expiry during deferred asynchronous work | planned | |
| AC-071 | Launch and action permissions combination | planned | |
| AC-072 | Entity publisher ownership transfer | planned | |
| AC-073 | Account closure and unusable pending attachments | planned | |
| AC-074 | Mixed application versions during migration | planned | |
| AC-075 | Database upgrade and repeat | server evidence | progressiveAccess.db.test.js backfill case (4eb2e22eb) |
| AC-076 | Backfill twice with preexisting approval | server evidence | progressiveAccess.db.test.js backfill case (4eb2e22eb) |
| AC-077 | Interrupted backfill during revoke | server evidence | progressiveAccess.db.test.js backfill case (4eb2e22eb) |
| AC-078 | Mode-role shadow divergence triage | planned | |
| AC-079 | Feature rollback after approvals | planned | |
| AC-080 | Short outage during access projection | planned | |
| AC-081 | Double-session refresh race | planned | |
| AC-082 | Old client with role hint and scoped grant | planned | |
| AC-083 | Old and new aliases for the same resource | planned | |
| AC-084 | Synchronized access refresh without private leak | planned | |
| AC-085 | Optional-auth public route and blocked content | planned | |
| AC-086 | Limited reviewer evidence export | planned | |
| AC-087 | Unauthorized access attempts and rate limits | planned | |
| AC-088 | Production readiness is candidate-specific | planned | |
| AC-089 | Capability request latency under load | planned | |
| AC-090 | Realtime revocation and reconnect | planned | |
| AC-091 | Explicit actor selection for a financial action | planned | |
| AC-092 | Applicant receives approval during checkout | planned | |
| AC-093 | Policy offline retriable case | planned | |
| AC-094 | Delegation must not outlive its grantor | planned | |
| AC-095 | Small-screen review confirmation | planned | |
| AC-096 | Provider contracts after staged cutover | planned | |
| AC-097 | Account data deletion from both sides | planned | |
| AC-098 | Release completion and parity holdout | planned | |
