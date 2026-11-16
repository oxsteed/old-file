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
| WP-007 | Verification and provider callbacks | P2 | planned | | |
| WP-008 | Business team access requests | P2 | planned | | |
| WP-009 | Invitations and Vortex codes | P2 | planned | | |
| WP-010 | Access policy and form discovery | P1 | implemented (server) | 3e19ebd25, fc9a8422d, 87a95318e | progressiveAccessDecisions.test.js; progressiveAccess.db.test.js |
| WP-011 | Applicant status and resubmission | P1 | implemented (server + client page) | 87a95318e, d47c5ff86 | progressiveAccess.db.test.js; client verify-i18n + esbuild |
| WP-012 | Platform review and audit | P1 | implemented (server API + admin queue page) | 87a95318e, c141d6f82 | progressiveAccess.db.test.js; adminRouteContracts + adminLocaleNamespaces; verify-i18n |
| WP-013 | Role switch retirement | P5 | in progress | bb9a413fa | switch-role authority gate behind ACCESS_LEGACY_SWITCH_RETIRED; UI retirement pending |
| WP-014 | Current-user projection and resume | P1 | implemented (server + Settings entry) | 87a95318e, d47c5ff86 | progressiveAccess.db.test.js; signupResume in GET /api/me/access |
| WP-015 | Home and dashboard routing | P2 | planned | | |
| WP-016 | Navigation, notices and settings | P2 | planned | | |
| WP-017 | JWT, CSRF and cross-tab session safety | P2 | planned | | |
| WP-018 | Two-factor authentication and passkeys | P2 | planned | | |
| WP-019 | Sessions on native API and PWA | P2 | planned | | |
| WP-020 | Notification and application messages | P2 | in progress (access notices done) | 7d936e6fb | progressiveAccess.db.test.js (outbox case) |
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
| WP-046 | Business setup and existing ownership | P3 | planned | | |
| WP-047 | Workspace context and multiple organizations | P3 | planned | | |
| WP-048 | Permission overrides and delegated administration | P3 | planned | | |
| WP-049 | Staff scheduling and dispatch | P3 | planned | | |
| WP-050 | Business communications and representative scope | P3 | planned | | |
| WP-051 | Business client records and customer insight | P3 | planned | | |
| WP-052 | Business leads, campaigns and follow-ups | P3 | planned | | |
| WP-053 | Catalog, pricing rules and marketplace publishing | P3 | planned | | |
| WP-054 | Invoices, quotes and recurring billing | P3 | planned | | |
| WP-055 | Business packages, services and waitlists | P3 | planned | | |
| WP-056 | Integrations and brand linkage | P3 | planned | | |
| WP-057 | Property and maintenance workflows | P3 | planned | | |
| WP-058 | Trades, creative, professional and appointment templates | P3 | planned | | |
| WP-059 | Continuity and operating health | P3 | planned | | |
| WP-060 | Restaurant application and activation | P3 | planned | | |
| WP-061 | Restaurant membership and assigned store scope | P3 | planned | | |
| WP-062 | Dining and public menu | P3 | planned | | |
| WP-063 | Restaurant order management and service cycle | P3 | planned | | |
| WP-064 | Restaurant menu and catalog management | P3 | planned | | |
| WP-065 | Restaurant host stand and reservations | P3 | planned | | |
| WP-066 | Cashier POS and drawer operations | P3 | planned | | |
| WP-067 | Kitchen and queue displays | P3 | planned | | |
| WP-068 | Inventory and purchase operations | P3 | planned | | |
| WP-069 | Crew shifts, time clock, and reports | P3 | planned | | |
| WP-070 | Restaurant runner and delivery | P3 | planned | | |
| WP-071 | Training, SOPs and operational quality | P3 | planned | | |
| WP-072 | Restaurant offline POS and store hub | P3 | planned | | |
| WP-073 | Restaurant and multi-location statements | P3 | planned | | |
| WP-074 | Consultant profile and referral pipeline | P4 | planned | | |
| WP-075 | Consultant booking, scheduling and billing | P4 | planned | | |
| WP-076 | Business launch journey | P4 | planned | | |
| WP-077 | Investor reporting and audience access | P4 | planned | | |
| WP-078 | Franchise application, review and territory | P4 | planned | | |
| WP-079 | Logistics buyer and checkout | P4 | planned | | |
| WP-080 | Logistics pooled campaigns | P4 | planned | | |
| WP-081 | Business procurement and restocking | P4 | planned | | |
| WP-082 | Logistics distribution and fulfillment | P4 | planned | | |
| WP-083 | Logistics internal operations and compliance | P4 | planned | | |
| WP-084 | Payment roles and money movement | P4 | planned | | |
| WP-085 | Helper earnings and payouts | P2 | planned | | |
| WP-086 | Personal and merchant Credit | P2 | planned | | |
| WP-087 | Statements, exports and archives | P4 | planned | | |
| WP-088 | Disputes, refund delegation and support | P4 | planned | | |
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
| AC-011 | Draft attachment confidentiality | planned | |
| AC-012 | Public form policy versus evidence data | planned | |
| AC-013 | Reviewer privilege narrows mid-session | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-014 | Two competing approval decisions | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-015 | Duplicate application on two tabs | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-016 | Policy changes during review | planned | |
| AC-017 | Admin rejects without harming customer access | planned | |
| AC-018 | Revoke and reinstate distinct rights | server evidence (UI pending) | progressiveAccess.db.test.js |
| AC-019 | Fixture identity changes across tabs | planned | |
| AC-020 | No role mutation on ordinary page navigation | server evidence (partial) | progressiveAccessModeGate.db.test.js: mode writes never raise role |
| AC-021 | Capability refresh during unsaved editing | planned | |
| AC-022 | Arabic approval status keyboard flow | planned | |
| AC-023 | Feature flag unavailable at boot | planned | |
| AC-024 | Mobile notification deep-link identity | planned | |
| AC-025 | Provider and customer work side by side | planned | |
| AC-026 | Verified identity with approval still pending | planned | |
| AC-027 | Approved helper suspended or unlisted | server evidence (partial) | progressiveAccessHelperEnforcement.test.js: suspended/revoked grant blocks bids and hiring under enforce |
| AC-028 | Existing contract after new-work revoke | planned | |
| AC-029 | Apply to create a new business | planned | |
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
| AC-041 | One manager grant in two restaurant locations | planned | |
| AC-042 | Existing guest order after owner approval | planned | |
| AC-043 | Cashier attempts foreign ticket | planned | |
| AC-044 | Reconcile offline terminal after revocation | planned | |
| AC-045 | Device and human cross-scope isolation | planned | |
| AC-046 | Runner sees one assigned delivery | planned | |
| AC-047 | Inventory transfer permissions | planned | |
| AC-048 | Tips, payroll and view-only employee | planned | |
| AC-049 | Careers hiring from an approved business | planned | |
| AC-050 | Assigned consultant eligibility | planned | |
| AC-051 | Investor report and metric evidence | planned | |
| AC-052 | Franchise applicant to territory operator | planned | |
| AC-053 | Tool owner publication versus renter | planned | |
| AC-054 | Tool reservation after listing hold | planned | |
| AC-055 | Pool organizer and personal buyer | planned | |
| AC-056 | Procurement and distributor grant separation | planned | |
| AC-057 | Marketplace Direct quote after approval | planned | |
| AC-058 | Media selected author after revoke | planned | |
| AC-059 | Media report and share visibility | planned | |
| AC-060 | Creator payment wallet and role | planned | |
| AC-061 | Statements permission revoked mid-export | planned | |
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
