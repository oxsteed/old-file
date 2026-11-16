<a id="cover"></a>

# Progressive account access

**Developer implementation handoff**

Customer-first accounts, scoped applications and approvals, and new actions in the same OxSteed experience.

| Edition | Value |
| --- | --- |
| Source baseline | `0e2722d2ed6b6c201baefc805e9c90aad85f6b6d` |
| Review date | November 16, 2026 |
| Primary targets | OxSteed web, Express API, PostgreSQL, supported API consumers |
| Format | Markdown with 393 explicitly numbered print pages |
| Implementation coverage | 103 work packages and 98 acceptance cases |

This is a proposed implementation specification grounded in the current checkout. Use its initial requirements and decision tables to preserve the intended user experience. Follow the [required new work](#required-new-work-and-completion-gates-full-product-completion-mandate), [product closure register](#product-by-product-closure-register-accounts-home-and-public-discovery-closure), work packages, and route inventory. Complete each product through real usage and staged or live verification when required.

**Start with** [Contents](#contents), then [Product mandate](#product-and-scope-product-mandate).

<div style="break-before: page; page-break-before: always;"></div>

<a id="contents"></a>

**Reading guide** · Page 002 of 393

## Contents

| Chapter | Pages |
| --- | --- |
| [Product and scope](#product-and-scope-product-mandate) | 6–23 |
| [Required new work and completion gates](#required-new-work-and-completion-gates-full-product-completion-mandate) | 24–33 |
| [Product-by-product closure register](#product-by-product-closure-register-accounts-home-and-public-discovery-closure) | 34–50 |
| [Engineering contracts](#engineering-contracts-server-contract-overview) | 51–70 |
| [Application intake and decisions](#application-intake-and-decisions-signup-screens-and-transitions) | 71–78 |
| [Implementation examples](#implementation-examples-commit-sized-delivery-sequence) | 79–90 |
| [Delivery and rollout](#delivery-and-rollout-phase-0-map-entry-points-and-capture-the-baseline) | 91–106 |
| [Account and access work packages](#wp-001) | 107–129 |
| [Marketplace and customer work packages](#wp-024) | 130–151 |
| [Business and restaurant work packages](#wp-046) | 152–179 |
| [Specialist and platform work packages](#wp-074) | 180–209 |
| [Acceptance for signup and access](#ac-001) | 210–233 |
| [Acceptance for customer and commerce flows](#ac-025) | 234–258 |
| [Acceptance for specialists and protected actions](#ac-050) | 259–282 |
| [Acceptance for release and reliability](#ac-074) | 283–307 |
| [Server router inventory](#api-001) | 308–376 |
| [Browser route inventory](#web-001) | 377–393 |

Use the [detailed chapter index](#chapter-index-1) to jump to engineering topics and major work packages. Use the [specialist and test index](#chapter-index-2) for release evidence, sensitive domains and the route maps.

<div style="break-before: page; page-break-before: always;"></div>

<a id="source-inventory-method"></a>

**Reading guide** · Page 003 of 393

## How to use the source inventory

The inventory baseline contains 206 JavaScript modules under `server/routes`, 3,495 statically read literal method and path entries, and 301 literal route paths in `client/src/App.jsx`. Router pages provide mount and handler samples with exact source links. Browser pages list top-level declarations in source order. Separate admin and nested routers require a second source pass where relevant.

A literal route sample establishes its declaration, method, and exact line. The trailing names describe detectable route-local middleware and terminal handlers. Router mount ordering, nested mounts, router-wide middleware, computed routes, environment configuration, and in-controller checks may add constraints. The first web wrapper is likewise structural evidence. Use owning code and mounted endpoint tests to establish actual access.

Work packages connect current source, proposed modifications and proof a developer should collect. Acceptance cases are planned. The handoff did not run application acceptance tests or validate signed-in production behaviors. Relative [`#L`] source anchors work in GitHub Markdown. Print-capable Markdown viewers can honor the embedded page breaks. Ordinary Markdown viewers may show continuous pages.

**Repository sources**  [index.js](../server/index.js) · [App.jsx](../client/src/App.jsx) · [scopeGates.js](../server/middleware/scopeGates.js) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="chapter-index-1"></a>

**Reading guide** · Page 004 of 393

## Detailed chapter index

| Start here | Page |
| --- | --- |
| [Product mandate](#product-and-scope-product-mandate) | 6 |
| [Decisions already made](#product-and-scope-decisions-already-made) | 7 |
| [What success looks like](#product-and-scope-what-success-looks-like) | 8 |
| [Full product completion mandate](#required-new-work-and-completion-gates-full-product-completion-mandate) | 24 |
| [Gap classification and work ledger](#required-new-work-and-completion-gates-gap-classification-and-work-ledger) | 25 |
| [End-to-end proof sheet for each action](#required-new-work-and-completion-gates-end-to-end-proof-sheet-for-each-action) | 31 |
| [Current mode coupling](#product-and-scope-current-mode-coupling) | 13 |
| [Account role inventory](#product-and-scope-account-role-inventory) | 15 |
| [Helper as the first additive journey](#product-and-scope-helper-as-the-first-additive-journey) | 17 |
| [Business ownership, creation, and claim](#product-and-scope-business-ownership-creation-and-claim) | 18 |
| [Effective access evaluation](#engineering-contracts-effective-access-evaluation) | 52 |
| [Proposed storage model](#engineering-contracts-proposed-storage-model) | 54 |
| [Request lifecycle](#engineering-contracts-request-lifecycle) | 56 |
| [Review authority matrix](#engineering-contracts-review-authority-matrix) | 59 |
| [Proposed applicant API contracts](#engineering-contracts-proposed-applicant-api-contracts) | 61 |
| [Signup flow contract](#engineering-contracts-signup-flow-contract) | 65 |
| [Sessions, identity, and mode removal](#engineering-contracts-sessions-identity-and-mode-removal) | 67 |
| [Commit-sized delivery sequence](#implementation-examples-commit-sized-delivery-sequence) | 79 |
| [Decision table for a helper bid](#implementation-examples-decision-table-for-a-helper-bid) | 85 |
| [Phase 0 map entry points and capture the baseline](#delivery-and-rollout-phase-0-map-entry-points-and-capture-the-baseline) | 91 |
| [Legacy entitlement mapping](#delivery-and-rollout-legacy-entitlement-mapping) | 97 |
| [Deployment and rollback contract](#delivery-and-rollout-deployment-and-rollback-contract) | 101 |
| [Signup entry and intent selector](#wp-001) | 107 |
| [Provider and customer work side by side](#ac-025) | 234 |
| [Restaurant membership and assigned store scope](#wp-061) | 167 |

<div style="break-before: page; page-break-before: always;"></div>

<a id="chapter-index-2"></a>

**Reading guide** · Page 005 of 393

## Specialist and test index

| Start here | Page |
| --- | --- |
| [Accounts, Home, and public discovery closure](#product-by-product-closure-register-accounts-home-and-public-discovery-closure) | 34 |
| [Restaurants discovery, ordering, and guest service closure](#product-by-product-closure-register-restaurants-discovery-ordering-and-guest-service-closure) | 38 |
| [OxSteed Media and creator work closure](#product-by-product-closure-register-oxsteed-media-and-creator-work-closure) | 43 |
| [Money, Credit, billing, payouts, statements, and disputes closure](#product-by-product-closure-register-money-credit-billing-payouts-statements-and-disputes-closure) | 47 |
| [Consultant profile and referral pipeline](#wp-074) | 180 |
| [Investor reporting and audience access](#wp-077) | 183 |
| [Franchise application, review and territory](#wp-078) | 184 |
| [Logistics buyer and checkout](#wp-079) | 185 |
| [Payment roles and money movement](#wp-084) | 190 |
| [Personal and merchant Credit](#wp-086) | 192 |
| [Platform staff grants and governance](#wp-089) | 195 |
| [Media publisher and verification](#wp-042) | 148 |
| [Restaurant offline POS and store hub](#wp-072) | 178 |
| [Guest finds a task and signs up](#ac-001) | 210 |
| [Verified identity with approval still pending](#ac-026) | 235 |
| [Assigned consultant eligibility](#ac-050) | 259 |
| [Mixed application versions during migration](#ac-074) | 283 |
| [Feature rollback after approvals](#ac-079) | 288 |
| [Release evidence worksheet](#implementation-examples-release-evidence-worksheet) | 90 |
| [Server router inventory](#api-001) | 308 |
| [Browser route inventory](#web-001) | 377 |

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-product-mandate"></a>

**Product and scope** · Page 006 of 393

## Product mandate

An OxSteed account begins with customer access. A person may express an intent to offer services, run a business, operate a restaurant, or take on another role. The intent starts an application. The application records facts for a decision. The decision activates specifically authorized actions for that person. They can continue using their customer account during review.

After approval, the newly available action appears in its existing product context. The Jobs page may gain **Find work** and **Submit bid**. A restaurant’s schedule may gain **Manage shifts**. A business can gain the controls to publish a listing or onboard its team. The user keeps the same account, navigation, history, and position in an open task. Their access persists across sign-ins and devices, subject to the scope and lifecycle of the grant.

Implement the missing screens, services, authorization, recovery and operational steps required for every supported product journey. Use the [completion mandate](#required-new-work-and-completion-gates-full-product-completion-mandate) and [product closure register](#product-by-product-closure-register-accounts-home-and-public-discovery-closure) as the acceptance threshold for the whole program.

The owner requested a developer handoff. All proposed implementation names, API shapes, rollout choices, and examples in this document are design recommendations. The source snapshot is `0e2722d2ed6b6c201baefc805e9c90aad85f6b6d` on `old-files-claude`, inspected on November 16, 2026. Current source and proposed behavior are labeled where confusion would affect implementation. Recheck the default branch and deployed versions before writing migration or compatibility code.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [README.md](../README.md) · [modeRouter.js](../client/src/utils/modeRouter.js) · [modeRole.js](../server/utils/modeRole.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-decisions-already-made"></a>

**Product and scope** · Page 007 of 393

## Decisions already made

1. Every new person has customer access after normal account activation. The signup choice describes the person’s intended activity.
2. Choosing Helper or Business Owner opens relevant questions and an application. An authorized OxSteed reviewer approves the application.
3. A person can apply during signup or later from the work they want to do. People can continue using their account during review.
4. Approved capabilities accumulate. Everyday navigation and login never require switching a global role or changing the person’s account type.
5. Ordinary work continues in the existing task context. In a restaurant, a shift permission appears on its schedule. In Media, staff publish using the selected and authorized publisher.
6. The approver is the authority for the requested access. OxSteed reviews platform eligibility, and the authorized organization grants its memberships and delegated responsibilities.
7. Existing valid access, records, in-progress work, and ownership must survive the transition.

Convert these requirements into product tests at the beginning of implementation. Several later sections propose choices for error codes, storage layout, API namespaces, and policy mechanics. Confirm those against existing conventions. A code reader must be able to distinguish the intent of these decisions from incidental details of the current mode picker.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [ModeSwitcher.jsx](../client/src/components/ModeSwitcher.jsx) · [businessTeam.js](../server/routes/businessTeam.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-what-success-looks-like"></a>

**Product and scope** · Page 008 of 393

## What success looks like

Use one verified fixture user with customer and helper access. Sign in once. In the first tab, submit a bid to a job posted by another customer. In the second tab, post their own job or check a restaurant order. Complete both actions with the original session and without changing an account mode. A reload restores the same tab’s task. A stale tab cannot gain access to any new action merely by changing a client value.

Use a second fixture user who works in two restaurants. Promote that person at one location through the authorized approval flow. The same store schedule gains the management actions at that location within the existing interface. The other store continues to show the person’s employee actions. A direct request against the other store’s shift endpoint remains denied. A correct store identifier with a foreign shift identifier remains denied.

Complete onboarding and approval on a second device while a draft is open on the first. Approval requires no session replacement for navigation. Refresh the first device’s access projection without discarding the draft. Then revoke a scoped grant and verify that the next protected commit is denied, an active private view clears or changes to its permitted state, and customer actions continue.

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [scopeGates.js](../server/middleware/scopeGates.js) · [restaurants.js](../server/routes/restaurants.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-acceptance-boundary"></a>

**Product and scope** · Page 009 of 393

## Acceptance boundary

Shipping requires evidence across UI, API, PostgreSQL, staged release, and operations. A new sidebar item or approval record by itself cannot satisfy the end-to-end requirement. Verify the approved journey from a fresh checkout against the actual HTTP entry points, while varying account identity, membership, target record, location, and status. Direct routes, legacy aliases, sockets, exports, and workers are included wherever they can act on the same resource.

For each converted domain, capture the old authorized case, old denial behavior, expected new authorization, and exact test output. Preserve endpoint contracts relied on by existing callers through the documented compatibility window. Approve any intentional behavior differences before switching a cohort. A public catalog or checkout path must remain reachable to the same audience allowed by its domain policy.

Maintain a release table with code SHA, migration plan, migration run, per-domain feature flags, cohort, artifact identity, verification link, reviewer, and rollback triggers. Run destructive scenarios, payment simulations, and migration retries only in a disposable environment. Deploy and live checks belong to the implementation’s release process. The preparation of this document did not exercise production approval, payments, or private user journeys.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [ci.yml](../.github/workflows/ci.yml) · [deployment-ci.md](../docs/deployment-ci.md) · [RUNBOOK.md](../RUNBOOK.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-account-intent-application-and-approval"></a>

**Product and scope** · Page 010 of 393

## Account, intent, application, and approval

Treat the authenticated user as the stable actor. Store the person’s expressed intent, proposed access, review history, and granted access in durable records keyed appropriately to that actor. Identity and membership have different owners and lifecycles. Someone may verify identity once, request Helper for themself, and accept a role in a restaurant that belongs to another organization.

The request scope is the proposed subject of a decision. For an independent helper, the subject is the person. For business ownership, the subject is a particular business or an application to create or claim it. For staff, the subject is a particular business or permitted location. An entitlement answers what the person is eligible to do. Action authorization combines entitlement or membership with verification, domain state, and ownership.

Keep the selection of an active entity local to the action or route. A saved preference can bring a user back to their most recent restaurant. Its value never proves authority. Keep account and audience labels clear separately from the capability that helped render them. Never migrate a historic label into an unverified right to act on a business.

**Repository sources**  [modeRole.js](../server/utils/modeRole.js) · [scopeModel.js](../server/services/scopeModel.js) · [businessTeamController.js](../server/controllers/businessTeamController.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-vocabulary-and-user-facing-language"></a>

**Product and scope** · Page 011 of 393

## Vocabulary and user-facing language

Use **Offer services**, **Run a business**, **Apply to consult**, and **Request reporting access** where the user can identify the intended job. Use **My applications** or **Access requests** for a list of requests. In context, offer **Continue application**, **View status**, or **Add requested information**. When a request is approved, the user gets an understandable message that names the approved capability and where to use it.

Reserve **Role**, **Permission**, and **Grant** for staff interfaces, documentation, or situations where the user is already managing their team. Distinguish the person’s profile name from an organization’s display name when an action publishes, replies, pays, or invoices on behalf of the organization. Prefer a named entity in the UI, such as **Manage shifts at Birch Street Cafe**.

Translate full sentences in the established locale catalogs. Keep the application labels and status labels stable across signup, settings, notifications, and skill-specific entry points. Localize human-facing rejection reasons through a safe reason key where practical. Preserve reviewer notes only when marked suitable for applicant visibility. Confirm translated copy for pending, declined, revoked, and provider-unavailable states.

**Repository sources**  [common.json](../client/src/i18n/locales/en/common.json) · [signupValidation.js](../client/src/utils/signupValidation.js) · [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-common-shell-and-progressive-access"></a>

**Product and scope** · Page 012 of 393

## Common shell and progressive access

Keep a predictable place for customer tasks, messages, notifications, profile, and account settings. Place newly approved controls in the relevant section. Independent provider tools may need a substantial page while still using the same shell and navigation. Open that page through its normal action or link. Keep the current page and focus when an approval update can be reflected in place.

Avoid assembling every specialist’s actions into the primary navbar. Pin or prioritize only what the user uses, and put role-specific subsections under the relevant task area. A person approved for investing may see **Investor reporting** under their analytics or account area. A franchise operator may see territory controls inside the appropriate business area. By default preserve the user’s current Home and routine navigation.

Use existing route entry points when possible. A fully scoped URL remains bookmarkable, shareable to eligible recipients, and usable on reload. For context-dependent lists that aggregate multiple entities, retain a visible business or location label in every affected row and filter. Preserve independent continuation states across tabs.

**Repository sources**  [navbarNavigation.js](../client/src/utils/navbarNavigation.js) · [ModeHomeRoute.jsx](../client/src/components/ModeHomeRoute.jsx) · [SmartDashboard.jsx](../client/src/pages/SmartDashboard.jsx) · [BusinessSwitcher.jsx](../client/src/components/BusinessSwitcher.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-current-mode-coupling"></a>

**Product and scope** · Page 013 of 393

## Current mode coupling

Current signup stores a selected `defaultMode` in the registration flow. The server derives a role from the pending record when verifying OTP. Client routes choose a dashboard using the returned mode. The mode change endpoint updates `users.default_mode` and `users.role` together, then exchanges the previous sessions for a new one. The navbar changes its primary navigation and the picker reloads the page.

That coupling affects both navigation and API behavior. A route may read `req.user.role`, its own verification field, ownership, an organization permission, a feature flag, or several of those together. A user-visible mode catalog gives limited evidence about who can complete a specific server action. The mode picker is therefore a starting point for source discovery.

Keep identity management and session security semantics intact while moving ordinary task authorization to the underlying scopes. Keep legacy fields readable during compatibility and record precisely which callers still authorize using them. Converting one screen safely requires converting both its actual API paths and any aliases, link targets, and secondary commands that act on the same record.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx#L153) · [ModeSwitcher.jsx](../client/src/components/ModeSwitcher.jsx#L61) · [authController.js](../server/controllers/authController.js#L1634) · [authController.js](../server/controllers/authController.js#L2675) · [auth.js](../server/middleware/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-current-source-authorities"></a>

**Product and scope** · Page 014 of 393

## Current source authorities

Start at repository setup and operating instructions. For request locations, verify mount order in `server/index.js`, the active router, and the controller called by the route. A similarly named controller can be dead code or own a different alias. Read router-wide middleware and mount middleware alongside path-local checks. For browser navigation, follow the React route to its actual component and read the API client call.

Inspect schema through applied migrations and referenced models. Some historical design docs describe intended behavior at earlier dates. Use their rationale when helpful, then verify the implementation and current tests. Treat a unit test as evidence of its tested contract and a disposable PostgreSQL run as evidence of the executed schema and concurrency scenarios. Treat a physical device or production test as separate evidence with a recorded runtime identity.

Run targeted searches before assigning work. Include `default_mode`, `defaultMode`, `switchRole`, `switch-role`, and `operatingMode`. Also inspect `req.user.role`, `requireRole`, `scopeExempt`, the permission resolver, and legacy routes built without the main mode catalog. Recheck every line link after conflicting edits or a branch rebase.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [README.md](../README.md) · [index.js](../server/index.js) · [App.jsx](../client/src/App.jsx) · [permissionsService.js](../server/services/permissionsService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-account-role-inventory"></a>

**Product and scope** · Page 015 of 393

## Account role inventory

The web signup currently lists Customer, Helper, and Business Owner. The backend role map includes Investor, Logistics, Consultant, Tool Owner, Franchise Applicant, Life, business manager, representative, employee, support agent, restaurant customer, restaurant owner, restaurant manager, restaurant staff, restaurant runner, and Admin. Admin and Super Admin are retained by the role derivation for existing staff accounts.

The mode catalog, signup choices, runtime launch flags, granted roles, and actual route authorizations differ. A router entry proves that the source exposes a path, subject to mount, identity, and feature gates. The final product should apply a recorded authorization policy per capability. Operators should be able to trace a screen action back to the verified grant, existing membership, or legacy equivalent during migration.

Document hidden or dormant modes and historical accounts explicitly. Preserve their records and classify their access by source facts. Avoid an implicit rollout where selecting a stale mode accidentally enables a feature previously controlled by an environment flag. Preserve the applicable feature gates while capability approval adds eligibility.

**Repository sources**  [launchScope.js](../client/src/utils/launchScope.js#L13) · [modeRouter.js](../client/src/utils/modeRouter.js#L18) · [modeRole.js](../server/utils/modeRole.js#L25) · [launchGate.js](../server/middleware/launchGate.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-customer-account-requirements"></a>

**Product and scope** · Page 016 of 393

## Customer account requirements

After account verification, give the person the usual customer features and their own account history. Main cases include browsing helpers and jobs, requesting quotes, posting and managing jobs, messaging associated parties, placing and tracking food orders, and seeing personal orders, payments, and statements. Access for guest ordering and otherwise public browsing follows the existing product rules.

A pending application must never put a person into a different application-wide state. Any step that currently sends a new intending helper to an exclusive dashboard should instead open the relevant application or onboarding step inside the existing account shell. Preserve checkout, invitation, and deep-link returns. Read policy outcomes using the actual current user and route parameters.

Test an active user with no applications, a user with a pending helper application, and a verified and approved helper as customers. Their own order, job, and inbox behaviors should match for the same ownership and transaction state. Include a pending restaurant request in a job posting fixture. No restaurant capability should appear in the request or authorize a write before the designated decision.

**Repository sources**  [Dashboard.jsx](../client/src/pages/Dashboard.jsx) · [navbarNavigation.js](../client/src/utils/navbarNavigation.js#L30) · [jobs.js](../server/routes/jobs.js) · [food.js](../server/routes/food.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-helper-as-the-first-additive-journey"></a>

**Product and scope** · Page 017 of 393

## Helper as the first additive journey

On signup, collect only the helper application details required for the review. The initial set proposed here includes a service category, service area, profile details, and standing of required verification. Existing helper onboarding derives readiness from verified email, terms, contact and profile completion, and identity verification. Keep that source of evidence current.

Let an applicant complete their own private setup. Pending work can contain profile edits and verification progress. A verified identity result updates evidence for the application and any existing authorized module. Reviewer approval gives access to the named Helper capability, and bid, quote, profile publication, or payout still applies the rules of that action. Keep a blocked or unlisted helper’s public data consistent.

At the Jobs surface add distinct views for jobs posted and work sought. Keep job route identity and existing participant relationships available. A user must not be able to bid on their own job. Approval should reveal actions without resubmitting the person’s form, replacing the entire session, or changing other tabs. An eligible existing helper keeps their current jobs, bids, profile and financial history after account rollout.

**Repository sources**  [helperOnboarding.js](../server/services/helperOnboarding.js) · [helperRegistration.js](../server/routes/helperRegistration.js) · [bids.js](../server/routes/bids.js) · [HelperDashboard.jsx](../client/src/pages/HelperDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-business-ownership-creation-and-claim"></a>

**Product and scope** · Page 018 of 393

## Business ownership, creation, and claim

Collect the operating name, type, market and location, the applicant’s relationship to the business, and authority evidence where applicable. Consider a draft business record or bounded application proposal before review. Keep that draft private and non-operational. An applicant should be able to use their own account even when the draft needs more information or administration rejects the claim.

Distinguish three flows. Starting a new business has an approved canonical creation or activation step. Claiming an existing business needs a decision about an exact record with an ownership validation path. Joining an existing business uses a membership invitation or request. A general approval to operate a new business does not resolve disputes or supersede ownership of an already-existing business.

After approval, the business appears in existing navigation and operations panels. Preserve services, pricing, clients, bookings, team, finance, and media data on the canonical record. Every protected write derives its business from the target data. A verified business owner remains a customer and may have several independently scoped businesses. Treat transfers, ownership succession, and entity deletion as domain operations with their own permissions and audit.

**Repository sources**  [businesses.js](../server/routes/businesses.js) · [businessController.js](../server/controllers/businessController.js) · [scopeModel.js](../server/services/scopeModel.js#L318) · [BusinessOwnerDashboard.jsx](../client/src/pages/BusinessOwnerDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-restaurant-as-a-business-with-location-controls"></a>

**Product and scope** · Page 019 of 393

## Restaurant as a business with location controls

A restaurant owner application can capture store details, operating identity, location, authorized representative, and merchant-specific prerequisites. Reuse the authoritative relationship between restaurant and business. Keep pre-approval setup private. When the verified request is accepted, reveal menus, ordering, device management, operations, and eligible finance features in the existing restaurant or business context.

Restaurant staff receive permissions from their employer and for applicable locations. A manager may have authorization to change one store’s inventory or rota and read only their own shifts at another. Canonicalize restaurant, business, location, and child record relationships on the server. Public menus, guest shopping, and customer order tracking use the original customer-facing policies.

Protect device identities and terminal sessions separately from human memberships. A cashier or kitchen display is bound to the assigned store. Changing a manager’s scope cannot reassign a reader, expose another restaurant’s till, or change the authority for a card payment. Preserve service-cycle, shift, payroll, tip, settlement, statement, and offline-reconciliation safeguards. Include multi-location and wrong-store fixtures.

**Repository sources**  [scopeModel.js](../server/services/scopeModel.js#L228) · [restaurants.js](../server/routes/restaurants.js) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx) · [README.md](../native/RestaurantTerminalOffline/README.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-delegations-and-the-promotion-metaphor"></a>

**Product and scope** · Page 020 of 393

## Delegations and the promotion metaphor

A business staff promotion changes the person’s allowed actions at that organization. Keep a familiar place for their tools and reveal the additional controls gained. Verify the reviewer’s current authority in the same entity and location, including restrictions on granting a role or adding permissions. Record the membership or invitation as the source of the access.

Use a separate rule for acting on the platform’s behalf. Internal admin, refunds, compliance, support, and operational privileges keep their staff channels and approval chains. A prospect cannot discover an ordinary signup option that grants internal authority. If a work invitation legitimately leads to account creation, resolve the invitation after email verification using its audience and expiry rules.

Consider concurrent changes. An applicant hired by two organizations can accept both invitations. An expired invitation should never create a role. Removing one site or its delegator must leave unrelated access intact. Direct endpoints must use the exact target business or location even when the most recent workspace is different.

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [vortex.js](../server/routes/vortex.js) · [adminAuth.js](../server/middleware/adminAuth.js) · [businessTeamController.js](../server/controllers/businessTeamController.js#L498)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-specialist-access-and-related-services"></a>

**Product and scope** · Page 021 of 393

## Specialist access and related services

Investor access is scoped reporting. Identify what audience and datasets a reviewer may grant. Establish the same rule for metric drill-down, exports, and cached reads. Consultant access can cover profiles, service area, referral workflow, scheduling, and paying transitions with distinct prerequisites. Franchise applicant progress and approved territory operations are distinct capabilities tied to the application and territory.

Tool owner activity covers listing, handoffs, deposits, and disputes under its domain guards. Logistics has buyer, organizer, procurement, distributor, and internal work areas. Grant access to the appropriate lane, account, business, or function. Personal Life features have personal ownership and are ordinary personal access where launched. Products such as Direct, Media, Careers and Learn may have action or publisher eligibility independent of the account mode.

Keep the UI entry points situational. A buyer can use ordinary purchasing where available without a seller application. From rental tools, an eligible person can request **List equipment**. A consultant can continue reading their existing messages or bookings while a new referral privilege is pending. Each specialist integration contains its own decision table and a scope check at the actual domain operation.

**Repository sources**  [investor.js](../server/routes/investor.js) · [consultantNetwork.js](../server/routes/consultantNetwork.js) · [franchise.js](../server/routes/franchise.js) · [toolRentals.js](../server/routes/toolRentals.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-terms-and-unresolved-product-policy"></a>

**Product and scope** · Page 022 of 393

## Terms and unresolved product policy

Before implementation of a given capability, obtain the owning team’s answers to the remaining policy questions. Record the policy version, its effective time, allowed reviewer classes, evidence requirements by market, and the precise actions eligible in each outcome. For owners, distinguish authorization to prepare a business, publish its listing, place orders, and access sensitive financial tools. For helpers, distinguish profile preparation, listing, bidding, accepting work, and payments.

Document grant lifetime, revocation triggers, reinstatement, treatment of existing contracts, and which information can be shown in application history. Establish operational review expectations before promising a turnaround. Sensitive case information and uploaded evidence require an approved retention policy. Country coverage and payout prerequisites remain owned by the relevant domains.

Pick an explicit status and reviewer for every exception. Examples include previously approved businesses with changed ownership, a stale manual identity review alongside a verified provider result, and investor access that has lost its sponsor. Assign the unresolved question to the product or domain owner. Keep the feature flag or specific action closed until the policy and verifier for the changed path are settled.

**Repository sources**  [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js) · [permissionsService.js](../server/services/permissionsService.js) · [privacy.js](../server/routes/privacy.js) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-and-scope-delivery-ownership-by-work-package"></a>

**Product and scope** · Page 023 of 393

## Delivery ownership by work package

Assign owners by contract boundary. An identity and applications owner controls signup, request persistence, evidence status, and applicant-facing responses. A permissions owner controls capability resolution, scope checks, revocation, and high-risk transaction patterns. Frontend owners implement in-context setup and capability rendering using the shared projection. Domain owners own the corresponding write paths, side effects, and current client behavior.

Define package acceptance before coding. Put a link to the relevant route and existing tests in each pull request. Keep additive schemas and compatibility changes separable so an old web or native build can continue making its supported requests. Coordinate shared modules and migrations with developers working concurrently. Use the repository’s timestamp naming rules and allocate filenames against the current default branch.

An implementation lead owns backfill design, policy decisions, shadow comparisons, and enablement sequencing. A release owner verifies the exact build and database, receives rollback responsibility, and tracks post-release issues. Prepare consumer and operator release notes only when the feature’s scope and cohorts are known. Record which behaviors still need assigned customer or staff live verification.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [README.md](../README.md) · [deployment-ci.md](../docs/deployment-ci.md) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-full-product-completion-mandate"></a>

**Required new work and completion gates** · Page 024 of 393

## Full product completion mandate

Implement every missing part of the progressive access experience needed to complete a supported product journey. A gap can be a missing screen, form, operational tool, API, authorizer, domain activation, persisted state, migration, notification, error path, or verification fixture. Build the missing part and connect it to the real product entry points. An existing feature qualifies for reuse after the developer traces its behavior under the new model and proves the complete journey.

Every affected product has a completion record, even when it can reuse its current implementation. Start with the product register in this document, then derive the full set of supported actions from UI routes, server mounts and controllers, jobs, integrations, and device and mobile contracts. Give each missing or incomplete piece an implementing work item, owner, dependency, and pass condition before its product can be closed.

Deliver the program through incremental releases. A pilot establishes one complete path and remains a pilot until the rest of the product matrix closes. Treat newly discovered broken or missing steps within a required journey as implementation work. Reconcile the register as the code changes. Keep any unmet product or live dependency visible, owned, and backed by a concrete next action.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [App.jsx](../client/src/App.jsx) · [index.js](../server/index.js) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-gap-classification-and-work-ledger"></a>

**Required new work and completion gates** · Page 025 of 393

## Gap classification and work ledger

Record current state at action level. Use **Build** for a required behavior with no end-to-end implementation, **Complete** for a partial path or a missing layer, **Adapt** for a working behavior whose authority or entry point depends on the active mode, and **Verify** for existing behavior that already appears to satisfy the target. Status can change when deeper inspection finds missing wiring or incompatible data. Document that finding and assign the work.

| Field | What to enter |
| --- | --- |
| Identifier | Product, role, resource, user action and version or surface |
| Baseline | Actual working entry point, exact source, and observed result |
| Missing layer | UX, API, data, permission, integration, recovery, or release evidence |
| Work | Build, Complete, Adapt, or Verify and implementation owner |
| Completion | Expected server and user outcome, test fixture and evidence |
| State | Planned, implemented, verified on candidate, or open dependency |

An endpoint or mock can support the baseline entry, but milestone status requires observed behavior. If a previously assumed capability is absent, create the full package from intake through real usage. Link migrations, decisions, and verification to the same identifier so a successor can continue open work.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [scopeGates.js](../server/middleware/scopeGates.js) · [routeScopeGuard.test.js](../server/__tests__/routeScopeGuard.test.js) · [App.jsx](../client/src/App.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-build-customer-first-signup-and-durable-intent"></a>

**Required new work and completion gates** · Page 026 of 393

## Build customer-first signup and durable intent

The inspected general signup path lets the user select a mode and derives the account role from the pending registration after OTP. Build the target account-creation contract. Every ordinary signup activates customer access, even when the applicant selected Helper or Business Owner. Preserve their expressed intent as a resumable application or a durable link to resume it. Store and validate the intent on the server separately from the access grant.

Build the in-context continuation UI and backend association with the verified account. The form pre-fills known data, explains the next step, persists a private draft and supports submit or finish later. Make the customer account usable if the application step is interrupted or its service is unavailable. Preserve device, invite, quote, and checkout continuations from the existing flow. Route legacy signup payloads into the same safe behavior.

Close the gap with an HTTP and browser journey at the real entry point. Confirm successful signup, initial role and access, no helper or business writes before approval, own customer action, resumable application, and approval showing the right controls. Record both server side effects and the actual screen.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx#L153) · [authController.js](../server/controllers/authController.js#L1634) · [auth.js](../server/routes/auth.js) · [signupReliability.test.js](../server/__tests__/signupReliability.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-build-the-scoped-application-and-decision-lifecycle"></a>

**Required new work and completion gates** · Page 027 of 393

## Build the scoped application and decision lifecycle

The existing platform approval table provides one row for each user and mode and lists requested, approved, rejected, and revoked statuses. Build or extend storage for independent subjects and durable evidence revisions, editable drafts, submission, review, requests for more information, resubmission, withdrawal, approval, decline, and a history of grant revocation or expiry. Define which transitions can be replayed and which require the latest review version.

Build the applicant APIs and status views. Build reviewer list, detail, evidence, and mutation paths scoped to the actual decision authority. Provide bounded queue search, clear reason messages, protected attachments, audit trail, and recovery from a failed downstream step. Reuse canonical identity and membership records. Persist the exact approved scope and link to the authoritative entity after provisioning.

A complete implementation proves the whole loop. The user sends an incomplete submission, receives a specific request for information, adds it, and a current authorized reviewer approves. The person sees the new action in context and performs the intended work. Verify concurrent reviews, expired reviewer, applicant withdrawal, duplicate request, stale evidence, and forbidden reads at all entry points.

**Repository sources**  [272_mode_platform_approvals.sql](../server/migrations/272_mode_platform_approvals.sql#L76) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [ModeApprovals.jsx](../client/src/admin/pages/super/ModeApprovals.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-build-independent-access-and-in-place-activation"></a>

**Required new work and completion gates** · Page 028 of 393

## Build independent access and in-place activation

The current switch action edits the user’s default mode and role and replaces sessions. Build the server-owned access resolution needed to hold several effective capabilities under one identity. Distinguish direct authorization, organization membership, verification and product-level checks. Select the exact resource in each operation and resolve as much as possible from canonical ownership, actor and membership records.

Build the minimal client projection and updates that let a page gain or lose an action without discarding the task. Replace global role-changing navigation with ordinary in-app access to customer, provider, and authorized entity tasks. Preserve a familiar Home, Messages, and account experience. Add status or request affordances where people discover new actions. Deal with expired access, revoked access, unavailable snapshots, and concurrent changes in other tabs.

Close with the two-context journeys in Product and Scope. One person simultaneously performs valid customer and helper actions. Another person gains staff authority at one store and lacks it at another. No arbitrary intent, browser mode, or token hint grants new authority. Check deep links, refresh, old clients, and protected writes with a stale UI.

**Repository sources**  [authController.js](../server/controllers/authController.js#L2675) · [scopeModel.js](../server/services/scopeModel.js) · [ModeSwitcher.jsx](../client/src/components/ModeSwitcher.jsx) · [AuthContext.jsx](../client/src/context/AuthContext.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-build-review-coverage-and-downstream-activation-for-each-product"></a>

**Required new work and completion gates** · Page 029 of 393

## Build review coverage and downstream activation for each product

A product approval is operational only when it reaches the database facts and server gates that perform the requested action. Each approved request needs an explicit effect. It may grant a personal capability, activate a known business relationship, accept an employer invitation, or permit a particular location or dataset. Implement the provisioning path whenever the product currently assumes the active mode will provide it.

For a business applicant, the authorized decision activates or links one intended business. Implement private setup, identity and ownership checks, conflict resolution paths and actionable review status where they are missing. For a restaurant, proceed through site-level activation and domain prerequisites. For other products, connect the accepted fact to their real actions, such as listing a tool or viewing approved reporting. Preserve any canonical workflow that already fulfills those requirements.

Each product team must implement its status-to-action mapping, concrete authorization integration, and revoke or expiry behavior. Include the operator who makes the decision, the signed-in user who uses the new privilege, affected users whose rights should stay the same, and intentional negative controls.

**Repository sources**  [businessTeamController.js](../server/controllers/businessTeamController.js) · [businesses.js](../server/routes/businesses.js) · [restaurants.js](../server/routes/restaurants.js) · [investor.js](../server/routes/investor.js) · [toolRentals.js](../server/routes/toolRentals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-build-decision-visibility-support-and-recovery"></a>

**Required new work and completion gates** · Page 030 of 393

## Build decision visibility, support, and recovery

When a request enters review, show the user what has happened and their next option. After review, show the capability, the named entity when relevant, and the original place from which they can use it. When more information is needed, show exactly what to change. If an approval needs provisioning or additional setup, present its real pending state and a safe resume action. Build these surfaces and reliable notifications where they are absent.

Give authorized reviewers the means to request information, consult evidence, handle a duplicate or claim conflict, and identify the difference between a failed delivery and a failed issuance. Give customer support a permission-scoped status and escalation path. Use existing staff and notification infrastructure where it meets the real audience and lifecycle. Make revocation effective for subsequent sensitive writes and visible in the client without changing unrelated work.

Test intentional failure and restart points. One case recovers after account creation succeeds and request provisioning times out. Another recovers after grant commits and notification fails. A third remains private while a reviewer’s authority changes. Record a usable recovery outcome for each role, including ordinary customers.

**Repository sources**  [notifications.js](../server/routes/notifications.js) · [adminMessageOutbox.js](../server/routes/adminMessageOutbox.js) · [support.js](../server/routes/support.js) · [SettingsPage.jsx](../client/src/pages/SettingsPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-end-to-end-proof-sheet-for-each-action"></a>

**Required new work and completion gates** · Page 031 of 393

## End-to-end proof sheet for each action

For each required action, run its complete path from the relevant discovery or saved link to persisted outcome and later retrieval. Repeat through the ordinary browser and every applicable supported API or device client. Include older accounts created before migration and fresh users created after it. Use multiple organizations, locations, and personas. Compare related lists, detail pages, dashboard badges, exports, API aliases, mobile API and realtime events where the product exposes them.

Capture eight observations for the action. Record entry point and prerequisites, applicant or participant journey, authoritative mutation, inspection of the durable record, expected downstream effect, independent allowed actor, denied counterpart, and recovery after an interruption or recheck. For approvals, exercise the approver who receives the request and the user who later gains or loses the new action. For money or external providers, add isolated reconciliation and authorized release evidence.

A feature can pass automated verification while still awaiting an authorized provider or production test. Mark that evidence as open. Preserve measurable progress and finish every check required for the intended release. A code path, route flag, UI mock, or list count on its own does not close a journey.

**Repository sources**  [ci.yml](../.github/workflows/ci.yml) · [AGENTS.md](../AGENTS.md) · [permissionResolver.db.test.js](../server/__tests__/permissionResolver.db.test.js) · [routeScopeGuard.test.js](../server/__tests__/routeScopeGuard.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-experience-quality-across-users-and-devices"></a>

**Required new work and completion gates** · Page 032 of 393

## Experience quality across users and devices

Verify the account experience for guests where supported, ordinary customers, first-time applicants, users needing more information, approved and revoked users, reviewers, people operating multiple businesses, and legacy users. Confirm direct entry, search and recognition, in-context setup, clear progress, error retry, return to drafts, meaningful empty states, and preserved context.

Use real small-screen and desktop layouts and supported devices. Check defined locales, Arabic right-to-left flow, keyboard access, screen-reader status and errors, touch targets, theme contrast, and names or labels that wrap. Ensure usability on slower connections and during background resume. Preserve public browsing and customer purchase paths alongside provider operations. For cases involving money, display the correct account, scope, currency and confirmation. In messaging and publishing, display the actual identity being represented.

Capture performance and reliability against the supported baseline and agreed budgets. Investigate regressions in page readiness, request latency, network cost, recurrent errors, and timing of access refresh. Fix quality defects that block or confuse a supported journey. Verify behavior again after repair using similar personas and contrasting scopes.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [product-accessibility-2026-11-03.md](../docs/reviews/product-accessibility-2026-11-03.md) · [pwa-continuity-2026-10-23.md](../docs/pwa-continuity-2026-10-23.md) · [package.json](../client/package.json)

<div style="break-before: page; page-break-before: always;"></div>

<a id="required-new-work-and-completion-gates-product-closure-and-release-accountability"></a>

**Required new work and completion gates** · Page 033 of 393

## Product closure and release accountability

Close a product when all supported actions have both implementation and accepted evidence at the intended scope. A complete product record covers customer and operator access, relevant application and activation, all applicable device or API entry points, negative authorization tests, private data boundaries, historical records, finished work and recovery. Take responsibility for adjacent services that must function for a user to finish the journey, such as auth, notifications, uploads, realtime, provider callbacks, statements and support.

Product owners confirm expected behavior and unresolved policy decisions. The implementing developer records the exact commit, migrations, test environments, test and holdout results, actual release behavior and remaining checks. Fix issues found in the run and repeat affected verification. Preserve deployment safety and known obligations when a product must be paused or rolled back.

A pilot or a dependency that still needs live verification remains open in the program record. Keep evidence status accurate and move other independent work forward. The program is complete only after every product record closes its required journeys and the released build is verified end to end.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [RUNBOOK.md](../RUNBOOK.md) · [deployment-ci.md](../docs/deployment-ci.md) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-accounts-home-and-public-discovery-closure"></a>

**Product-by-product closure register** · Page 034 of 393

## Accounts, Home, and public discovery closure

Prove that a person can discover public jobs, helpers, restaurants, and other launched products, enter a valid customer action and return to it after signup. Pursue Helper and Business Owner intent in separate accounts and complete review. Confirm the original person can still use customer tools and shareable links throughout. Verify a signed-out visitor, registered customer, pending applicant, approved dual-role user, suspended role and existing legacy account.

Build any missing verified signup resume, access status card, current access API, or stable navigation needed for these journeys. Preserve account recovery and security features, search and location preferences, notification history, in-progress profile edits, and familiar Home. Include protected deep links and old mode-related links on supported clients. Verify loading, empty, wrong-scope, unable-to-load, and no-applicable-access states.

Close with server proof that no role or identity write occurs during routine navigation. A signup choice never grants the underlying privilege. An authorized task can be opened directly and on reload, with unrelated customer data and actions still available.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [SmartDashboard.jsx](../client/src/pages/SmartDashboard.jsx) · [discover.js](../server/routes/discover.js) · [auth.js](../server/routes/auth.js) · [mainApp.js](../server/routes/mainApp.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-marketplace-customers-helpers-and-services-closure"></a>

**Product-by-product closure register** · Page 035 of 393

## Marketplace customers, helpers, and services closure

Trace a customer from discovery, profile and quote or job request through bid, booking, schedule changes, delivery, authorized completion, payment, and post-work review or dispute. Trace a helper through application, profile and verification, approval, bidding and assignment, performed work, earnings and records. Include independent provider visibility, customer ownership, chat behavior, repeat booking or repeat quotes, and the established cancellation policy.

Build missing links between the new helper decision and real listing, bids, quotes or other authorized provider work. Complete any missing application status, availability, navigation or denied-action recovery required for supported paths. Preserve historical jobs and contracts under their owning rules. Apply self-bid, double accept, verified standing and party checks after adding eligibility.

The same account must complete a valid job posted as the customer and participate as a helper in a different job. Prove separate actor roles on each object, exact side effects, one financial reconciliation, correct messages, no foreign records, and no session or mode mutation.

**Repository sources**  [jobs.js](../server/routes/jobs.js) · [bids.js](../server/routes/bids.js) · [helperQuotes.js](../server/routes/helperQuotes.js) · [bookings.js](../server/routes/bookings.js) · [HelperDashboard.jsx](../client/src/pages/HelperDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-oxsteed-direct-closure"></a>

**Product-by-product closure register** · Page 036 of 393

## OxSteed Direct closure

Exercise public service discovery, quote intake, returning after verification or sign-in, quote changes, booking, scheduled work, payment, proof or receipt, history, and support. Use one visitor without an account, one normal customer, and one customer acquiring provider or business access while a Direct task is open. Include actual customer and authorized operator cases.

Build any missing in-place account continuation and permission adapters for Direct customer or operator workflows affected by the mode retirement. An unrelated grant must never assign someone to Direct’s privileged staff operations. Check catalog, quote triage, calendar, jobs, payment, customer history and internal reports against their actual guards. Preserve original quote, customer and payment IDs through return and reload.

Close with one supported browser journey and mounted routes confirming a scope-valid flow. Confirm quote and booking recovery under retries and preempted sessions, direct denial for a mismatched actor, and receipt attribution. Use isolated payment testing and retain existing idempotency and cancellation rules.

**Repository sources**  [direct.js](../server/routes/direct.js) · [directController.js](../server/controllers/directController.js) · [directBookSlotAuth.test.js](../server/__tests__/directBookSlotAuth.test.js) · [App.jsx](../client/src/App.jsx#L536)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-business-hub-and-organization-teams-closure"></a>

**Product-by-product closure register** · Page 037 of 393

## Business Hub and organization teams closure

Start with a new owner application, an existing business claim, and an authorized staff invitation. For each, verify offer, approval, grant, in-context activation and revocation. Run separate owners, managers, representatives, employees and support agents through their actual tools, using scoped organization IDs. Verify business services, products, prices, clients, calendar, inbox, team management, marketing, reports, quotes, invoices and applicable finance.

Build private setup, exact owner review or placeholder-to-canonical provisioning and any required role management gap discovered in these journeys. Bring authorized access from current ownership and memberships. Update screens whose only gate is former account mode. When a template has unique operational workflows, complete its permitted request, assignment, use and record history. Include property, trade, care, appointments, creative and professional templates that are supported at release.

Close with two companies and different grants for one identity. Switch tasks via ordinary navigation, publish and manage using the correct company, decline a denied cross-company write, and inspect existing records and notifications after a membership change.

**Repository sources**  [businesses.js](../server/routes/businesses.js) · [businessTeam.js](../server/routes/businessTeam.js) · [businessOperations.js](../server/routes/businessOperations.js) · [businessHubRoleMenu.js](../client/src/utils/businessHubRoleMenu.js) · [template-business-modes-roadmap.md](../docs/template-business-modes-roadmap.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-restaurants-discovery-ordering-and-guest-service-closure"></a>

**Product-by-product closure register** · Page 038 of 393

## Restaurants discovery, ordering, and guest service closure

Run discovery, restaurant storefront, menu, item configuration, availability, guest or signed-in ordering, permitted payment, queue and order tracking, pickup or delivery, and customer support. Review one open store and a store with different visibility and ordering states. A restaurant owner who is also a customer can buy from another business without exposing its merchant tools or moving the order into the wrong account.

Build missing owner intake status and any link from approved storefront setup to opening the right store’s manage controls. Verify publication and ordering states stay with the restaurant domain. Validate public response caching, branded or legacy links, device views, and customer order association when someone signs up with a different product intent during checkout.

Close with a complete isolated service cycle, each supported ordering path, and the resulting POS or kitchen state, receipt, customer history, and status display. Validate removed or closed catalog records, denied store mutations, mapped legacy paths, and valid customer resumption during access changes.

**Repository sources**  [food.js](../server/routes/food.js) · [restaurants.js](../server/routes/restaurants.js) · [App.jsx](../client/src/App.jsx#L741) · [SERVICE-CYCLE-2026-10-24.md](../docs/restaurant-franchise/SERVICE-CYCLE-2026-10-24.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-restaurant-operations-workforce-hardware-and-delivery-closure"></a>

**Product-by-product closure register** · Page 039 of 393

## Restaurant operations, workforce, hardware, and delivery closure

For an existing owner and a new approved owner, complete assigned site setup, staff invitation, management grant and revoke. Cover menus, store controls, brand, sites, reservations and hosting, POS and drawers, kitchen, kiosk, display pairing, inventory, supplier workflow, shifts, time clock, staff pay and tips, checklists, training, audits and operations reports where supported. Complete delivery dispatch, driver or runner assignment, handoff, proof, issues and customer tracking.

Build missing restaurant- or location-scoped upgrade entry points, capability projection, and domain permission integration. Keep named person, cashier, device and restaurant identities distinct. Validate prerequisites for a display, reader, terminal lease and store hub. Fix any missing handoff between team changes and server authorization that prevents correct operations at either site.

Close with separate physical or supported device tests for the surfaces in use. Reconcile applicable isolated payments and offline permits. Run a real two-site fixture, including dashboard reads, child-ID substitution, device misuse, employee to manager in-place promotion, account scopes and existing workforce records after a role change.

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [runner.js](../server/routes/runner.js) · [localDelivery.js](../server/routes/localDelivery.js) · [restaurantDevices.js](../server/routes/restaurantDevices.js) · [README.md](../native/RestaurantTerminalOffline/README.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-products-carts-sharing-and-purchase-closure"></a>

**Product-by-product closure register** · Page 040 of 393

## Products, carts, sharing, and purchase closure

Trace public catalog visibility, product details, saved and shared carts, price or inventory changes, checkout, fulfillment, cancellation and order history. Verify independent product listings from a helper and a business, including requesting and gaining seller access where the applicable product policy requires it. A business buyer and a person can use the same login and maintain separate accounts and order scopes.

Build any missing tool that connects approval to the relevant seller/resource action. Complete private seller drafts, authorizer integration, requested publication and storefront association where the flow previously depended on a single selected mode. Preserve existing purchase, stock, pricing, guest and materials workflows. Validate existing digital or fulfillment assets based on their real scope.

Close with at least one buy while seller access is pending, one valid listing after approval, a replay-safe purchase, and a denied order or product action against another business. Prove stock and order changes on the right record, the correct confirmation and history currency, and safe loss of seller access.

**Repository sources**  [marketplaceProducts.js](../server/routes/marketplaceProducts.js) · [businessProducts.js](../server/routes/businessProducts.js) · [cartCheckout.js](../server/routes/cartCheckout.js) · [sharedCarts.js](../server/routes/sharedCarts.js) · [orders.js](../server/routes/orders.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-tool-rentals-closure"></a>

**Product-by-product closure register** · Page 041 of 393

## Tool Rentals closure

Run a customer from browsing through booking, pickup, return, deposit result and dispute. Run an owner from the **List equipment** action through any required application, private listing setup, authorization, public availability, booking review, handoff and receipts. Verify an existing rental and separate new-listing eligibility when the owner’s access changes.

Build missing access intake and activation if the product still relies on the Tool Owner mode for operational entry. Connect approved listing access to its specific person or business, and apply the listing moderation, booking, payout and deposit checks. A person renting another owner’s tool should not need to leave that purchase path to gain listing rights.

Close with a synthetic listing, reservation, dispute state and payment reconciliation. Test wrong owner and wrong listing, expired pickup, held content, cancellation and a late retry. Verify the listings, owner calendar, renter history, notifications and receipts all agree.

**Repository sources**  [toolRentals.js](../server/routes/toolRentals.js) · [ToolOwnerDashboard.jsx](../client/src/pages/ToolOwnerDashboard.jsx) · [toolRentalModerationHold.test.js](../server/__tests__/toolRentalModerationHold.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-logistics-and-local-delivery-closure"></a>

**Product-by-product closure register** · Page 042 of 393

## Logistics and local delivery closure

Trace buyer sourcing, purchasing, shipment tracking, claims and support. Verify organizer request and approved pooled orders, business procurement and restock, distributor fulfillment, operations freight and warehouse work, compliance, and restricted internal controls. Run delivery separately through scheduling, dispatch, operator assignment, progress, proof, reconciliation and history wherever applicable.

Build missing grants, application or invitation continuations and actor-aware routing for organizer, buyer, buyer-for-business, distributor or delivery assignment where existing role checks prevent the intended task. Verify lane, market, campaign, buying entity, assigned shipment and internal staff boundaries. Maintain affected launches and provider limits via current policy.

Close with a legitimate buyer and a pooled organizer using the same identity without conflating purchases. Add a multi-business procurement case and a delivery operator with two distinct assigned scopes. Match warehouse, shipment, information exposure, and finance effect to the right participants. Exercise manual exceptions, inactive lanes, expiry and recovery where supported.

**Repository sources**  [logistics.js](../server/routes/logistics.js) · [logisticsAdmin.js](../server/routes/logisticsAdmin.js) · [localDelivery.js](../server/routes/localDelivery.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-oxsteed-media-and-creator-work-closure"></a>

**Product-by-product closure register** · Page 043 of 393

## OxSteed Media and creator work closure

Run guest discovery, Nearby and search, profile or Space navigation, and share previews. As a current customer plus an approved publisher, complete draft, attachments, verification, post, edit, removal, linked product and normal interactions. Verify restaurant federation and source removal. Test reporting, appeals, moderator takedown and access scoping separately. Creator gigs, tips, sponsorships and boosts require their own authorized workflow and isolated settlement checks.

Build missing publisher choices, application redirects, action controls and grant or revocation checks for every applicable product actor. Verify **Posting as** and entity card scope for personal, helper, business, and restaurant contexts. Keep scanning, quarantine, processing, and media moderation rules independent. Provide a reliable path for legitimate draft recovery after an account access change.

Close with public and signed-in route checks, scoped denial and data verification. Test a user who approved one business and lost another with drafts open. Verify their actual session and never expose private evidence, wrongly revive a held asset or mix creator or buyer wallets.

**Repository sources**  [media.js](../server/routes/media.js) · [mediaAdmin.js](../server/routes/mediaAdmin.js) · [MediaComposePage.jsx](../client/src/pages/media/MediaComposePage.jsx) · [oxsteed-media-completion-goal.md](../docs/oxsteed-media-completion-goal.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-careers-learn-and-personal-life-closure"></a>

**Product-by-product closure register** · Page 044 of 393

## Careers, Learn, and personal Life closure

Careers needs candidate discovery, application, history, messaging or interview where applicable, and separate authorized employer recruiting and applicant records. Learn needs public or authenticated content, personal progress and any authorized contribution workflow. Life needs private goals, planned needs, expenses and maintenance, including legitimate links to customer work. Test across people who hold personal and organization roles at the same time.

Build or complete entry and action checks revealed by removing active mode. An employer hiring grant requires a verified business or location, a product and role check, and private candidate safeguards. A Learning or Life personalization choice may suggest an action and link to an application when needed. Carry existing history and approval state into the new experience.

Close with one complete candidate and employer interaction, a learning or personal plan resumed after capability change, and direct denial for employer reads of other company applicants or employee personal data. Keep proof for enabled languages, underlying private routes, notification return and historical data.

**Repository sources**  [careers.js](../server/routes/careers.js) · [learn.js](../server/routes/learn.js) · [lifeDashboard.js](../server/routes/lifeDashboard.js) · [plannedNeeds.js](../server/routes/plannedNeeds.js) · [HANDOFF.md](../docs/careers/HANDOFF.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-consulting-and-business-launch-closure"></a>

**Product-by-product closure register** · Page 045 of 393

## Consulting and business launch closure

Run a customer or aspiring owner from advisory discovery through intake, appointment, scoped communication, actions, and the applicable invoice or payment. Run the consultant from approved pathway through eligible profile, availability, assigned referral, protected client data and permitted paid transitions. Verify the same user can be a customer and adviser in clearly identified records.

Build consultant application, decision integration and in-context controls where current policy covers only some actions. Connect an existing authorized adviser to their service or referral scope without reissuing unrelated business authority. Complete explicit prerequisites for paid transitions, booking, service areas and supported visit types.

Close with current approved, pending, expired and absent eligibility across separate referral assignments. Verify a normal applicant waiting on business ownership can receive consulting help. Confirm notes, client history and compensation respect audience and isolated financial operations. Exercise recoverable decline, service outage, reschedule, and current provider rules.

**Repository sources**  [consultantNetwork.js](../server/routes/consultantNetwork.js) · [consultantScheduling.js](../server/routes/consultantScheduling.js) · [businessLaunch.js](../server/routes/businessLaunch.js) · [consultingPayment.js](../server/routes/consultingPayment.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-franchise-and-investor-closure"></a>

**Product-by-product closure register** · Page 046 of 393

## Franchise and investor closure

Begin a franchise proposal, submit required diligence, route an authorized decision, track agreement and activation, and reach assigned territory tools. Test applicant, operator, reviewer and unauthorized user. For investor reporting, request a specific audience, approve it, and verify scoped KPI, chart, evidence and applicable export paths through expiry or revoke.

Build the missing application and projection components for these products where current dashboard or role eligibility is insufficient. Preserve distinct ownership of each franchise proposal and territory. Implement controlled read scope for investor results and prevent privileged drill-down or export from revealing unrelated records. Trace all older ask or invite paths and ensure they can continue appropriately for existing valid accounts.

Close with two territories or audiences, contrasting approvals, and reconciliation of authorized reads, activation and secure loss of access. Confirm public information, customer features, underlying analytics and old case histories remain correct.

**Repository sources**  [franchise.js](../server/routes/franchise.js) · [investor.js](../server/routes/investor.js) · [investorController.js](../server/controllers/investorController.js) · [FranchiseTerritoryOpsPage.jsx](../client/src/pages/FranchiseTerritoryOpsPage.jsx) · [InvestorDashboardPage.jsx](../client/src/pages/InvestorDashboardPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-money-credit-billing-payouts-statements-and-disputes-closure"></a>

**Product-by-product closure register** · Page 047 of 393

## Money, Credit, billing, payouts, statements, and disputes closure

Trace how the person or business pays and receives money in applicable products, including verification, account selection, confirmation, retries, refund or dispute, and historical statements. Identify customer, personal provider, business, restaurant, staff and administrator identities. Validate personal and entity wallets, currencies, ledger history, account ownership, payouts, subscriptions, payroll or tips, transaction limits, and separate compliance permissions as applicable.

Build missing scoped controls and permission bridges needed to make actions fully usable under the new model. Reuse the authoritative money and ledger services, access checks, and idempotency. Preserve audit, limits, existing financial commitments and statement history. Validate step-up, issuance, download, export and status according to actual product rules.

Close with isolated transaction proof that different accounts stay isolated, persisted journals reconcile, and recovery or rollback creates no duplicate movement. Include current signed-in statement views, authorized service or business account selection, foreign-account denial, false or partial approvals, and payment behavior after expired or revoked role.

**Repository sources**  [payments.js](../server/routes/payments.js) · [oxsteedCredit.js](../server/routes/oxsteedCredit.js) · [payoutRoutes.js](../server/routes/payoutRoutes.js) · [statementCenter.js](../server/routes/statementCenter.js) · [oxsteed-credit-code-completion-goal.md](../docs/oxsteed-credit-code-completion-goal.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-messages-support-notifications-and-realtime-closure"></a>

**Product-by-product closure register** · Page 048 of 393

## Messages, support, notifications, and realtime closure

Trace individual, helper, business, restaurant and support communications end to end. Check inbox and queue counts, list and search, direct lookup, attachments, on-behalf-of identity, reply, assignment, escalation, and any appropriate handoff. Verify notifications, status links, preferences, retry and consent for owners and audiences. Confirm admins and business support agents observe their permitted scopes.

Build missing request updates, outbox handlers, task links, access invalidation, sender selection and scoped support lookup needed under progressive access. Remove active-mode dependence in shared entry points as each product is converted. Multi-account or tenant messaging should retain an explicit authorized actor and clear current subject.

Close with an access change arriving while a drafted message or supported conversation is open. Check current UI and API scope, a latest notification leading to the correct record after sign-in, and private room delivery or reconnection after revocation. The user must still be able to reach unrelated customer or work threads and resolve recoverable failures.

**Repository sources**  [messages.js](../server/routes/messages.js) · [support.js](../server/routes/support.js) · [notifications.js](../server/routes/notifications.js) · [adminMessageOutbox.js](../server/routes/adminMessageOutbox.js) · [MessagingWorkspace.jsx](../client/src/components/messaging/MessagingWorkspace.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-growth-affiliates-analytics-and-integrations-closure"></a>

**Product-by-product closure register** · Page 049 of 393

## Growth, affiliates, analytics, and integrations closure

Trace approved events and usefulness of metrics across signup, approval, first action, revoke and legacy history. Verify business marketing, affiliate or referral links, partner and connector integrations, derived insights, dashboards, and any applicable exports. Distinguish public information, platform metrics, qualified investor audiences, employer scope, machine identity, and user consent and purpose.

Build missing transition events, counterpart measurements and provenance needed for this access model. Complete relevant adapter integrations so current product or data sources remain meaningful as older mode events retire. Use established consent, privacy, launch flags, attribution, throttles, webhook authenticity and partner scope.

Close with tested worker and queue contracts, chart and underlying access parity, attribution and event dedupe, safe policy data and revoked service access. Test that permission grants alone never send a campaign or open private data to unrelated audiences. Retain controls for already initiated campaign, provider and connector obligations according to their owning workflow.

**Repository sources**  [emit.js](../server/growth/emit.js) · [growthInsights.js](../server/routes/growthInsights.js) · [referrals.js](../server/routes/referrals.js) · [connector.js](../server/routes/connector.js) · [partners.js](../server/routes/partners.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="product-by-product-closure-register-platform-administration-devices-and-operations-closure"></a>

**Product-by-product closure register** · Page 050 of 393

## Platform administration, devices, and operations closure

Exercise internal enrollment, staff grants, reviewers, delegation, queue, support, moderation, fraud, finance approvals, audit, readiness, and recovery. Include corporate and logistics workspaces and separately maintained device/API consumers where applicable. Confirm deployed versions support the appropriate security, permission and migration behavior.

Build missing scoped reviewer surfaces, audit search, decision recovery and monitoring for the new lifecycle. Complete protected routes and policy management needed by authorized staff. Retain existing internal approval and privilege boundaries, and keep store/device operations scoped to their assigned identities. Add automation and telemetry used by operations to spot stalled provisioning or stale access.

Close with staging evidence from the exact release, disposable verification of migrations and affected financial paths, cross-client behavior, and authorized live acceptance. A support or administrative recovery requires both a user-visible result and a durable outcome in its owning system. Record issue resolution and re-run dependent product checks before closing each release slice.

**Repository sources**  [corporateRoles.js](../server/routes/corporateRoles.js) · [internalWorkspaces.js](../server/routes/internalWorkspaces.js) · [adminRouteManifest.js](../client/src/admin/adminRouteManifest.js) · [ci.yml](../.github/workflows/ci.yml) · [RUNBOOK.md](../RUNBOOK.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-server-contract-overview"></a>

**Engineering contracts** · Page 051 of 393

## Server contract overview

Keep authentication, eligibility, and action authorization explicit. Authentication establishes the account or device identity. The access service answers whether the person has an effective capability and provides narrowly scoped facts. The domain authorizer checks the resource and action, including ownership, membership permissions, feature flags, state, and verification. Actions such as publishing a catalog item and issuing a refund continue to use their existing specialized rules.

Call a server authorization boundary from controllers, services used by workers, and privileged socket handlers as applicable. Resolved scopes can be shared within a request where the repository already provides a verified context. Services receiving an entity context must verify its authority or require a verified server-side representation. Raw tenant identifiers or actor types from a request body are inputs to validate.

Define the error contract before converting callers. Each protected action should have a stable machine code and expected status. If a denial would disclose a private record, retain the domain’s existing resource-hiding behavior. Only return request-access affordances when the user may learn that the capability exists and may apply for that subject.

**Repository sources**  [auth.js](../server/middleware/auth.js) · [scopeGates.js](../server/middleware/scopeGates.js) · [requireBusinessAccess.js](../server/middleware/requireBusinessAccess.js) · [requirePermission.js](../server/middleware/requirePermission.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-effective-access-evaluation"></a>

**Engineering contracts** · Page 052 of 393

## Effective access evaluation

Evaluate user eligibility from the stable authenticated account, recognized grants, and existing trusted domain facts. An active account may have several effective capabilities. A suspended account remains subject to suspension rules. Resolve parent and child ownership before using a tenant-scoped grant. A grant for a business location must attach to a validated resource that actually belongs to that location. Define location-level fallback explicitly for every domain.

Keep denial conditions close to the action. A user with a verified Helper grant cannot bid on their own job, a payout-ready helper still needs eligible transactions, and an approved manager can only update a shift allowed by their restaurant membership. An entitlement makes the domain action available for further evaluation.

Design a resolver result that records the capability, subject, grant or source identity, and policy version for audit and testing. Expose a smaller browser projection. When multiple facts can authorize the same action, choose a deterministic source or return the evaluated set internally. Cached decisions must meet an explicit freshness requirement and a revocation guarantee appropriate to the operation.

**Repository sources**  [scopeModel.js](../server/services/scopeModel.js) · [permissionsService.js](../server/services/permissionsService.js) · [requestContext.js](../server/utils/requestContext.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-capability-policy-registry"></a>

**Engineering contracts** · Page 053 of 393

## Capability policy registry

Define capabilities and their eligible subject types in one versioned policy registry or a narrow extension to the current policy service. An entry describes permitted reviewer classes, whether the user may apply, required evidence, conditional questions, grant bounds, allowed next steps, and relevant preconditions. Build action names around real business verbs and keep them stable for metrics and authorization tests.

Decouple public application schemas from private policy. The public projection can describe required questions, possible request states, and how to continue. It should omit reviewer-only actions and data. Fetch a form policy by capability and relevant context. A request records the policy version under which its evidence was submitted. At decision time, verify whether that version is still valid and whether new facts are required.

Avoid duplicating the market and service eligibility logic already enforced by the domain. The policy can refer to checks such as current identity verification, restaurant active status, or provider requirements. Call owning services for their results and test disagreement cases where application evidence and current facts differ.

**Repository sources**  [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js#L95) · [modePlatformApprovalController.js](../server/controllers/modePlatformApprovalController.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-proposed-storage-model"></a>

**Engineering contracts** · Page 054 of 393

## Proposed storage model

Start with an additive design and retain canonical memberships and ownership rows. Keep historical mode approvals available for their legacy consumers. The historic user-and-mode uniqueness allows one result per person and mode. The new request model needs multiple subjects, independent review attempts, and provenance for a decision that can be audited after the request’s status advances.

| Record | Purpose |
| --- | --- |
| Signup intent | Optional requested capability and safe resume target captured during account creation |
| Access request | Applicant, requested capability, typed subject, current status, relevant policy version, timestamps, optimistic version |
| Decision entry | Immutable decision, reviewer principal and authority, evidence revision, effective scope, safe reason fields |
| Grant | Durable effective platform entitlement where the domain has no canonical grant, with source and lifecycle |
| Evidence reference | Application field or protected object reference with access and retention metadata |
| Outbox entry | Committed notification or projection invalidation keyed to the transition |

Use existing tables as sources for business membership and ownership where possible. A projected view is sufficient for those scopes. A new generic grant row must not duplicate ownership authority or silently outlive the membership from which it was derived.

**Repository sources**  [270_user_default_mode.sql](../server/migrations/270_user_default_mode.sql) · [272_mode_platform_approvals.sql](../server/migrations/272_mode_platform_approvals.sql) · [scopeModel.js](../server/services/scopeModel.js) · [businessTeamController.js](../server/controllers/businessTeamController.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-database-constraints-and-lookup-shape"></a>

**Engineering contracts** · Page 055 of 393

## Database constraints and lookup shape

Choose identifiers that match the actual owning tables. Verify account identifiers and the numeric or UUID types used by each subject before drafting SQL. For typed references, choose a representation with enforceable relation integrity. A request to create a new business can reference a private proposal until an approved transaction links the canonical record. A claim of an existing business must bind to a validated business row.

Enforce stable uniqueness for an effective entitlement and a single open application for the same applicant, capability, and exact subject. Use stable keys for unscoped person capabilities. If using a partial unique index for open requests, keep its predicate based on explicit states. Expiry can be enforced by a transition and runtime comparison. Test the index and query on the supported PostgreSQL major.

Record a monotonic request version, auditable originals for evidence changes, and actor references appropriate to worker and reviewer actions. Add supporting indexes for applicant history, reviewer queue filters, and active authorizations. Use bounded explain plans with synthetic workloads. Match schema-qualified table identity in every new constraint existence guard.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [migrationOrder.js](../server/migrationOrder.js) · [check-migration-history.cjs](../scripts/check-migration-history.cjs)

[PostgreSQL 16 partial indexes](https://www.postgresql.org/docs/16/indexes-partial.html)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-request-lifecycle"></a>

**Engineering contracts** · Page 056 of 393

## Request lifecycle

The proposed lifecycle supports Draft, Submitted, In review, Needs information, Approved, Declined, and Withdrawn. Track revocation, expiry, and suspension on the effective grant or owning membership. Keep the application record and its decision visible per the relevant retention policy. Represent an approval with further activation requirements clearly, such as **Approved · finish payout setup** for that separate payout action.

An applicant can save changes to a draft. Submitting runs complete validation against the applicable policy and locks the decision input until a review transition allows new evidence. A reviewer can send a specific request for information and return it to the applicant. Resubmission preserves earlier decision context and runs fresh validation. A withdrawn request consumes no active entitlement.

When approver claims are offered, an assignment is operational queue metadata. An assigned reviewer must still be authorized when making a decision. Application status reads and writes must be owned by the actor or a properly scoped reviewer. Offer a bounded history endpoint for the applicant, including dates, plain-language status, and user-facing decision reasons.

**Repository sources**  [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js#L337) · [modePlatformApprovalController.js](../server/controllers/modePlatformApprovalController.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-transition-concurrency-and-retry-behavior"></a>

**Engineering contracts** · Page 057 of 393

## Transition concurrency and retry behavior

Use a transaction to lock the exact application and validate its version and status. Re-resolve reviewer authority for the same scope inside that boundary. Validate current evidence and policy. Change the request, record the immutable decision, create or link the canonical grant or membership, and write the notification outbox event before committing. Decide the ordering of locks across request, authorization source, and existing grant before adding competing code paths.

Use a request idempotency key bound to the authenticated actor, intended action, target, and normalized payload fingerprint. Same-key retry should return the prior result without a second decision, grant, business, or message. A different payload using the same key fails safely. Concurrent submissions from several tabs must converge on one open request. Competing review decisions return a clear conflict if their expected version is stale.

Review, rescind, transfer, and revoke must have explicit linearization behavior. Define what happens if the person loses authority while their action is in progress. High-risk writes use a DB boundary and compatible locking or a version check that serializes against revocation.

**Repository sources**  [db.js](../server/db.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js) · [businessTeamController.js](../server/controllers/businessTeamController.js)

[PostgreSQL 16 locking](https://www.postgresql.org/docs/16/explicit-locking.html)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-evidence-collection-and-retention"></a>

**Engineering contracts** · Page 058 of 393

## Evidence collection and retention

Define fields the reviewer needs to decide the named scope. Prefer references to existing verification status and approved entity records. Reuse verified information where the applicant can see what is being reused. Perform identity verification in the existing provider flow and return status rather than raw identity documents. Collect payout data in the approved payout onboarding.

If an application needs attachment evidence, apply the existing upload and scanning practices. Create protected metadata, enforce type and size limits, authorize both upload and download against the request, quarantine until eligible, and use short-lived delivery. Review the storage service’s production constraints before choosing to share infrastructure with a public asset pipeline.

Store safe applicant-facing reasons separately from reviewer notes. Avoid embedding sensitive values, raw request payloads, uploaded files, or storage grants in logs, audit descriptions, URLs, analytics, emails, or push notices. Define deletion, legal hold, evidence retention, and account export with the relevant owner. Report explicitly which integration collects each field and where the field is stored.

**Repository sources**  [didit.js](../server/routes/didit.js) · [verification.js](../server/routes/verification.js) · [upload.js](../server/routes/upload.js) · [privacy.js](../server/routes/privacy.js) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-review-authority-matrix"></a>

**Engineering contracts** · Page 059 of 393

## Review authority matrix

Handle platform and tenant decisions using their owning authorization systems. Helper and Business Owner applications go to appropriately authorized OxSteed reviewers. Restaurant ownership and any activation restrictions go to the restaurant or merchant review authority. Consultant and investor decisions go to the OxSteed teams allowed to grant their domain access. Franchise review uses its approved pipeline and territory ownership policy.

Team applications and invitations continue to use organization authority. Limit a delegated approver to the business or location they can administer and to permissions they are entitled to grant. A person cannot approve their own elevation. Platform admin roles have scoped grants and further protected actions. Reuse the current mandate checks rather than allowing a generic queue permission to manage unrelated accounts.

State one rule for each proposed capability and action in the review matrix. Include the eligible reviewer class, required permission, exact subject, which prerequisites can be waived by whom, dual control if the domain already requires it, and audit destination. Ask the domain owner to sign off on legacy decisions that do not meet the new review standard.

**Repository sources**  [adminAuth.js](../server/middleware/adminAuth.js) · [businessTeam.js](../server/routes/businessTeam.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [franchise.js](../server/routes/franchise.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-review-queue-design"></a>

**Engineering contracts** · Page 060 of 393

## Review queue design

Create an appropriate review view for the people who own the decision and have the relevant grant. Identify the request purpose and subject with enough context to disambiguate the applicant. Provide filters for status, policy, market, subject, and age whose queries remain scoped server-side. Use bounded pagination, stable sort, explicit error states, and an accessible list and detail structure.

Show verified facts and their source, applicant-entered values, current policy, duplicate or related claims, and history. Show approval only when the reviewer can make that decision. Separate the requested information field visible to the applicant from internal notes. Present the exact permission, business, and location being activated. Require an explicit decision and reason per policy, and display a stale-decision state when another reviewer acts first.

Queue metrics should identify gaps in coverage, items aging in review, and outcomes by scope without exposing private evidence to unauthorized staff. Close the loop with a reliable notification and an in-app receipt. Verify delegated, region-limited, non-reviewer, and revoked reviewers against list, detail, attachment, and mutation endpoints.

**Repository sources**  [ModeApprovals.jsx](../client/src/admin/pages/super/ModeApprovals.jsx) · [ModePolicies.jsx](../client/src/admin/pages/super/ModePolicies.jsx) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-proposed-applicant-api-contracts"></a>

**Engineering contracts** · Page 061 of 393

## Proposed applicant API contracts

Use the existing API response and error style. Suggested applicant paths are `GET /api/me/access`, `GET /api/me/access-requests`, `POST /api/me/access-requests`, `GET /api/me/access-requests/:id`, and distinct mutation operations for draft updates, submission, resubmission, and withdrawal. An optional capability-specific form discovery endpoint returns only information safe for the current user.

The list should return summary fields, status, validated scope display labels, applicable actions, and stable pagination. The detail response includes applicant-visible form values and revision details. Updates accept the expected version. The transaction validates auth, ownership, target, schema, status, size, and dedupe criteria. Use route-level throttles and ordinary CSRF protections for cookie sessions.

Example proposed responses use `access_required` for a discoverable missing grant, `request_already_open` for a conflicting open application, and `request_version_conflict` for stale mutable state. Keep actual codes additive where clients already inspect existing values. Preserve resource-hiding errors across direct, batched, and related endpoints.

**Repository sources**  [meWorkspace.js](../server/routes/meWorkspace.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [apiError.js](../server/utils/apiError.js) · [modePlatformApprovals.js](../client/src/api/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-proposed-reviewer-api-contracts"></a>

**Engineering contracts** · Page 062 of 393

## Proposed reviewer API contracts

Mount review under an appropriate restricted API. Bind queue filters to the reviewer’s permitted scopes on the server. The detail and evidence reads use the same enforcement as the decision. A decision request carries the expected version, selected permitted outcome, reason, and evidence revision if necessary. Any grant subject must derive from the stored application and separately validated policy rules.

Allow explicit transitions for requesting more information, approving, declining, revoking, and reinstating where the owning policy supports those actions. Each transition has clear replay and error behaviors. If an operator has grant authority revoked between loading the case and submitting, the handler denies the write and records any required security audit without leaking private information.

Render permission changes in the reviewer UI as state changes rather than assuming the form remains valid. An approval may require provisioning the canonical business or membership in the same transaction or after a durable pending step. Clearly expose that distinction in API and applicant copy when the process can remain pending after a human decision.

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [businessTeam.js](../server/routes/businessTeam.js) · [corporateRoles.js](../server/routes/corporateRoles.js) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-access-projection-for-the-client"></a>

**Engineering contracts** · Page 063 of 393

## Access projection for the client

The access projection is a minimal server-owned snapshot. Include a version and small sets of currently actionable personal capabilities, invited or active subjects, and allowed controls for the visible task. Optional embedded summaries can list pending actions while leaving full evidence in dedicated endpoints. Keep actual authorization on the server. Cache private projection data only under the authenticated actor and relevant scopes.

Add fields compatibly to existing startup contracts or use a dedicated read with bounded cost. Preserve legacy response keys during the client upgrade window. Avoid embedding every business member permission and request in the session token. A short startup projection can be expanded when the user opens an entity or asks for more workspaces.

On approve, revoke, membership change, or policy change, update or invalidate the relevant version. Add projection refresh points on app resume, successful transitions, and scoped notification delivery. When returning to a private page after expiry, validate the projection through a fresh read. Network failure should retain the authenticated state if appropriate and prevent unsafe access elevation from stale data.

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [authSessionEpoch.js](../client/src/api/authSessionEpoch.js) · [authController.js](../server/controllers/authController.js#L197) · [businessTeamController.js](../server/controllers/businessTeamController.js#L338)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-public-urls-and-request-in-context"></a>

**Engineering contracts** · Page 064 of 393

## Public URLs and request-in-context

Start from the action the user asked to do. Example flows include **Apply to offer services** on Jobs, **List equipment** in Tool Rentals, and **Request reporting access** in an eligible dashboard. Keep the application in the surrounding shell through a panel, inline step, or appropriately linked account page. Preserve a safe return reference to the original action and canonical entity.

Define safe destination allowlists for signup, application completion, invitation acceptance, and notification links. Reject external or ambiguous redirect values. Build routes from verified internal target information rather than trusting an arbitrary stored URL. Restore reading position or local draft through existing recovery conventions.

Do not put private application data in query parameters or links. A notification needs only safe text and an opaque authorized reference. If a signed-out user follows it, resume after login only after verifying that the signed-in account can read that request. For stale or removed entities, show the current permitted route state and keep unrelated features usable.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [ModeHomeRoute.jsx](../client/src/components/ModeHomeRoute.jsx) · [MediaGuestGate.jsx](../client/src/pages/media/MediaGuestGate.jsx) · [launchScope.js](../client/src/utils/launchScope.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-signup-flow-contract"></a>

**Engineering contracts** · Page 065 of 393

## Signup flow contract

Keep the familiar account form, terms, and one-time email verification. Present an optional choice using user intents such as **Find help or order food**, **Offer services**, and **Run a business**. This field becomes a server-validated signup intent. Create a Customer account on successful finalization. Remove the caller’s ability to obtain role authority by supplying a helper or business value through self-service signup or profile writes.

After the account is usable, show the appropriate role-specific questions in the same signup flow or offer a clear resume action. Reuse already provided contact information. Persist any draft and accept idempotent retries of application creation. A transient application storage failure should leave the person with a valid account, their express intent, and a recoverable next step. Define failure contract for a duplicate email, expired OTP, and account already created by a concurrent client.

The post-signup route should honor any legitimate task or invitation return. Opening helper onboarding or business setup is a separate choice or continuation and uses the current shell. Explain what is under review and that customer tools are ready.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx#L153) · [signupValidation.js](../client/src/utils/signupValidation.js) · [auth.js](../server/routes/auth.js#L75) · [authController.js](../server/controllers/authController.js#L1564)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-helper-verification-inside-a-customer-session"></a>

**Engineering contracts** · Page 066 of 393

## Helper verification inside a customer session

Trace existing onboarding entry points, including the general registration controller, dedicated helper registration, verification pages, Didit or other provider callbacks, onboarding service, and account status reads. Some current endpoints assume a helper-role row or a helper profile. Permit the authenticated applicant’s authorized private setup path and keep new operational actions closed until eligibility is complete and approval is granted.

Keep policy evidence current across approved flows. The approved helper’s display and listing state may depend on provider result, profile completion, safety requirements, terms, and current listing preference. Model verification and approval independently so approval cannot set a fabricated verification state. A webhook verifies provider identity, binds to the same person’s session or case, and records a trustworthy result. A replay or browser reload cannot create another grant.

Preserve applicant access to finish or repair their own setup even after an ordinary role label changes in the compatibility window. Test delayed callback, mismatched external verification ID, expired session, duplicate callback, existing verified user, and operator-approved request with identity recheck.

**Repository sources**  [helperRegistration.js](../server/routes/helperRegistration.js) · [helperOnboarding.js](../server/services/helperOnboarding.js#L46) · [didit.js](../server/routes/didit.js) · [authController.js](../server/controllers/authController.js#L1701)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-sessions-identity-and-mode-removal"></a>

**Engineering contracts** · Page 067 of 393

## Sessions, identity, and mode removal

Retain the established login, refresh, logout, CSRF session namespace, account-switch coordination, and optional-auth behaviors. Replace the mode-driven account mutation with server-side access state that can change independently of ordinary navigation. Capability grants and revocations must affect effective authorization without relying on a user to obtain a new role claim by logging in again.

Many routes use the authenticated user loaded from the database, and the existing access JWT includes a role claim. Trace consumers of both. During compatibility, document which endpoints still rely on legacy role claims and exactly how old clients can keep working without elevation. Never let a deprecated switch endpoint manufacture access or delegate to a permissive role mapping.

The client transport has request epochs and coordinated cookie-changing operations. Keep those boundaries for actual credential changes. Give access updates their own snapshot or version rules so stale responses do not replace a different user's data. Verify with isolated two-tab browser scenarios, rapid sign-out, refresh races, and approval or revoke arriving during a different user’s login.

**Repository sources**  [auth.js](../server/middleware/auth.js#L22) · [authController.js](../server/controllers/authController.js#L2675) · [authSessionEpoch.js](../client/src/api/authSessionEpoch.js) · [session-cookie-ordering-2026-11-04.md](../docs/reviews/session-cookie-ordering-2026-11-04.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-mobile-pwa-and-api-compatibility"></a>

**Engineering contracts** · Page 068 of 393

## Mobile, PWA, and API compatibility

Trace the API consumers in the browser, PWA, native API, and any separately maintained iOS clients. In this checkout, the native source under the Restaurant Terminal offline package is an integration component. Check the actual native client owners for releases outside this checkout. Preserve legacy envelopes, old deep links, and observable error behavior while capabilities are introduced.

The service worker must never hold reusable private data across account changes. Review application and capability reads in browser caching rules and navigation fallback. Preserve unsaved drafts and release notice behavior when an update is available. State invalidation from approval must remain independent of the forced-refresh paths meant for new application versions.

Test lowest supported client versions against a migrated server. A retained old role-selection endpoint may safely return compatible navigation information for preexisting rights while the server enforces scoped capabilities. Verify API versioning and bridge behavior, include off-network and return-from-background scenarios, and pin the minimum supported versions before retirement.

**Repository sources**  [mobile.js](../server/routes/mobile.js) · [mobileController.js](../server/controllers/mobileController.js) · [sw.js](../client/public/sw.js) · [ServiceWorkerUpdateNotice.jsx](../client/src/components/ServiceWorkerUpdateNotice.jsx) · [README.md](../native/RestaurantTerminalOffline/README.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-realtime-and-asynchronously-executed-actions"></a>

**Engineering contracts** · Page 069 of 393

## Realtime and asynchronously executed actions

Use the existing realtime bootstrap lifecycle. Where access is needed for rooms or a socket-side write, resolve the authenticated principal and verify the current subscription scope. On membership loss, evict or revalidate access to rooms so a stale socket stops updating private views. Subscribe to a person’s own capability changes without broadcasting private outcomes to business rooms.

Keep application notifications bounded and idempotent. Send after commit via the existing durable worker or an explicit outbox contract. If a notification fails, retry without reapproving the request or creating a second grant. A push or email can link to a status view after auth. It should not include raw evidence, unpublished business names, or private reviewer notes.

When a queued job performs a user-authorized write later, define if it must recheck current authority at execution. If processing a previously accepted fact such as a payment settlement, use its existing state machine and actor provenance. Do not cancel or duplicate committed business obligations because the initiating person later lost a UI grant. Separate access checks for starting new work from reconciliation of already accepted work.

**Repository sources**  [auxiliaryWorkers.js](../server/bootstrap/auxiliaryWorkers.js) · [mediaNamespace.js](../server/realtime/mediaNamespace.js) · [notifications.js](../server/routes/notifications.js) · [adminMessageOutbox.js](../server/routes/adminMessageOutbox.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="engineering-contracts-locale-accessibility-and-mobile-layout"></a>

**Engineering contracts** · Page 070 of 393

## Locale, accessibility, and mobile layout

Build text and controls using the established English, Spanish, French, Haitian Creole, and Arabic catalogs. Validate both legacy and namespaced parity for modified strings. Test right-to-left layouts, small touch screens, longer translated labels, keyboard traversal, screen reader status announcements, and theme contrast. Avoid putting permission details only in color, icons, or hover text.

Use labeled groups for the initial intent choices and an understandable title for each application step. Focus the first validation problem when submission fails. Announce status updates without unexpected navigation or focus loss. Preserve focus when the user closes an application panel or sees controls unlocked while editing. Confirm that fallbacks and errors remain understandable on slow networks.

Use the existing accessible dialogs and field components where applicable. Test approval status in the same page with a live region, reviewer confirmation focus and error recovery, and Arabic text with mixed left-to-right reference IDs. Include a physical-device check and a screen-reader walkthrough before release.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [product-accessibility-2026-11-03.md](../docs/reviews/product-accessibility-2026-11-03.md)

[WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-signup-screens-and-transitions"></a>

**Application intake and decisions** · Page 071 of 393

## Signup screens and transitions

Use one account invitation prompt followed by verified account creation. The default card is **Find help or order food**. The other two cards can read **Offer services as a helper** and **Run a business on OxSteed**. Preserve action-intent links such as an existing provider signup URL and show the corresponding choice. Treat link state as a form default. The same account fields and terms apply.

After successful email verification, show the next application section for the selected intent. Give the verified user a clear way to finish later. The primary action on a complete, validated application is **Submit for review**. Save a resumable draft as the person proceeds. For an interrupted signup, preserve the stored intent with the verified account and restore via an authorized status lookup.

The confirmation can say **Your OxSteed account is ready. Your helper application is under review.** If the application is only a draft, use copy such as **Your OxSteed account is ready. Finish your helper application when you’re ready.** Maintain a link to the same task and include these distinct states in translation tests. Handle provider verification from the same application context.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [signupValidation.js](../client/src/utils/signupValidation.js) · [auth.js](../server/routes/auth.js) · [helperOnboarding.js](../server/services/helperOnboarding.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-helper-application-fields-and-approval-actions"></a>

**Application intake and decisions** · Page 072 of 393

## Helper application fields and approval actions

Use the common account information as an identity reference and display an option to correct it in the authorized account flow. Ask for at least one supported service category, service area, brief description of work, and any decision-critical evidence for the selected services. Show profile completion and identity verification as linked checklist items. A reviewer should see a verified status, supported source, timing, and the person it applies to.

A pending applicant can update allowed draft profile data and check status. The initial helper grant should explicitly say whether it permits handling a public listing, bidding, provider quote submission, or a smaller pilot subset. Existing job, subscription, safety, and payout conditions still apply to those actions. Capture separately what an approved helper can do across jobs, messages, bookings, invoices, public profile and earnings paths.

Reject or request information when the operating market or required evidence is unresolved. Use structured reason codes and a safe optional explanation. Test an applicant with completed verification, one with mismatched evidence, and an already eligible helper who returns through the new request surface.

**Repository sources**  [helperOnboarding.js](../server/services/helperOnboarding.js) · [helperRegistration.js](../server/routes/helperRegistration.js) · [bids.js](../server/routes/bids.js) · [HelperDashboard.jsx](../client/src/pages/HelperDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-business-owner-application-fields-and-approval-actions"></a>

**Application intake and decisions** · Page 073 of 393

## Business owner application fields and approval actions

Ask whether the person is setting up a new business or seeking authority over an existing one. A new business application can ask for business or trading name, business kind, operating country or region, customer-facing service area, contact route, and the person’s relationship to the business. Request an authority reference or documentation through protected intake when relevant. Fill known personal values from the verified account.

For an existing business, resolve the target through a safe lookup or a verified invite. Keep the application distinct from a staff request. Reviewers need evidence of existing ownership, conflicts, relevant verification checks, request history, and grounds for any transfer. A claim against an ongoing business needs the owning authority’s established transfer process.

For a new entity, approval links the applicant to one canonical business record. Editable information, publication, employer configuration, and financial activation may have separate domain checks. Show which setup actions are available at each step. Ensure applicant retry does not produce duplicate businesses, membership variants or listing entries.

**Repository sources**  [businesses.js](../server/routes/businesses.js) · [businessController.js](../server/controllers/businessController.js) · [BusinessCreationWizard.jsx](../client/src/components/businessHub/BusinessCreationWizard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-restaurant-owner-and-additional-location-intake"></a>

**Application intake and decisions** · Page 074 of 393

## Restaurant owner and additional location intake

Reuse business application answers when the restaurant belongs to an existing verified business. Ask for a storefront name, verified relationship to the owner, physical operating region and location, and the controls requested. Route an owner or new store to the approved merchant verification and activation checks. Preserve a private draft for menu and service choices as those are gathered.

An additional outlet should begin from **Add location** in the existing business context. An authority review must resolve the exact restaurant, brand, canonical business, operating market and locations. Some launch tasks can be completed by assigned management after the owner’s authority is established. Use existing permission groups and document each newly visible control individually.

Customer-facing menus and order acceptance only change when the applicable publication and service controls activate. Payout, Credit, POS, local delivery and device permissions retain their separate verification and scope. Include the independent approval and existing store ownership conflict in the intake and rollout tests.

**Repository sources**  [scopeModel.js](../server/services/scopeModel.js#L228) · [restaurants.js](../server/routes/restaurants.js) · [restaurantBrands.js](../server/routes/restaurantBrands.js) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-team-access-requests-and-manager-promotions"></a>

**Application intake and decisions** · Page 075 of 393

## Team access requests and manager promotions

On the team or task page, ask for the existing business, any relevant location, and one action or role supported by the owner’s configuration. Use invitation details when available. A safe explanation can state what the requested access would let the applicant do. Use existing membership when evaluating a promotion for a current employee. Collect only role-specific evidence needed by that appointing organization.

The reviewer must have authority for the exact organization and for the offered responsibilities. Use a summary with the named business or location, resulting membership role and selected permissions. A promotion is additive only to the extent the scoped decision says. Denied or withdrawn requests leave current staff access according to the original membership policy.

In the user experience, reveal newly allowed operations in the same calendar, queue, messages, or staff page. When the user works in more than one organization, identify which work location gained the access. Use the same menu, backend gate, permission lookup and audit for a denied result, direct routes after revoke, and other employers with similar names.

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [vortex.js](../server/routes/vortex.js) · [permissionsService.js](../server/services/permissionsService.js) · [businessTeamController.js](../server/controllers/businessTeamController.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-specialist-intake-fields"></a>

**Application intake and decisions** · Page 076 of 393

## Specialist intake fields

| Capability | Minimum decision context | Issuing scope |
| --- | --- | --- |
| Consultant | Specialty, service area, languages, experience and required credentials | Approved service and referrals |
| Investor reporting | Affiliation, reason for access, requested reports or audience | Approved dataset and effective period |
| Tool listing | Equipment description, pickup area and required ownership or safety evidence | Personal or business listing operator |
| Logistics organizer | Campaign scope, region, lane and operational capacity | Approved campaign or organizer assignment |
| Business procurement | Purchasing entity and permitted responsibilities | Verified organization and applicable lane |
| Distribution | Operator affiliation, capacity and fulfillment assignment | Approved region, lane or shipment |
| Franchise operations | Proposed territory, application state and required diligence | Authorized and activated territory |

The owning team decides which fields are mandatory by market and scope. Some cases begin with an invitation or preexisting canonical record. Reuse its checked evidence and route directly to the missing questions. Keep separate submission and approval policies for public buyer actions, role-based operating tools, and internal staff. Ensure the approval copy names the exact subject and any activation requirement.

**Repository sources**  [consultantNetwork.js](../server/routes/consultantNetwork.js) · [investor.js](../server/routes/investor.js) · [toolRentals.js](../server/routes/toolRentals.js) · [logistics.js](../server/routes/logistics.js) · [franchise.js](../server/routes/franchise.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-application-data-dictionary"></a>

**Application intake and decisions** · Page 077 of 393

## Application data dictionary

The application projection should distinguish fields by author and reviewer visibility. Applicant-entered values have validated size and type. Verified values reference their trusted source and are refreshed at the relevant decision. Internal notes have a reviewer-only audience. Use scoped attachments for evidence and operation-specific displays for decision labels and activation steps.

| Field group | Stored or derived | Owner and handling |
| --- | --- | --- |
| Account reference | Stored key | Authenticated actor and allowed reviewer |
| Requested capability and subject | Stored key and typed scope | Server validated at create and decision |
| Contact and verification summary | Derived references | Reuse trusted facts with narrow output |
| Application answers | Versioned record | Applicant draft and in-scope reviewer |
| Public reason | Decision value | Localized key or explicitly shared text |
| Internal evidence and notes | Protected references | Review purpose and scoped auditing |
| Approval and grant origins | Immutable decision metadata | Operational and audit views under grant |

Define mandatory, optional and conditional fields for each policy revision. Keep nil, absent, and denied values meaningful for both server and frontend. A deleted or replaced item should follow its retention rule and never silently alter evidence already considered in a decision.

**Repository sources**  [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js#L395) · [privacy.js](../server/routes/privacy.js) · [upload.js](../server/routes/upload.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="application-intake-and-decisions-approver-operating-decisions"></a>

**Application intake and decisions** · Page 078 of 393

## Approver operating decisions

Before enabling a role, record its accountable decision owner, qualified alternates and escalation route. List acceptable proof, denial reasons, conditions for request-more-information, whether reviewers can narrow a request, and expected activation steps. Document exact side effects that approval commits. Define any timeline or support wording only after operational staffing is in place.

Use simple outcomes that operators can apply consistently. An incomplete but correctable case requests information. A request for a foreign organization redirects to its designated authority when appropriate, without exposing private ownership data. A denied request should have a clear reason or narrowing path when policy allows it. Revocation should update the effective privileges and let the relevant domain resolve existing commitments.

The regular rollout test includes one applicant and reviewer in different scopes, a withdrawn case, expired reviewer capability, rework, and an approval committed while the applicant is signed in. Link this record from the review queue, the domain work package and the implementation release checklist.

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [adminAuth.js](../server/middleware/adminAuth.js) · [businessTeam.js](../server/routes/businessTeam.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-commit-sized-delivery-sequence"></a>

**Implementation examples** · Page 079 of 393

## Commit-sized delivery sequence

Use independent, reviewable changes in this order. First establish baselines and fixtures without shifting role decisions. Add request persistence, policy, and audit. Introduce application read and write routes, reviewer endpoints, and private UI behind their development feature gate. Add capability projection and eligibility evaluation. Release the complete thin customer/helper pilot with shadow gates, then incrementally convert domain writers. Finish legacy removal only once migration and active client compatibility have been verified.

| Change slice | Exit evidence |
| --- | --- |
| Data expand | Clean plus upgraded schema, repeat test, rollback compatibility |
| Applications | One authorized lifecycle, same-version conflicts, safe redaction |
| Target actor | Scoped projection and server verifier agree on existing fixtures |
| Pilot | Customer plus Helper on one session and denied pending writes |
| Tenant domains | Different rights at two stores, including a child-ID spoof attempt |
| Cutover | Compatibility, counts-only backfill evidence, no dangerous divergences |
| Retirement | No remaining reliance on global switches for supported actions |

Favor feature-owned pull requests over one global edit across role checks. Integrate billing, statements, provider or terminal changes only after the owning regressions run. Require a documented revert strategy before each cohort switch.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [ci.yml](../.github/workflows/ci.yml) · [modeRole.js](../server/utils/modeRole.js) · [scopeModel.js](../server/services/scopeModel.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-suggested-implementation-ownership-map"></a>

**Implementation examples** · Page 080 of 393

## Suggested implementation ownership map

Keep feature code where its current authority lives. For account application lifecycle, choose a route mounted under authenticated self-service and an associated controller/service. For approval queue, use the admin route manifest and grant types already supported in the platform. For organization activity, extend business team and restaurant scopes without adding an alternative ownership lookup.

Use a small browser access API module and a hook or provider with identity-bound invalidation. Within each job, booking or restaurant section, consume local availability and the exact entity. Reuse existing primitives for dialogs, pending states, errors, and focus. Keep any page-specific application adapter in that domain so the generic form engine carries only common questions and statuses.

Keep migrations in the server migration root. Add a domain capability fixture builder where it can be used by focused Jest integration suites. Share test-only actor/entity setup while keeping tests independent and their actual route entry points explicit. Add a small browser fixture or extend an existing harness for in-place promotions. Coordinate any new production flag across server and client boot visibility.

**Repository sources**  [index.js](../server/index.js) · [adminRouteManifest.js](../client/src/admin/adminRouteManifest.js) · [modePlatformApprovals.js](../client/src/api/modePlatformApprovals.js) · [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-proposed-application-request-payload"></a>

**Implementation examples** · Page 081 of 393

## Proposed application request payload

The following illustrates an independent helper application. The authenticated user ID is resolved on the server. A supported capability and typed subject are validated before request creation. The app should fetch the current schema and provide its version. Use the repository idiom for idempotency header or request key.

```json
{
  "capability": "helper.offer_services",
  "subject": { "type": "self" },
  "policyVersion": "helper-policy-1",
  "answers": {
    "serviceCategories": ["fixture-category"],
    "serviceArea": { "country": "US", "region": "OH", "city": "Springfield" }
  }
}
```

This example omits already verified contact and identity evidence, which the server links from its trusted records. A follow-up request can edit allowed fields on a draft by providing its expected version. For a business ownership request, require a validated draft proposal or specific business-claim subject, and keep those separate intent types. Limit string, array and nested object sizes in the server schema. Keep subject immutable after submission, apart from an explicitly audited activation link to the new canonical record.

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js#L395) · [meWorkspace.js](../server/routes/meWorkspace.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-proposed-applicant-response-and-ui-mapping"></a>

**Implementation examples** · Page 082 of 393

## Proposed applicant response and UI mapping

Return states the browser can describe without reconstructing permission logic. A response may look like the following. Every action comes from server conditions and also has an authoritative handler guard.

```json
{
  "id": "fixture-request-id",
  "capability": "helper.offer_services",
  "status": "needs_information",
  "version": 4,
  "publicReasonCode": "service_area_required",
  "availableActions": ["revise", "withdraw"],
  "subjectDisplay": "Your helper profile"
}
```

Show a direct **Add service area** button and make previous saved values available. Use a localizable safe reason. If the request advances from pending to approved while the user is elsewhere, refresh relevant abilities and update status nonintrusively. `approved` is an application outcome. Show terms, payouts, or publishing readiness independently where actions still have business-specific requirements. Keep evidence content and reviewer details out of summary payloads.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [ModeApprovals.jsx](../client/src/admin/pages/super/ModeApprovals.jsx) · [apiError.js](../server/utils/apiError.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-proposed-decision-payload-and-server-ordering"></a>

**Implementation examples** · Page 083 of 393

## Proposed decision payload and server ordering

A decision command targets a persisted request ID under the approved reviewer surface. This model is illustrative. Business, applicant, or granted role fields in the client body require explicit validation or derivation from the protected request.

```json
{
  "decision": "approve",
  "expectedVersion": 4,
  "reasonCode": "review_complete",
  "evidenceRevision": 3
}
```

Authenticate reviewer and resolve current authority for the case. Lock the request and validate lifecycle, expected version, policy, and associated subject. Recheck authoritative evidence under the same decision boundary as appropriate. Insert the decision and effective source, update version and disposition, and enqueue outbox data. Commit before delivery. Map conflict and no-longer-authorized outcomes to safe errors.

Define the behavior of already decided requests. Same idempotency key with the same command obtains its earlier result. A stale browser with a different decision receives the current safe state and conflict. Disallow changing a grant scope through free-text notes. A partial provisioning path must expose a clear durable intermediate status.

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js#L437) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-browser-access-snapshot-example"></a>

**Implementation examples** · Page 084 of 393

## Browser access snapshot example

Design the projection for ordinary navigation and the specific controls needed by the page. Example for a signed-in fixture with provider access and one company.

```json
{
  "version": 8,
  "personal": ["customer", "helper.offer_services"],
  "organizations": [
    { "type": "business", "id": "10", "name": "Fixture Shop" }
  ],
  "openRequestCount": 1
}
```

A named business page may fetch permitted controls using its server-validated business context. Keep membership proof and reviewer information out of the broad bootstrap. Mark or invalidate account-bound cached data as stale when the version changes. Never continue a pending action with an old entry if the server denies its current scope or if the logged-in identity changed.

The names above are proposed, and example IDs do not constrain schema types. Pick an explicit compatibility policy for clients that lack the new endpoint and short-circuit protected new controls if boot does not return applicable feature state.

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [meWorkspace.js](../server/routes/meWorkspace.js) · [businessTeamController.js](../server/controllers/businessTeamController.js#L338)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-decision-table-for-a-helper-bid"></a>

**Implementation examples** · Page 085 of 393

## Decision table for a helper bid

Test the action by the actual mounted route and include any native or alternative paths. The exact denial code follows the owning bid API compatibility contract. A permitted transition requires both approved capability and standard job rules.

| Fixture | Evidence and request | Expected |
| --- | --- | --- |
| Guest | No auth on mutation | Authentication required |
| Customer | Valid job, no eligible request | Denied, show eligible apply affordance |
| Applicant | Identity verified, review pending | Denied without creating a bid |
| Approved helper | Current eligibility and open foreign job | Normal bid behavior |
| Approved helper | Own customer job | Existing same-party denial |
| Approved but suspended | Valid foreign job | Existing enforcement denial |
| Approved helper | Job removed or ineligible | Domain not-found or state error |
| Same command replay | Same authorized actor and request | Domain replay or duplicate policy |

Test bidder count on every write case and read both participants’ authorized state. A passing response or UI alone misses a duplicated or partially committed row. Preserve quote, offer, notification, and related participant behavior on the legacy paths.

**Repository sources**  [bids.js](../server/routes/bids.js) · [jobs.js](../server/routes/jobs.js) · [helperOnboarding.js](../server/services/helperOnboarding.js) · [modeRole.test.js](../server/__tests__/modeRole.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-decision-table-for-promotion-at-a-location"></a>

**Implementation examples** · Page 086 of 393

## Decision table for promotion at a location

The user currently works at restaurant A and B. A reviewer can grant shift management only for A under the institution’s own scope rules. The role editor and changed schedule share canonical restaurant location lookup.

| Subject and permission | Target record | Expected |
| --- | --- | --- |
| Employee at A | Their own permitted A shift | Self-service read |
| Current manager at A | Assigned A employee shift | Permitted scoped change |
| Current manager at A and employee at B | B employee shift | No management right |
| A manager from stale tab | A shift after revoke | Authoritative API rejects |
| A manager with A route | Child shift from B | Scope or not-found denial |
| B owner | Management at B | Existing owner authority |

Check employee self-service after promotion and revoke. Evaluate roster, reports, search, exports and nested actions that consume the shift to ensure scopes agree. Include two locations in one business as well as two independent owner accounts. Test the approval actor’s delegation separately to distinguish who can grant the right from who can use it.

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [businessTeamController.js](../server/controllers/businessTeamController.js) · [scopeModel.js](../server/services/scopeModel.js) · [restaurantScopeModel.db.test.js](../server/__tests__/restaurantScopeModel.db.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-route-conversion-recipe"></a>

**Implementation examples** · Page 087 of 393

## Route conversion recipe

First identify the actual route, mount prefix, middleware, and target owning service. Establish baseline tests for the expected allow and deny. Identify the resource and applicable scopes from loaded domain objects. Decide who may request access and whether a missing grant may be disclosed. Add tests at mounted endpoint with an approved actor and a different user authorized only for a different resource.

Introduce the scoped verifier through the applicable existing middleware or owning action authorizer. For a write, keep authorization and side effects consistent under concurrency. Preserve domain errors and compatibility across legacy aliases. Convert browse, list, detail, attach, update, worker and socket paths where they expose equivalent data or actions.

Add client controls in context, using projected availability while handling server denial as authoritative. Update permission wiring and task links. Run the targeted access tests and shadow comparisons with existing mode behavior. Obtain domain review of intentional differences. Record exact routes, worker paths that were checked, test cases, visible behavior and rollback flags in the change description.

**Repository sources**  [index.js](../server/index.js) · [scopeGates.js](../server/middleware/scopeGates.js) · [routeScopeGuard.test.js](../server/__tests__/routeScopeGuard.test.js) · [App.jsx](../client/src/App.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-retained-client-decisions-and-cleanup-timing"></a>

**Implementation examples** · Page 088 of 393

## Retained client decisions and cleanup timing

A legacy role may still be required to decode a client response, select device UI, or issue a supported session. Inventory where that value is shown, where it chooses a harmless default page, and where it authorizes a server action. Move the authorization cases onto live scoped facts first. Keep existing internal account role semantics and recognize every supported legacy migration value.

A safe compatibility adapter can expose broadly equivalent user-facing navigation for a legacy client that already has access. It cannot create a new approval or canonical membership. Retire signals when shipped and supported clients stop requiring them, not merely after replacing the latest desktop navbar. Use telemetry on recognized calls rather than logging old tokens or payloads.

Plan and record the moment where a field becomes read-only, where another client version becomes required, and where its columns can be retired. Test release rollback across that exact window. Treat historical audit and decision fields as retained records even after presentation changes.

**Repository sources**  [authController.js](../server/controllers/authController.js#L197) · [authController.js](../server/controllers/authController.js#L2604) · [mobile.js](../server/routes/mobile.js) · [ModeSwitcher.jsx](../client/src/components/ModeSwitcher.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-evidence-needed-from-source-read-findings"></a>

**Implementation examples** · Page 089 of 393

## Evidence needed from source-read findings

This snapshot shows a possible Investor guard disagreement. The Investor routes pass an array to the authentication middleware’s variadic requireRole factory. That factory compares the user’s role with individual configured arguments. Verify resulting behavior through the actual mounted API and authorized fixture before relying on any Investor output during the migration.

A second boundary is that server mode mapping includes restaurant account values while current web signup exposes three choices and the web mode catalog has a separate list. Current restaurant access is grounded in business and restaurant ownership or membership. Backfill from those relationships and visible flags. Do not infer any operational authority merely because a restaurant string was once stored in a mode field.

An inventory section notes patterns and source entry points. A static match is evidence of literal declarations. Middleware registered above a route, feature conditions, imported authorization helpers, child resources, and runtime policy must still be read. Capture exact observed behavior and link to the discovered owning source before converting each domain.

**Repository sources**  [investor.js](../server/routes/investor.js#L19) · [auth.js](../server/middleware/auth.js#L410) · [modeRole.js](../server/utils/modeRole.js#L25) · [launchScope.js](../client/src/utils/launchScope.js#L13) · [scopeModel.js](../server/services/scopeModel.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="implementation-examples-release-evidence-worksheet"></a>

**Implementation examples** · Page 090 of 393

## Release evidence worksheet

Use this small checklist in each implementation pull request and release record. Reviewers should be able to trace application and entitlement changes, judge acceptance, and decide whether to pause the rollout.

| Field | Required detail |
| --- | --- |
| Change | Domain and user action, approved policy, work package owner |
| Source | Exact SHA, mounted route and package version |
| Scope | Subject, owning data, actor, current signed-in or staff authority |
| Tests | Authorized, denied, foreign target, pending, stale and after revoke |
| Migration | Filename, previous schema, upgrade, repeat, and reconciliation |
| Release | Cohort, client versions, feature flags, exact deployed image |
| Verification | Commands, output, physical device or provider if applicable |
| Recovery | Hold condition, fallback behavior and accountable operator |

Collect test evidence in an approved location. Record synthetic fixtures clearly. Treat real customer or employee data as private. Record warnings and deferred verification exactly, with an owner and status update during implementation.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [RUNBOOK.md](../RUNBOOK.md) · [deployment-ci.md](../docs/deployment-ci.md) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-phase-0-map-entry-points-and-capture-the-baseline"></a>

**Delivery and rollout** · Page 091 of 393

## Phase 0 map entry points and capture the baseline

Pin the current default branch, package lockfiles, migration prefix floor, and active deployment candidate. Build a work inventory rather than relying on the mode switcher’s choices. Start from `rg -n` searches for mode values and role comparisons, then include middleware, routed aliases, direct controllers, workers, socket namespaces, app route definitions, and browser and native bridges.

Record each affected action in the migration matrix. Columns should include work package, method and public path, actor, resource, current authorization source, precedence and scope, proposed grant evidence, old client behavior, acceptance fixture, rollout flag, and assigned owner. Use the appendices as a starting inventory. Follow the actual mounted handler and add any dynamic routing found during review.

Capture a permission truth table on current source before making changes. Keep fixtures with different users and tenant assignments, rather than assuming every elevated test actor owns the same organization. Include exact status and safe output for legacy denials. Baseline product policy questions appear in the scope chapter and need an owner before behavior changes.

**Repository sources**  [index.js](../server/index.js) · [App.jsx](../client/src/App.jsx) · [routeScopeGuard.test.js](../server/__tests__/routeScopeGuard.test.js) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-phase-1-additive-access-and-reviewer-plumbing"></a>

**Delivery and rollout** · Page 092 of 393

## Phase 1 additive access and reviewer plumbing

Add the schemas, service interfaces, applicant and reviewer routes, and tests behind a disabled-by-default cohort gate. Keep current live request paths compatible. Introduce the stable identity and authorization result shape that later domain work will use, with existing membership and scope services as sources. Keep the authorization table explicit about which decisions can be read from legacy policy records.

Implement request lifecycle, persistence, conditional decisions, audit, notification dispatch, and projection invalidation as one slice. Exercise duplicate submission, competing approval, stale policy, review visibility, cross-tenant subjects, and revocation with real PostgreSQL. Provide admin fixture grants through approved test tooling. Do not build a single global reviewer role for unrelated scopes.

Add the applicant status view and reviewer queue in the current shell layout. Guard API access as well as route presentation. At this stage the cohort gate should allow development and test users to use isolated flows. Ensure legacy production users and clients continue to receive stable authentication response shapes and endpoint behavior.

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js) · [scopeModel.js](../server/services/scopeModel.js) · [adminRouteManifest.js](../client/src/admin/adminRouteManifest.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-phase-2-customer-and-helper-pilot"></a>

**Delivery and rollout** · Page 093 of 393

## Phase 2 customer and helper pilot

Deliver the customer-first signup and independent Helper application through the real routes. Ensure a newly verified intending helper can act as a customer immediately. Their private profile and identity verification can progress while current public listing and bidding boundaries remain closed. Connect administrative approval to the authorized helper capabilities and the in-context Jobs actions.

Extend the work into quote, appointment, existing contract, message, search, earning and payout paths touched by the mode change. Preserve consumer checkout and posting while the provider capability is active. A pilot without listed routes such as native bids or alternate quotes is incomplete. Use the source index and domain checks to find these variants.

Run the pilot behind separate application, projection, and authorization cutover controls as appropriate. Define exactly which users use the new server decisions, and give internal testers rollback readiness. Verify existing helpers can switch independent tasks naturally and that new applicants cannot gain access via legacy APIs. Read denial, error, and performance signals before expanding.

**Repository sources**  [auth.js](../server/routes/auth.js) · [helperRegistration.js](../server/routes/helperRegistration.js) · [bids.js](../server/routes/bids.js) · [helperQuotes.js](../server/routes/helperQuotes.js) · [HelperDashboard.jsx](../client/src/pages/HelperDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-phase-3-business-and-restaurant-pilot"></a>

**Delivery and rollout** · Page 094 of 393

## Phase 3 business and restaurant pilot

Move owner applications, canonical association, and organization memberships onto the same account experience. Start with one ordinary service business and one restaurant with a second separate location. Design their eligible and pending workflows in the current page structures. Convert alternate location-changing and work assignment paths along with the primary privileges.

Bring forward organization permissions through existing resolver facts. Carefully verify customer-facing storefront and guest paths. Separate staff management, direct personal work, merchant settings, and sensitive finance within the same route context. Demonstrate that changing a grant for one organization preserves another’s records, operations, and selections.

Test old and new clients side by side. Include staff invite acceptance while signed out, setup without public visibility, browser actions after promotion during an active session, and lost org authority between permission preview and commit. Reconcile reports and operational data without changing balances or duplicating entity records. Extend to restaurant finance and devices only with domain signoff and the isolated verifiers.

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [businessOperations.js](../server/routes/businessOperations.js) · [restaurants.js](../server/routes/restaurants.js) · [README.md](../native/RestaurantTerminalOffline/README.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-phase-4-specialists-and-remaining-integrations"></a>

**Delivery and rollout** · Page 095 of 393

## Phase 4 specialists and remaining integrations

Convert Logistics, Tool Owner, Consultant, Investor, and Franchise capabilities with the appropriate scopes and domain reviewers. Drive the work from actions and policies, including separate account, organization, shipment/lane, reporting audience, and territory scopes. Verify Act As controls for Media, Direct contexts and provider flows, and staff-only integrations along the way.

Review other product families that use a helper-class role as a proxy for access, including template workflows, career recruiting, marketing, payment and statement surfaces, local delivery, CRM, subscriptions, and integrations. Decide whether they need a capability, their existing membership or ownership, or a published product entitlement. Record the choice and authorization proof at each relevant entry point.

Prioritize high-risk writes and private exports before exposing broader new navigation. A market with restricted launch or external provider use retains the current launch controls. Implement missing behavior needed for every supported journey in the [product closure register](#product-by-product-closure-register-accounts-home-and-public-discovery-closure). A parity-only entry must demonstrate that the existing behavior meets the complete target experience. Publish a compatibility and verification record for every product, including those that needed new work and those covered by existing behavior.

**Repository sources**  [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js) · [toolRentals.js](../server/routes/toolRentals.js) · [investor.js](../server/routes/investor.js) · [media.js](../server/routes/media.js) · [direct.js](../server/routes/direct.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-phase-5-cleanup-and-legacy-compatibility"></a>

**Delivery and rollout** · Page 096 of 393

## Phase 5 cleanup and legacy compatibility

Before removing the switcher, inventory callers of the server switch endpoint, registration legacy fields, profile writes, native responses, old links, and token claims. Identify supported versions and observe real use with bounded privacy-safe metrics. Update and ship supported clients before deprecating a path. Retain a compatible response where old links need a safe landing.

Remove the authority-changing behavior in a controlled migration. Preserve historical data and compatibility columns for the defined period. A stale deep link should resolve to the appropriate local page, request flow, or safe denied state for the current logged-in person. Validate all alternate paths for self-service mutation of role, including profile, signup, mobile, and administrative flows.

Retire old fields only after no authorized live path depends on them and a safe rollback has been reviewed. Leave an index from former modes to current user-facing actions. Verify cleanup with source searches and new fixture tests that demonstrate a generic role change cannot grant new authority. Confirm account and internal staff access independently.

**Repository sources**  [auth.js](../server/routes/auth.js) · [authController.js](../server/controllers/authController.js#L2604) · [ModeSwitcher.jsx](../client/src/components/ModeSwitcher.jsx) · [mobile.js](../server/routes/mobile.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-legacy-entitlement-mapping"></a>

**Delivery and rollout** · Page 097 of 393

## Legacy entitlement mapping

Construct the migration from independent evidence. Customer access derives from a valid account. Helper access derives from canonical onboarding and current permission or eligibility evidence established by the pilot policy. Verify identity, active state, existing listing or work obligations, and any suspended status. Business and restaurant access derives from authoritative ownership or active membership and site assignments.

Platform-approved specialist access must be traced to valid decisions and subject facts. For an investor, check audience records and current authority. For a consultant, include approval and referral status where applicable. For franchise, preserve applicant history and only grant territory operations when a current territory assignment authorizes it. For tools and logistics, carry forward qualifying roles and canonical records without creating new seller rights.

Handle ambiguous accounts in an exception table with safe existing access and tracked review. Record why every grant exists and its scope. Avoid reading a single historic mode as proof of organization ownership, a current paid entitlement, or approval to operate. Any proposed expansion from old behavior needs explicit policy approval.

**Repository sources**  [modeRole.js](../server/utils/modeRole.js) · [helperOnboarding.js](../server/services/helperOnboarding.js) · [scopeModel.js](../server/services/scopeModel.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-backfill-job-and-dry-run"></a>

**Delivery and rollout** · Page 098 of 393

## Backfill job and dry run

Make the backfill rerunnable and observable. Choose a deterministic traversal, bounded batch size, stable idempotency key, and committed checkpoint boundaries. Establish what happens when new approvals, memberships, or status changes occur during the run. Use canonical upsert constraints or existing membership sources and preserve provenance. Protect revocations from a backfill replay.

Before writes, produce a counts-only dry run by capability, eligible record class, and exception reason. Compare new grants against the legacy behavior and the documented policy. Manually sample synthetic cases and authorized production-safe aggregates. Treat unknown identity state or conflicting site ownership as exceptions, with a reviewer and reconciliation path. Avoid outputting evidence or personal identifiers in the general deployment log.

Verify an upgrade from the previous schema and a clean database. Interrupt then resume after several committed batches. Run the same job twice. Race it with a revoke and a membership update. Record row counts, denial deltas, exceptions, and time to complete. Attach rollback and reconciliation procedures to the release record.

**Repository sources**  [migrate.js](../server/migrate.js) · [migrationOrder.js](../server/migrationOrder.js) · [check-migration-history.cjs](../scripts/check-migration-history.cjs) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-authorization-shadow-comparisons"></a>

**Delivery and rollout** · Page 099 of 393

## Authorization shadow comparisons

Before cutover, calculate old and proposed decisions using the same request context and record only operationally appropriate differences. Run shadow mode without granting a new write or altering the legacy response. Use an explicit request sample strategy and prevent a comparison service from becoming a source of user data. Record distinguishing rules, not full evidence.

Investigate both directions. A proposed new grant with a legacy deny may be intended for a now-authorized user, an incomplete feature gate, or a vulnerability. A new deny with a legacy allow can uncover missing source evidence or a wrongly permitted legacy path. Create dedicated evidence for each accepted divergence, especially direct URLs, mobile writes, and row-level scope.

Remove result mismatches before switching a cohort or document the accepted policy. Keep metrics segmented by domain, action, client version, and selected decision reason. Protect request targets and user identity in telemetry. Verify that expensive shadow lookups are sampled or controlled and that enabling the comparison cannot affect production latency unexpectedly.

**Repository sources**  [scopeGates.js](../server/middleware/scopeGates.js) · [scopeModel.js](../server/services/scopeModel.js) · [emit.js](../server/growth/emit.js) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-launch-flags-and-drop-in-compatibility"></a>

**Delivery and rollout** · Page 100 of 393

## Launch flags and drop-in compatibility

Use server-owned feature flags with one clear meaning per rollout phase. Where needed, flag the new applications, client projection, scoped gate migration and legacy retirement separately. Ensure the UI knows its cohort and feature visibility through the existing boot contract. A hidden UI feature is never the server permission boundary.

Exercise flag combinations in CI, including old client with new server and one domain converted alongside another still running on the legacy contract. Preserve launch scope for the branches independently. Verify enablement when a request is pending, right after approval, and after revocation without assigning a new default mode.

Give every flag an owner and a retirement trigger. Record which conditions are operationally reversible. Preserve application and approval data through a rollback. If returning a domain to a previous authorization implementation would reopen revoked access or break correctness, use a safe paused-write or allowlisted fallback until reconciliation finishes. Re-test after re-enablement using current permission state.

**Repository sources**  [launchGate.js](../server/middleware/launchGate.js) · [launchScope.js](../client/src/utils/launchScope.js) · [index.js](../server/index.js) · [deployment-ci.md](../docs/deployment-ci.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-deployment-and-rollback-contract"></a>

**Delivery and rollout** · Page 101 of 393

## Deployment and rollback contract

Plan additive migrations that support rolling deploys with older and newer versions concurrently. Follow the default-branch append-only migration policy. Required services must be ready before starting workers. Keep production data, backups, volumes, uploads, and operational state intact. Use the configured Colima context when inspecting production.

For a rollout, record the exact deployed SHA or image identity, migration version, feature configuration, and readiness for dependencies and workers. Validate the happy path with authorized synthetic fixtures or approvals for appropriate live checks. Actual release ownership and deployment steps follow the repository runbook and CI policy.

Rollback procedures should describe the supported app and schema combination, flag change, and method to preserve decision and audit records. Record new-scope changes that need forward reconciliation. Keep a record of affected cohorts and an owner to communicate interruptions. Retain a staged exit when the source of truth or grant projection is inconsistent, and preserve existing finalized commitments.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [RUNBOOK.md](../RUNBOOK.md) · [deployment-ci.md](../docs/deployment-ci.md) · [web-image.yml](../.github/workflows/web-image.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-test-levels-and-fixture-design"></a>

**Delivery and rollout** · Page 102 of 393

## Test levels and fixture design

Build contract and state-machine tests using focused unit coverage. Use PostgreSQL integration for issuance, duplicate prevention, region or entity scoping, denial, concurrent reviews, transition atomicity, and migration replay. Exercise normal HTTP entry points with server-side permission fixtures. Test normal browser interactions, mobile viewports, and cross-device behavior. Existing source contract tests support the regression plan.

A reasonable minimum fixture set is a guest, customer, pending applicant, approved helper, suspended helper, owner of two businesses, employee at two locations with different grants, manager, delegated approver, expired approver, and privileged internal staff. Add domain actors, device credentials, and unaffiliated users where relevant. Give records different IDs, owner identities and status values.

Use before and after observations to prove side effects. Count grants, decisions, outbox events, records created, and linked rows. Record the exact consumer action, route, payload class, scope, HTTP status, and persisted outcome. Include current valid activity and previously authorized historical reads after revocation alongside denial of new protected writes.

**Repository sources**  [routeScopeGuard.test.js](../server/__tests__/routeScopeGuard.test.js) · [permissionResolver.db.test.js](../server/__tests__/permissionResolver.db.test.js) · [restaurantScopeModel.db.test.js](../server/__tests__/restaurantScopeModel.db.test.js) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-verification-commands-and-evidence"></a>

**Delivery and rollout** · Page 103 of 393

## Verification commands and evidence

Run targeted checks under the repository’s respective package directories. Baseline commands and existing test files here are pointers. Match actual test options and fixture prerequisites to the current package scripts before running them.

```sh
npm --prefix client run test:signup-validation
npm --prefix client run test:launch-scope-visibility
npm --prefix client run build:ci
npm --prefix server test -- --runInBand modeRole authLoginContract signupReliability
npm --prefix server test -- --runInBand routeScopeGuard permissionResolver restaurantScopeModel
node --test scripts/deploy-coolify.test.cjs
```

Read the server package test scripts and CI high-risk jobs. Provide an isolated PostgreSQL and Redis instance where required. Avoid counting suites skipped by environment conditions or missing setup. Build the client before tests that expect prerendered production assets. Use current isolated Media or Credit tools for tests that reach those domains. Record each actual command, SHA, exit status, suite counts, relevant skip reasons, and where proof lives.

Complete the staged acceptance record with readiness, migration rehearsal, exact artifact, and live customer and reviewer scenarios. This page lists planned implementation verification. No implementation test status is implied.

**Repository sources**  [README.md](../README.md) · [package.json](../client/package.json) · [package.json](../server/package.json) · [ci.yml](../.github/workflows/ci.yml) · [media-isolated-env.sh](../scripts/media-isolated-env.sh)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-observability-audits-and-support"></a>

**Delivery and rollout** · Page 104 of 393

## Observability, audits, and support

Track applicant funnel events from intent through submission, review, additional information, approval, and activation. Use action and outcome codes with safe, approved dimensions. If replacing the legacy account-role event, preserve downstream contract understanding and avoid double-counting users who navigate repeatedly. Treat a grant transition and a successful use of the feature as distinct events.

Operational dashboards should surface review volume, time awaiting review, rework, duplicate attempts, legacy usage, authorization mismatch, revocation latency, unavailable dependencies, and permission-denial changes. Use sensitive audit identifiers in authorized evidence stores with controlled access. Avoid dumping form answers into routine telemetry. Route state and idempotency keys should be purpose-bound.

Give support a vetted way to explain application status and route a correction. Support staff can use their granted ability to help with a case. Granting or overriding the requested privilege belongs to the authorized reviewer and is auditable. Provide escalation ownership for stuck provisioning, revoked memberships, or unsupported clients. Confirm authorization for views, search, exports, and internal notes.

**Repository sources**  [notifications.js](../server/routes/notifications.js) · [adminMessageOutbox.js](../server/routes/adminMessageOutbox.js) · [account.role_added.v1.json](../server/growth/events/schemas/account.role_added.v1.json) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-user-and-staff-rollout-communications"></a>

**Delivery and rollout** · Page 105 of 393

## User and staff rollout communications

Prepare localized applicant copy for the statuses in this handoff and for no available service in the selected area. An in-context message explains what is ready, what approval is pending, and where follow-up is needed. On approval, notification links should open the original Jobs, business or restaurant context where the new action appears.

For existing users, explain the new path to familiar functions. A user who has an active helper assignment should be able to open existing jobs or messages and find their provider tools. A staff member whose employer granted new responsibilities can see the entity and actions in their normal dashboard. Keep relevant access history in account settings.

Train reviewers on scope, decisions, evidence handling, duplicate or disputed claims, and how to request more information. Give support examples using synthetic records and clear trouble-reporting instructions. Release communications and verification can distinguish intent launch, first pilot approval, and broad availability. Avoid promising unverified support for specialist or gated capabilities.

**Repository sources**  [navbarNavigation.js](../client/src/utils/navbarNavigation.js) · [SettingsPage.jsx](../client/src/pages/SettingsPage.jsx) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [AGENTS.md](../AGENTS.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="delivery-and-rollout-completion-checklist-for-the-implementation-owner"></a>

**Delivery and rollout** · Page 106 of 393

## Completion checklist for the implementation owner

- Record precise platform and organization approval policies for each launched capability.
- Prove customer-first signup and the Helper and Business Owner application paths with fresh fixtures.
- Verify that approvals add actions in place and ordinary navigation keeps the same identity and session.
- Exercise both valid and invalid actor, resource, membership, and location pairs with real HTTP calls.
- Preserve existing application history, domain records, active obligations, scopes, and old-client behavior.
- Validate approval, resubmission, concurrent review, revocation, and recovery in PostgreSQL.
- Confirm representative mobile and keyboard/screen reader journeys in required locales.
- Rehearse migration, rollback controls, operator recovery, and verification on the exact deployment candidate.
- Obtain evidence from authorized staged and production checks for the capabilities being released.

The remainder of the document contains a domain-by-domain implementation inventory and verification cases. Keep their evidence references current as the branch changes. Before handoff to operators, use the accepted policy and code to update outstanding decisions, scopes, release cohort rollbacks, and known limitations.

**Repository sources**  [AGENTS.md](../AGENTS.md) · [RUNBOOK.md](../RUNBOOK.md) · [deployment-ci.md](../docs/deployment-ci.md) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-001"></a>

**Account and access work packages** · Page 107 of 393 · WP-001

## Signup entry and intent selector

### Current boundary

The account chooser is rendered before OTP and currently stores a selected defaultMode. Customer, Helper, and Business Owner are launch signup choices.

### Implementation work

Replace account-type copy with action-oriented intent text. Keep the same account inputs and terms. Preserve the selected intent through draft reload and safe return targets without granting an operational role.

### Acceptance

Start from general signup, a helper deep link, and an owner call to action. Inspect the page after back, reload, and locale change. A forged value is rejected or normalized safely and cannot alter the authenticated actor.

### Source declarations to trace

- [`POST /login`](../server/routes/auth.js#L41) · guards `loginLimiter` · handler `login`
- [`POST /login/2fa`](../server/routes/auth.js#L42) · guards `loginLimiter` · handler `loginWith2FA`
- [`POST /login/passkey/options`](../server/routes/auth.js#L43) · guards `strictLimiter` · handler `passkeyCtrl.authenticationOptions`

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [signupValidation.js](../client/src/utils/signupValidation.js) · [auth.js](../server/routes/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-002"></a>

**Account and access work packages** · Page 108 of 393 · WP-002

## Registration start and pending identity

### Current boundary

Registration start collects validated contact and location fields before finalized account creation and records pending state.

### Implementation work

Persist supported intent separately from access authority. Keep the pending token bound to the current registration, ensure correct TTL and resend behavior, and protect against restart and alternate-client payloads. Bound user-entered source metadata.

### Acceptance

Replay start while email is unverified and after a conflicting duplicate account appears. Confirm one finalized account and no application for an unrelated email. A helper-shaped role field never elevates the record.

### Source declarations to trace

- [`POST /register/start`](../server/routes/auth.js#L75) · guards `authLimiter` · handler `startRegistration`
- [`POST /register/verify-otp`](../server/routes/auth.js#L77) · guards `authLimiter` · handler `verifyRegistrationOTP`
- [`POST /register/resend-otp`](../server/routes/auth.js#L78) · guards `authLimiter` · handler `resendRegistrationOTP`

**Repository sources**  [auth.js](../server/routes/auth.js) · [authController.js](../server/controllers/authController.js#L1349) · [signupReliability.test.js](../server/__tests__/signupReliability.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-003"></a>

**Account and access work packages** · Page 109 of 393 · WP-003

## OTP finalization and bootstrap

### Current boundary

The OTP finalizer reads pending default mode, derives role, creates user and session, and can seed a helper profile.

### Implementation work

Provision customer features after valid OTP. Keep the intended application recoverable even when provisioning Application Draft is temporarily unavailable. Preserve the account and authentication contract. Record which follow-up state the client can resume.

### Acceptance

Finalize with two near-simultaneous OTP calls. Confirm exactly one customer account and at most one application draft for the same outcome. Read emitted events and ensure customer-only writes can execute with the returned identity.

### Source declarations to trace

- [`POST /login`](../server/routes/auth.js#L41) · guards `loginLimiter` · handler `login`
- [`POST /login/2fa`](../server/routes/auth.js#L42) · guards `loginLimiter` · handler `loginWith2FA`
- [`POST /login/passkey/options`](../server/routes/auth.js#L43) · guards `strictLimiter` · handler `passkeyCtrl.authenticationOptions`

**Repository sources**  [auth.js](../server/routes/auth.js) · [authController.js](../server/controllers/authController.js#L1564) · [authLoginContract.test.js](../server/__tests__/authLoginContract.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-004"></a>

**Account and access work packages** · Page 110 of 393 · WP-004

## Login and legacy mode inputs

### Current boundary

Some login callers send operating mode or default mode, and server login code has path-specific behavior for requested switches.

### Implementation work

Treat login input as a legacy navigation hint only where safe. Preserve passwords, terms, account locks, session semantics, and legitimate invitation returns. Resolve actual grants separately using current authority. Audit every identifier synonym accepted by historic clients.

### Acceptance

A legacy app asks for Helper before the account is approved. It authenticates as allowed while all helper writes remain closed. An approved user can log in, read their own data, and navigate directly without mutating account role.

### Source declarations to trace

- [`POST /login`](../server/routes/auth.js#L41) · guards `loginLimiter` · handler `login`
- [`POST /login/2fa`](../server/routes/auth.js#L42) · guards `loginLimiter` · handler `loginWith2FA`
- [`POST /login/passkey/options`](../server/routes/auth.js#L43) · guards `strictLimiter` · handler `passkeyCtrl.authenticationOptions`

**Repository sources**  [auth.js](../server/routes/auth.js) · [authController.js](../server/controllers/authController.js#L280) · [AuthContext.jsx](../client/src/context/AuthContext.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-005"></a>

**Account and access work packages** · Page 111 of 393 · WP-005

## Signed-in profile edit and account type removal

### Current boundary

Profile writes contain a default-mode compatibility route and settings can trigger mode changes.

### Implementation work

Move role preferences to choosing an in-app default page where needed. Store user profile changes without changing authorizations. Keep current claim handling for role comparisons until each server action has been migrated. Audit settings, admin and mobile writes independently.

### Acceptance

Send a profile PATCH with an ordinary language change plus a malicious default mode. Verify only supported profile behavior and no grant regardless of output compatibility. Apply profile changes during an in-progress application and check no merge leaks.

### Source declarations to trace

- [`PUT /profile`](../server/routes/auth.js#L82) · guards `authLimiter, authenticate` · handler `updateProfile`
- [`PATCH /me`](../server/routes/auth.js#L83) · guards `authLimiter, authenticate` · handler `updateProfile`
- [`POST /login`](../server/routes/auth.js#L41) · guards `loginLimiter` · handler `login`

**Repository sources**  [auth.js](../server/routes/auth.js) · [authController.js](../server/controllers/authController.js#L2000) · [SettingsPage.jsx](../client/src/pages/SettingsPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-006"></a>

**Account and access work packages** · Page 112 of 393 · WP-006

## Dedicated helper registration

### Current boundary

Dedicated helper registration and the general registration path have separate handling and historical pending-record shapes.

### Implementation work

Keep alternate registration entry points consistent with customer-first activation. Reuse completed profile and verification evidence for a single request. Map old tokens and resume links only to their original verified person.

### Acceptance

Use a dedicated helper link and generic signup requesting helper access in parallel for the same synthetic user. Assert no duplicate requester or helper profile and confirm the role-gated bid remains denied.

### Source declarations to trace

- [`POST /start`](../server/routes/helperRegistration.js#L26) · guards `authLimiter` · handler `startRegistration`
- [`POST /registration-terms`](../server/routes/helperRegistration.js#L49) · guards `authLimiter` · handler `acceptPendingTerms`
- [`POST /finalize`](../server/routes/helperRegistration.js#L50) · guards `authenticate, requireHelperStep` · handler `finalizeRegistration`

**Repository sources**  [helperRegistration.js](../server/routes/helperRegistration.js) · [helperOnboarding.js](../server/services/helperOnboarding.js) · [authController.js](../server/controllers/authController.js#L1573)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-007"></a>

**Account and access work packages** · Page 113 of 393 · WP-007

## Verification and provider callbacks

### Current boundary

Identity checks flow through existing provider sessions, callbacks, and durable onboarding facts.

### Implementation work

Keep identity evidence as a verification dependency, keyed to the verified subject and provider session. Allow legitimate applicants to initiate their own private onboarding. Read result freshness from the verification service and make approval conditions explicit.

### Acceptance

Try a delayed, duplicate, mismatched and stale verification return. Confirm receipt cannot authorize a different account or create another grant. Current helper bid capability changes only after the correct decision and current verified evidence.

### Source declarations to trace

- [`POST /skip`](../server/routes/didit.js#L16) · guards `authenticate` · handler `skipVerification`

**Repository sources**  [didit.js](../server/routes/didit.js) · [verification.js](../server/routes/verification.js) · [helperOnboarding.js](../server/services/helperOnboarding.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-008"></a>

**Account and access work packages** · Page 114 of 393 · WP-008

## Business team access requests

### Current boundary

The team router includes membership listing, role or override changes, approval and denial, and invitations with privilege checks.

### Implementation work

Reuse business membership as the source for approvals to join that business. Render a request in the selected entity context. Validate a reviewer’s current privileges and target scope. Changes that widen existing membership deserve their own auditable state.

### Acceptance

Create a pending member in two businesses. Approve one membership as that owner. Verify access only in the selected business and permission subset. Attempt approval after the approver’s grant is revoked and inspect persisted rows.

### Source declarations to trace

- [`PATCH /:businessId/memberships/:membershipId/role`](../server/routes/businessTeam.js#L48) · guards `authenticate, requireBusinessAccess` · handler `team.changeMembershipRole`
- [`PUT /:businessId/memberships/:membershipId/overrides`](../server/routes/businessTeam.js#L55) · guards `authenticate, requireBusinessAccess` · handler `team.setMembershipOverrides`
- [`GET /:businessId/memberships`](../server/routes/businessTeam.js#L33) · guards `authenticate, requireBusinessAccess, requirePermission` · handler `team.listMemberships`

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [businessTeamController.js](../server/controllers/businessTeamController.js) · [requireBusinessAccess.js](../server/middleware/requireBusinessAccess.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-009"></a>

**Account and access work packages** · Page 115 of 393 · WP-009

## Invitations and Vortex codes

### Current boundary

Invite, code and membership flows can create a relationship before the person has used the selected workspace.

### Implementation work

Bind pending invite use to the eligible verified account, code validity, business, role and allowed location. Link accepted invitations without another account switch. Keep pre-approval status and invite return consistent for logged-out users.

### Acceptance

Consume one invitation twice and from an invalid account. Race invite acceptance with revocation or expiry. Assert one intended membership, retained prior memberships, and no accidental reveal of a foreign team.

### Source declarations to trace

- [`POST /preview`](../server/routes/vortex.js#L32) · guards `authenticate, rejectImpersonated, requireVortexEnabled, vortexRedeemLimiter` · handler `access.previewCode`
- [`POST /:businessId/access-codes`](../server/routes/businessTeam.js#L110) · guards `authenticate, rejectImpersonated, requireVortexEnabled, requireBusinessAccess` · handler `access.createAccessCode`

**Repository sources**  [vortex.js](../server/routes/vortex.js) · [businessTeam.js](../server/routes/businessTeam.js) · [vortex.js](../client/src/api/vortex.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-010"></a>

**Account and access work packages** · Page 116 of 393 · WP-010

## Access policy and form discovery

### Current boundary

Current policies expose application schema and gate configured actions. The historical application is keyed by user and mode.

### Implementation work

Extend through a scoped application model or a purpose-built adapter. Select applicable stable revision by capability and scope, and expose public questions with conditional requirements. Keep private rules and sensitive notes behind reviewer authorization.

### Acceptance

Change a question while two clients hold an older revision. A save stays recoverable and submission either validates the current version or reports an explicit mismatch. Compare unauthenticated and applicant form discovery output.

### Source declarations to trace

- [`PATCH /mode-policies/:mode`](../server/routes/modePlatformApprovals.js#L30) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminUpdatePolicy`
- [`POST /mode-policies/:mode/rollback`](../server/routes/modePlatformApprovals.js#L31) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminRollbackPolicy`
- [`GET /mode-policies/coverage`](../server/routes/modePlatformApprovals.js#L28) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminListPolicyCoverage`

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js) · [modePlatformApprovals.js](../client/src/api/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-011"></a>

**Account and access work packages** · Page 117 of 393 · WP-011

## Applicant status and resubmission

### Current boundary

Existing approval APIs have applicant reads and request writes plus review actions.

### Implementation work

Expose applicant-visible history for a specific request. Add a recoverable needs-information state and revisions. Preserve prefills and selected scope, and fetch status from the authoritative request before rendering actions.

### Acceptance

Request a specific missing document, then submit it and refresh on another device. The history retains both revisions. An applicant cannot read or revise another account’s case using its opaque identifier.

### Source declarations to trace

- [`POST /me/:mode/request`](../server/routes/modePlatformApprovals.js#L22) · guards `authenticate` · handler `ctrl.requestMine`
- [`PATCH /mode-policies/:mode`](../server/routes/modePlatformApprovals.js#L30) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminUpdatePolicy`
- [`POST /mode-policies/:mode/rollback`](../server/routes/modePlatformApprovals.js#L31) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminRollbackPolicy`

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalController.js](../server/controllers/modePlatformApprovalController.js) · [SettingsPage.jsx](../client/src/pages/SettingsPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-012"></a>

**Account and access work packages** · Page 118 of 393 · WP-012

## Platform review and audit

### Current boundary

Historic mode approvals are reviewed by Super Admin in this route family with approve, reject and revoke operations.

### Implementation work

Design scoped review authorities for each new capability and reuse the applicable admin infrastructure. Include evidence, status, safe notes, exact subject and version. Require idempotent auditable decisions. Separate staff invitation authority and domain reviewers.

### Acceptance

Two authorized reviewers act on the same request version. One commits. The other sees a conflict and the final decision. A scoped reviewer cannot approve, inspect proof, or list a foreign subject.

### Source declarations to trace

- [`POST /me/:mode/request`](../server/routes/modePlatformApprovals.js#L22) · guards `authenticate` · handler `ctrl.requestMine`
- [`PATCH /mode-policies/:mode`](../server/routes/modePlatformApprovals.js#L30) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminUpdatePolicy`
- [`POST /mode-policies/:mode/rollback`](../server/routes/modePlatformApprovals.js#L31) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminRollbackPolicy`

**Repository sources**  [ModeApprovals.jsx](../client/src/admin/pages/super/ModeApprovals.jsx) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-013"></a>

**Account and access work packages** · Page 119 of 393 · WP-013

## Role switch retirement

### Current boundary

The mode switch path changes default mode, derived role and session state, and the browser reloads.

### Implementation work

Keep legacy callers safe during compatibility. Remove their ability to acquire new authority through the switch. Replace navigation interactions with ordinary in-app actions. Verify refresh cookie and role payload behavior for supported versions.

### Acceptance

Call the retained endpoint with every former self-selectable mode from a customer account concurrently with new grants. Check protected writes require approved authority and that the stable account remains usable for customer tasks.

### Source declarations to trace

- [`POST /switch-role`](../server/routes/auth.js#L90) · guards `authLimiter, authenticate` · handler `switchRole`
- [`POST /login`](../server/routes/auth.js#L41) · guards `loginLimiter` · handler `login`
- [`POST /login/2fa`](../server/routes/auth.js#L42) · guards `loginLimiter` · handler `loginWith2FA`

**Repository sources**  [auth.js](../server/routes/auth.js) · [modeRole.js](../server/utils/modeRole.js) · [ModeSwitcher.jsx](../client/src/components/ModeSwitcher.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-014"></a>

**Account and access work packages** · Page 120 of 393 · WP-014

## Current-user projection and resume

### Current boundary

Current-user bootstrap and My Businesses provide different views of identity and authorized entities.

### Implementation work

Return a stable minimally scoped access projection for useful actions. Load large organization or permission data on demand. Keep authorization independent from the current page. Use the same view on reload, mobile background resume, and after a grant notification.

### Acceptance

Load a private tab, remove a role in another tab, and reload. Verify personal identity remains, the removed feature is closed, and no browser cache exposes another account’s details after signing out and back in.

### Source declarations to trace

- [`POST /internal-access/recovery/use`](../server/routes/auth.js#L51) · guards `strictLimiter` · handler `logisticsInternalAccessCtrl.useRecovery`

**Repository sources**  [auth.js](../server/routes/auth.js) · [meWorkspace.js](../server/routes/meWorkspace.js) · [AuthContext.jsx](../client/src/context/AuthContext.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-015"></a>

**Account and access work packages** · Page 121 of 393 · WP-015

## Home and dashboard routing

### Current boundary

Current dashboard selection relies on normalized launch mode or derived role. Some role dashboards redirect to scoped areas.

### Implementation work

Make Home stable and task-based. Use capability-aware sections and current entity scope. Preserve deep links to old dashboards through the compatibility window. New approvals can reveal controls without replacing a person’s dashboard choice.

### Acceptance

Give the fixture personal, helper, employee, and restaurant-manager actions in parallel. Load Home directly after sign-in and refresh active work in two entity tabs. No unrelated role selection is required for actions or reload.

**Repository sources**  [ModeHomeRoute.jsx](../client/src/components/ModeHomeRoute.jsx) · [SmartDashboard.jsx](../client/src/pages/SmartDashboard.jsx) · [modeAccess.js](../client/src/utils/modeAccess.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-016"></a>

**Account and access work packages** · Page 122 of 393 · WP-016

## Navigation, notices and settings

### Current boundary

Navigation chooses different action groups for selected modes and uses workspace choices to reach operations.

### Implementation work

Use shared navigation, with local links or controls scoped to the current action. Show application status in account settings and relevant context. Keep named entities, user preference and permitted dashboard subsections separate. Render clear fallback on removed access.

### Acceptance

At widths from phone to desktop, run customer action, provider action and entity action from recognizable entry points. Apply approval while viewing Settings and validate screen reader status with no focus jump.

**Repository sources**  [navbarNavigation.js](../client/src/utils/navbarNavigation.js) · [BusinessSwitcher.jsx](../client/src/components/BusinessSwitcher.jsx) · [SettingsPage.jsx](../client/src/pages/SettingsPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-017"></a>

**Account and access work packages** · Page 123 of 393 · WP-017

## JWT, CSRF and cross-tab session safety

### Current boundary

Auth loads current user facts and coordinates cookie-changing operations and refresh. Existing JWT compatibility includes role and session information.

### Implementation work

Keep session revocation for actual credential events. Recheck grants for protected commands without needing a global switching session. Invalidate access snapshots separately from cross-user cookie transitions. Keep suspended identities blocked.

### Acceptance

Stress declined refresh, sign-out, password security changes and supervisor revocation during concurrent requests. A prior session or late access projection must never become attached to the next signed-in user.

### Source declarations to trace

- [`POST /login`](../server/routes/auth.js#L41) · guards `loginLimiter` · handler `login`
- [`POST /login/2fa`](../server/routes/auth.js#L42) · guards `loginLimiter` · handler `loginWith2FA`
- [`POST /login/passkey/options`](../server/routes/auth.js#L43) · guards `strictLimiter` · handler `passkeyCtrl.authenticationOptions`

**Repository sources**  [auth.js](../server/middleware/auth.js) · [auth.js](../server/routes/auth.js) · [authSessionEpoch.js](../client/src/api/authSessionEpoch.js) · [AuthContext.jsx](../client/src/context/AuthContext.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-018"></a>

**Account and access work packages** · Page 124 of 393 · WP-018

## Two-factor authentication and passkeys

### Current boundary

Security factors include separate enrollment and challenge routes with their own session and credential handling.

### Implementation work

Preserve second-factor and step-up requirements on protected staff and financial actions. Access approval must still leave the correct authentication strength check in place. Do not change passkey ownership when assigning capabilities.

### Acceptance

Approve a reviewer capability to a user with a weak session. Protected review still requires the applicable factor. Try assertion or enrollment replay against a different account and inspect that role changes did not affect challenge binding.

### Source declarations to trace

- [`DELETE /:id`](../server/routes/passkeys.js#L13) · guards `authenticate, requireAdmin, rejectImpersonated, strictLimiter` · handler `controller.revokePasskey`
- [`DELETE /:id`](../server/routes/userPasskeys.js#L14) · guards `authenticate, rejectImpersonated, strictLimiter` · handler `controller.revokePasskey`

**Repository sources**  [twoFactor.js](../server/routes/twoFactor.js) · [passkeys.js](../server/routes/passkeys.js) · [userPasskeys.js](../server/routes/userPasskeys.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-019"></a>

**Account and access work packages** · Page 125 of 393 · WP-019

## Sessions on native API and PWA

### Current boundary

This checkout provides mobile endpoints, PWA update behavior, and server-driven profile and action contracts.

### Implementation work

Add compatibly projected access and durable return context. Check the owner and installed versions of separately maintained clients. Prevent the service worker and offline queue from caching applicant or private access data across accounts.

### Acceptance

Check on old iOS request fixtures and a browser installed as a PWA. Queue an action, revoke permission, and resume. Verify server denial for a new unauthorized action and retained legitimate recovery state.

### Source declarations to trace

- [`PATCH /profile`](../server/routes/mobile.js#L17) · guards `authenticate` · handler `mobileController.updateMobileProfile`
- [`POST /push-token`](../server/routes/mobile.js#L18) · guards `authenticate` · handler `mobileController.registerPushToken`
- [`DELETE /push-token`](../server/routes/mobile.js#L19) · guards `authenticate` · handler `mobileController.unregisterPushToken`

**Repository sources**  [mobile.js](../server/routes/mobile.js) · [mobileController.js](../server/controllers/mobileController.js) · [sw.js](../client/public/sw.js) · [ServiceWorkerUpdateNotice.jsx](../client/src/components/ServiceWorkerUpdateNotice.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-020"></a>

**Account and access work packages** · Page 126 of 393 · WP-020

## Notification and application messages

### Current boundary

Notifications and admin outbound messages reach clients through multiple delivery paths.

### Implementation work

Give each durable request transition one notification identity and safe template. Link to the owning application or permissible task. Keep sensitive reviewer notes and evidence out of outbound content. Delivery outcomes remain separate from authorization.

### Acceptance

Trigger one approved transition and retry worker dispatch after an artificial timeout. Check in-app and channel delivery dedupe and follow the link as intended viewer, no user, and another signed-in user.

### Source declarations to trace

- [`DELETE /:id`](../server/routes/notifications.js#L51) · guards `authenticate` · handler `notifCtrl.deleteNotification`

**Repository sources**  [notifications.js](../server/routes/notifications.js) · [adminMessageOutbox.js](../server/routes/adminMessageOutbox.js) · [mobilePushService.js](../server/services/mobilePushService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-021"></a>

**Account and access work packages** · Page 127 of 393 · WP-021

## Account deletion, export and privacy

### Current boundary

Account security and privacy endpoints handle user actions under their existing identity and data rules.

### Implementation work

Submit a retention and export design for requests, grants, and evidence. Close effective rights on account deletion or suspension without damaging other members’ data and durable domain obligations. Enforce ownership in export downloads.

### Acceptance

Delete a fixture requesting access and retaining an existing contract. Check private requests and grants become inaccessible appropriately, retention facts are preserved as specified, and a foreign operator cannot download the applicant’s export history.

### Source declarations to trace

- [`POST /export/verification/request`](../server/routes/privacy.js#L188) · guards `authenticate`

**Repository sources**  [privacy.js](../server/routes/privacy.js) · [consent.js](../server/routes/consent.js) · [auth.js](../server/routes/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-022"></a>

**Account and access work packages** · Page 128 of 393 · WP-022

## Profile and public directory

### Current boundary

Public and private endpoints serve profiles, slugs, search and account actions with various verification and audience checks.

### Implementation work

Separate helper application drafts and approval facts from published provider data. Apply current visibility and standing for listings on search, profile links, snapshots and embeds. Retain existing reviews and route slugs when approval is backfilled.

### Acceptance

Compare guest, customer, suspended helper and approved listed helper. Search, slug preview, embeds and metadata must agree for visibility. Unlisting one business cannot change a different owned profile.

### Source declarations to trace

- [`GET /:id/profile-qr.png`](../server/routes/helpers.js#L61) · guards `generalLimiter` · handler `getHelperProfileQRCodePng`
- [`PUT /cover-image`](../server/routes/helperProfile.js#L688) · guards `helperOnly, coverUpload.single, validateFileUpload` · handler `helperProfileImageController.uploadCoverImage`
- [`PATCH /me`](../server/routes/users.js#L16) · guards `authenticate, rejectImpersonated` · handler `updateProfile`

**Repository sources**  [helpers.js](../server/routes/helpers.js) · [helperProfile.js](../server/routes/helperProfile.js) · [profileSlugs.js](../server/routes/profileSlugs.js) · [users.js](../server/routes/users.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-023"></a>

**Account and access work packages** · Page 129 of 393 · WP-023

## Preferences, status and localization

### Current boundary

Help and experience content select role-specific defaults and settings currently use account mode.

### Implementation work

Choose suggested content using visible actions and the local context. Keep settings sections understandable for multiple independent capabilities. Translate and test all new intake and approval labels in required catalogs.

### Acceptance

Open a translated request in Arabic with a long business name. Validate keyboard, focus return, screen reader status and the correct policy link. Changes in Spanish settings must retain all separate approved choices.

**Repository sources**  [howItWorksRoleModel.js](../client/src/utils/howItWorksRoleModel.js) · [experienceGuideModel.js](../client/src/utils/experienceGuideModel.js) · [modeAccess.js](../client/src/utils/modeAccess.js) · [common.json](../client/src/i18n/locales/en/common.json)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-024"></a>

**Marketplace and customer work packages** · Page 130 of 393 · WP-024

## Public discovery and location

### Current boundary

Discovery combines public catalog and location-aware browsing. The current home action can depend on selected mode.

### Implementation work

Keep anonymous and personal discovery behavior. Add provider actions separately when authorized, and make private projection data unavailable to public caches. Preserve explicit location choices and original discovery scope.

### Acceptance

Load identical discover requests as guest, applicant and approved helper. Verify visibility and guest navigation parity, and test location changes while a stale result response is returning.

**Repository sources**  [discover.js](../server/routes/discover.js) · [geo.js](../server/routes/geo.js) · [recommendations.js](../server/routes/recommendations.js) · [ModeHomeRoute.jsx](../client/src/components/ModeHomeRoute.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-025"></a>

**Marketplace and customer work packages** · Page 131 of 393 · WP-025

## Customer job post and job lifecycle

### Current boundary

Jobs include posting, management and public or relationship-scoped detail. A provider may also have customer-owned jobs.

### Implementation work

Preserve employer/customer ownership checks. Make posting accessible within Jobs even for approved providers. Apply canonical authorization to title, placement, edit, cancellation, schedule and completion actions.

### Acceptance

Create a new posted job as a verified helper for themself as customer. Verify their own job cannot accept their bid. An unrelated user cannot edit, cancel, or see private fields of that job.

### Source declarations to trace

- [`PUT /draft`](../server/routes/jobs.js#L27) · guards `authenticate` · handler `saveDraft`
- [`DELETE /draft`](../server/routes/jobs.js#L28) · guards `authenticate` · handler `deleteDraft`
- [`POST /`](../server/routes/jobs.js#L56) · guards `authenticate, requireEmailVerified, requireTermsAcceptance, checkRestrictions` · handler `createJob`

**Repository sources**  [jobs.js](../server/routes/jobs.js) · [Dashboard.jsx](../client/src/pages/Dashboard.jsx) · [jobDetailModel.js](../client/src/utils/jobDetailModel.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-026"></a>

**Marketplace and customer work packages** · Page 132 of 393 · WP-026

## Helper bidding and acceptance

### Current boundary

Bid and work routes have provider-role and lifecycle requirements that can differ by entry point.

### Implementation work

Replace role-only dependence with approved helper entitlement and current verification evidence. Enforce participant, offer, competition and job rules. Preserve acceptance by the correct role in the particular job relationship.

### Acceptance

Attempt direct bids from an applicant, verified helper, suspended helper and helper who owns the job. Approve the pending applicant while signed in, submit exactly one legitimate bid, and exercise accepted and rejected bids across browsers.

### Source declarations to trace

- [`POST /assign`](../server/routes/jobs.js#L57) · guards `authenticate, rejectImpersonated` · handler `assignHelper`

**Repository sources**  [bids.js](../server/routes/bids.js) · [jobs.js](../server/routes/jobs.js) · [helperOnboarding.js](../server/services/helperOnboarding.js) · [HelperDashboard.jsx](../client/src/pages/HelperDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-027"></a>

**Marketplace and customer work packages** · Page 133 of 393 · WP-027

## Bookings and calendar

### Current boundary

Booking and calendar paths serve requesters, providers, staff and business calendars with different scopes.

### Implementation work

Use scoped participant and membership checks. Keep appointment location, schedule visibility, availability, conflict handling, and cancellation state. Avoid over-expanding staff calendar reads when provider eligibility is added.

### Acceptance

Give the same identity personal appointments, its own helper schedule and a restricted team calendar. Check filters, writes, reschedule and recurrence with multiple entity IDs and two tabs.

### Source declarations to trace

- [`POST /`](../server/routes/bookings.js#L12) · guards `requireAuth, requireEmailVerified, requireTermsAcceptance` · handler `bookingController.createBookingRequest`
- [`POST /notifications/:id/read`](../server/routes/calendar.js#L40) · guards `authenticate, rateLimiter` · handler `calendarNotificationController.markNotificationAsRead`

**Repository sources**  [bookings.js](../server/routes/bookings.js) · [calendar.js](../server/routes/calendar.js) · [businessCalendarPermissions.test.js](../server/__tests__/businessCalendarPermissions.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-028"></a>

**Marketplace and customer work packages** · Page 134 of 393 · WP-028

## Quotes and quote requests

### Current boundary

Quotes can be requested by customers, answered by providers or generated in an authorized business context.

### Implementation work

Retain requester and provider distinctions on each record, quote lifecycle, version and currency. Grant creation and acceptance to authorized subjects. Keep alternate approval paths from reinterpreting an unverified profile as an authorized consultant.

### Acceptance

Create customer and helper quote flows in one session. Check draft recovery, wrong party acceptance, change request, duplicate retry and unauthorized access to attachments or private notes.

### Source declarations to trace

- [`POST /`](../server/routes/quoteRequests.js#L9) · guards `generalLimiter, optionalAuth` · handler `ctrl.createQuoteRequest`

**Repository sources**  [helperQuotes.js](../server/routes/helperQuotes.js) · [quoteRequests.js](../server/routes/quoteRequests.js) · [invoices.js](../server/routes/invoices.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-029"></a>

**Marketplace and customer work packages** · Page 135 of 393 · WP-029

## Work agreements and disputes

### Current boundary

Agreements and disputes reference existing work and their participants. Enforcement can change account standing.

### Implementation work

Keep historical relationship reads and obligations available according to existing policy when new work eligibility is revoked. Preserve actor checks for signatures, new commitments, evidence, moderation and dispute state transitions.

### Acceptance

Suspend a helper in an active agreement. Reject new bids, preserve permitted ongoing dispute access and enforce exact actor and state on signing or modifying an existing agreement.

### Source declarations to trace

- [`POST /draft`](../server/routes/workAgreements.js#L13) · guards `authenticate` · handler `wa.draftAgreement`
- [`POST /jobs/:jobId`](../server/routes/disputes.js#L19) · guards `authenticate` · handler `disputeCtrl.openDispute`

**Repository sources**  [workAgreements.js](../server/routes/workAgreements.js) · [disputes.js](../server/routes/disputes.js) · [enforcement.js](../server/routes/enforcement.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-030"></a>

**Marketplace and customer work packages** · Page 136 of 393 · WP-030

## Ratings and review management

### Current boundary

Reviews are linked to provider, business and job context and can be moderated separately.

### Implementation work

Derive authorship and eligibility from the underlying relationship. Keep public visible reviews and flags governed by their own policy. Business review replies must use the verified entity and scoped permission.

### Acceptance

Switch between two businesses while composing a reply. Verify the displayed author and response subject remain aligned. Remove a team grant and deny new replies without hiding unrelated public reviews.

### Source declarations to trace

- [`POST /jobs/:jobId`](../server/routes/reviews.js#L11) · guards `authenticate` · handler `reviewCtrl.submitReview`
- [`POST /reviews/:reviewId/report`](../server/routes/reviewModeration.js#L20) · guards `requireAuth` · handler `ctrl.reportReview`
- [`POST /:businessId/submit`](../server/routes/businessReviews.js#L15) · guards `authenticate, scopeExempt` · handler `reviewsController.submitReview`
- [`POST /:businessId/reviews-manage/:reviewId/reply`](../server/routes/businessReviewMgmt.js#L8) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.replyToReview`

**Repository sources**  [reviews.js](../server/routes/reviews.js) · [reviewModeration.js](../server/routes/reviewModeration.js) · [businessReviews.js](../server/routes/businessReviews.js) · [businessReviewMgmt.js](../server/routes/businessReviewMgmt.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-031"></a>

**Marketplace and customer work packages** · Page 137 of 393 · WP-031

## Career applications and employer recruiting

### Current boundary

Careers covers both applicants and authorized employers, including private candidate and interview information.

### Implementation work

Keep applicant actions personal and available during other pending applications. Keep employer posting and candidate access subject to the authorized business and opening. Preserve publication, invite and interview authorization rules.

### Acceptance

Apply as an employee of a different company and open an applicant link. Verify an employer role for business A cannot view applicants at B, including interview links and exported candidate notes.

### Source declarations to trace

- [`POST /employers/:slug/reviews`](../server/routes/careers.js#L44) · guards `authenticate, careersContentLimiter` · handler `mk.submitReview`
- [`POST /employers/:slug/questions`](../server/routes/careers.js#L45) · guards `authenticate, careersContentLimiter` · handler `mk.askQuestion`
- [`POST /employers/:slug/questions/:questionId(\d+)/answers`](../server/routes/careers.js#L46) · guards `authenticate, careersContentLimiter` · handler `mk.answerQuestion`

**Repository sources**  [careers.js](../server/routes/careers.js) · [careersModel.js](../client/src/features/careers/careersModel.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-032"></a>

**Marketplace and customer work packages** · Page 138 of 393 · WP-032

## Direct customer requests and bookings

### Current boundary

Direct includes catalog, quotes, booking, job, payment and history routes with guest and authenticated paths.

### Implementation work

Keep the customer journey stable while new helper or business capabilities are added. Continue seat, quote and appointment checks using canonical IDs. Preserve verified user return state and request drafts after auth.

### Acceptance

Start a quote or booking as a guest, sign up with Helper intent, and return to finish the same customer flow. A pending application must never block the person’s permitted booking or expose another quote.

### Source declarations to trace

- [`POST /uploads`](../server/routes/direct.js#L102) · guards `authenticate, directUploadLimiter, upload.single, validateFileUpload` · handler `ctrl.uploadDirectAsset`
- [`POST /requests`](../server/routes/direct.js#L114) · guards `generalLimiter, optionalAuth, limitDirectPhotoAttachments` · handler `quoteCtrl.createQuoteRequest`
- [`POST /requests/claim`](../server/routes/direct.js#L118) · guards `authenticate` · handler `ctrl.claimGuestRequest`

**Repository sources**  [direct.js](../server/routes/direct.js) · [directController.js](../server/controllers/directController.js) · [directBookSlotAuth.test.js](../server/__tests__/directBookSlotAuth.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-033"></a>

**Marketplace and customer work packages** · Page 139 of 393 · WP-033

## Direct authorized operations

### Current boundary

Direct internal views include queue, catalog, schedules, jobs, receipts, teams and reports.

### Implementation work

Use Direct’s existing operator grants and use a canonical job or entity context for sensitive actions. Match any admin and provider routes, and keep staffing, price, payment and export boundaries explicit.

### Acceptance

Run both a permitted operator and a customer with an approved business. Customer cannot read the operations queue. A scoped operator sees only allowed Direct work, and payment retry stays idempotent.

### Source declarations to trace

- [`POST /uploads`](../server/routes/direct.js#L102) · guards `authenticate, directUploadLimiter, upload.single, validateFileUpload` · handler `ctrl.uploadDirectAsset`
- [`POST /catalog/services/:id/holds`](../server/routes/direct.js#L93) · guards `authenticate, directHoldLimiter` · handler `ctrl.createServiceHold`
- [`POST /catalog/services/:id/book`](../server/routes/direct.js#L99) · guards `authenticate, requireEmailVerified, requireTermsAcceptance, directBookLimiter` · handler `ctrl.bookServiceSlot`

**Repository sources**  [direct.js](../server/routes/direct.js) · [adminRouteManifest.js](../client/src/admin/adminRouteManifest.js) · [directController.js](../server/controllers/directController.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-034"></a>

**Marketplace and customer work packages** · Page 140 of 393 · WP-034

## Client message threads

### Current boundary

Message behavior depends on thread relationships and sometimes on mode or role when choosing the inbox.

### Implementation work

Use a single predictable Messages surface with contextual identities and inbox filters. Keep thread membership, sender context, block rules, and safe guest fallbacks. Convert send, listing, attachment and unread paths together.

### Acceptance

Open personal, helper and two business threads in the same account, then revoke one team membership. Realtime, badge counts, thread deep links and attachment downloads must reflect scope without dropping valid personal threads.

### Source declarations to trace

- [`POST /guest-inquiries/:id/messages`](../server/routes/messages.js#L47) · guards `userChatLimiter, conversationMessageLimiter` · handler `replyGuestInquiryMessage`
- [`POST /conversations/:conversationId`](../server/routes/messages.js#L74) · guards `userChatLimiter, conversationMessageLimiter` · handler `sendMessage`
- [`DELETE /conversations/:conversationId/:messageId`](../server/routes/messages.js#L77) · guards `userChatLimiter, conversationMessageLimiter` · handler `deleteMessage`

**Repository sources**  [messages.js](../server/routes/messages.js) · [messageController.js](../server/controllers/messageController.js) · [MessagingWorkspace.jsx](../client/src/components/messaging/MessagingWorkspace.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-035"></a>

**Marketplace and customer work packages** · Page 141 of 393 · WP-035

## Support from the customer surface

### Current boundary

Support can be launched from public or signed-in contexts, including user and business requests.

### Implementation work

Show the user a way to ask about pending applications while maintaining existing support availability. Pass only safe application references. Verify support lookup is scoped by conversation and authority, and preserve guest-to-user transition.

### Acceptance

Ask support about a synthetic pending request while signed in and from a fresh guest session. A foreign case reference must reveal no applicant details. Link back into the authorized account state.

### Source declarations to trace

- [`POST /initiate`](../server/routes/supportChat.js#L23) · guards `authLimiter, optionalAuth` · handler `initiateSupportChat`
- [`POST /public/conversations`](../server/routes/support.js#L60) · guards `conversationMessageLimiter` · handler `publicSupport.createGuestConversation`

**Repository sources**  [supportChat.js](../server/routes/supportChat.js) · [support.js](../server/routes/support.js) · [guestChat.js](../server/routes/guestChat.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-036"></a>

**Marketplace and customer work packages** · Page 142 of 393 · WP-036

## Business support agent queue

### Current boundary

Support workspace queue access is organization scoped and operations include case ownership and SLA actions.

### Implementation work

Reveal authorized conversation tools within the business context. Keep separate company and platform support authorizers. Check employer scope and permissions on queue list, claim, change, escalation and attachments.

### Acceptance

Claim a case from the allowed employer. Switch to another employer’s URL and try to reply using the former case ID. Remove employer access while the queue is open and verify action denial and timely cleanup.

### Source declarations to trace

- [`POST /onboard`](../server/routes/supportAgents.js#L23) · guards `authenticate` · handler `onboardAgent`
- [`POST /:businessId/conversations/:ticketId/assign`](../server/routes/supportRouting.js#L80) · guards `requireAuth, scopeExempt` · handler `supportRoutingController.assignToAgent`

**Repository sources**  [supportAgents.js](../server/routes/supportAgents.js) · [supportRouting.js](../server/routes/supportRouting.js) · [scopeGates.js](../server/middleware/scopeGates.js) · [SupportAgentWorkspacePage.jsx](../client/src/pages/SupportAgentWorkspacePage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-037"></a>

**Marketplace and customer work packages** · Page 143 of 393 · WP-037

## Listings and rental participant setup

### Current boundary

Renting and listing tooling are available through separate use cases with listing, booking and owner views.

### Implementation work

Keep rent search and booking usable with customer access. Propose explicit right to publish equipment and operate only the person’s or business’s inventory. Allow eligible applicant private drafts and check platform listing policy.

### Acceptance

As customer rent a permitted tool, then request the ability to list. Pending state can resume draft but never publishes. Approved actor publishes one listing for the right owner, with no ability to edit another owner’s listing.

### Source declarations to trace

- [`POST /payment-method`](../server/routes/toolRentals.js#L448) · guards `authenticate` · handler `paymentMethodController.setPaymentMethod`
- [`DELETE /payment-method`](../server/routes/toolRentals.js#L449) · guards `authenticate` · handler `paymentMethodController.deletePaymentMethod`
- [`POST /`](../server/routes/toolRentals.js#L452) · guards `authenticate, upload.single, validateFileUpload`

**Repository sources**  [toolRentals.js](../server/routes/toolRentals.js) · [ToolOwnerDashboard.jsx](../client/src/pages/ToolOwnerDashboard.jsx) · [toolOwnerDashboard.js](../client/src/utils/toolOwnerDashboard.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-038"></a>

**Marketplace and customer work packages** · Page 144 of 393 · WP-038

## Rental handoff, deposits and disputes

### Current boundary

Rental operations include booking approval, pickup, return, disputes and moderation hold.

### Implementation work

Keep booking ownership and settlement semantics independent of publisher eligibility. Approved owners can operate eligible reservations. Revoked listing rights block new listings while case handling follows booking and dispute authority.

### Acceptance

Place and accept a rental in an isolated fixture. Revoke publishing and test handoff and deposit paths against actual booking rules. Verify replay and damage disputes do not double-charge or overexpose rider details.

### Source declarations to trace

- [`POST /bookings/:bookingId/deposit/resolve`](../server/routes/toolRentals.js#L703) · guards `authenticate, invoiceLimiter` · handler `invoiceController.resolveDeposit`
- [`POST /jobs/:jobId`](../server/routes/disputes.js#L19) · guards `authenticate` · handler `disputeCtrl.openDispute`

**Repository sources**  [toolRentals.js](../server/routes/toolRentals.js) · [disputes.js](../server/routes/disputes.js) · [toolRentalModerationHold.test.js](../server/__tests__/toolRentalModerationHold.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-039"></a>

**Marketplace and customer work packages** · Page 145 of 393 · WP-039

## Marketplace product catalog

### Current boundary

The product marketplace has distinct public visibility, supplier and owner actions, and approved commerce features.

### Implementation work

Derive catalog mutation ability from scoped seller or member authority and product publication policy. Keep reading public goods and accepting valid purchase paths independent of supplier approval status.

### Acceptance

Attempt customer checkout from an approved seller account. Attempt product write from a pending seller and from a business authorized for a different catalog. Validate public visibility and fulfillment link behavior.

### Source declarations to trace

- [`POST /:productId/reviews`](../server/routes/marketplaceProducts.js#L47) · guards `authenticate` · handler `marketplaceProductsController.submitProductReview`
- [`POST /:businessId/products`](../server/routes/businessProducts.js#L17) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createProduct`

**Repository sources**  [marketplaceProducts.js](../server/routes/marketplaceProducts.js) · [businessProducts.js](../server/routes/businessProducts.js) · [helperProducts.js](../server/routes/helperProducts.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-040"></a>

**Marketplace and customer work packages** · Page 146 of 393 · WP-040

## Carts, saved baskets, and checkout

### Current boundary

Carts can be personal, shared, or tied to job materials. Checkout and temporary state have distinct identity and authorization rules.

### Implementation work

Retain and recover carts across approval events. Verify buyer, collaborator, business ownership and explicit payment context at write time. Enforce dedupe and rotate sensitive share state only under existing policy rules.

### Acceptance

Open a shared cart and a personal basket in separate tabs. Approve a helper capability after entering checkout. Verify no cart rekey, stale price acceptance, unauthorized share visibility, or duplicated order.

### Source declarations to trace

- [`POST /:cartId/payment-intent`](../server/routes/cartCheckout.js#L31) · guards `requireAuth, requireEmailVerified, requireTermsAcceptance, checkRestrictions`
- [`POST /`](../server/routes/shoppingCarts.js#L12) · handler `shoppingCartsController.createCart`
- [`POST /`](../server/routes/sharedCarts.js#L10) · guards `authenticate` · handler `sharedCartsController.shareCart`

**Repository sources**  [cartCheckout.js](../server/routes/cartCheckout.js) · [shoppingCarts.js](../server/routes/shoppingCarts.js) · [sharedCarts.js](../server/routes/sharedCarts.js) · [jobKits.js](../server/routes/jobKits.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-041"></a>

**Marketplace and customer work packages** · Page 147 of 393 · WP-041

## Jobs materials and ordering

### Current boundary

Materials may connect a job or product order to logistics and marketplace state.

### Implementation work

Keep the job participant and purchase actor as separately verified facts. Apply the jurisdiction or lane rules at the procurement operation. Do not conflate an organization’s buyer grant with ability to change a job record.

### Acceptance

Bid on a job, attach a permitted materials option, and submit the correct owner’s order. A foreign order ID must fail even if the helper owns the job. Repeat the action with the same idempotency key.

### Source declarations to trace

- [`POST /:jobType/build`](../server/routes/jobKits.js#L32)

**Repository sources**  [jobKits.js](../server/routes/jobKits.js) · [orders.js](../server/routes/orders.js) · [logistics.js](../server/routes/logistics.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-042"></a>

**Marketplace and customer work packages** · Page 148 of 393 · WP-042

## Media publisher and verification

### Current boundary

Media distinguishes author and publisher identities and has draft, publishing and verification flows.

### Implementation work

List only publishable or explicitly unverified private setup identities belonging to current actor. Verify at draft creation and publish against exact publisher. Preserve moderation gates, attribution and restaurant federation.

### Acceptance

In the same session select personal and two entity publishers. Revoke one while its draft is open, confirm eligible publishers remain available and denied publisher cannot publish by resending a stale payload.

### Source declarations to trace

- [`POST /verification/requests`](../server/routes/media.js#L42) · guards `requireAuth` · handler `verificationCtrl.createRequest`
- [`GET /verification`](../server/routes/media.js#L41) · guards `requireAuth` · handler `verificationCtrl.getCenter`
- [`GET /search`](../server/routes/media.js#L46) · handler `ctrl.searchMedia`

**Repository sources**  [media.js](../server/routes/media.js) · [mediaVerificationController.js](../server/controllers/mediaVerificationController.js) · [MediaComposePage.jsx](../client/src/pages/media/MediaComposePage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-043"></a>

**Marketplace and customer work packages** · Page 149 of 393 · WP-043

## Media creator marketplace and sharing

### Current boundary

Media also contains public feeds, moderation, creator gigs, sponsorships, tips and boosts with distinct rules.

### Implementation work

Keep public discovery and private creator tools separate within existing Media shell. Require correct buyer and creator authority, scope any spend to the actual wallet, and preserve settlement and dispute rails.

### Acceptance

Exercise creator posting and buyer actions in isolated Credit runtime. Attempt with a pending or revoked creator and wrong wallet. Confirm report and block data remain private and marketplace public pages continue to work.

### Source declarations to trace

- [`POST /creator/gigs`](../server/routes/media.js#L71) · guards `requireAuth` · handler `creatorCtrl.createGig`
- [`POST /creator-work-reviews/:reviewId/resolve`](../server/routes/mediaAdmin.js#L14) · guards `requirePermission` · handler `workCtrl.resolveWorkReview`

**Repository sources**  [media.js](../server/routes/media.js) · [mediaAdmin.js](../server/routes/mediaAdmin.js) · [mediaCreatorController.js](../server/controllers/mediaCreatorController.js) · [MediaCreatorPage.jsx](../client/src/pages/media/MediaCreatorPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-044"></a>

**Marketplace and customer work packages** · Page 150 of 393 · WP-044

## Learn, personal interests, and resources

### Current boundary

Learn and personal pages can use account mode to tailor recommendations and entry routes. Skill and learning history belongs to the person.

### Implementation work

Recommend content using the immediate task or declared goal and available access. Keep learn history, goals, certificates or skill records on the person. Approval to list professional services follows its owning policy.

### Acceptance

Start learning as customer, gain helper approval and revisit the same lesson or skill. Check history persists and recommendations update without duplicating account records or giving a professional listing automatically.

**Repository sources**  [learn.js](../server/routes/learn.js) · [userSkills.js](../server/routes/userSkills.js) · [LearnModePage.jsx](../client/src/pages/LearnModePage.jsx) · [LifeDashboard.jsx](../client/src/pages/LifeDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-045"></a>

**Marketplace and customer work packages** · Page 151 of 393 · WP-045

## Personal finances and planned needs

### Current boundary

Personal Life manages goals, recurrence, household and vehicle data and can create marketplace context.

### Implementation work

Use appropriate personal ownership and consent when features cross from Life into marketplace workflows. Do not expose personal goals or home details to employers or business members through one account’s combined projection.

### Acceptance

Have both a personal home task and business task with similar labels. Request a helper for the personal task. Confirm only intended disclosure occurs and a staff workspace cannot query private Life records.

### Source declarations to trace

- [`POST /`](../server/routes/plannedNeeds.js#L22) · guards `authenticate` · handler `ctrl.createPlannedNeed`

**Repository sources**  [lifeDashboard.js](../server/routes/lifeDashboard.js) · [plannedNeeds.js](../server/routes/plannedNeeds.js) · [house.js](../server/routes/house.js) · [vehicles.js](../server/routes/vehicles.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-046"></a>

**Business and restaurant work packages** · Page 152 of 393 · WP-046

## Business setup and existing ownership

### Current boundary

Business creation connects the owner to a canonical business. Existing approval, visibility, or primary-selection signals carry different meanings.

### Implementation work

Support private preparation while approval is pending. Authorize final creation or activation using the reviewed proposal or exact existing business scope. Expose side effects deliberately and keep stable IDs through claims.

### Acceptance

Simultaneous owner request approvals or duplicate wizard submits must not create two primary businesses. A user who names another business cannot claim it by exact name or copied identifier.

### Source declarations to trace

- [`POST /vortex/redeem`](../server/routes/businesses.js#L79) · guards `authenticate, rejectImpersonated, requireVortexEnabled, vortexRedeemLimiter` · handler `redeemToken`
- [`POST /invitations/:id/accept`](../server/routes/businesses.js#L84) · guards `authenticate` · handler `acceptInvitation`
- [`POST /invitations/:id/decline`](../server/routes/businesses.js#L85) · guards `authenticate` · handler `declineInvitation`

**Repository sources**  [businesses.js](../server/routes/businesses.js) · [businessController.js](../server/controllers/businessController.js) · [BusinessCreationWizard.jsx](../client/src/components/businessHub/BusinessCreationWizard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-047"></a>

**Business and restaurant work packages** · Page 153 of 393 · WP-047

## Workspace context and multiple organizations

### Current boundary

The client remembers a prior business workspace. The server validates supported business and restaurant selections.

### Implementation work

Keep a recent context preference as navigation. Pass the exact entity in each sensitive request and resolve memberships per action. Show permission status in the current organization’s UI rather than replacing the global shell.

### Acceptance

Open two named workspaces in two tabs with different grants. Approve staffing in one. Preference changes cannot alter the other tab’s intended recipient or permit a forbidden write.

### Source declarations to trace

- [`POST /workspace-context`](../server/routes/meWorkspace.js#L18) · guards `authenticate` · handler `team.setWorkspaceContext`
- [`GET /businesses`](../server/routes/meWorkspace.js#L17) · guards `authenticate` · handler `team.getMyBusinesses`

**Repository sources**  [meWorkspace.js](../server/routes/meWorkspace.js) · [businessTeamController.js](../server/controllers/businessTeamController.js#L498) · [BusinessSwitcher.jsx](../client/src/components/BusinessSwitcher.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-048"></a>

**Business and restaurant work packages** · Page 154 of 393 · WP-048

## Permission overrides and delegated administration

### Current boundary

Business permissions derive from role defaults, memberships, and overrides, with permission-aware team routes.

### Implementation work

Use a faithful projection of the existing analyzer. Grant only what the acting approver can administer. Audit change of override and resulting direct writes. Recheck grantor standing and keep selective revocations scope-bound.

### Acceptance

Grant calendar management in one business then add a deny override. The next direct mutation uses the new effective result. Test former manager, expired or wrong workspace grant, and cache freshness.

### Source declarations to trace

- [`PUT /:businessId/memberships/:membershipId/overrides`](../server/routes/businessTeam.js#L55) · guards `authenticate, requireBusinessAccess` · handler `team.setMembershipOverrides`
- [`PATCH /:businessId/memberships/:membershipId/role`](../server/routes/businessTeam.js#L48) · guards `authenticate, requireBusinessAccess` · handler `team.changeMembershipRole`
- [`POST /:businessId/memberships/:membershipId/approve`](../server/routes/businessTeam.js#L62) · guards `authenticate, rejectImpersonated, requireVortexEnabled, requireBusinessAccess` · handler `access.approveMembership`

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [permissionsService.js](../server/services/permissionsService.js) · [requirePermission.js](../server/middleware/requirePermission.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-049"></a>

**Business and restaurant work packages** · Page 155 of 393 · WP-049

## Staff scheduling and dispatch

### Current boundary

Staff and workspace operations present scope-dependent calendar, scheduling, and job data.

### Implementation work

Add delegated scheduling controls to the existing business calendar. Use both exact site and assignee rules. Distinguish employee self-actions from management of a roster. Preserve existing bookings and calendar history.

### Acceptance

Staff at two businesses can see their own assignments and manipulate only the schedule they manage. Submitting a correct tenant ID with a foreign booking or shift fails without revealing its details.

**Repository sources**  [businessStaff.js](../server/routes/businessStaff.js) · [businessOperations.js](../server/routes/businessOperations.js) · [calendar.js](../server/routes/calendar.js) · [BusinessRoleDashboardBase.jsx](../client/src/pages/BusinessRoleDashboardBase.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-050"></a>

**Business and restaurant work packages** · Page 156 of 393 · WP-050

## Business communications and representative scope

### Current boundary

Business communications include workspace inbox and representative access, message routing, templates, and sender selection.

### Implementation work

Present grant-backed inboxes and template actions in relevant work. Keep channel, sender, conversation, and recipient scopes separate. Permission to reply does not by itself give broad search, export, or team reconfiguration.

### Acceptance

Use a representative with only assigned conversations. Confirm queue and search visibility agree with send, template management, attachment and badge endpoints. After revoke, existing unrelated personal messages remain accessible.

**Repository sources**  [businessOperations.js](../server/routes/businessOperations.js) · [businessMsgTemplates.js](../server/routes/businessMsgTemplates.js) · [messages.js](../server/routes/messages.js) · [messageController.js](../server/controllers/messageController.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-051"></a>

**Business and restaurant work packages** · Page 157 of 393 · WP-051

## Business client records and customer insight

### Current boundary

Business CRM and analytics show customer information with entity-specific eligibility and privacy rules.

### Implementation work

Build capability projections with minimal derived card metadata. Keep CRM, drill-down/export and contact searches scoped, and retain existing consent or purpose restrictions. Audit especially any connection between platform and employer insight.

### Acceptance

A customer and employee are the same account. Both roles can use their own scope while employer view cannot expose personal wallet, unrelated histories or another business’s customer record.

### Source declarations to trace

- [`POST /:businessId/appointments/:appointmentId/record-payment`](../server/routes/businessOperations.js#L64) · guards `requireAuth, requireBusinessAccess, requireBusinessCalendarAccess` · handler `businessAppointmentsController.recordAppointmentPayment`

**Repository sources**  [businessCustomer360.js](../server/routes/businessCustomer360.js) · [businessOperations.js](../server/routes/businessOperations.js) · [customer360Workspace.js](../server/services/customer360Workspace.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-052"></a>

**Business and restaurant work packages** · Page 158 of 393 · WP-052

## Business leads, campaigns and follow-ups

### Current boundary

Lead stages and marketing permissions encompass reading entity-owned prospects and sending or automating outreach.

### Implementation work

Keep opening and launching communications subject to consent and current business authority. Distinguish capabilities to manage lead state, view contacts, or send campaigns. Preserve opt-out and worker safeguards.

### Acceptance

Grant lead access without granting outreach. Attempt a browser action and direct campaign launch. Revoke authorizing role before queued activity and verify the approved domain behavior at execution.

### Source declarations to trace

- [`POST /:businessId/leads`](../server/routes/businessLeads.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createLead`
- [`PATCH /:businessId/lead-pipeline/:id`](../server/routes/businessLeadPipeline.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateLead`
- [`POST /:businessId/request`](../server/routes/leads.js#L26) · guards `authenticate, scopeExempt` · handler `leadController.createLead`
- [`GET /:businessId/campaign-performance`](../server/routes/businessMarketing.js#L24) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.getCampaignPerformance`

**Repository sources**  [businessLeads.js](../server/routes/businessLeads.js) · [businessLeadPipeline.js](../server/routes/businessLeadPipeline.js) · [leads.js](../server/routes/leads.js) · [businessMarketing.js](../server/routes/businessMarketing.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-053"></a>

**Business and restaurant work packages** · Page 159 of 393 · WP-053

## Catalog, pricing rules and marketplace publishing

### Current boundary

Catalog and pricing actions include public browsing, internal edits, publishing and operating prices.

### Implementation work

Preserve the public read model and signed-in approval requirements. Derive scope from the product’s owning entity. Keep price and inventory update permissions explicit and approval actions auditable.

### Acceptance

User with approval to operate business A attempts to edit a product in B. A legitimate price edit retains currency rules and appears only in the intended catalog. Public reads preserve prior filters.

### Source declarations to trace

- [`POST /:businessId/product-pricing/rules`](../server/routes/businessProductPricing.js#L16) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createPricingRule`
- [`POST /:businessId/pricing/service/:serviceId/rules`](../server/routes/pricingRulesAdmin.js#L13) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createServiceRule`
- [`POST /:productId/reviews`](../server/routes/marketplaceProducts.js#L47) · guards `authenticate` · handler `marketplaceProductsController.submitProductReview`

**Repository sources**  [businessProducts.js](../server/routes/businessProducts.js) · [businessProductPricing.js](../server/routes/businessProductPricing.js) · [pricingRulesAdmin.js](../server/routes/pricingRulesAdmin.js) · [marketplaceProducts.js](../server/routes/marketplaceProducts.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-054"></a>

**Business and restaurant work packages** · Page 160 of 393 · WP-054

## Invoices, quotes and recurring billing

### Current boundary

Invoices, financial operations, and recurring flows are sensitive and can cross individual and organization-based representatives.

### Implementation work

Keep invoice issuer, payer, affected entity, currency, and delegated finance permission distinct. Stop new schedules if domain policy requires it after revocation. Preserve authorized execution and reconciliation of committed billing.

### Acceptance

Create personal and business invoices from the same identity. Revoke business finance rights, then verify direct edits, exports, payment and scheduled operations respect their own rules without duplicating a previously committed invoice.

### Source declarations to trace

- [`POST /:businessId/quotes`](../server/routes/businessFinance.js#L18) · guards `requireAuth, requireBusinessAccess` · handler `quotes.createQuote`
- [`POST /:businessId/recurring-billing/:id/generate-invoice`](../server/routes/businessRecurringBilling.js#L37) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.generateInvoice`
- [`POST /:id/pay-with-credit`](../server/routes/invoices.js#L59) · guards `strictLimiter, authenticate, rejectImpersonated` · handler `businessInvoiceCreditController.payInvoiceWithOxsteedCredit`

**Repository sources**  [businessFinance.js](../server/routes/businessFinance.js) · [businessRecurringBilling.js](../server/routes/businessRecurringBilling.js) · [invoices.js](../server/routes/invoices.js) · [helperQuotes.js](../server/routes/helperQuotes.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-055"></a>

**Business and restaurant work packages** · Page 161 of 393 · WP-055

## Business packages, services and waitlists

### Current boundary

Packages and add-on scheduling or waitlist tools use organization scope and can contain linked bookings or customers.

### Implementation work

Only show package and queue controls when approved for the current entity and product. Preserve linked customer visibility, resource and price state. Validate transitions by individual permission, membership, and record ownership.

### Acceptance

A delegated scheduler can modify one authorized booking but cannot change pricing or see another business’s queue. A package promotion does not assign team permissions or expose unrelated booking history.

### Source declarations to trace

- [`POST /:businessId/packages`](../server/routes/businessPackages.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createPackage`
- [`POST /:businessId/waitlist`](../server/routes/businessWaitlist.js#L9) · guards `requireAuth, scopeExempt` · handler `ctrl.addToWaitlist`
- [`POST /:businessId/services/:serviceId/staff`](../server/routes/businessOperations.js#L42) · guards `requireAuth, requireBusinessAccess` · handler `businessServicesController.assignStaffToService`

**Repository sources**  [businessPackages.js](../server/routes/businessPackages.js) · [businessWaitlist.js](../server/routes/businessWaitlist.js) · [businessOperations.js](../server/routes/businessOperations.js) · [businessHubRoleMenu.js](../client/src/utils/businessHubRoleMenu.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-056"></a>

**Business and restaurant work packages** · Page 162 of 393 · WP-056

## Integrations and brand linkage

### Current boundary

Business integrations, branding and profile assets involve scoped identities and can be attached to multiple locations.

### Implementation work

Scope integration setup, credential references and callback binding to the intended entity. Keep existing linkage ownership and administrative permissions. Distinguish public brand assets from sensitive integration settings and avoid exposing secrets in UI projections.

### Acceptance

Two owners configure separate integrations. An intercepted or stale callback cannot attach the scanner or provider to the other business. Revoke setup authority while preserving existing domain-approved worker connections.

### Source declarations to trace

- [`POST /:businessId/integrations/api-key/regenerate`](../server/routes/businessIntegrations.js#L43) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.regenerateApiKey`
- [`DELETE /:brandId/restaurants/:restaurantId`](../server/routes/restaurantBrands.js#L61) · guards `scopeExempt` · handler `brand.detachRestaurant`

**Repository sources**  [businessIntegrations.js](../server/routes/businessIntegrations.js) · [businessProfileImages.js](../server/routes/businessProfileImages.js) · [restaurantBrands.js](../server/routes/restaurantBrands.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-057"></a>

**Business and restaurant work packages** · Page 163 of 393 · WP-057

## Property and maintenance workflows

### Current boundary

Property and maintenance work has owner, tenant, facility and service provider audiences.

### Implementation work

Identify the property and exact work order from authoritative records. Keep scoped ability to open, schedule and assign jobs distinct from a tenant’s ability to submit and follow their own request.

### Acceptance

Let a tenant follow one maintenance issue after becoming a helper. Ensure tenant sees no other unit records. A manager at site A cannot create an assignment attached to site B by combining IDs.

**Repository sources**  [propertyOperations.js](../server/routes/propertyOperations.js) · [maintenanceRequests.js](../server/routes/maintenanceRequests.js) · [businessOperations.js](../server/routes/businessOperations.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-058"></a>

**Business and restaurant work packages** · Page 164 of 393 · WP-058

## Trades, creative, professional and appointment templates

### Current boundary

Specialized business templates have workflows such as site visits, appointments, projects, and professional intake with role-specific controls.

### Implementation work

Use template selection as a product feature and resolve authority against the owning business and specific workflow records. Preserve assets, schedules and forms keyed to that entity. Audit existing UI checks that derive from mode or template alone.

### Acceptance

Run one representative multi-step flow per enabled template family with a customer, owner and restricted employee. Swap a child record between organizations and compare direct write denial with the UI.

### Source declarations to trace

- [`POST /activate`](../server/routes/templates.js#L21) · guards `authenticate` · handler `ctrl.activateTemplate`

**Repository sources**  [tradesOperations.js](../server/routes/tradesOperations.js) · [beautyOperations.js](../server/routes/beautyOperations.js) · [creativeOperations.js](../server/routes/creativeOperations.js) · [professionalOperations.js](../server/routes/professionalOperations.js) · [templates.js](../server/routes/templates.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-059"></a>

**Business and restaurant work packages** · Page 165 of 393 · WP-059

## Continuity and operating health

### Current boundary

Continuity pages expose business risk, reminders, operational tasks, and status across scopes.

### Implementation work

Keep alerts scoped to the exact entity and action. Add capable task links inside the existing workspace dashboard. A new management permission must not affect which employee health or operational signals are globally visible.

### Acceptance

Create alerts in two entities and approve a manager for one. Check notification destinations, counts, detail access, acknowledgement and post-revocation updates under the original session.

### Source declarations to trace

- [`POST /:businessId/health-alerts/generate`](../server/routes/businessHealthAlerts.js#L8) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.generateAlerts`

**Repository sources**  [continuityOperations.js](../server/routes/continuityOperations.js) · [businessHealthAlerts.js](../server/routes/businessHealthAlerts.js) · [businessOperations.js](../server/routes/businessOperations.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-060"></a>

**Business and restaurant work packages** · Page 166 of 393 · WP-060

## Restaurant application and activation

### Current boundary

Restaurant onboarding and merchant control use business and restaurant identifiers and activation state.

### Implementation work

Store a scoped owner application and protect the private setup record. Validate exact authorized representative, market and linked business at approval. Keep opening of public ordering and other domain activations on their owning state machines.

### Acceptance

Attempt to activate a conflicting storefront through two pending applications and direct old endpoints. Confirm a decided grant applies to one canonical store and does not enable unrelated restaurant or wallet controls.

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [food.js](../server/routes/food.js) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx) · [scopeModel.js](../server/services/scopeModel.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-061"></a>

**Business and restaurant work packages** · Page 167 of 393 · WP-061

## Restaurant membership and assigned store scope

### Current boundary

Restaurant access derives from ownership and membership, and additional store and location assignment affects operational reads and writes.

### Implementation work

Expose route-scoped business, restaurant, location and permission facts. Do not make previous restaurant selection an implicit access control input. Convert controls such as scheduling and menu edits to respect actual location assignments.

### Acceptance

Employee works at A and B. Promote their schedule management at A only. Verify status, cross-location queries, denied foreign shifts, and applicable current assignment events.

### Source declarations to trace

- [`PATCH /:restaurantId/locations/:locationId/menu-items/:itemId`](../server/routes/restaurants.js#L177) · guards `requireRestaurantAccess` · handler `storeMenu.update`
- [`PUT /:restaurantId/hq/labor-policies/:locationId`](../server/routes/restaurants.js#L240) · guards `requireRestaurantAccess` · handler `hq.updateStoreLaborPolicy`
- [`PUT /:restaurantId/location-access/:membershipId`](../server/routes/restaurants.js#L261) · guards `requireRestaurantAccess` · handler `locationAccess.replace`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [businessTeamController.js](../server/controllers/businessTeamController.js) · [scopeModel.js](../server/services/scopeModel.js) · [restaurantScopeModel.db.test.js](../server/__tests__/restaurantScopeModel.db.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-062"></a>

**Business and restaurant work packages** · Page 168 of 393 · WP-062

## Dining and public menu

### Current boundary

Menus, hours and discovery are public-facing. Checkout has signed-in and guest-specific rules and places orders subject to merchant state.

### Implementation work

Keep guest ordering, tracking, hours, availability, and published menus governed by product state. Show editing affordances only for the correct restaurant context. Use entity capability for mutation without changing cached public responses.

### Acceptance

Compare guest, member, and staff views of a closed and an open restaurant. Check guest guest-order link, own order recovery, logout behavior and denied cross-store reads.

### Source declarations to trace

- [`POST /restaurants/:restaurantId/categories`](../server/routes/food.js#L165) · guards `authenticate, requireRestaurantAccess` · handler `ctrl.createMenuCategory`
- [`PATCH /:restaurantId/locations/:locationId/menu-items/:itemId`](../server/routes/restaurants.js#L177) · guards `requireRestaurantAccess` · handler `storeMenu.update`

**Repository sources**  [food.js](../server/routes/food.js) · [restaurants.js](../server/routes/restaurants.js) · [App.jsx](../client/src/App.jsx#L741)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-063"></a>

**Business and restaurant work packages** · Page 169 of 393 · WP-063

## Restaurant order management and service cycle

### Current boundary

Merchant order lifecycle spans ordering, statuses, menu routing and operational displays.

### Implementation work

Authorize every merchant action at the exact store, by current staff scope and service state. Preserve ordered items, till, kitchen state, fulfillment and status history when grants or membership change.

### Acceptance

Use an order with fulfilled and incomplete items. Remove actor management scope during retry. Foreign store updates fail and the service-cycle counters reflect only committed transitions.

### Source declarations to trace

- [`POST /:restaurantId/devices/:deviceId/screen-orders`](../server/routes/restaurants.js#L69) · guards `strictLimiter, scopeExempt` · handler `screens.createOrder`
- [`POST /orders/:orderId/cancel`](../server/routes/food.js#L51) · guards `optionalAuth, generalLimiter` · handler `ctrl.cancelMyFoodOrder`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [food.js](../server/routes/food.js) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-064"></a>

**Business and restaurant work packages** · Page 170 of 393 · WP-064

## Restaurant menu and catalog management

### Current boundary

Menu item edits, category pricing and brand rules affect a published catalog and can be shared across locations.

### Implementation work

Use explicit store and brand scopes. Preserve existing draft publication, approved menu policies and option constraints. Distinguish media publish and menu pricing permissions even when both appear in the same owner view.

### Acceptance

A manager of store A edits a menu item. Attempt to send an item or brand option created for store B. Guest reads keep published records consistent and show the intended update only.

### Source declarations to trace

- [`PATCH /:restaurantId/locations/:locationId/menu-items/:itemId`](../server/routes/restaurants.js#L177) · guards `requireRestaurantAccess` · handler `storeMenu.update`
- [`POST /:brandId/menu/publish`](../server/routes/restaurantBrands.js#L21) · handler `brand.publishMenu`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [restaurantBrands.js](../server/routes/restaurantBrands.js) · [RestaurantMenuManager.jsx](../client/src/pages/food/RestaurantMenuManager.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-065"></a>

**Business and restaurant work packages** · Page 171 of 393 · WP-065

## Restaurant host stand and reservations

### Current boundary

Host tools manage tables, reservations and walk-ins using restaurant and location context.

### Implementation work

Keep reservations accessible to valid personal parties and assigned restaurant operators. Confirm staff rights to seat, reassign and cancel depend on record ownership, store, location, service cycle and existing policy.

### Acceptance

Seat a customer on a valid table and try using a table from the other location. A promotion scoped to staffing alone must not imply host permissions.

### Source declarations to trace

- [`POST /:restaurantId/reservations`](../server/routes/restaurants.js#L273) · guards `requireRestaurantAccess` · handler `hosting.createReservation`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [bookings.js](../server/routes/bookings.js) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx#L2109)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-066"></a>

**Business and restaurant work packages** · Page 172 of 393 · WP-066

## Cashier POS and drawer operations

### Current boundary

Cashier operations include store scope and transaction or drawer-specific requirements.

### Implementation work

Keep cashier identity, POS session, till, ticket and store context distinct from a broader employee role. A mode grant never bypasses individualized drawer controls or payment and refund boundary. Preserve consent and existing provider relationships.

### Acceptance

Give employee POS permission at one store and no drawer at another. Test discounts, till write, payment attempt and reconciliation with mismatched cashier, device and ticket IDs on an isolated environment.

### Source declarations to trace

- [`POST /:restaurantId/inventory/areas`](../server/routes/restaurants.js#L488) · guards `requireRestaurantAccess` · handler `inventoryOperations.createArea`
- [`POST /:restaurantId/inventory/suppliers`](../server/routes/restaurants.js#L490) · guards `requireRestaurantAccess` · handler `inventoryOperations.createSupplier`
- [`PUT /:restaurantId/inventory/supplier-catalog`](../server/routes/restaurants.js#L492) · guards `requireRestaurantAccess` · handler `inventoryOperations.upsertSupplierCatalog`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [RestaurantPOSPage.jsx](../client/src/pages/food/RestaurantPOSPage.jsx) · [PosStaffSession.jsx](../client/src/pages/food/PosStaffSession.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-067"></a>

**Business and restaurant work packages** · Page 173 of 393 · WP-067

## Kitchen and queue displays

### Current boundary

Kitchen and queue surfaces include human and paired-device paths serving a named restaurant.

### Implementation work

Use existing device-scoped credentials and authorized staff sessions with distinct scopes. Preserve pairing and turn updates scoped to one store. Review hidden and external feeds separately, including no unauthorized personal details on public queue screens.

### Acceptance

Pair a kitchen display and revoke a manager’s human grant. The device remains limited to its own configured store. Attempt a write from kiosk or owner identity against an unauthorized kitchen ticket.

### Source declarations to trace

- [`POST /pairing-code`](../server/routes/restaurantDisplays.js#L22) · guards `strictLimiter` · handler `displays.issuePairingCode`

**Repository sources**  [restaurantDisplays.js](../server/routes/restaurantDisplays.js) · [restaurantDevices.js](../server/routes/restaurantDevices.js) · [FoodKitchenPage.jsx](../client/src/pages/food/FoodKitchenPage.jsx) · [App.jsx](../client/src/App.jsx#L751)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-068"></a>

**Business and restaurant work packages** · Page 174 of 393 · WP-068

## Inventory and purchase operations

### Current boundary

Inventory tracks ingredients, supplies, adjustments and purchase operations with operational and financial implications.

### Implementation work

Grant inventory controls for the precise scope and use current property or store assignment. Preserve adjustment history and require permissions for supplier or transfer operations independently.

### Acceptance

User promoted to inventory at A performs a stock count and attempts to adjust B using forged location. Cross-store transfer retains its authorization and transactional state, including read-only history after revoke.

### Source declarations to trace

- [`POST /:restaurantId/inventory/purchase-requests`](../server/routes/restaurants.js#L481) · guards `requireRestaurantAccess` · handler `inventory.createPurchaseRequest`
- [`PATCH /:restaurantId/inventory/purchase-requests/:requestId`](../server/routes/restaurants.js#L483) · guards `requireRestaurantAccess` · handler `inventory.updatePurchaseRequest`
- [`POST /:restaurantId/inventory/areas`](../server/routes/restaurants.js#L488) · guards `requireRestaurantAccess` · handler `inventoryOperations.createArea`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [RestaurantInventoryPage.jsx](../client/src/pages/food/RestaurantInventoryPage.jsx) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx#L2112)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-069"></a>

**Business and restaurant work packages** · Page 175 of 393 · WP-069

## Crew shifts, time clock, and reports

### Current boundary

The employee portal exposes shifts, availability, tips, pay and swaps. Management routes perform team scheduling and payroll-related work.

### Implementation work

Keep self-service time actions and team management distinct by permission. Verify affected staff membership and assigned site even for a canonical route. Hold sensitive workforce data and reports under their own read and export authority.

### Acceptance

Promote an employee while their own shift is open. The same schedule gains permitted controls without losing the current shift. Try updating a worker from another location and exporting payroll without the finance grant.

### Source declarations to trace

- [`POST /:restaurantId/crew/shifts`](../server/routes/restaurants.js#L513) · guards `requireRestaurantAccess` · handler `appFlow.createCrewShift`
- [`PATCH /:restaurantId/crew/shifts/:shiftId`](../server/routes/restaurants.js#L514) · guards `requireRestaurantAccess` · handler `appFlow.updateCrewShift`
- [`GET /:restaurantId/crew/shifts`](../server/routes/restaurants.js#L512) · guards `requireRestaurantAccess` · handler `appFlow.listCrewShifts`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [RestaurantEmployeePortalPage.jsx](../client/src/pages/food/RestaurantEmployeePortalPage.jsx) · [RestaurantTimeClockCard.jsx](../client/src/pages/food/RestaurantTimeClockCard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-070"></a>

**Business and restaurant work packages** · Page 176 of 393 · WP-070

## Restaurant runner and delivery

### Current boundary

Runner and local delivery tasks have assigned operator, store and shipment rules plus proofs and status updates.

### Implementation work

Resolve claim, progress and proof against the actual work assignment and location. Keep permitted access to committed deliveries and historical receipt data. Limit private addresses and proof media to authorized parties.

### Acceptance

Assign and claim a delivery at restaurant A, then revoke future runner availability. Direct access to B’s tasks is denied. Verify explicitly allowed reads and evidence submission for the existing delivery.

### Source declarations to trace

- [`GET /workspaces`](../server/routes/runner.js#L10) · handler `runnerWorkspace.listWorkspaces`
- [`POST /:restaurantId/gift-cards/:cardId/delivery-resolution`](../server/routes/restaurants.js#L186) · guards `requireRestaurantAccess` · handler `giftCards.resolveDelivery`

**Repository sources**  [runner.js](../server/routes/runner.js) · [restaurants.js](../server/routes/restaurants.js) · [localDelivery.js](../server/routes/localDelivery.js) · [RestaurantRunnerPage.jsx](../client/src/pages/food/RestaurantRunnerPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-071"></a>

**Business and restaurant work packages** · Page 177 of 393 · WP-071

## Training, SOPs and operational quality

### Current boundary

Restaurant operations include authored checklists, SOPs, training assignments, temperature logs, audits and corrective actions.

### Implementation work

Expose tools according to current scoped grants. Preserve employee task completion and authored business records on the canonical location. Keep authoring and management permissions separate from completing an assigned record.

### Acceptance

Employee completes an existing assignment, becomes a manager at one site, and creates another assignment within scope. The previous completion, authored version and audit history remain attributable.

### Source declarations to trace

- [`POST /:restaurantId/sops`](../server/routes/restaurants.js#L310) · guards `requireRestaurantAccess` · handler `ops.createSop`
- [`PATCH /:restaurantId/sops/:sopId`](../server/routes/restaurants.js#L311) · guards `requireRestaurantAccess` · handler `ops.updateSop`
- [`DELETE /:restaurantId/sops/:sopId`](../server/routes/restaurants.js#L312) · guards `requireRestaurantAccess` · handler `ops.deleteSop`

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx#L2110) · [RestaurantEmployeePortalPage.jsx](../client/src/pages/food/RestaurantEmployeePortalPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-072"></a>

**Business and restaurant work packages** · Page 178 of 393 · WP-072

## Restaurant offline POS and store hub

### Current boundary

Offline POS and store hub flows bind devices or leases to protected restaurant, app, and transaction state.

### Implementation work

Keep lease scope, recovery and outstanding tenders tied to the assigned account and device. Ask the native integration owner to verify actual builds and access rules. Manager promotions should only expose eligible operations when the user is online and current authorization is known.

### Acceptance

Test action queue replay after store membership revoke and correct recovery for already-forwarded payment. Use test-mode provider and hardware procedures, and verify no new unrelated operations or double capture.

### Source declarations to trace

- [`POST /:restaurantId/hubs/:hubId/offline-sales/:saleId/resolve`](../server/routes/storeHubs.js#L20) · guards `authenticate, rejectImpersonated, requireRestaurantAccess, strictLimiter` · handler `hub.resolveOfflineSale`
- [`POST /:restaurantId/devices/:deviceId/offline-tickets`](../server/routes/restaurants.js#L74) · guards `strictLimiter, scopeExempt` · handler `screens.importTicket`

**Repository sources**  [storeHubs.js](../server/routes/storeHubs.js) · [restaurants.js](../server/routes/restaurants.js) · [README.md](../native/RestaurantTerminalOffline/README.md) · [usePosSync.js](../client/src/pages/food/usePosSync.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-073"></a>

**Business and restaurant work packages** · Page 179 of 393 · WP-073

## Restaurant and multi-location statements

### Current boundary

Restaurant payout, Credit and settlement statements are tied to exact business accounts and may span store scopes.

### Implementation work

Use account ownership and scoped financial permissions, keeping operational membership independent. Preserve masked account details, authorized comparisons, and historical download protections. Keep business currency semantics and payout ledger unchanged.

### Acceptance

Approve a restaurant manager for staffing and deny finance reads and exports. Then grant one authorized account read and test wrong-store status and blocked access via a prior signed link.

### Source declarations to trace

- [`GET /statements/center`](../server/routes/statementCenter.js#L18) · guards `authenticate`

**Repository sources**  [restaurantPayouts.js](../server/routes/restaurantPayouts.js) · [statementCenter.js](../server/routes/statementCenter.js) · [settlementStatementArchive.js](../server/routes/settlementStatementArchive.js) · [RestaurantFinanceWorkspace.jsx](../client/src/pages/food/RestaurantFinanceWorkspace.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-074"></a>

**Specialist and platform work packages** · Page 180 of 393 · WP-074

## Consultant profile and referral pipeline

### Current boundary

The consultant portal exposes a self profile and assigned local referrals. Transitions to paying states invoke platform approval.

### Implementation work

Collect specialties, service area, languages, experience and necessary evidence for the policy. Grant assigned referral actions using both capability and referral relationship. Keep public/requester material separate from consultant notes and compensation.

### Acceptance

Attempt to access a different consultant’s assigned request and promote a referral while unapproved. Approve the applicant, then verify only assigned records and currently allowed transitions appear.

### Source declarations to trace

- [`PUT /profile`](../server/routes/consultantNetwork.js#L19) · guards `authenticate` · handler `controller.upsertMyConsultantProfile`
- [`GET /profile`](../server/routes/consultantNetwork.js#L18) · guards `authenticate` · handler `controller.getMyConsultantProfile`
- [`PATCH /referrals/:requestId`](../server/routes/consultantNetwork.js#L21) · guards `authenticate, gatePayingReferralTransition` · handler `controller.updateMyReferral`

**Repository sources**  [consultantNetwork.js](../server/routes/consultantNetwork.js) · [consultantNetworkController.js](../server/controllers/consultantNetworkController.js) · [ConsultantContractorDashboard.jsx](../client/src/pages/ConsultantContractorDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-075"></a>

**Specialist and platform work packages** · Page 181 of 393 · WP-075

## Consultant booking, scheduling and billing

### Current boundary

Consulting appointments, site visits, payment, feedback and schedules use participant and provider data.

### Implementation work

Preserve customer booking and existing commitments in the same shell. Scope consultant availability, acceptance of paid sessions, and payment views by the owning record. Reuse applicable current approval gates.

### Acceptance

Sign in as a consultant with an expired paid-action approval. Reject a newly paying transition where required. Verify a legitimate customer appointment and already accepted provider work remain correctly represented.

### Source declarations to trace

- [`POST /consultants/:consultantId/availability`](../server/routes/consultantScheduling.js#L12) · guards `authenticate` · handler `consultantSchedulingController.setAvailability`
- [`GET /consultant/:consultantId`](../server/routes/consultingFeedback.js#L15) · guards `generalLimiter, authenticate, requireAdmin, requirePermission` · handler `feedbackController.getConsultantFeedback`

**Repository sources**  [consultantScheduling.js](../server/routes/consultantScheduling.js) · [consultingPayment.js](../server/routes/consultingPayment.js) · [consultingFeedback.js](../server/routes/consultingFeedback.js) · [siteVisits.js](../server/routes/siteVisits.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-076"></a>

**Specialist and platform work packages** · Page 182 of 393 · WP-076

## Business launch journey

### Current boundary

Business-launch intake, action items and advisory support have their own applicant and adviser context.

### Implementation work

Allow an applicant to start a draft or request help from the same account. Keep a successful advising milestone separate from authority to represent an existing business. Link relevant advisory and approval records while retaining audiences.

### Acceptance

Submit a business launch intake and add a consultant while the Owner application is pending. The consultation persists but grants no business ownership. Test scoped visibility of attachments and progress.

### Source declarations to trace

- [`POST /submit`](../server/routes/businessLaunch.js#L27) · guards `generalLimiter` · handler `submitBusinessLaunchRequest`

**Repository sources**  [businessLaunch.js](../server/routes/businessLaunch.js) · [consulting.js](../server/routes/consulting.js) · [consultingActionItems.js](../server/routes/consultingActionItems.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-077"></a>

**Specialist and platform work packages** · Page 183 of 393 · WP-077

## Investor reporting and audience access

### Current boundary

Investor analytics has role checks, and the route passes an array to a variadic role factory in this snapshot. Treat current authorization as a contract to verify with a mounted endpoint test.

### Implementation work

Grant reporting by explicit audience and data scope. Carry applicable privacy and read permissions through KPIs, charts, evidence, export and caches. Replace brittle role gates with tested intended access. Confirm reviewer scope and expiry policy.

### Acceptance

Exercise mounted routes for authorized investor, expired investor, customer, and staff. Check both KPI and drill-down responses and whether selected data is allowed. Ensure approval grants no funds movement, owner, or staff rights.

### Source declarations to trace

- [`GET /kpis`](../server/routes/investor.js#L21) · guards `authenticate, allowInvestor` · handler `getKpis`
- [`GET /revenue-chart`](../server/routes/investor.js#L22) · guards `authenticate, allowInvestor` · handler `getRevenueChart`
- [`GET /franchise`](../server/routes/investor.js#L23) · guards `authenticate, allowInvestor` · handler `getFranchisePipeline`

**Repository sources**  [investor.js](../server/routes/investor.js) · [investorController.js](../server/controllers/investorController.js) · [InvestorDashboardPage.jsx](../client/src/pages/InvestorDashboardPage.jsx) · [auth.js](../server/middleware/auth.js#L410)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-078"></a>

**Specialist and platform work packages** · Page 184 of 393 · WP-078

## Franchise application, review and territory

### Current boundary

Franchise application is tracked separately from territory operations and has a staff review pipeline.

### Implementation work

Keep progress, evidence and existing agreements on the application. Approve or activate territory privileges only when the franchise domain has assigned the exact active scope. Retain distinct agreement, fee, compliance and launch rules.

### Acceptance

A signed-in applicant reads their own case before approval, then one assigned territory after activation. Decline or revoke an assignment and verify a foreign territory roster and payouts are denied.

### Source declarations to trace

- [`POST /applications`](../server/routes/franchise.js#L32) · guards `generalLimiter, requireFranchiseEnabled` · handler `createFranchiseApplication`
- [`PATCH /applications/:id`](../server/routes/franchise.js#L39) · guards `authenticate, requireAdmin, requirePermission` · handler `updateFranchiseApplication`
- [`POST /applications/:id/notes`](../server/routes/franchise.js#L40) · guards `authenticate, requireAdmin, requirePermission` · handler `addFranchiseNote`

**Repository sources**  [franchise.js](../server/routes/franchise.js) · [FranchiseApplicantDashboard.jsx](../client/src/pages/FranchiseApplicantDashboard.jsx) · [FranchiseTerritoryOpsPage.jsx](../client/src/pages/FranchiseTerritoryOpsPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-079"></a>

**Specialist and platform work packages** · Page 185 of 393 · WP-079

## Logistics buyer and checkout

### Current boundary

Logistics buyer functions include sourcing, purchase and shipment or claim history, some offered under wider product flags.

### Implementation work

Keep eligible personal buyers and authorized business buyers in the same experience. Identify the acting buyer and shipment or order scope. Preserve checkout, claim, refund and payment policies for the lane and product.

### Acceptance

Buy as a person with pending organizer access while permitted. Assert that buyer history, support and shipment tracking stay usable and that role projection cannot authorize a foreign shipment or business order.

### Source declarations to trace

- [`POST /checkout/attempt`](../server/routes/logistics.js#L321) · guards `requireAuth, requireLogisticsPayments, requireCountryOnFile` · handler `paymentsCtrl.createAttempt`

**Repository sources**  [logistics.js](../server/routes/logistics.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js#L3) · [orders.js](../server/routes/orders.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-080"></a>

**Specialist and platform work packages** · Page 186 of 393 · WP-080

## Logistics pooled campaigns

### Current boundary

Organizer tools run pooled campaigns and coordinate participation, thresholds and handoffs.

### Implementation work

Require an approved organizer with the exact campaign and applicable region or lane. Keep buyer participation governed by existing product policies. Validate published campaign eligibility in all linked destinations.

### Acceptance

Approve one campaign creator and try managing a campaign administered by another organizer. Exercise share card availability, minimum order and rollover behavior for the permitted campaign.

### Source declarations to trace

- [`POST /campaigns`](../server/routes/logistics.js#L77) · guards `requireAuth` · handler `pooledCtrl.createPooledOrder`
- [`POST /campaigns`](../server/routes/logisticsAdmin.js#L135) · guards `requireOperationsWorkspace` · handler `pooledCtrl.createPooledOrder`

**Repository sources**  [logistics.js](../server/routes/logistics.js) · [logisticsAdmin.js](../server/routes/logisticsAdmin.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js#L10)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-081"></a>

**Specialist and platform work packages** · Page 187 of 393 · WP-081

## Business procurement and restocking

### Current boundary

Procurement uses business access, purchasing context and lane-specific catalogs or restock options.

### Implementation work

Resolve business permissions independent of personal buying and organizer status. Preserve sourcing, quote visibility, pricing, supplier selection and payment scope. Authorize records by their canonical business.

### Acceptance

A person with purchasing at business A and employee scope at B opens procurement for both. They can source qualifying products for A. A B quote and an A request must never combine in an order write.

**Repository sources**  [logistics.js](../server/routes/logistics.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js#L17) · [businessProducts.js](../server/routes/businessProducts.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-082"></a>

**Specialist and platform work packages** · Page 188 of 393 · WP-082

## Logistics distribution and fulfillment

### Current boundary

Distributor and operations views track assigned stock, freight, handoff, warehouse and final-mile delivery.

### Implementation work

Grant access per assignment, lane or internal work area. Keep sensitive shipment address and scan or proof data scoped. Preserve state machine and replay rules through late updates by operational workers.

### Acceptance

Assign one inventory lot and shipment to a distributor, then revoke access before they submit an update. Verify denial of unrelated orders and independent completion or recovery for existing obligations by authorized staff.

**Repository sources**  [logistics.js](../server/routes/logistics.js) · [localDelivery.js](../server/routes/localDelivery.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js#L24)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-083"></a>

**Specialist and platform work packages** · Page 189 of 393 · WP-083

## Logistics internal operations and compliance

### Current boundary

Internal logistics operations, compliance and admin control have separate workspaces and permissions.

### Implementation work

Leave staff grants under the appropriate authorized teams. Grant pricing, restrictions, supplier approval and compliance separately. Keep region, lane and provider policies and audit behavior enforced throughout.

### Acceptance

Give internal staff operations read, no compliance override. They may view their allowed work and cannot change restrictions or supplier status. Link audit records to the approved override and current staff identity.

### Source declarations to trace

- [`POST /compliance/approve-po/:id`](../server/routes/logisticsAdmin.js#L202) · guards `requireComplianceWorkspace` · handler `complianceCtrl.approveRestrictedPO`

**Repository sources**  [logisticsAdmin.js](../server/routes/logisticsAdmin.js) · [internalWorkspaces.js](../server/routes/internalWorkspaces.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js#L31)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-084"></a>

**Specialist and platform work packages** · Page 190 of 393 · WP-084

## Payment roles and money movement

### Current boundary

Payment paths apply ownership, transaction, confirmation and provider facts distinct from UI navigation.

### Implementation work

Keep payer, payee, initiating actor, ownership and settlement policy explicit. Preserve existing step-up and idempotency. A grant that enables quoting, orders, or editing teams does not authorize money movement.

### Acceptance

Make approved and pending actors retry synthetic payment operations. Verify safe denial when wrong wallet, transaction or scope is supplied and only one money movement for the valid retried command.

### Source declarations to trace

- [`POST /intent`](../server/routes/payments.js#L49) · guards `authenticate, requireEmailVerified, requireTermsAcceptance, requirePaymentsEnabled` · handler `createPaymentIntent`
- [`POST /jobs/:id/offline-payment/confirm`](../server/routes/paymentLayers.js#L26) · guards `authenticate, rejectImpersonated` · handler `ctrl.confirmOfflinePayment`

**Repository sources**  [payments.js](../server/routes/payments.js) · [paymentLayers.js](../server/routes/paymentLayers.js) · [qrPayments.js](../server/routes/qrPayments.js) · [feeConfig.js](../server/routes/feeConfig.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-085"></a>

**Specialist and platform work packages** · Page 191 of 393 · WP-085

## Helper earnings and payouts

### Current boundary

Earnings visibility and payout eligibility are distinct and involve prior work, identity and supported payment setup.

### Implementation work

Preserve ownership of funds, financial records, verification and payment partner prerequisites. Keep eligible historical statements readable under the domain’s policy after provider work is paused. Link existing payout accounts without copying authority.

### Acceptance

Revoke new work eligibility for an actor with a balance. Check allowed earnings view, payout behavior under actual payout rules, denied attempts against another payout, and currency-appropriate totals.

### Source declarations to trace

- [`POST /payout-methods`](../server/routes/payoutRoutes.js#L16) · guards `requireAuth, requireUserTotpStepUp, requireOnboardingStep` · handler `PayoutController.createPayoutMethod`

**Repository sources**  [payoutRoutes.js](../server/routes/payoutRoutes.js) · [tax.js](../server/routes/tax.js) · [verification.js](../server/routes/verification.js) · [HelperDashboard.jsx](../client/src/pages/HelperDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-086"></a>

**Specialist and platform work packages** · Page 192 of 393 · WP-086

## Personal and merchant Credit

### Current boundary

Credit has distinct personal, business, restaurant, cashier and compliance contexts with separate authorization and settlement controls.

### Implementation work

Preserve wallet isolation, currency precision, activation flags and append-only ledger semantics. Use current scope and serving role for spend, top-up, settlement and approval. Keep accepted account rights tied to the wallet.

### Acceptance

Run targeted Credit isolation verification in disposable runtime. Compare principal, wallet owner, business, store and operation across deny and valid cases. Pre/post balances and journal pairs must reconcile on retry.

### Source declarations to trace

- [`POST /conversions`](../server/routes/oxsteedCredit.js#L25) · guards `creditMutationLimiter, rejectImpersonated, checkRestrictions` · handler `controller.convertMyCredit`

**Repository sources**  [oxsteedCredit.js](../server/routes/oxsteedCredit.js) · [oxsteedCreditKiosk.js](../server/routes/oxsteedCreditKiosk.js) · [restaurantTopups.js](../server/routes/restaurantTopups.js) · [creditLicenceAdmin.js](../server/routes/creditLicenceAdmin.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-087"></a>

**Specialist and platform work packages** · Page 193 of 393 · WP-087

## Statements, exports and archives

### Current boundary

Statement center and archive surfaces support several account types and private downloads.

### Implementation work

Maintain account-first navigation by canonical account and current permission. List only authorized sources and require equivalent server checks for detail, export, download, search and disputes. Keep time periods and currencies distinct.

### Acceptance

With personal and business accounts open, revoke business read mid-export. Confirm available statements and repeat download rules match current authority. Use mismatched account and statement IDs to test denial.

### Source declarations to trace

- [`GET /statements/center`](../server/routes/statementCenter.js#L18) · guards `authenticate`
- [`GET /archive/:documentId/download`](../server/routes/statementArchive.js#L747) · guards `creditExportLimiter`

**Repository sources**  [statementCenter.js](../server/routes/statementCenter.js) · [statementArchive.js](../server/routes/statementArchive.js) · [statementExports.js](../server/routes/statementExports.js) · [statementSearch.js](../server/routes/statementSearch.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-088"></a>

**Specialist and platform work packages** · Page 194 of 393 · WP-088

## Disputes, refund delegation and support

### Current boundary

Refunds and disputes can involve participants, support agents or specially granted reviewers.

### Implementation work

Keep authored cases and actor eligibility independent of job mode. Preserve transaction amount limits, reasons, source role, adjustable wallet, compensation controls and audit. Enforce scope again at refund commit.

### Acceptance

Give agent view-only support and attempt a refund for an allowed case. Then use a legitimately privileged actor with a wrong business or old context. Validate good retry yields at most one compensation.

### Source declarations to trace

- [`POST /jobs/:jobId`](../server/routes/disputes.js#L19) · guards `authenticate` · handler `disputeCtrl.openDispute`
- [`POST /food-orders/:id/refund`](../server/routes/agentFoodRefundActions.js#L19) · guards `strictLimiter, rejectImpersonated, requirePermission` · handler `agentFoodRefundActions.refundFoodOrder`
- [`POST /stepup-challenges/refund`](../server/routes/adminFoodOrders.js#L15) · guards `strictLimiter, rejectImpersonated, requirePermission` · handler `ctrl.issueRefundStepupChallenge`

**Repository sources**  [disputes.js](../server/routes/disputes.js) · [agentCreditAdjustments.js](../server/routes/agentCreditAdjustments.js) · [agentFoodRefundActions.js](../server/routes/agentFoodRefundActions.js) · [adminFoodOrders.js](../server/routes/adminFoodOrders.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-089"></a>

**Specialist and platform work packages** · Page 195 of 393 · WP-089

## Platform staff grants and governance

### Current boundary

Privileged operations use role, grants, placement and delegated standing, with Super Admin routes for certain actions.

### Implementation work

Retain dedicated staff access, grantor checks and privileged logout/session rules. Keep self-service application eligibility separate from internal grants. Audit review decisions for permitted scope and link to the governing rule.

### Acceptance

A business manager cannot open a platform queue. A staff reviewer revoked on one region cannot approve its cases, including stale drawer actions. Verify grant history and new state under exact privilege requirements.

### Source declarations to trace

- [`POST /policies`](../server/routes/governance.js#L20) · guards `requireAdmin, requireSuperAdmin` · handler `governanceCtrl.createPolicy`

**Repository sources**  [corporateRoles.js](../server/routes/corporateRoles.js) · [governance.js](../server/routes/governance.js) · [workforce.js](../server/routes/workforce.js) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-090"></a>

**Specialist and platform work packages** · Page 196 of 393 · WP-090

## Provider and internal identity entry

### Current boundary

Internal workspaces have dedicated route and user scope checks. Their login or credential requirements differ from consumer navigation.

### Implementation work

Integrate staff actions through approved internal shells and policies. Keep authentication strength, account linked identity, staff enrollment, and role revocations independent from consumer and business capability grants.

### Acceptance

Use an authorized staff login and a consumer with the same location preference. Only staff reach the permitted internal area. Remove internal access and preserve legitimate consumer features.

**Repository sources**  [internalWorkspaces.js](../server/routes/internalWorkspaces.js) · [corporateRoles.js](../server/routes/corporateRoles.js) · [twoFactor.js](../server/routes/twoFactor.js) · [internalWorkspaces.js](../client/src/utils/internalWorkspaces.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-091"></a>

**Specialist and platform work packages** · Page 197 of 393 · WP-091

## Analytics and telemetry audiences

### Current boundary

Analytics surfaces include customer-specific, organization, platform and investor data that have distinct purposes and access.

### Implementation work

Keep analytics scopes and consent enforced end to end. Extract only purpose-bound metadata into access telemetry. Do not derive reporting scope from a navigation mode or user-supplied business ID.

### Acceptance

Compare aggregate and detailed requests from ordinary customer, business manager, investor and staff. Privacy and row filters agree across export, cache, drill-down and underlying query.

**Repository sources**  [growthInsights.js](../server/routes/growthInsights.js) · [promotionAnalytics.js](../server/routes/promotionAnalytics.js) · [reporting.js](../server/routes/reporting.js) · [oneTruth.js](../server/routes/oneTruth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-092"></a>

**Specialist and platform work packages** · Page 198 of 393 · WP-092

## Scheduled growth and operational outreach

### Current boundary

Growth contracts and notices can consume account-role signals and may later trigger campaign work.

### Implementation work

Emit access events for actual transitions and preserve consent, defaults and campaign gates. Separate historical mode-navigation events from durable eligibility in analytics reconciliation. Check segment membership and current action eligibility where needed.

### Acceptance

Toggle modes on an old fixture and count legacy observations. Approve one new capability and retry the event. Verify one intended event and no unrequested campaign sending.

**Repository sources**  [activity.js](../server/routes/activity.js) · [adminOperationalNotices.js](../server/routes/adminOperationalNotices.js) · [businessMarketing.js](../server/routes/businessMarketing.js) · [emit.js](../server/growth/emit.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-093"></a>

**Specialist and platform work packages** · Page 199 of 393 · WP-093

## Connector and partner service accounts

### Current boundary

Integrations use connector grants, partner signatures or approved service identities independent of the UI mode.

### Implementation work

Keep service accounts and machine scopes separate from personal approvals. Validate grant revocation and callback auth using the owning scheme. Treat a connector delegated by a company as organization-scoped authority with explicit resource checking.

### Acceptance

Attempt partner sync with a human capability token and attempt private staff read with a scoped connector token. Preserve authorized operations and reject revocation replay and mismatched companies.

### Source declarations to trace

- [`POST /reconciliation-exceptions/:id/acknowledge`](../server/routes/connector.js#L37) · guards `connectorMutationLimiter, requireConnectorGrant` · handler `connector.acknowledgeReconException`

**Repository sources**  [connector.js](../server/routes/connector.js) · [apiProducts.js](../server/routes/apiProducts.js) · [partners.js](../server/routes/partners.js) · [opsIntegrations.js](../server/routes/opsIntegrations.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-094"></a>

**Specialist and platform work packages** · Page 200 of 393 · WP-094

## Moderation, safety and holds

### Current boundary

Account and content holds can affect otherwise eligible actions. Moderation is separate from ordinary application approval.

### Implementation work

Keep safety and enforcement states as explicit domain preconditions. A capability approval cannot clear a listing hold, incident state or block. Define who can remove or reinstate domain restrictions.

### Acceptance

Approve a previously suspended provider with missing reinstatement. New offer or publish attempt remains subject to suspension. Reinstatement later changes only the intended scope and leaves evidence traceable.

**Repository sources**  [moderation.js](../server/routes/moderation.js) · [mediaAdmin.js](../server/routes/mediaAdmin.js) · [safety.js](../server/routes/safety.js) · [enforcementPolicy.js](../server/routes/enforcementPolicy.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-095"></a>

**Specialist and platform work packages** · Page 201 of 393 · WP-095

## Uploads and protected evidence retrieval

### Current boundary

Uploads may hand off to scanners, storage or task-specific delivery rules, and not every attachment is public.

### Implementation work

Create a bounded private evidence workflow using existing safe handling. Revalidate current applicant or reviewer authority when issuing signed reads. Scope attachment association to request, version and actor.

### Acceptance

Upload to a private request and test unauthenticated access, a different reviewer, a revoked reviewer, URL replay and unsafe file handling. Public Media and food assets should retain their existing unaffected delivery policies.

### Source declarations to trace

- [`POST /assets/photo-uploads`](../server/routes/media.js#L113) · guards `requireAuth, mediaUploadLimiter, assetCtrl.mediaPhotoUploadHandler, enforceUploadQuota` · handler `assetCtrl.uploadPhoto`

**Repository sources**  [upload.js](../server/routes/upload.js) · [storage.js](../server/routes/storage.js) · [media.js](../server/routes/media.js) · [verification.js](../server/routes/verification.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-096"></a>

**Specialist and platform work packages** · Page 202 of 393 · WP-096

## Subsidiary product and paid entitlements

### Current boundary

Subscriptions and plan or trial features can be tested alongside mode-dependent controls.

### Implementation work

Preserve tier restrictions, billing state, trial and product launch visibility. Model capability authority and subscription eligibility as separate preconditions for actions where required.

### Acceptance

Approve helper capability for someone whose subscription is expired. Verify core helper affordances and trial-only actions according to policy. Renew on a second device without creating another grant.

**Repository sources**  [subscription.js](../server/routes/subscription.js) · [config.js](../server/routes/config.js) · [auth.js](../server/middleware/auth.js#L419) · [modeAccess.js](../client/src/utils/modeAccess.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-097"></a>

**Specialist and platform work packages** · Page 203 of 393 · WP-097

## Referrals, affiliates and partner attribution

### Current boundary

Affiliate attribution and links can land before login and refer to offers, account actions or payouts.

### Implementation work

Preserve consent and eligible attribution across customer-first signup. Keep promoter permission and payout review scoped and idempotent. Sanitize attribution parameters and carry only what the destination recognizes.

### Acceptance

Follow a referral with Helper intent, finish signup, and restart application on another device. Verify attribution once and no automatic affiliate access or payout. Try a forged approval-style query parameter.

### Source declarations to trace

- [`GET /me`](../server/routes/referrals.js#L6) · guards `authenticate` · handler `ctrl.getMyReferral`
- [`POST /calculate`](../server/routes/affiliatePayouts.js#L36) · guards `strictLimiter, requireAuth` · handler `affiliatePayoutsController.calculateAndCreatePayout`

**Repository sources**  [referrals.js](../server/routes/referrals.js) · [affiliatePayouts.js](../server/routes/affiliatePayouts.js) · [offerLinks.js](../server/routes/offerLinks.js) · [partners.js](../server/routes/partners.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-098"></a>

**Specialist and platform work packages** · Page 204 of 393 · WP-098

## Release visibility and startup bootstrap

### Current boundary

Launch visibility defaults and runtime flags govern products and client startup behavior.

### Implementation work

Include capability UX flags through existing server-owned configuration. Define fallback on startup failure and compatibility by client version. Add safe cohort rollout without hiding unrelated public pages or ignoring server denies.

### Acceptance

Test basic defaults, server overrides, unavailable configuration, upgrade prompt and old browser assets. Payment and private approval paths remain gated and public customer paths keep valid navigation.

### Source declarations to trace

- [`GET /ios`](../server/routes/appVersion.js#L22)
- [`GET /android`](../server/routes/appVersion.js#L34)

**Repository sources**  [launchGate.js](../server/middleware/launchGate.js) · [launchScope.js](../client/src/utils/launchScope.js) · [appVersion.js](../server/routes/appVersion.js) · [index.js](../server/index.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-099"></a>

**Specialist and platform work packages** · Page 205 of 393 · WP-099

## Email, SMS and provider retry handling

### Current boundary

Communication systems have channel preferences, webhook verification and retryable delivery mechanisms.

### Implementation work

Use established preference and operational notification rules. Derive recipients from committed request transitions. Keep sensitive evidence in the authenticated app. Build retry and suppression semantics with the owning delivery systems.

### Acceptance

Fail one channel, retry in the outbox, and measure successful delivery per transition. An unverified external webhook cannot change an application or cause another reviewer approval.

### Source declarations to trace

- [`PUT /`](../server/routes/emailPreferences.js#L10) · guards `requireAuth` · handler `emailPreferencesController.updateEmailPreferences`
- [`POST /retry`](../server/routes/adminMessageOutbox.js#L21) · guards `strictLimiter, rejectImpersonated`

**Repository sources**  [emailPreferences.js](../server/routes/emailPreferences.js) · [smsNotifications.js](../server/routes/smsNotifications.js) · [supportChannelWebhooks.js](../server/routes/supportChannelWebhooks.js) · [adminMessageOutbox.js](../server/routes/adminMessageOutbox.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-100"></a>

**Specialist and platform work packages** · Page 206 of 393 · WP-100

## Audit, finance and exceptional administration

### Current boundary

Administrative routes may provide extraordinary scoped operations for support, investigation and finance.

### Implementation work

Keep privileged overrides under existing audited workflows and step-up checks. Preserve maker/checker and any separate authority on sensitive changes. Restrict new access requests and evidence audits to the precise reviewer purpose.

### Acceptance

Simulate an admin approving a request while lacking financial override eligibility. Platform access decision cannot change a balance or expose another organization’s investigation notes.

### Source declarations to trace

- [`GET /operations/security-audit-log`](../server/routes/admin.js#L101) · guards `requireAdmin, requirePermission` · handler `adminOperationsCtrl.getSecurityAuditLog`

**Repository sources**  [admin.js](../server/routes/admin.js) · [serviceOps.js](../server/routes/serviceOps.js) · [statementInvestigation.js](../server/routes/statementInvestigation.js) · [treasury.js](../server/routes/treasury.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-101"></a>

**Specialist and platform work packages** · Page 207 of 393 · WP-101

## Reputation, trust, cancellations and restrictions

### Current boundary

Provider standing and reliability are derived from linked domain facts. Restriction and appeal flows can affect new activity.

### Implementation work

Preserve underlying job and appraisal records through grants or changes. Keep individual and business reputation distinct and apply eligibility at the owning action. Prevent combining identities to evade rate or enforcement limits.

### Acceptance

Approve a helper who has rate or trust restrictions on a previous role. Verify existing limits still apply according to domain policy. Attendance and review history remain linked to canonical participants.

### Source declarations to trace

- [`POST /:userId/recalculate`](../server/routes/reputation.js#L29) · guards `requireAuth, requireAdmin, requirePermission` · handler `recalculateReputation`
- [`POST /refresh`](../server/routes/cancellationStats.js#L32) · guards `requireAuth` · handler `cancellationStatsController.refreshCancellationStats`

**Repository sources**  [reputation.js](../server/routes/reputation.js) · [cancellationStats.js](../server/routes/cancellationStats.js) · [helperCancellationPolicies.js](../server/routes/helperCancellationPolicies.js) · [enforcement.js](../server/routes/enforcement.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-102"></a>

**Specialist and platform work packages** · Page 208 of 393 · WP-102

## Legal records and policy acknowledgements

### Current boundary

General terms and specialized acceptance evidence have their own routes and policy versions.

### Implementation work

Retain original terms, version, actor and time. Apply required additional terms at the right application or activation stage. Preserve previously accepted applicable policies through migration, and capture any specifically required new acknowledgement.

### Acceptance

Perform approval with a stale or missing policy acceptance. Permit the person’s customer features and accurately surface the missing prerequisite. Audit terms for the target account and check idempotent retry.

### Source declarations to trace

- [`POST /:documentType/accept`](../server/routes/legalDocuments.js#L352) · guards `authenticate, strictLimiter` · handler `legalController.recordAcceptance`

**Repository sources**  [legalDocuments.js](../server/routes/legalDocuments.js) · [consent.js](../server/routes/consent.js) · [auth.js](../server/routes/auth.js) · [helperOnboarding.js](../server/services/helperOnboarding.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="wp-103"></a>

**Specialist and platform work packages** · Page 209 of 393 · WP-103

## Maintenance operations and rollback ownership

### Current boundary

Release and operational state combine application health, readiness and configured automation.

### Implementation work

Keep deploy stages and flags observable, migrations additive, telemetry bounded, and rollback compatible with grant revocations. Notify operators about stuck approval or projection work and define ownership.

### Acceptance

Run migration rehearsal with old and new app versions. Disable one cohort after granting and revoking different rights. Both decisions persist while unrelated services stay ready.

### Source declarations to trace

- [`POST /incidents/:incidentId/acknowledge`](../server/routes/monitoring.js#L49) · handler `monitoringController.acknowledgeIncident`
- [`POST /incidents/:incidentId/resolve`](../server/routes/monitoring.js#L50) · handler `monitoringController.resolveIncident`
- [`POST /incidents/:incidentId/notes`](../server/routes/monitoring.js#L52) · handler `monitoringController.addIncidentNote`

**Repository sources**  [RUNBOOK.md](../RUNBOOK.md) · [deployment-ci.md](../docs/deployment-ci.md) · [web-image.yml](../.github/workflows/web-image.yml) · [monitoring.js](../server/routes/monitoring.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-001"></a>

**Acceptance for signup and access** · Page 210 of 393 · AC-001

## Guest finds a task and signs up

### Setup and action

Open a public job or restaurant link as guest. Use signup from the ordinary customer action and verify email.

### Expected result

The account opens the valid same-purpose continuation. A new customer can complete the original task under its domain rules. No privileged application or holder grant is created implicitly.

### Evidence to record

Capture the source path, successful return, account type and absence of an unintended request. Try a malformed external return as the negative control.

**Related work packages**  [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003) · [WP-004](#wp-004)

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [auth.js](../server/routes/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-002"></a>

**Acceptance for signup and access** · Page 211 of 393 · AC-002

## Helper intent survives OTP

### Setup and action

Choose Offer services and start normal registration. Open a new tab before OTP, then verify through the original flow.

### Expected result

Exactly one active customer account exists. The selected helper intent is resumable, and a draft or request points at that exact actor. Provider writes are closed until eligible and approved.

### Evidence to record

Show the pending record, redacted account shape, committed request count, HTTP bid denial, and customer dashboard loaded in the same session.

**Related work packages**  [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003) · [WP-004](#wp-004)

**Repository sources**  [auth.js](../server/routes/auth.js) · [signupReliability.test.js](../server/__tests__/signupReliability.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-003"></a>

**Acceptance for signup and access** · Page 212 of 393 · AC-003

## Owner intent with application failure

### Setup and action

Choose Run a business and let account creation commit. Simulate a recoverable outage on application creation or attachment.

### Expected result

Customer account and intent remain usable. The applicant sees the resume path. A retry creates just one application and operates on the correct actor and scope.

### Evidence to record

Save the final actor, idempotency and application counts. Confirm there is no operational or public business record from the failed attempt.

**Related work packages**  [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003) · [WP-004](#wp-004)

**Repository sources**  [auth.js](../server/routes/auth.js) · [authController.js](../server/controllers/authController.js#L1564)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-004"></a>

**Acceptance for signup and access** · Page 213 of 393 · AC-004

## Unverified email and pending account

### Setup and action

Start a signup with a named role request and skip email verification. Try the continuation route and protected APIs as the pending actor.

### Expected result

Actions that require a verified account stay closed according to the auth policy. No approval can unexpectedly activate based solely on an unverified identity draft.

### Evidence to record

Record response statuses, absence of granted capabilities, and retention or expiry of pending signup state.

**Related work packages**  [WP-002](#wp-002) · [WP-001](#wp-001) · [WP-003](#wp-003) · [WP-004](#wp-004)

**Repository sources**  [auth.js](../server/routes/auth.js) · [JoinPage.jsx](../client/src/pages/JoinPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-005"></a>

**Acceptance for signup and access** · Page 214 of 393 · AC-005

## OTP retry, expiry and resend

### Setup and action

Create an intending helper registration with a short test OTP lifetime. Resend, attempt the prior code, and finalize using the valid current generation.

### Expected result

The prior or expired code fails. The successful replay semantics follow the account contract, and durable customer and application records are singular.

### Evidence to record

Observe the final mode-independent account and the resume affordance. Count account and active-application writes and record applicable error codes.

**Related work packages**  [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003) · [WP-004](#wp-004)

**Repository sources**  [auth.js](../server/routes/auth.js) · [signupReliability.test.js](../server/__tests__/signupReliability.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-006"></a>

**Acceptance for signup and access** · Page 215 of 393 · AC-006

## Same email and two signup entry points

### Setup and action

Open generic signup and dedicated helper onboarding for the same synthetic email, with different contact or intent payloads.

### Expected result

Registration keys never authorize the other branch’s identity. Verified finalization carefully resolves the account conflict and preserves a valid intent without duplicated person or provider record.

### Evidence to record

Record both response envelopes and database identifiers, and check whether applicant data created by the conflicting branch remains private.

**Related work packages**  [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003) · [WP-004](#wp-004)

**Repository sources**  [helperRegistration.js](../server/routes/helperRegistration.js) · [auth.js](../server/routes/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-007"></a>

**Acceptance for signup and access** · Page 216 of 393 · AC-007

## Legacy mode forged on signup

### Setup and action

Call generic and legacy signup with helper, business owner, admin and staff mode fields using API aliases and alternative parameter spellings.

### Expected result

Only the allowed applicant intent is recorded. Customer account authority remains the default for new people. Internal access cannot be created through any of these submissions.

### Evidence to record

Collect response statuses and selected database columns. Try a direct privileged endpoint after OTP with the same returned session.

**Related work packages**  [WP-004](#wp-004) · [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003)

**Repository sources**  [auth.js](../server/routes/auth.js) · [modeRole.js](../server/utils/modeRole.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-008"></a>

**Acceptance for signup and access** · Page 217 of 393 · AC-008

## Resume application on second device

### Setup and action

Submit a saved but unfinished helper application on one device. Sign in with the same account on a second device and open the relevant Jobs action.

### Expected result

Existing application and status load without user re-entry. Saving requires current version. A concurrent edit gives a recoverable conflict and preserves committed changes.

### Evidence to record

Capture request version before and after edits and demonstrate safe form recovery and no cross-device reauthentication prompted by approval state.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-009"></a>

**Acceptance for signup and access** · Page 218 of 393 · AC-009

## Withdraw then reapply

### Setup and action

Submit a valid application, withdraw it before decision, then start another request for the same capability and subject.

### Expected result

Withdrawal is durable and produces no effective grant. A later application follows current policy. History makes the distinct attempts understandable and allows the configured retry rule.

### Evidence to record

Assert open-request index, exact historical count, effective grant count and notifications. A reviewer using the old version cannot approve the withdrawn case.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-010"></a>

**Acceptance for signup and access** · Page 219 of 393 · AC-010

## Needs information and revision history

### Setup and action

Reviewer asks for a missing item. Applicant opens the same request, adds required information, and resubmits.

### Expected result

Applicant sees approved safe reason and specific required fields. A new revision is immutable from review history. Prior submitted facts and reviewer notes remain correctly visible only to authorized parties.

### Evidence to record

Save status and version transitions, applicant safe output, and evidence-access results for two reviewer scopes and a foreign applicant.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-011"></a>

**Acceptance for signup and access** · Page 220 of 393 · AC-011

## Draft attachment confidentiality

### Setup and action

Upload synthetic evidence and view it in the applicant and reviewer paths. Attempt unauthenticated, unrelated account, and revoked reviewer reads.

### Expected result

Ownership, reviewer scope, scan state and expiration are all considered. Links are short-lived and never appear in URLs outside the authenticated evidence flow.

### Evidence to record

Record allow and deny responses after issuance and after revocation. Confirm redacted audit or log output and object lifecycle behavior in the isolated harness.

**Related work packages**  [WP-021](#wp-021) · [WP-095](#wp-095)

**Repository sources**  [upload.js](../server/routes/upload.js) · [storage.js](../server/routes/storage.js) · [privacy.js](../server/routes/privacy.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-012"></a>

**Acceptance for signup and access** · Page 221 of 393 · AC-012

## Public form policy versus evidence data

### Setup and action

Fetch an application schema for a role, then inspect it as guest or another authenticated non-applicant. Save values containing new, unrecognized fields.

### Expected result

Public schema carries permitted questions and supported fields. Strict or explicitly allowlisted mutating inputs prevent storage of internal fields, actor claims or arbitrary large attachments.

### Evidence to record

Record which keys are visible or stored. Attempt a recognized field with oversized input, wrong type and tenant-specific private value.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js#L395)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-013"></a>

**Acceptance for signup and access** · Page 222 of 393 · AC-013

## Reviewer privilege narrows mid-session

### Setup and action

Open a case under an approval grant that expires, then try to approve from the still-open browser drawer.

### Expected result

The decision uses current authority, refuses the stale write, and creates no effective grant. Valid access elsewhere stays active for that reviewer.

### Evidence to record

Record decision count and grant count. Test expiry, revocation and loss of reviewer delegation independently against list, detail, evidence and mutation.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [adminAuth.js](../server/middleware/adminAuth.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-014"></a>

**Acceptance for signup and access** · Page 223 of 393 · AC-014

## Two competing approval decisions

### Setup and action

Prepare one submitted case. Concurrently send approval and decline using its same expected version from two authorized reviewers.

### Expected result

Defined transition rules determine a single committed outcome. The other action sees a conflict. The lasting status, grant, audit and customer notification agree.

### Evidence to record

Capture both request outcomes and SQL-backed state, evidence version and outbox event count. Repeat with a same-action idempotent retry.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-015"></a>

**Acceptance for signup and access** · Page 224 of 393 · AC-015

## Duplicate application on two tabs

### Setup and action

As one verified actor send two equivalent application submissions for the same capability and exact target.

### Expected result

One open request is effective. Its version and submission history are coherent. Conflicting unsaved values are surfaced clearly without silently overwriting approved evidence.

### Evidence to record

Run the race with multiple workers and varying idempotency keys. Add a different authorized scope and verify two independent open requests are allowed.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [272_mode_platform_approvals.sql](../server/migrations/272_mode_platform_approvals.sql)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-016"></a>

**Acceptance for signup and access** · Page 225 of 393 · AC-016

## Policy changes during review

### Setup and action

Submit under one policy revision. Change eligibility requirements before review, then decide with the original revision.

### Expected result

Decision behavior follows explicit policy-transition rules. Required new evidence is surfaced where applicable. Stale dependent data cannot accidentally qualify the actor.

### Evidence to record

Record policy and application revision, resulting status, authorized appeal or resubmit action, and audit evidence.

**Related work packages**  [WP-010](#wp-010) · [WP-012](#wp-012) · [WP-011](#wp-011)

**Repository sources**  [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js#L269) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-017"></a>

**Acceptance for signup and access** · Page 226 of 393 · AC-017

## Admin rejects without harming customer access

### Setup and action

Decline a Helper or Business Owner application as authorized reviewer. Then use the applicant’s personal customer session to post a valid job and view a food order.

### Expected result

Decline stays visible with safe reason and permitted retry action. Customer access, draft and prior history persist. Protected helper or ownership actions remain denied.

### Evidence to record

Record job/order permissions, one rejection notification and status data on both original and second devices.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012) · [WP-025](#wp-025)

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [jobs.js](../server/routes/jobs.js) · [food.js](../server/routes/food.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-018"></a>

**Acceptance for signup and access** · Page 227 of 393 · AC-018

## Revoke and reinstate distinct rights

### Setup and action

Grant two independent capabilities. Revoke one while both are in use and restore eligibility through the approved review lifecycle.

### Expected result

Only the revoked subject’s future actions close. Audit shows revoke and separate reinstatement in order. No other entity grant or personal activity changes.

### Evidence to record

Collect access projection versions and protected action responses. Run concurrency with a stale legitimate command and a fresh command after scope-recheck.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [scopeModel.js](../server/services/scopeModel.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-019"></a>

**Acceptance for signup and access** · Page 228 of 393 · AC-019

## Fixture identity changes across tabs

### Setup and action

Begin capability refresh for account A. Sign out on the other tab and sign in as B before delayed A response arrives.

### Expected result

UI and cache associate the response only with its original account and session epoch. No A applications, notifications or fast actions appear in B’s context.

### Evidence to record

Use a browser run with deferred responses, independently verify cookies, and inspect storage keys for account bindings.

**Repository sources**  [authSessionEpoch.js](../client/src/api/authSessionEpoch.js) · [AuthContext.jsx](../client/src/context/AuthContext.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-020"></a>

**Acceptance for signup and access** · Page 229 of 393 · AC-020

## No role mutation on ordinary page navigation

### Setup and action

Use Jobs, My Work, food ordering, and two scoped business views from one session. Trace network requests and session state.

### Expected result

No navigation action requires changing persisted account authority or rotating tokens. Actions use the logged-in identity and exact resource. Regular refresh and session expiry behavior still works.

### Evidence to record

Capture route and session transitions with browser diagnostics. Independently prove attempted access to an ungranted action still fails.

**Related work packages**  [WP-013](#wp-013) · [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003)

**Repository sources**  [ModeSwitcher.jsx](../client/src/components/ModeSwitcher.jsx) · [auth.js](../server/routes/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-021"></a>

**Acceptance for signup and access** · Page 230 of 393 · AC-021

## Capability refresh during unsaved editing

### Setup and action

Open a valid draft in Home or Media. Apply an unrelated approval from a separate session and deliver the access update.

### Expected result

The in-place capability refresh doesn't destroy the draft, focus or page location. Approval messaging is announced appropriately and appears where relevant.

### Evidence to record

Compare persisted and unsaved fields across tabs, establish no reload from approval, and verify a real release change remains distinguishable.

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [ServiceWorkerUpdateNotice.jsx](../client/src/components/ServiceWorkerUpdateNotice.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-022"></a>

**Acceptance for signup and access** · Page 231 of 393 · AC-022

## Arabic approval status keyboard flow

### Setup and action

Use keyboard and available screen-reader observability in Arabic. Start a request, hit validation, recover, then receive an approval status while focused.

### Expected result

Focus moves only as appropriate. Status is announced, controls are labeled, mixed IDs render in readable order, and mobile touch targets and layout are usable.

### Evidence to record

Capture translated response, route state, screenshot, screen reader observation and locale parity evidence for required catalogs.

**Repository sources**  [JoinPage.jsx](../client/src/pages/JoinPage.jsx) · [common.json](../client/src/i18n/locales/ar/common.json)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-023"></a>

**Acceptance for signup and access** · Page 232 of 393 · AC-023

## Feature flag unavailable at boot

### Setup and action

Temporarily fail the boot visibility read and current-access refresh from an isolated browser. Open an eligible public route and a protected route.

### Expected result

Public behavior follows safe existing defaults and authorization remains server controlled. Private features do not turn on because loaded settings are stale or absent.

### Evidence to record

Record flag, boot response and fallback text. Include a non-eligible direct API call and recovery after restoring the service.

**Repository sources**  [launchGate.js](../server/middleware/launchGate.js) · [launchScope.js](../client/src/utils/launchScope.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-024"></a>

**Acceptance for signup and access** · Page 233 of 393 · AC-024

## Mobile notification deep-link identity

### Setup and action

Open an approval notice on a mobile client after sign-out. First authenticate as another user, then as the correct applicant.

### Expected result

Foreign user's link cannot expose case status or target. Correct account resumes the proper scoped task without a mode reset or unrelated navigation.

### Evidence to record

Verify signed-out landing, native or browser deep-link parsing, denied and permitted envelope, and versioned compatibility on supported builds.

**Related work packages**  [WP-020](#wp-020) · [WP-019](#wp-019)

**Repository sources**  [mobile.js](../server/routes/mobile.js) · [notifications.js](../server/routes/notifications.js) · [AuthContext.jsx](../client/src/context/AuthContext.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-025"></a>

**Acceptance for customer and commerce flows** · Page 234 of 393 · AC-025

## Provider and customer work side by side

### Setup and action

Use a verified and approved helper fixture. Post a customer job in one tab and bid on someone else’s job in another. Include an active food order.

### Expected result

User retains both journeys under one identity. Approving access changed available actions in context. Server checks block self-bid, detached bid update and cross-customer order history.

### Evidence to record

Record bid, post and order ownership, active browser identity in both tabs, and no role writes on navigation.

**Related work packages**  [WP-025](#wp-025) · [WP-026](#wp-026)

**Repository sources**  [jobs.js](../server/routes/jobs.js) · [bids.js](../server/routes/bids.js) · [HelperDashboard.jsx](../client/src/pages/HelperDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-026"></a>

**Acceptance for customer and commerce flows** · Page 235 of 393 · AC-026

## Verified identity with approval still pending

### Setup and action

Complete the identity provider flow on a helper applicant. Hold the application in review and try the provider APIs using returned verification state.

### Expected result

Private setup and read remain available where appropriate. No public listing or bid is enabled by verification alone if the approved policy requires a separate decision.

### Evidence to record

Record current verification result, grant list, API deny and private route behavior. Approve the same application and retest with the original session.

**Related work packages**  [WP-007](#wp-007) · [WP-026](#wp-026)

**Repository sources**  [helperOnboarding.js](../server/services/helperOnboarding.js) · [didit.js](../server/routes/didit.js) · [bids.js](../server/routes/bids.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-027"></a>

**Acceptance for customer and commerce flows** · Page 236 of 393 · AC-027

## Approved helper suspended or unlisted

### Setup and action

Start with approved helper, then suspend new work or unlist through the correct domain flow. Issue direct listing and bid requests.

### Expected result

Effective action incorporates current safety and listing policy. Public directory and detail visibility remain consistent. A listing preference and a suspension get their distinct intended treatment.

### Evidence to record

Capture same actor before/after listing and bid outputs, public search cache behavior, and preservation of existing job history.

**Related work packages**  [WP-026](#wp-026) · [WP-022](#wp-022) · [WP-029](#wp-029) · [WP-101](#wp-101)

**Repository sources**  [helpers.js](../server/routes/helpers.js) · [enforcement.js](../server/routes/enforcement.js) · [bids.js](../server/routes/bids.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-028"></a>

**Acceptance for customer and commerce flows** · Page 237 of 393 · AC-028

## Existing contract after new-work revoke

### Setup and action

Assign active work to a provider. Revoke ability to start new work and attempt a new bid, authorized history read, and state transition on the existing contract.

### Expected result

New business is closed. Obligations, evidence access and continuation follow approved domain policy. Separate participants remain able to exercise their valid rights.

### Evidence to record

Record contract state and new work denial. Check accrual or reconciliation does not create or remove original obligations as a side effect.

**Related work packages**  [WP-029](#wp-029) · [WP-025](#wp-025) · [WP-026](#wp-026) · [WP-038](#wp-038)

**Repository sources**  [workAgreements.js](../server/routes/workAgreements.js) · [disputes.js](../server/routes/disputes.js) · [jobs.js](../server/routes/jobs.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-029"></a>

**Acceptance for customer and commerce flows** · Page 238 of 393 · AC-029

## Apply to create a new business

### Setup and action

Apply with a trade name that is also used in a different region. Fill a private setup draft and request owner review.

### Expected result

Draft remains private. A specific decision and validated market identify the intended new record. Approved applicant can use controls for that business only.

### Evidence to record

List public storefront and admin review before and after. Show one canonical owner relationship and unchanged foreign entity.

**Related work packages**  [WP-046](#wp-046)

**Repository sources**  [businesses.js](../server/routes/businesses.js) · [BusinessCreationWizard.jsx](../client/src/components/businessHub/BusinessCreationWizard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-030"></a>

**Acceptance for customer and commerce flows** · Page 239 of 393 · AC-030

## Competing claims for an existing business

### Setup and action

Two verified users claim an existing business with the same identifying details. Existing owner remains active. Attempt to approve in parallel.

### Expected result

Claim resolution follows verified ownership or transfer rules. It cannot replace an existing owner based on name or a generic approval. Only authorized transfer outcomes update ownership.

### Evidence to record

Record canonical owner and applicant IDs in isolated evidence. Compare decisions, protected writes and business record counts.

**Related work packages**  [WP-046](#wp-046)

**Repository sources**  [businesses.js](../server/routes/businesses.js) · [scopeModel.js](../server/services/scopeModel.js#L318)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-031"></a>

**Acceptance for customer and commerce flows** · Page 240 of 393 · AC-031

## Membership approval by actual employer

### Setup and action

Set up pending roles at two companies with different owners. Owner A tries approve A and B using each URL and combined IDs.

### Expected result

Only authorized membership at the exact company changes. Authority is current when approval commits, and wrong-subject requests preserve normal denial behavior.

### Evidence to record

Read member rows and scope projection after each attempted review. Confirm owner A cannot see B’s evidence or grant broader roles than permitted.

**Related work packages**  [WP-008](#wp-008) · [WP-009](#wp-009) · [WP-048](#wp-048)

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [requirePermission.js](../server/middleware/requirePermission.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-032"></a>

**Acceptance for customer and commerce flows** · Page 241 of 393 · AC-032

## Invite link across logged-out state

### Setup and action

Follow an invitation logged out, start ordinary signup, verify email, and resume the invitation. Repeat with a mismatched logged-in account.

### Expected result

Only the invitation’s intended audience can consume it. Accepted access appears in the existing organization context. Invitation expiry and reuse are enforced.

### Evidence to record

Collect application and membership records, no duplicate invites consumed, and safe routing for mismatched recipient and expired invitation.

**Related work packages**  [WP-009](#wp-009)

**Repository sources**  [vortex.js](../server/routes/vortex.js) · [JoinPage.jsx](../client/src/pages/JoinPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-033"></a>

**Acceptance for customer and commerce flows** · Page 242 of 393 · AC-033

## Business staff promotion while work is open

### Setup and action

An employee is viewing the company calendar. The authorized owner promotes that member. Resume the same calendar after the access refresh.

### Expected result

New scoped manager controls appear. Scroll, tab identity and relevant ongoing assignment remain stable. Employee activity at a different company remains unchanged.

### Evidence to record

Record grant invalidation event, current route, visible controls and permitted/forbidden calendar writes on both entities.

**Related work packages**  [WP-008](#wp-008) · [WP-009](#wp-009) · [WP-048](#wp-048)

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [BusinessRoleDashboardBase.jsx](../client/src/pages/BusinessRoleDashboardBase.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-034"></a>

**Acceptance for customer and commerce flows** · Page 243 of 393 · AC-034

## Customer also manages a company

### Setup and action

Open a personal job and a client booking on behalf of a business in the same session. Alternate operations twice.

### Expected result

Attribution stays on the correct relationship and entity. Private client history and personal job data are mutually protected. The user does not change account mode to complete either.

### Evidence to record

Compare HTTP subject and persisted owner in both flows. Use browser return and reload and check representative permissions.

**Related work packages**  [WP-025](#wp-025) · [WP-026](#wp-026) · [WP-049](#wp-049) · [WP-050](#wp-050)

**Repository sources**  [businessOperations.js](../server/routes/businessOperations.js) · [jobs.js](../server/routes/jobs.js) · [navbarNavigation.js](../client/src/utils/navbarNavigation.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-035"></a>

**Acceptance for customer and commerce flows** · Page 244 of 393 · AC-035

## Staff financial read restricted to a named account

### Setup and action

Give a manager operational scope for A and financial read scope for B only. Attempt statement search and exports under each selection.

### Expected result

Finances use exact account and permission regardless of most recently opened business. Exported and cached responses preserve the same scope.

### Evidence to record

Record allowed financial readers, account IDs inside requests, blocked A export and B detail parity with direct statement download.

**Related work packages**  [WP-054](#wp-054) · [WP-073](#wp-073) · [WP-087](#wp-087)

**Repository sources**  [businessFinance.js](../server/routes/businessFinance.js) · [statementCenter.js](../server/routes/statementCenter.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-036"></a>

**Acceptance for customer and commerce flows** · Page 245 of 393 · AC-036

## Business representative cannot assume owner

### Setup and action

Give staff a representative grant for a business. Try lead follow-up, editing owner contact information, changing team membership and issuing a payment.

### Expected result

Only granted actions on assigned records succeed. Other operations continue to require their actual domain permissions and reviewer path.

### Evidence to record

Capture one successful authorized lead action and denial for unrelated writes. Then revoke and verify lead scope is removed promptly.

**Related work packages**  [WP-008](#wp-008) · [WP-009](#wp-009) · [WP-048](#wp-048) · [WP-052](#wp-052)

**Repository sources**  [businessTeam.js](../server/routes/businessTeam.js) · [businessLeads.js](../server/routes/businessLeads.js) · [businessFinance.js](../server/routes/businessFinance.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-037"></a>

**Acceptance for customer and commerce flows** · Page 246 of 393 · AC-037

## Cross-tenant template child record

### Setup and action

Create similar records in two template businesses. Reuse a valid business A URL with B’s record ID for update and attachments.

### Expected result

Child ownership and any assigned resource are validated. The update and file response disclose no unauthorized record and preserve canonical history.

### Evidence to record

Perform a valid update using A’s own record and compare failed checks with DB side effects, audit and safe error shape.

**Related work packages**  [WP-058](#wp-058) · [WP-057](#wp-057)

**Repository sources**  [propertyOperations.js](../server/routes/propertyOperations.js) · [tradesOperations.js](../server/routes/tradesOperations.js) · [beautyOperations.js](../server/routes/beautyOperations.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-038"></a>

**Acceptance for customer and commerce flows** · Page 247 of 393 · AC-038

## Business marketing and late revocation

### Setup and action

Schedule a synthetic outreach under a valid permission and remove that grant before execution. Test an independent opt-out path.

### Expected result

The worker follows declared revocation semantics for work scheduled by a user. Consent, existing provider flags and recipient scope are enforced under the owning campaign policy.

### Evidence to record

Record job state, consent proof and delivery count in isolates. Verify retry and alternate segment sends do not bypass opt-out.

**Related work packages**  [WP-052](#wp-052) · [WP-092](#wp-092)

**Repository sources**  [businessMarketing.js](../server/routes/businessMarketing.js) · [adminOperationalNotices.js](../server/routes/adminOperationalNotices.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-039"></a>

**Acceptance for customer and commerce flows** · Page 248 of 393 · AC-039

## Carrier context on material order

### Setup and action

A helper attaches an authorized materials request to a job and a business member prepares another purchase. Swap order or business IDs in the completion request.

### Expected result

The caller’s role does not substitute for validated material purchase authority. The link cannot attach a foreign order. Committed originals remain correctly keyed.

### Evidence to record

Inspect links and quantities after valid and rejected operations. Repeat with a recovered cart and another co-owner.

**Related work packages**  [WP-041](#wp-041) · [WP-040](#wp-040) · [WP-079](#wp-079) · [WP-080](#wp-080)

**Repository sources**  [jobKits.js](../server/routes/jobKits.js) · [logistics.js](../server/routes/logistics.js) · [cartCheckout.js](../server/routes/cartCheckout.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-040"></a>

**Acceptance for customer and commerce flows** · Page 249 of 393 · AC-040

## Merchant private draft becomes eligible

### Setup and action

Start a restaurant application as Customer. Enter test menu and store details while pending, then approve canonical ownership.

### Expected result

Private draft is recoverable before review. Merchant controls appear after scope activates. Public listing and ordering open only through the appropriate domain state.

### Evidence to record

Compare signed-out restaurant discovery and merchant action responses before and after decisions and separate publication.

**Related work packages**  [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062) · [WP-063](#wp-063)

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [food.js](../server/routes/food.js) · [FoodMerchantPage.jsx](../client/src/pages/food/FoodMerchantPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-041"></a>

**Acceptance for customer and commerce flows** · Page 250 of 393 · AC-041

## One manager grant in two restaurant locations

### Setup and action

Use a manager at location A and an employee at B of the same business. Visit each schedule and try a request mixing identifiers.

### Expected result

The same interface provides location-specific controls. A scoped promotion at A grants no staff management at B. Shift and store IDs are verified together.

### Evidence to record

Use database-backed fixtures and compare whole list, individual row, search, direct PATCH and attempted export responses for both sites.

**Related work packages**  [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062) · [WP-063](#wp-063)

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [scopeModel.js](../server/services/scopeModel.js#L228)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-042"></a>

**Acceptance for customer and commerce flows** · Page 251 of 393 · AC-042

## Existing guest order after owner approval

### Setup and action

Start a guest order or tracking link, then enter the account and apply for restaurant ownership. Later approve without interfering with the food task.

### Expected result

Guest and customer journey remains valid within its existing payment and tracking contract. Staff controls are available only for the applicant’s approved entity.

### Evidence to record

Record tracking and own order status before and after. Try staff direct endpoints against the restaurant that took the guest order when the applicant owns another restaurant.

**Related work packages**  [WP-063](#wp-063) · [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062)

**Repository sources**  [food.js](../server/routes/food.js) · [restaurants.js](../server/routes/restaurants.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-043"></a>

**Acceptance for customer and commerce flows** · Page 252 of 393 · AC-043

## Cashier attempts foreign ticket

### Setup and action

Open POS for a valid cashier and drawer at A. Use B’s ticket ID and then try a valid A ticket with B’s location and device.

### Expected result

Proper scope, staff session, drawer and ticket relationships all matter. No accidental ticket payment or drawer activity is generated on rejected attempts.

### Evidence to record

Verify isolated POS ledger, order state, and denied/allowed responses. Repeat after membership or location revoke before tender initiation.

**Related work packages**  [WP-066](#wp-066) · [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062)

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [RestaurantPOSPage.jsx](../client/src/pages/food/RestaurantPOSPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-044"></a>

**Acceptance for customer and commerce flows** · Page 253 of 393 · AC-044

## Reconcile offline terminal after revocation

### Setup and action

Simulate approved offline permit and an existing uncertain tender in provider sandbox. Change cashier membership before reconnect.

### Expected result

Domain-specific recovery reconciles existing commitments through authorized channels. Revoked cashier cannot create new permits. Capture, reversal and replay remain tied to exact store and provider account.

### Evidence to record

Collect permit state, reconciliation acknowledgements and isolated provider evidence. One capture and correct ledger results are required.

**Related work packages**  [WP-072](#wp-072) · [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062)

**Repository sources**  [storeHubs.js](../server/routes/storeHubs.js) · [restaurants.js](../server/routes/restaurants.js) · [README.md](../native/RestaurantTerminalOffline/README.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-045"></a>

**Acceptance for customer and commerce flows** · Page 254 of 393 · AC-045

## Device and human cross-scope isolation

### Setup and action

Pair a kitchen screen to store A. Promote a human account at store B. Test both credentials against each store’s management and display endpoints.

### Expected result

Each credential only grants its own configured scope and actions. Pairing or human approval does not expose another store’s kitchen and staff information.

### Evidence to record

Record safe display and admin results, revoke A’s device or B’s manager independently, and confirm other authorized requests stay useful.

**Related work packages**  [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062) · [WP-063](#wp-063)

**Repository sources**  [restaurantDevices.js](../server/routes/restaurantDevices.js) · [restaurantDisplays.js](../server/routes/restaurantDisplays.js) · [restaurants.js](../server/routes/restaurants.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-046"></a>

**Acceptance for customer and commerce flows** · Page 255 of 393 · AC-046

## Runner sees one assigned delivery

### Setup and action

Assign one live task and one unrelated store task in the same area. Use a runner who also has customer and employee access.

### Expected result

Only intended runner data is disclosed. Claim and proof operations verify assigned task context. Other consumer and employee duties remain accessible.

### Evidence to record

Compare runner queue to direct task access and alternate proof upload using the foreign ID. Verify ownership and task status after denied requests.

**Related work packages**  [WP-070](#wp-070) · [WP-082](#wp-082)

**Repository sources**  [runner.js](../server/routes/runner.js) · [localDelivery.js](../server/routes/localDelivery.js) · [RestaurantRunnerPage.jsx](../client/src/pages/food/RestaurantRunnerPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-047"></a>

**Acceptance for customer and commerce flows** · Page 256 of 393 · AC-047

## Inventory transfer permissions

### Setup and action

Attempt an inventory transfer as a member with adjust rights at A but no transfer authority or B access. Then test a valid authorized transfer.

### Expected result

Required rights and both affected scopes are checked under the transaction. No inventory changes occur from an unauthorized move or cross-store child substitution.

### Evidence to record

Capture inventory quantities, audit and side effects before and after each attempt. Replay valid operation and reconcile expected quantities.

**Related work packages**  [WP-068](#wp-068) · [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062)

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [RestaurantInventoryPage.jsx](../client/src/pages/food/RestaurantInventoryPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-048"></a>

**Acceptance for customer and commerce flows** · Page 257 of 393 · AC-048

## Tips, payroll and view-only employee

### Setup and action

Install a fixture with own tips, another employee’s payroll, and two stores. Promote operations permissions only.

### Expected result

Employee sees their own allowed records. Broader operational role alone cannot reveal other workers’ pay or run payroll. Existing payout reconciliation remains unaffected.

### Evidence to record

Verify own read, foreign direct read, exported report and masked projection. Use an explicit allowed finance reviewer to validate expected independent access.

**Related work packages**  [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062) · [WP-063](#wp-063)

**Repository sources**  [restaurants.js](../server/routes/restaurants.js) · [RestaurantEmployeePortalPage.jsx](../client/src/pages/food/RestaurantEmployeePortalPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-049"></a>

**Acceptance for customer and commerce flows** · Page 258 of 393 · AC-049

## Careers hiring from an approved business

### Setup and action

Apply to an employer as a customer and post an opening from another business where the person has authorized hiring scope.

### Expected result

Both functions appear in relevant contexts while applications remain private to permitted audiences. Employer approval does not expose a foreign applicant or interview.

### Evidence to record

Test candidate route, employer listing, old invite link, interview participant lookup and denial for foreign application IDs.

**Related work packages**  [WP-031](#wp-031)

**Repository sources**  [careers.js](../server/routes/careers.js) · [careersModel.js](../client/src/features/careers/careersModel.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-050"></a>

**Acceptance for specialists and protected actions** · Page 259 of 393 · AC-050

## Assigned consultant eligibility

### Setup and action

Invite a consultant into two market groups with referral assignment at one. Review approval and attempt unrelated case access.

### Expected result

Provider access obeys actual market, assigned request, current policy and paid-transition prerequisites. Customer bookings remain accessible when permitted.

### Evidence to record

Collect status and assignment evidence. Exercise current paid action, wrong scope and denied provider action from a pending case.

**Related work packages**  [WP-074](#wp-074) · [WP-075](#wp-075)

**Repository sources**  [consultantNetwork.js](../server/routes/consultantNetwork.js) · [consultantScheduling.js](../server/routes/consultantScheduling.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-051"></a>

**Acceptance for specialists and protected actions** · Page 260 of 393 · AC-051

## Investor report and metric evidence

### Setup and action

Grant an investor a limited reporting dataset. Open KPI detail, export as applicable, and access evidence by changing a metric or dataset ID.

### Expected result

Same audience policy governs aggregate and underlying details. The investigator confirms declared route guard behavior on the mounted server and no unapproved fields are exposed.

### Evidence to record

Test dataset A permission and dataset B denial, serialized response, query filters and cached output after grant expiry.

**Related work packages**  [WP-077](#wp-077)

**Repository sources**  [investor.js](../server/routes/investor.js) · [investorController.js](../server/controllers/investorController.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-052"></a>

**Acceptance for specialists and protected actions** · Page 261 of 393 · AC-052

## Franchise applicant to territory operator

### Setup and action

Advance franchise applicant through a synthetic approved process with assigned territory. Retain a different existing signed agreement and another pending application.

### Expected result

Application history remains available. Capability update grants only the assigned territory once activated and preserves distinct agreement and fee states.

### Evidence to record

Record applicant status, agreement and region checks, denied read against another territory, and allowed roster or KPI access.

**Related work packages**  [WP-078](#wp-078)

**Repository sources**  [franchise.js](../server/routes/franchise.js) · [FranchiseTerritoryOpsPage.jsx](../client/src/pages/FranchiseTerritoryOpsPage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-053"></a>

**Acceptance for specialists and protected actions** · Page 262 of 393 · AC-053

## Tool owner publication versus renter

### Setup and action

Rent a tool, create a draft listing, and apply to publish in the same account. Approve only personal tool publishing.

### Expected result

Renter history and payments persist throughout. Publishing is available only for the approved subject and only through listing, verification and moderation rules.

### Evidence to record

Inspect the approved listing, another owner’s listing and the pending instance. Test a fake owner ID and direct checkout.

**Related work packages**  [WP-037](#wp-037) · [WP-038](#wp-038)

**Repository sources**  [toolRentals.js](../server/routes/toolRentals.js) · [ToolOwnerDashboard.jsx](../client/src/pages/ToolOwnerDashboard.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-054"></a>

**Acceptance for specialists and protected actions** · Page 263 of 393 · AC-054

## Tool reservation after listing hold

### Setup and action

Place an accepted tool reservation, then place a hold on its listing. Add or revoke an unrelated owner capability.

### Expected result

Existing reservation handling follows the intended state machine. A new grant does not clear moderation or accelerate a financial release.

### Evidence to record

Record listing state, reservation, deposit and dispute response before and after. Confirm held content remains out of public results.

**Related work packages**  [WP-037](#wp-037) · [WP-038](#wp-038)

**Repository sources**  [toolRentals.js](../server/routes/toolRentals.js) · [toolRentalModerationHold.test.js](../server/__tests__/toolRentalModerationHold.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-055"></a>

**Acceptance for specialists and protected actions** · Page 264 of 393 · AC-055

## Pool organizer and personal buyer

### Setup and action

An approved organizer runs one campaign as well as buying from a different campaign personally. Try taking organizer action against the latter.

### Expected result

Campaign management requires the exact organizer authority and applicable eligibility. Buyer action continues normally. Product caps and scope remain enforced.

### Evidence to record

Prove two distinct records and roles in one session. Query campaign and buyer receipts, list filtering and unauthorized participant access.

**Related work packages**  [WP-079](#wp-079) · [WP-041](#wp-041) · [WP-080](#wp-080) · [WP-081](#wp-081)

**Repository sources**  [logistics.js](../server/routes/logistics.js) · [logisticsWorkspaces.js](../client/src/utils/logisticsWorkspaces.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-056"></a>

**Acceptance for specialists and protected actions** · Page 265 of 393 · AC-056

## Procurement and distributor grant separation

### Setup and action

Assign a buyer to business A and a distributor to an order for B. Try the same checkout or pickup command against both.

### Expected result

Organization procurement and assigned fulfillment have separate authorizers. Filters, addresses and inboxes show only the corresponding parties.

### Evidence to record

Capture the genuine A order and B delivery path as well as refused cross-context and forged child ID commands.

**Related work packages**  [WP-081](#wp-081) · [WP-041](#wp-041) · [WP-070](#wp-070) · [WP-079](#wp-079)

**Repository sources**  [logistics.js](../server/routes/logistics.js) · [localDelivery.js](../server/routes/localDelivery.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-057"></a>

**Acceptance for specialists and protected actions** · Page 266 of 393 · AC-057

## Marketplace Direct quote after approval

### Setup and action

Begin quote and booking as a customer. In the same session approve a helper request. Return from payment test mode or a scheduled Direct update.

### Expected result

Draft, customer case and safe return are stable. Direct staff functionality stays privileged, and eligible appointment claims use the real quote and owner.

### Evidence to record

Record quote and booking identities, denied operator action and serialized payment retry in the disposable environment.

**Related work packages**  [WP-032](#wp-032) · [WP-033](#wp-033)

**Repository sources**  [direct.js](../server/routes/direct.js) · [directBookSlotAuth.test.js](../server/__tests__/directBookSlotAuth.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-058"></a>

**Acceptance for specialists and protected actions** · Page 267 of 393 · AC-058

## Media selected author after revoke

### Setup and action

Open a restaurant-publisher draft and personal Media draft. Revoke the restaurant role while the tab remains open.

### Expected result

The restaurant action revalidates current author eligibility. Local text recovery respects the domain’s permitted access. Personal draft and public feed continue to work.

### Evidence to record

Verify draft and publisher IDs, link cards, denied stale publish and lack of unintended republication through a restaurant alias.

**Related work packages**  [WP-042](#wp-042) · [WP-043](#wp-043) · [WP-095](#wp-095)

**Repository sources**  [media.js](../server/routes/media.js) · [MediaComposePage.jsx](../client/src/pages/media/MediaComposePage.jsx)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-059"></a>

**Acceptance for specialists and protected actions** · Page 268 of 393 · AC-059

## Media report and share visibility

### Setup and action

Keep a public post and a reported post that was held. Approve a Media-related business action for a user who is not a moderator.

### Expected result

The new grant never bypasses report hold or creates evidence access. Share metadata, direct reads, feeds and linked cards follow the exact visibility result.

### Evidence to record

Compare public and signed-in outputs, cached previews and reporting API status. Check a valid moderation actor separately.

**Related work packages**  [WP-042](#wp-042) · [WP-043](#wp-043) · [WP-094](#wp-094) · [WP-095](#wp-095)

**Repository sources**  [media.js](../server/routes/media.js) · [mediaAdmin.js](../server/routes/mediaAdmin.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-060"></a>

**Acceptance for specialists and protected actions** · Page 269 of 393 · AC-060

## Creator payment wallet and role

### Setup and action

Use an authorized creator with a personal wallet and an organization recipient. Attempt a payout or purchase through the wrong wallet actor.

### Expected result

The server resolves actual party, grant, currency, amount, and eligible deliverable. Approved creator access leaves unrelated wallets isolated.

### Evidence to record

Record journal results, wallet IDs and exact transaction count in the isolated Credit setup. Retry valid payment and inspect expiry or frozen-wallet behavior.

**Related work packages**  [WP-043](#wp-043) · [WP-042](#wp-042) · [WP-086](#wp-086) · [WP-095](#wp-095)

**Repository sources**  [media.js](../server/routes/media.js) · [mediaCreatorController.js](../server/controllers/mediaCreatorController.js) · [oxsteedCredit.js](../server/routes/oxsteedCredit.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-061"></a>

**Acceptance for specialists and protected actions** · Page 270 of 393 · AC-061

## Statements permission revoked mid-export

### Setup and action

Start a business statement export under proper authorization and revoke financial access before completion or download.

### Expected result

Collection, query and file delivery follow their protected boundaries. Historical export handles do not give continued rights beyond domain policy. Personal statements remain available.

### Evidence to record

Check generated artifact state, signed URL expiry or revoke behavior, CSV/PDF retrieval, list and search under the two scopes.

**Related work packages**  [WP-087](#wp-087) · [WP-073](#wp-073)

**Repository sources**  [statementCenter.js](../server/routes/statementCenter.js) · [statementExports.js](../server/routes/statementExports.js) · [statementSearch.js](../server/routes/statementSearch.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-062"></a>

**Acceptance for specialists and protected actions** · Page 271 of 393 · AC-062

## Credit cashier and account isolation

### Setup and action

Activate a store-bound cashier in a disposable environment and try spend or top-up from another merchant wallet or location.

### Expected result

Merchant, device, wallet and transaction checks agree. Customer account is separate. No authorization side effect, suspense entry or transfer occurs on rejected operation.

### Evidence to record

Reconcile balances, entries and known idempotency keys, testing the eligible operation independently.

**Related work packages**  [WP-066](#wp-066) · [WP-086](#wp-086) · [WP-060](#wp-060) · [WP-061](#wp-061)

**Repository sources**  [oxsteedCredit.js](../server/routes/oxsteedCredit.js) · [oxsteedCreditKiosk.js](../server/routes/oxsteedCreditKiosk.js) · [restaurants.js](../server/routes/restaurants.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-063"></a>

**Acceptance for specialists and protected actions** · Page 272 of 393 · AC-063

## Payout retry and expired grant

### Setup and action

Create one synthetic payout in an isolated rail. Expire or revoke role before retrying a related command.

### Expected result

Provider requirements and durable payout state guide retries. Forbidden new transfers are denied. Existing acknowledged effects remain singular and accurately represented.

### Evidence to record

Capture transaction provider state, current grant and audit without storing sensitive banking data. Validate wallet, amount and revision guards.

**Related work packages**  [WP-085](#wp-085) · [WP-073](#wp-073)

**Repository sources**  [payoutRoutes.js](../server/routes/payoutRoutes.js) · [restaurantPayouts.js](../server/routes/restaurantPayouts.js) · [tax.js](../server/routes/tax.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-064"></a>

**Acceptance for specialists and protected actions** · Page 273 of 393 · AC-064

## Authorized and unauthorized refund reviewer

### Setup and action

Give agent read or conversation access without refund and give a different reviewer scoped financial authority. Try matching and nonmatching cases.

### Expected result

Case visibility, approved amount and refund state are enforced independently of general application privileges. Only authorized scoped refund succeeds.

### Evidence to record

Capture expected ledger and audit changes under the valid path. Replay and foreign case tests produce no duplicate or out-of-scope compensation.

**Related work packages**  [WP-088](#wp-088) · [WP-029](#wp-029) · [WP-038](#wp-038)

**Repository sources**  [disputes.js](../server/routes/disputes.js) · [agentFoodRefundActions.js](../server/routes/agentFoodRefundActions.js) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-065"></a>

**Acceptance for specialists and protected actions** · Page 274 of 393 · AC-065

## Workforce and capability reviewer separation

### Setup and action

Grant scope-limited access reviewer role and an independent internal governance role to separate people.

### Expected result

Each privileged account can use the right functions in staff tooling. Review grant never gives ability to amend governance or assign itself broader rights.

### Evidence to record

Compare list, mutation, delegation and direct-request outcomes for both identities, including current two-factor requirements.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012) · [WP-089](#wp-089)

**Repository sources**  [workforce.js](../server/routes/workforce.js) · [governance.js](../server/routes/governance.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-066"></a>

**Acceptance for specialists and protected actions** · Page 275 of 393 · AC-066

## Support queue authorization after role removal

### Setup and action

A business support agent claims an eligible conversation and then loses access to that employer while viewing it.

### Expected result

Agent no longer receives private updates or sends new replies where barred. Customer retains own conversation. Another company’s queue remains correctly accessible if authorized.

### Evidence to record

Capture socket membership behavior, API denies, attachment reads, badge counts and audit event scope.

**Related work packages**  [WP-036](#wp-036) · [WP-035](#wp-035)

**Repository sources**  [support.js](../server/routes/support.js) · [supportAgents.js](../server/routes/supportAgents.js) · [supportRouting.js](../server/routes/supportRouting.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-067"></a>

**Acceptance for specialists and protected actions** · Page 276 of 393 · AC-067

## Consent and offer attribution with pending access

### Setup and action

Follow a valid offer link, apply for a capability and defer optional analytics consent. Later change consent and re-open the same application.

### Expected result

Approval functionality and consent lifecycle remain independent. Purpose-bound telemetry and attribution respect stored consent. User does not get outreach merely because an application was approved.

### Evidence to record

Inspect safe test event counts and campaign states before/after. Verify consent and request events cannot impersonate each other.

**Related work packages**  [WP-097](#wp-097) · [WP-021](#wp-021) · [WP-092](#wp-092) · [WP-102](#wp-102)

**Repository sources**  [activity.js](../server/routes/activity.js) · [referrals.js](../server/routes/referrals.js) · [consent.js](../server/routes/consent.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-068"></a>

**Acceptance for specialists and protected actions** · Page 277 of 393 · AC-068

## Connector loses organization scope

### Setup and action

Use a legitimate connector tied to an organization, revoke its grant, and separately approve a human member for a new task at that organization.

### Expected result

Human grant cannot silently revive a connector. Revocation stops newly forbidden calls for the machine credential. Authorized data sync for a separate partner remains intact.

### Evidence to record

Validate request failures with the revoked connector and safe output with the approved human. Audit links point to the expected principal and access mechanism.

**Related work packages**  [WP-093](#wp-093) · [WP-097](#wp-097)

**Repository sources**  [connector.js](../server/routes/connector.js) · [partners.js](../server/routes/partners.js) · [apiProducts.js](../server/routes/apiProducts.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-069"></a>

**Acceptance for specialists and protected actions** · Page 278 of 393 · AC-069

## Read-only issued report on closed entity

### Setup and action

Close or delete an entity under domain rules that retain certain records. Compare a person formerly affiliated and an independent current auditor.

### Expected result

Future writes are denied and historical access follows authorized retention and audit policy. Permanent records and private artifacts remain associated with their original subject.

### Evidence to record

Check scoped list, export, by-ID read, and a synthetic historical invoice or statement audit pointer.

**Related work packages**  [WP-021](#wp-021) · [WP-087](#wp-087)

**Repository sources**  [statementArchive.js](../server/routes/statementArchive.js) · [scopeModel.js](../server/services/scopeModel.js) · [privacy.js](../server/routes/privacy.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-070"></a>

**Acceptance for specialists and protected actions** · Page 279 of 393 · AC-070

## Expiry during deferred asynchronous work

### Setup and action

Schedule a synthetic domain action with current auth, then let access expire before worker execution. Replay the same job payload.

### Expected result

Worker uses the documented distinction between accepted obligations and fresh initiated actions. It emits audited outcome or recovery exactly once. Other sent notifications and invoices retain state.

### Evidence to record

Record job intent type, grant expiry, DB/provisioning outcome and bounded retry behavior for accepted and not-yet-accepted work.

**Related work packages**  [WP-020](#wp-020) · [WP-054](#wp-054) · [WP-099](#wp-099)

**Repository sources**  [adminMessageOutbox.js](../server/routes/adminMessageOutbox.js) · [businessRecurringBilling.js](../server/routes/businessRecurringBilling.js) · [auxiliaryWorkers.js](../server/bootstrap/auxiliaryWorkers.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-071"></a>

**Acceptance for specialists and protected actions** · Page 280 of 393 · AC-071

## Launch and action permissions combination

### Setup and action

For a flag-gated capability, establish approved access and run flag on and off independently. Repeat with a pending application.

### Expected result

Access alone cannot reveal a disabled branch’s private data. Open branch does not grant a pending applicant the ability to act. Child endpoints use the intended equivalent policy.

### Evidence to record

Record flag and capability matrix for eligible and ineligible viewers. Test deep links and direct requests alongside navigation hiding.

**Related work packages**  [WP-041](#wp-041) · [WP-079](#wp-079) · [WP-080](#wp-080) · [WP-081](#wp-081)

**Repository sources**  [launchGate.js](../server/middleware/launchGate.js) · [launchScope.js](../client/src/utils/launchScope.js) · [logistics.js](../server/routes/logistics.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-072"></a>

**Acceptance for specialists and protected actions** · Page 281 of 393 · AC-072

## Entity publisher ownership transfer

### Setup and action

Transfer a test business or restaurant according to approved policy while former owner has a draft and new owner first signs in.

### Expected result

Existing public attribution and legal entity history are preserved. Active management and publisher authority follow current canonical ownership and policies. Review private draft access explicitly.

### Evidence to record

Attempt publication and edits on both sessions. Compare actor IDs, membership updates, audit and public content before/after transfer.

**Related work packages**  [WP-008](#wp-008) · [WP-009](#wp-009) · [WP-048](#wp-048)

**Repository sources**  [mediaController.js](../server/controllers/mediaController.js) · [scopeModel.js](../server/services/scopeModel.js) · [businessTeam.js](../server/routes/businessTeam.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-073"></a>

**Acceptance for specialists and protected actions** · Page 282 of 393 · AC-073

## Account closure and unusable pending attachments

### Setup and action

Close the account holding a pending request with protected test attachments. Attempt reviewer action and applicant access after closure.

### Expected result

No new authority can activate for the closed actor. Evidence moves through the approved retention lifecycle. A different person’s linked business access remains unaffected.

### Evidence to record

Record final request and effective grant state plus authorized retention disposition. Test re-signup with old email through approved account lifecycle rules.

**Related work packages**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012) · [WP-021](#wp-021)

**Repository sources**  [privacy.js](../server/routes/privacy.js) · [storage.js](../server/routes/storage.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-074"></a>

**Acceptance for release and reliability** · Page 283 of 393 · AC-074

## Mixed application versions during migration

### Setup and action

Run pre-change and new application server variants against the additive migrated fixture database. Connect matching and older browser or supported API clients.

### Expected result

Old supported calls parse compatible data. New endpoints handle missing projection where planned and enforce new capability rules only for the correct flag. No variant loses original work.

### Evidence to record

Record each app SHA, schema, flag combination and client version. Use exact target startup and migration test runs.

**Repository sources**  [ci.yml](../.github/workflows/ci.yml) · [migrate.js](../server/migrate.js) · [package.json](../client/package.json)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-075"></a>

**Acceptance for release and reliability** · Page 284 of 393 · AC-075

## Database upgrade and repeat

### Setup and action

Migrate clean disposable DB and clone of previous-version schema. Repeat runner after success and interruption, including failed new statement.

### Expected result

Applied migrations stay byte-immutable. New changes install once in correct order. Scoped constraint names work with another same-named table in other schema.

### Evidence to record

Record counts, exact migrated filenames, constraint/index existence, repeated run result and appropriate rollback evidence.

**Repository sources**  [migrate.js](../server/migrate.js) · [migrationOrder.js](../server/migrationOrder.js) · [check-migration-history.cjs](../scripts/check-migration-history.cjs)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-076"></a>

**Acceptance for release and reliability** · Page 285 of 393 · AC-076

## Backfill twice with preexisting approval

### Setup and action

Seed helper, owner, membership, expired, unusual, and suspended legacy fixtures, plus several new access decisions. Run proposed backfill twice.

### Expected result

Grants and exceptions derive from the approved evidence mapping. Subsequent replays are stable. Explicit new approval, revocation and expiry remain authoritative.

### Evidence to record

Compare normalized before and after snapshot and two runs' row counts. Log only counts or synthetic identifiers.

**Repository sources**  [helperOnboarding.js](../server/services/helperOnboarding.js) · [scopeModel.js](../server/services/scopeModel.js) · [272_mode_platform_approvals.sql](../server/migrations/272_mode_platform_approvals.sql)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-077"></a>

**Acceptance for release and reliability** · Page 286 of 393 · AC-077

## Interrupted backfill during revoke

### Setup and action

Stop backfill after partial checkpoint, revoke one eligible record, and resume in the presence of a concurrent membership creation.

### Expected result

Final grant follows deterministic compatibility rules and newer revocation. Sources have durable checkpoints and scope provenance. Multiple executions do not resurrect permission.

### Evidence to record

Verify exact affected record counts, logged exception path, checkpoint position and effective permission truth after retry.

**Repository sources**  [migrate.js](../server/migrate.js) · [scopeModel.js](../server/services/scopeModel.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-078"></a>

**Acceptance for release and reliability** · Page 287 of 393 · AC-078

## Mode-role shadow divergence triage

### Setup and action

Feed actor fixtures where former role implies more access than current scoped evidence and where approved authority enables an extra same-account action.

### Expected result

Shadow comparisons leave live authorization unchanged. Differences are classified and traced to policy, missing data, or defect. No raw evidence appears in telemetry.

### Evidence to record

Capture safe mismatch codes and opportunity for separate response verification, including an allowed-after-cutover case.

**Repository sources**  [auth.js](../server/middleware/auth.js) · [modeRole.js](../server/utils/modeRole.js) · [scopeGates.js](../server/middleware/scopeGates.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-079"></a>

**Acceptance for release and reliability** · Page 288 of 393 · AC-079

## Feature rollback after approvals

### Setup and action

Enable pilot and create an approval followed by a targeted revoke. Disable the new UI or switch authorizer route under proposed rollback policy.

### Expected result

Customer features continue, request data remains, and revoked rights stay revoked or properly frozen. Rollback does not reset balances or erase decisions.

### Evidence to record

Record flags, effective access, decisions, audit, and outcome for old client and current client. Restore feature and verify current state.

**Repository sources**  [launchGate.js](../server/middleware/launchGate.js) · [deployment-ci.md](../docs/deployment-ci.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-080"></a>

**Acceptance for release and reliability** · Page 289 of 393 · AC-080

## Short outage during access projection

### Setup and action

Simulate slow DB or a service unavailable response after valid login. Open ordinary Home and a protected approval action.

### Expected result

Existing verified identity and allowed offline or ordinary content recover as defined. The mutating action cannot fail open or clear a valid session due to a projection-only error.

### Evidence to record

Capture API status, UI recovery text, preserved draft and successful retry. Distinguish from an intentional credential expiry.

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [auth.js](../server/middleware/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-081"></a>

**Acceptance for release and reliability** · Page 290 of 393 · AC-081

## Double-session refresh race

### Setup and action

Force refresh in two tabs during a sign out or password change and deliver a late capability invalidation response.

### Expected result

Transport coordinator preserves actual auth boundaries. Stale cookies and grants are not accepted by the next identity. Distinct expiry UX survives.

### Evidence to record

Capture browser network order and resulting session validity. Run with same user and separate user sign-in transitions.

**Repository sources**  [authSessionEpoch.js](../client/src/api/authSessionEpoch.js) · [session-cookie-ordering-2026-11-04.md](../docs/reviews/session-cookie-ordering-2026-11-04.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-082"></a>

**Acceptance for release and reliability** · Page 291 of 393 · AC-082

## Old client with role hint and scoped grant

### Setup and action

Request an old client's login and switching sequences using saved legacy role values. Use personal and granted entity operations via legacy aliases.

### Expected result

Compatibility response remains supported where agreed. State changes satisfy current capability and tenant checks. Old hints cannot create access or overwrite a new grant.

### Evidence to record

Test exact legacy request and response fields, protected denial and existing authorized grant. Note version supporting the new contract.

**Related work packages**  [WP-013](#wp-013) · [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003)

**Repository sources**  [mobile.js](../server/routes/mobile.js) · [auth.js](../server/routes/auth.js) · [authController.js](../server/controllers/authController.js#L2604)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-083"></a>

**Acceptance for release and reliability** · Page 292 of 393 · AC-083

## Old and new aliases for the same resource

### Setup and action

Resolve route mounts and statically mapped aliases in the working version. Exercise both paths for an allow, an unapproved actor, and a foreign subject.

### Expected result

Equivalent authorized endpoints protect the same resource and use consistent scope. Reviewed public exceptions remain intentionally reachable.

### Evidence to record

Record concrete prefixed URLs and handler links. Include failure status, number of side effects, and any accepted response shape difference.

**Related work packages**  [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062) · [WP-063](#wp-063)

**Repository sources**  [index.js](../server/index.js) · [food.js](../server/routes/food.js) · [restaurants.js](../server/routes/restaurants.js) · [routeScopeGuard.test.js](../server/__tests__/routeScopeGuard.test.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-084"></a>

**Acceptance for release and reliability** · Page 293 of 393 · AC-084

## Synchronized access refresh without private leak

### Setup and action

Emit scoped grant changes from several simultaneous reviews. Keep many browser tabs for applicant and a reviewer with different subjects.

### Expected result

Clients update only relevant projections and keep unrelated UI state. Batch or debounce limits load without ignoring revocation. Cross-user channel messages contain only approved safe metadata.

### Evidence to record

Record refresh counts, affected scope, bounded revalidation time and negative access proof on next sensitive write.

**Related work packages**  [WP-014](#wp-014) · [WP-047](#wp-047)

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [meWorkspace.js](../server/routes/meWorkspace.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-085"></a>

**Acceptance for release and reliability** · Page 294 of 393 · AC-085

## Optional-auth public route and blocked content

### Setup and action

Compare guest, blocked visitor, approved publisher, and unknown token across public catalog and moderation hold states.

### Expected result

Optional authorization preserves visibility filtering for known viewers and public behavior for proper guests. Access projection cannot override a hold, mutual block, or scope.

### Evidence to record

Record cache headers, safe response shapes and denied unpublished data read with both active and malformed session.

**Related work packages**  [WP-024](#wp-024) · [WP-042](#wp-042) · [WP-043](#wp-043) · [WP-095](#wp-095)

**Repository sources**  [auth.js](../server/middleware/auth.js) · [media.js](../server/routes/media.js) · [discover.js](../server/routes/discover.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-086"></a>

**Acceptance for release and reliability** · Page 295 of 393 · AC-086

## Limited reviewer evidence export

### Setup and action

As a scoped reviewer request bulk list, file export or downloadable evidence across scopes. Change filters and pagination parameters.

### Expected result

Accessible cases stay within grant and audience. Counts, cursors and filenames do not leak unrelated cases. A restricted admin cannot bypass through a single ID lookup.

### Evidence to record

Verify joins, DB fixture rows, edge-page boundaries, revoked link behavior and captured role metadata in test audit.

**Related work packages**  [WP-021](#wp-021) · [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

**Repository sources**  [privacy.js](../server/routes/privacy.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [adminAuth.js](../server/middleware/adminAuth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-087"></a>

**Acceptance for release and reliability** · Page 296 of 393 · AC-087

## Unauthorized access attempts and rate limits

### Setup and action

Send many malformed and repeated submissions and decisions to the new route boundaries, mixing authorized and unauthorized IDs.

### Expected result

Valid users get established limits and useful retry semantics. Decision endpoints retain authorization. Requests and errors do not leak hidden account or entity existence.

### Evidence to record

Count persisted transitions, log reason categories and only expected denied results. Recheck normal applicant flow after reset.

**Related work packages**  [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003) · [WP-004](#wp-004)

**Repository sources**  [auth.js](../server/routes/auth.js) · [modePlatformApprovals.js](../server/routes/modePlatformApprovals.js) · [auth.js](../server/middleware/auth.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-088"></a>

**Acceptance for release and reliability** · Page 297 of 393 · AC-088

## Production readiness is candidate-specific

### Setup and action

After staging rollout, compare running image, schema, startup and worker readiness to the reviewed commit. Warm supported browser versions.

### Expected result

Release evidence identifies the actual new candidate. Old healthy deployment or static asset alone cannot satisfy acceptance. Ready workers can process new requests with current migrations.

### Evidence to record

Save exact timestamps, build identity, ready checks and authorized smoke results. Verify rollback trigger and owner recorded.

**Repository sources**  [RUNBOOK.md](../RUNBOOK.md) · [deployment-ci.md](../docs/deployment-ci.md) · [web-image.yml](../.github/workflows/web-image.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-089"></a>

**Acceptance for release and reliability** · Page 298 of 393 · AC-089

## Capability request latency under load

### Setup and action

Generate synthetic simultaneous account boots, tenant page reads, and review operations with appropriate distribution of grants.

### Expected result

Access lookups and invalidations remain bounded. Indexed queries scope queues properly. Slowdowns prompt refinement without bypassing authorization or caching across user boundaries.

### Evidence to record

Capture read/write p50 and p95, database timings, pool usage, representative queries, sample sizes and the chosen acceptable limits.

**Repository sources**  [scopeModel.js](../server/services/scopeModel.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js) · [ci.yml](../.github/workflows/ci.yml)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-090"></a>

**Acceptance for release and reliability** · Page 299 of 393 · AC-090

## Realtime revocation and reconnect

### Setup and action

Subscribe to a permitted entity stream and keep a connection alive. Revoke access, emit a new event, and reconnect.

### Expected result

No newly private data reaches removed subscriber. Reconnect checks current authority. Other personal or different entity subscriptions continue as permitted.

### Evidence to record

Test both server messages and UI updates with timestamps. Include missed invalidation and connection restore behavior.

**Related work packages**  [WP-034](#wp-034) · [WP-035](#wp-035) · [WP-050](#wp-050)

**Repository sources**  [mediaNamespace.js](../server/realtime/mediaNamespace.js) · [messages.js](../server/routes/messages.js) · [support.js](../server/routes/support.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-091"></a>

**Acceptance for release and reliability** · Page 300 of 393 · AC-091

## Explicit actor selection for a financial action

### Setup and action

Give a fixture one person account and multiple eligible merchant contexts. Open a payment using one context, change another tab’s selection, and confirm.

### Expected result

Confirmation uses the exact originally selected and revalidated account. Stale or unreadable account requires deliberate recovery. Amount and currency remain correct.

### Evidence to record

Capture confirmation label, payee and attributed record. Check no charge or statement association for unintended account.

**Related work packages**  [WP-073](#wp-073) · [WP-084](#wp-084) · [WP-086](#wp-086) · [WP-087](#wp-087)

**Repository sources**  [qrPayments.js](../server/routes/qrPayments.js) · [statementCenter.js](../server/routes/statementCenter.js) · [oxsteedCredit.js](../server/routes/oxsteedCredit.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-092"></a>

**Acceptance for release and reliability** · Page 301 of 393 · AC-092

## Applicant receives approval during checkout

### Setup and action

Leave a customer checkout on its confirmation step. Approve Helper from reviewer session and refresh access before final submission.

### Expected result

Checkout remains intact and amount, buyer identity, and cart are unchanged. Provider action appears in its relevant context. Approval notification can be dismissed appropriately.

### Evidence to record

Record draft and checkout state, completed order or synthetic payment, no duplicate event on reload and available helper action.

**Related work packages**  [WP-040](#wp-040) · [WP-020](#wp-020)

**Repository sources**  [AuthContext.jsx](../client/src/context/AuthContext.jsx) · [cartCheckout.js](../server/routes/cartCheckout.js) · [notifications.js](../server/routes/notifications.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-093"></a>

**Acceptance for release and reliability** · Page 302 of 393 · AC-093

## Policy offline retriable case

### Setup and action

Fail policy lookup while the person attempts a currently gated action, then recover service.

### Expected result

Protected domain action remains closed while verification is unavailable. User sees a recoverable state and can retry with its original request safely after service returns.

### Evidence to record

Capture status and retry evidence, no first mutation and one later eligible mutation. Test the same in an admin queue.

**Repository sources**  [requirePlatformApproval.js](../server/middleware/requirePlatformApproval.js) · [modePlatformApprovalService.js](../server/services/modePlatformApprovalService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-094"></a>

**Acceptance for release and reliability** · Page 303 of 393 · AC-094

## Delegation must not outlive its grantor

### Setup and action

Issue permissible delegation, then remove the authority of the account that delegated it and leave target reviewer signed in.

### Expected result

Result follows the owning delegation policy. Dependent privileges cannot be exercised by a stale UI or token after required invalidation. Existing protected cases remain auditable.

### Evidence to record

Save grantor and delegate fixture state, list/detail/decision checks, and unaffected separate scopes. Revalidate after reassigning proper authority.

**Related work packages**  [WP-008](#wp-008) · [WP-009](#wp-009) · [WP-048](#wp-048)

**Repository sources**  [adminAuth.js](../server/middleware/adminAuth.js) · [businessTeam.js](../server/routes/businessTeam.js) · [permissionsService.js](../server/services/permissionsService.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-095"></a>

**Acceptance for release and reliability** · Page 304 of 393 · AC-095

## Small-screen review confirmation

### Setup and action

Review a long entity name and full legal approver warning at narrow viewport with keyboard-only and screen reader flows.

### Expected result

Decision action clearly identifies scope. Focus and status work without hidden confirmation or clipped content. Stale decisions present recovery and keep history accessible.

### Evidence to record

Capture mobile layout, keyboard order and outcome announcement. Repeat in Arabic and a longer Latin-language localization.

**Repository sources**  [ModeApprovals.jsx](../client/src/admin/pages/super/ModeApprovals.jsx) · [product-accessibility-2026-11-03.md](../docs/reviews/product-accessibility-2026-11-03.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-096"></a>

**Acceptance for release and reliability** · Page 305 of 393 · AC-096

## Provider contracts after staged cutover

### Setup and action

Start work before cohort cutover, complete or dispute after it, and compare customer and provider perspectives.

### Expected result

Existing workflow, legal participant record, commitments and authorized monetary state persist. Pilot changes add new capability pathways without rekeying older records.

### Evidence to record

Capture before/after immutable identifiers and full domain outcome in isolated mode, including decline or cancellation and original statement.

**Related work packages**  [WP-029](#wp-029) · [WP-038](#wp-038) · [WP-084](#wp-084) · [WP-088](#wp-088)

**Repository sources**  [workAgreements.js](../server/routes/workAgreements.js) · [payments.js](../server/routes/payments.js) · [disputes.js](../server/routes/disputes.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-097"></a>

**Acceptance for release and reliability** · Page 306 of 393 · AC-097

## Account data deletion from both sides

### Setup and action

Create a staff account also holding customer data and media drafts. Request deletion and run owning retention workflow with shared business records.

### Expected result

Identity closure prevents new authorization. Company-owned records and subject-owned data follow their distinct retention and audit rules. Another employee can continue permitted work.

### Evidence to record

Record counts and actor visibility with retained records, revoked sessions and credential expiry. Confirm ready-to-delete evidence disposed under approved policy.

**Related work packages**  [WP-021](#wp-021) · [WP-008](#wp-008) · [WP-009](#wp-009) · [WP-042](#wp-042)

**Repository sources**  [privacy.js](../server/routes/privacy.js) · [businessTeam.js](../server/routes/businessTeam.js) · [media.js](../server/routes/media.js)

<div style="break-before: page; page-break-before: always;"></div>

<a id="ac-098"></a>

**Acceptance for release and reliability** · Page 307 of 393 · AC-098

## Release completion and parity holdout

### Setup and action

Exercise a verified release with pilot and holdout accounts, at least two scoped organizations, supported old clients and all required locales.

### Expected result

Pilot achieves same-experience access and tenant isolation. Holdouts retain intended stable behavior. Support knows the applicable rollout and fallback state.

### Evidence to record

Attach reproducible automated and staged evidence, approved live checks, flag state, any accepted exceptions and assigned follow-ups.

**Repository sources**  [ci.yml](../.github/workflows/ci.yml) · [RUNBOOK.md](../RUNBOOK.md) · [deployment-ci.md](../docs/deployment-ci.md)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-001"></a>

**Server router inventory** · Page 308 of 393 · API-001

## abTestRoutes through admin

### abTestRoutes

[Router source](../server/routes/abTestRoutes.js) · 8 literal method and path entries

**Mount references**  [`/api/ab-tests`](../server/index.js#L819)

- [`POST /`](../server/routes/abTestRoutes.js#L7) · guards `requireAuth` · handler `ABTestController.createTest`
- [`GET /`](../server/routes/abTestRoutes.js#L10) · guards `requireAuth` · handler `ABTestController.getTests`
- [`GET /:test_id`](../server/routes/abTestRoutes.js#L13) · guards `requireAuth` · handler `ABTestController.getTest`
- [`POST /:test_id/start`](../server/routes/abTestRoutes.js#L16) · guards `requireAuth` · handler `ABTestController.startTest`

### activity

[Router source](../server/routes/activity.js) · 16 literal method and path entries

**Mount references**  [`/api/activity`](../server/index.js#L558)

- [`GET /policy`](../server/routes/activity.js#L43) · guards `generalLimiter, optionalAuth` · handler `handled`
- [`GET /config`](../server/routes/activity.js#L71) · guards `generalLimiter, optionalAuth` · handler `handled`
- [`POST /batch`](../server/routes/activity.js#L128) · guards `optionalAuth`
- [`PUT /preferences`](../server/routes/activity.js#L235) · guards `strictLimiter, authenticate, sameOrigin` · handler `handled`

**Refactor work**  [WP-092](#wp-092)

### admin

[Router source](../server/routes/admin.js) · 387 literal method and path entries

**Mount references**  [`/api/admin`](../server/index.js#L553)

**Detected router middleware**  `requireSuperAdmin`

- [`GET /support/availability`](../server/routes/admin.js#L89) · guards `requireAdmin` · handler `supportCtrl.getMyAvailability`
- [`PUT /support/availability`](../server/routes/admin.js#L90) · guards `requireAdmin` · handler `supportCtrl.setMyAvailability`
- [`POST /moderation-flags/:id/review`](../server/routes/admin.js#L114) · guards `requireAdmin, requirePermission` · handler `moderationCtrl.reviewContentFlag`
- [`PATCH /jobs/:jobId`](../server/routes/admin.js#L123) · guards `requireAdmin, requirePermission, rejectImpersonated` · handler `adminJobEditCtrl.editJob`

**Refactor work**  [WP-100](#wp-100)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-002"></a>

**Server router inventory** · Page 309 of 393 · API-002

## adminFeaturedPlacement through adminMessageOutbox

### adminFeaturedPlacement

[Router source](../server/routes/adminFeaturedPlacement.js) · 6 literal method and path entries

**Mount references**  [`/api/admin/featured-placements`](../server/index.js#L796)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /featured`](../server/routes/adminFeaturedPlacement.js#L18) · handler `ctrl.listFeatured`
- [`GET /`](../server/routes/adminFeaturedPlacement.js#L19) · handler `ctrl.listRequests`
- [`POST /:id/contact`](../server/routes/adminFeaturedPlacement.js#L20) · handler `ctrl.contactRequest`
- [`POST /:id/approve`](../server/routes/adminFeaturedPlacement.js#L21) · handler `ctrl.approveRequest`

### adminFoodOrders

[Router source](../server/routes/adminFoodOrders.js) · 4 literal method and path entries

**Mount references**  [`/api/admin/food-orders`](../server/index.js#L581)

**Detected router middleware**  `requireAdmin`

- [`GET /`](../server/routes/adminFoodOrders.js#L12) · guards `requirePermission` · handler `ctrl.listFoodOrders`
- [`GET /:id`](../server/routes/adminFoodOrders.js#L13) · guards `requirePermission` · handler `ctrl.getFoodOrder`
- [`POST /stepup-challenges/refund`](../server/routes/adminFoodOrders.js#L15) · guards `strictLimiter, rejectImpersonated, requirePermission` · handler `ctrl.issueRefundStepupChallenge`
- [`POST /:id/refund`](../server/routes/adminFoodOrders.js#L16) · guards `strictLimiter, rejectImpersonated, requirePermission` · handler `ctrl.refundFoodOrder`

**Refactor work**  [WP-088](#wp-088)

### adminMessageOutbox

[Router source](../server/routes/adminMessageOutbox.js) · 2 literal method and path entries

**Mount references**  [`/api/admin/message-notification-outbox`](../server/index.js#L797)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /failed`](../server/routes/adminMessageOutbox.js#L15)
- [`POST /retry`](../server/routes/adminMessageOutbox.js#L21) · guards `strictLimiter, rejectImpersonated`

**Refactor work**  [WP-020](#wp-020) · [WP-099](#wp-099)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-003"></a>

**Server router inventory** · Page 310 of 393 · API-003

## adminOperationalNotices through adminProducts

### adminOperationalNotices

[Router source](../server/routes/adminOperationalNotices.js) · 4 literal method and path entries

**Mount references**  [`/api/admin/operational-notices`](../server/index.js#L564)

**Detected router middleware**  `requireAdmin`

- [`GET /notices`](../server/routes/adminOperationalNotices.js#L21) · handler `wrap`
- [`POST /notices/:id/ack`](../server/routes/adminOperationalNotices.js#L44) · handler `wrap`
- [`GET /region-geo-source`](../server/routes/adminOperationalNotices.js#L58) · guards `requirePermission` · handler `wrap`
- [`POST /region-geo-source/dry-run`](../server/routes/adminOperationalNotices.js#L72) · guards `requirePermission` · handler `wrap`

**Refactor work**  [WP-092](#wp-092)

### adminOrders

[Router source](../server/routes/adminOrders.js) · 6 literal method and path entries

**Mount references**  [`/api/admin/orders`](../server/index.js#L801)

**Detected router middleware**  `requireAuth`, `requireAdmin`, `requirePermission`

- [`GET /`](../server/routes/adminOrders.js#L13) · handler `adminOrdersController.getOrders`
- [`GET /stats`](../server/routes/adminOrders.js#L16) · handler `adminOrdersController.getOrderStats`
- [`GET /:orderId`](../server/routes/adminOrders.js#L19) · handler `adminOrdersController.getOrder`
- [`POST /:orderId/mark-shipped`](../server/routes/adminOrders.js#L22) · handler `adminOrdersController.markShipped`

### adminProducts

[Router source](../server/routes/adminProducts.js) · 5 literal method and path entries

**Mount references**  [`/api/admin/products`](../server/index.js#L802)

- [`POST /`](../server/routes/adminProducts.js#L8) · guards `requireAuth, requireAdmin, requirePermission` · handler `adminProductsController.createProduct`
- [`PUT /:productId`](../server/routes/adminProducts.js#L9) · guards `requireAuth, requireAdmin, requirePermission` · handler `adminProductsController.updateProduct`
- [`DELETE /:productId`](../server/routes/adminProducts.js#L10) · guards `requireAuth, requireAdmin, requirePermission` · handler `adminProductsController.deleteProduct`
- [`GET /stats`](../server/routes/adminProducts.js#L12) · guards `requireAuth, requireAdmin, requirePermission` · handler `adminProductsController.getProductStats`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-004"></a>

**Server router inventory** · Page 311 of 393 · API-004

## adminRestaurantMedia through adminRestaurantPayRuns

### adminRestaurantMedia

[Router source](../server/routes/adminRestaurantMedia.js) · 3 literal method and path entries

**Mount references**  [`/api/admin/restaurant-media`](../server/index.js#L798)

**Detected router middleware**  `requireAdmin`

- [`GET /flags`](../server/routes/adminRestaurantMedia.js#L20) · guards `contentGate` · handler `ctrl.adminListMediaFlags`
- [`POST /media/:mediaId/restore`](../server/routes/adminRestaurantMedia.js#L21) · guards `contentGate` · handler `ctrl.adminRestoreMedia`
- [`POST /flags/:flagId/review`](../server/routes/adminRestaurantMedia.js#L26) · guards `contentGate`

### adminRestaurantPayouts

[Router source](../server/routes/adminRestaurantPayouts.js) · 6 literal method and path entries

**Mount references**  [`/api/admin/restaurant-payouts`](../server/index.js#L794)

**Detected router middleware**  `requireAdmin`

- [`GET /`](../server/routes/adminRestaurantPayouts.js#L21) · guards `moneyGate` · handler `ctrl.listQueue`
- [`POST /stepup-challenges`](../server/routes/adminRestaurantPayouts.js#L23) · guards `moneyGate` · handler `ctrl.issueApproveStepupChallenge`
- [`POST /:payoutId/approve`](../server/routes/adminRestaurantPayouts.js#L25) · guards `moneyGate, rejectImpersonated` · handler `ctrl.approve`
- [`POST /:payoutId/reject`](../server/routes/adminRestaurantPayouts.js#L26) · guards `moneyGate, rejectImpersonated` · handler `ctrl.reject`

### adminRestaurantPayRuns

[Router source](../server/routes/adminRestaurantPayRuns.js) · 2 literal method and path entries

**Mount references**  [`/api/admin/restaurant-pay-runs`](../server/index.js#L795)

**Detected router middleware**  `requireAdmin`

- [`GET /`](../server/routes/adminRestaurantPayRuns.js#L15) · guards `moneyGate` · handler `ctrl.listPayRuns`
- [`GET /:payRunId`](../server/routes/adminRestaurantPayRuns.js#L16) · guards `moneyGate` · handler `ctrl.getPayRun`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-005"></a>

**Server router inventory** · Page 312 of 393 · API-005

## adminRestaurantSupport through affiliatePayouts

### adminRestaurantSupport

[Router source](../server/routes/adminRestaurantSupport.js) · 11 literal method and path entries

**Mount references**  [`/api/admin/restaurants/support`](../server/index.js#L785)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /cases`](../server/routes/adminRestaurantSupport.js#L11) · handler `ctrl.adminListCases`
- [`GET /cases/:caseId`](../server/routes/adminRestaurantSupport.js#L12) · handler `ctrl.adminGetCase`
- [`POST /cases/:caseId/messages`](../server/routes/adminRestaurantSupport.js#L13) · handler `ctrl.adminAddMessage`
- [`POST /cases/:caseId/assign`](../server/routes/adminRestaurantSupport.js#L14) · handler `ctrl.adminAssign`

### adminRestaurantTopups

[Router source](../server/routes/adminRestaurantTopups.js) · 8 literal method and path entries

**Mount references**  [`/api/admin/restaurant-topups`](../server/index.js#L793)

**Detected router middleware**  `requireAdmin`

- [`GET /applications`](../server/routes/adminRestaurantTopups.js#L26) · guards `moneyGate` · handler `ctrl.listApplications`
- [`GET /topups/:topupId`](../server/routes/adminRestaurantTopups.js#L30) · guards `moneyGate` · handler `ctrl.getTopup`
- [`POST /stepup-challenges/approve`](../server/routes/adminRestaurantTopups.js#L31) · guards `moneyGate, strictLimiter, rejectImpersonated` · handler `issueAdminActionStepup`
- [`POST /stepup-challenges/clawback`](../server/routes/adminRestaurantTopups.js#L32) · guards `moneyGate, strictLimiter, rejectImpersonated` · handler `issueAdminActionStepup`

### affiliatePayouts

[Router source](../server/routes/affiliatePayouts.js) · 16 literal method and path entries

**Mount references**  [`/api/affiliate`](../server/index.js#L818)

- [`GET /stats/all`](../server/routes/affiliatePayouts.js#L21) · guards `requireAuth` · handler `affiliatePayoutsController.getAffiliateStats`
- [`GET /schedule`](../server/routes/affiliatePayouts.js#L24) · guards `requireAuth` · handler `affiliatePayoutsController.getPayoutsSchedule`
- [`GET /payouts`](../server/routes/affiliatePayouts.js#L29) · guards `requireAdmin, rejectImpersonated, requirePermission` · handler `affiliatePayoutsController.listAdminPayouts`
- [`POST /calculate`](../server/routes/affiliatePayouts.js#L36) · guards `strictLimiter, requireAuth` · handler `affiliatePayoutsController.calculateAndCreatePayout`

**Refactor work**  [WP-097](#wp-097)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-006"></a>

**Server router inventory** · Page 313 of 393 · API-006

## agentBookingActions through agentFoodRefundActions

### agentBookingActions

[Router source](../server/routes/agentBookingActions.js) · 1 literal method and path entries

**Mount references**  [`/api/agent/bookings`](../server/index.js#L584)

- [`POST /:bookingId/cancel`](../server/routes/agentBookingActions.js#L24) · guards `strictLimiter, requireAuth, requireAdmin, requirePermission` · handler `agentBookingActions.cancelBooking`

### agentCreditAdjustments

[Router source](../server/routes/agentCreditAdjustments.js) · 6 literal method and path entries

**Mount references**  [`/api/agent`](../server/index.js#L582)

**Detected router middleware**  `requireAdmin`

- [`GET /credit-adjustments/pending`](../server/routes/agentCreditAdjustments.js#L15) · guards `moneyGate` · handler `controller.listPendingAdjustments`
- [`POST /credit-adjustments`](../server/routes/agentCreditAdjustments.js#L16) · guards `moneyGate` · handler `controller.proposeAdjustment`
- [`POST /credit-adjustments/stepup-challenges`](../server/routes/agentCreditAdjustments.js#L21) · guards `moneyGate` · handler `controller.issueApprovalStepupChallenge`
- [`POST /credit-adjustments/:id/approve`](../server/routes/agentCreditAdjustments.js#L22) · guards `moneyGate` · handler `controller.approveAdjustment`

**Refactor work**  [WP-088](#wp-088)

### agentFoodRefundActions

[Router source](../server/routes/agentFoodRefundActions.js) · 1 literal method and path entries

**Mount references**  [`/api/agent`](../server/index.js#L583)

**Detected router middleware**  `requireAuth`, `requireAdmin`

- [`POST /food-orders/:id/refund`](../server/routes/agentFoodRefundActions.js#L19) · guards `strictLimiter, rejectImpersonated, requirePermission` · handler `agentFoodRefundActions.refundFoodOrder`

**Refactor work**  [WP-088](#wp-088)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-007"></a>

**Server router inventory** · Page 314 of 393 · API-007

## agentJobActions through appVersion

### agentJobActions

[Router source](../server/routes/agentJobActions.js) · 2 literal method and path entries

**Mount references**  [`/api/admin`](../server/index.js#L554)

- [`POST /stepup-challenges/agent-job-cancel`](../server/routes/agentJobActions.js#L24) · guards `strictLimiter, requireAdmin, rejectImpersonated, requirePermission` · handler `agentJobActions.issueAgentJobCancelStepupChallenge`
- [`POST /jobs/:jobId/cancel`](../server/routes/agentJobActions.js#L33) · guards `strictLimiter, requireAdmin, requirePermission` · handler `agentJobActions.cancelJobAsAgent`

### apiProducts

[Router source](../server/routes/apiProducts.js) · 9 literal method and path entries

**Mount references**  [`/api/api-products`](../server/index.js#L816)

- [`POST /`](../server/routes/apiProducts.js#L8) · guards `requireAuth` · handler `apiProductsController.createApiProduct`
- [`GET /creator/all`](../server/routes/apiProducts.js#L9) · guards `requireAuth` · handler `apiProductsController.getCreatorApiProducts`
- [`POST /:productId/publish`](../server/routes/apiProducts.js#L10) · guards `requireAuth` · handler `apiProductsController.publishApiProduct`
- [`GET /:productId`](../server/routes/apiProducts.js#L13) · handler `apiProductsController.getApiProduct`

**Refactor work**  [WP-093](#wp-093)

### appVersion

[Router source](../server/routes/appVersion.js) · 2 literal method and path entries

**Mount references**  [`/api/app-version`](../server/index.js#L656)

- [`GET /ios`](../server/routes/appVersion.js#L22)
- [`GET /android`](../server/routes/appVersion.js#L34)

**Refactor work**  [WP-098](#wp-098)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-008"></a>

**Server router inventory** · Page 315 of 393 · API-008

## auth through bids

### auth

[Router source](../server/routes/auth.js) · 33 literal method and path entries

**Mount references**  [`/api/auth`](../server/index.js#L540)

- [`POST /login`](../server/routes/auth.js#L41) · guards `loginLimiter` · handler `login`
- [`GET /internal-access/config`](../server/routes/auth.js#L45) · guards `strictLimiter` · handler `logisticsInternalAccessCtrl.getRouteConfig`
- [`PUT /profile`](../server/routes/auth.js#L82) · guards `authLimiter, authenticate` · handler `updateProfile`
- [`PATCH /me`](../server/routes/auth.js#L83) · guards `authLimiter, authenticate` · handler `updateProfile`

**Refactor work**  [WP-001](#wp-001) · [WP-002](#wp-002) · [WP-003](#wp-003) · [WP-004](#wp-004) · [WP-005](#wp-005)

### beautyOperations

[Router source](../server/routes/beautyOperations.js) · 11 literal method and path entries

**Mount references**  [`/api/beauty-operations`](../server/index.js#L735)

- [`GET /public/:businessId`](../server/routes/beautyOperations.js#L14) · guards `scopeExempt` · handler `controller.getPublicWorkspace`
- [`POST /public/:businessId/intakes`](../server/routes/beautyOperations.js#L15) · guards `publicIntakeLimiter, generalLimiter, upload.array, validateFileUpload` · handler `controller.createIntakeRequest`
- [`PUT /business/:businessId/settings`](../server/routes/beautyOperations.js#L18) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.updateSettings`
- [`DELETE /business/:businessId/packages/:packageId`](../server/routes/beautyOperations.js#L23) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.deletePackage`

**Refactor work**  [WP-058](#wp-058)

### bids

[Router source](../server/routes/bids.js) · 8 literal method and path entries

**Mount references**  [`/api/bids`](../server/index.js#L545)

- [`GET /recent`](../server/routes/bids.js#L13) · guards `generalLimiter` · handler `getRecentBids`
- [`GET /me`](../server/routes/bids.js#L16) · guards `authenticate` · handler `getMyBids`
- [`PUT /:id`](../server/routes/bids.js#L19) · guards `authenticate` · handler `updateBid`
- [`POST /:id/withdraw`](../server/routes/bids.js#L20) · guards `authenticate` · handler `withdrawBid`

**Refactor work**  [WP-026](#wp-026)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-009"></a>

**Server router inventory** · Page 316 of 393 · API-009

## bookings through businessCustomer360

### bookings

[Router source](../server/routes/bookings.js) · 18 literal method and path entries

**Mount references**  [`/api/bookings`](../server/index.js#L731)

- [`POST /`](../server/routes/bookings.js#L12) · guards `requireAuth, requireEmailVerified, requireTermsAcceptance` · handler `bookingController.createBookingRequest`
- [`GET /`](../server/routes/bookings.js#L13) · guards `requireAuth` · handler `bookingController.getMyBookingRequests`
- [`GET /incoming`](../server/routes/bookings.js#L14) · guards `requireAuth` · handler `bookingController.getIncomingBookingRequests`
- [`GET /recurring`](../server/routes/bookings.js#L17) · guards `requireAuth` · handler `bookingController.listRecurringBookings`

**Refactor work**  [WP-027](#wp-027) · [WP-065](#wp-065)

### broadcastTracking

[Router source](../server/routes/broadcastTracking.js) · 5 literal method and path entries

**Mount references**  [`/api/broadcast-tracking`](../server/index.js#L599)

- [`GET /o/:token`](../server/routes/broadcastTracking.js#L6) · handler `ctrl.emailOpen`
- [`POST /p/:token`](../server/routes/broadcastTracking.js#L7)
- [`GET /c/:token/:index`](../server/routes/broadcastTracking.js#L15) · handler `ctrl.click`
- [`GET /u/:token`](../server/routes/broadcastTracking.js#L16) · handler `ctrl.unsubscribePage`

### businessCustomer360

[Router source](../server/routes/businessCustomer360.js) · 2 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L604)

- [`GET /:businessId/customer360/customers`](../server/routes/businessCustomer360.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.list`
- [`GET /:businessId/customer360/customers/:customerKey`](../server/routes/businessCustomer360.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.profile`

**Refactor work**  [WP-051](#wp-051)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-010"></a>

**Server router inventory** · Page 317 of 393 · API-010

## businesses through businessHealthAlerts

### businesses

[Router source](../server/routes/businesses.js) · 91 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L589)

- [`GET /invoices/public/:token`](../server/routes/businesses.js#L76) · handler `getPublicInvoice`
- [`POST /vortex/redeem`](../server/routes/businesses.js#L79) · guards `authenticate, rejectImpersonated, requireVortexEnabled, vortexRedeemLimiter` · handler `redeemToken`
- [`PUT /:id/slug`](../server/routes/businesses.js#L102) · guards `authenticate, bizIdAccess`
- [`PATCH /:id`](../server/routes/businesses.js#L112) · guards `authenticate, bizIdAccess` · handler `updateBusiness`

**Refactor work**  [WP-046](#wp-046)

### businessFinance

[Router source](../server/routes/businessFinance.js) · 17 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L593)

- [`GET /:businessId/expenses`](../server/routes/businessFinance.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `expenses.listExpenses`
- [`POST /:businessId/expenses`](../server/routes/businessFinance.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `expenses.createExpense`
- [`PUT /:businessId/expenses/:expenseId`](../server/routes/businessFinance.js#L12) · guards `requireAuth, requireBusinessAccess` · handler `expenses.updateExpense`
- [`DELETE /:businessId/expenses/:expenseId`](../server/routes/businessFinance.js#L13) · guards `requireAuth, requireBusinessAccess` · handler `expenses.deleteExpense`

**Refactor work**  [WP-054](#wp-054)

### businessHealthAlerts

[Router source](../server/routes/businessHealthAlerts.js) · 3 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L602)

- [`GET /:businessId/health-alerts`](../server/routes/businessHealthAlerts.js#L7) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listAlerts`
- [`POST /:businessId/health-alerts/generate`](../server/routes/businessHealthAlerts.js#L8) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.generateAlerts`
- [`POST /:businessId/health-alerts/:alertId/dismiss`](../server/routes/businessHealthAlerts.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.dismissAlert`

**Refactor work**  [WP-059](#wp-059)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-011"></a>

**Server router inventory** · Page 318 of 393 · API-011

## businessIntegrations through businessLeadPipeline

### businessIntegrations

[Router source](../server/routes/businessIntegrations.js) · 11 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L608)

- [`GET /:businessId/integrations`](../server/routes/businessIntegrations.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.getIntegrations`
- [`POST /:businessId/webhooks`](../server/routes/businessIntegrations.js#L27) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createWebhook`
- [`DELETE /:businessId/webhooks/:webhookId`](../server/routes/businessIntegrations.js#L35) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deleteWebhook`
- [`PATCH /:businessId/integrations/:integrationType`](../server/routes/businessIntegrations.js#L51) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateIntegration`

**Refactor work**  [WP-056](#wp-056)

### businessLaunch

[Router source](../server/routes/businessLaunch.js) · 15 literal method and path entries

**Mount references**  [`/api/consulting/business-launch`](../server/index.js#L686)

- [`POST /submit`](../server/routes/businessLaunch.js#L27) · guards `generalLimiter` · handler `submitBusinessLaunchRequest`
- [`GET /my-requests`](../server/routes/businessLaunch.js#L34) · guards `authenticate` · handler `getUserBusinessLaunchRequests`
- [`PATCH /requests/:id`](../server/routes/businessLaunch.js#L82) · guards `authenticate, requireAdmin, requirePermission` · handler `updateBusinessLaunchRequestStatus`
- [`DELETE /notes/:noteId`](../server/routes/businessLaunch.js#L111) · guards `authenticate, requireAdmin, requirePermission` · handler `deleteNote`

**Refactor work**  [WP-076](#wp-076)

### businessLeadPipeline

[Router source](../server/routes/businessLeadPipeline.js) · 4 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L606)

- [`GET /:businessId/lead-pipeline`](../server/routes/businessLeadPipeline.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listLeads`
- [`PATCH /:businessId/lead-pipeline/:id`](../server/routes/businessLeadPipeline.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateLead`
- [`PATCH /:businessId/lead-pipeline/:id/notes`](../server/routes/businessLeadPipeline.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.addNote`
- [`POST /:businessId/lead-pipeline/:id/to-quote`](../server/routes/businessLeadPipeline.js#L12) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createLeadQuote`

**Refactor work**  [WP-052](#wp-052)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-012"></a>

**Server router inventory** · Page 319 of 393 · API-012

## businessLeads through businessMsgTemplates

### businessLeads

[Router source](../server/routes/businessLeads.js) · 6 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L603)

- [`GET /:businessId/leads`](../server/routes/businessLeads.js#L7) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listLeads`
- [`POST /:businessId/leads`](../server/routes/businessLeads.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createLead`
- [`PUT /:businessId/leads/:leadId`](../server/routes/businessLeads.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateLead`
- [`DELETE /:businessId/leads/:leadId`](../server/routes/businessLeads.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deleteLead`

**Refactor work**  [WP-052](#wp-052)

### businessMarketing

[Router source](../server/routes/businessMarketing.js) · 15 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L597)

- [`GET /:businessId/broadcasts`](../server/routes/businessMarketing.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listBroadcasts`
- [`POST /:businessId/broadcasts`](../server/routes/businessMarketing.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createBroadcast`
- [`GET /:businessId/broadcasts/report`](../server/routes/businessMarketing.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.getBroadcastReport`
- [`DELETE /:businessId/broadcasts/:id`](../server/routes/businessMarketing.js#L14) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deleteBroadcast`

**Refactor work**  [WP-052](#wp-052) · [WP-092](#wp-092)

### businessMsgTemplates

[Router source](../server/routes/businessMsgTemplates.js) · 5 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L607)

- [`GET /:businessId/message-templates`](../server/routes/businessMsgTemplates.js#L7) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listTemplates`
- [`POST /:businessId/message-templates`](../server/routes/businessMsgTemplates.js#L8) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createTemplate`
- [`PUT /:businessId/message-templates/:templateId`](../server/routes/businessMsgTemplates.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateTemplate`
- [`DELETE /:businessId/message-templates/:templateId`](../server/routes/businessMsgTemplates.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deleteTemplate`

**Refactor work**  [WP-050](#wp-050)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-013"></a>

**Server router inventory** · Page 320 of 393 · API-013

## businessOperations through businessProductPricing

### businessOperations

[Router source](../server/routes/businessOperations.js) · 37 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L590)

- [`GET /:businessId/messages`](../server/routes/businessOperations.js#L20) · guards `requireAuth, requireBusinessAccess, requireBusinessMessageAccess` · handler `businessMessagingController.getConversations`
- [`POST /:businessId/messages`](../server/routes/businessOperations.js#L21) · guards `requireAuth, requireBusinessAccess, requireBusinessMessageAccess` · handler `businessMessagingController.createConversation`
- [`PUT /:businessId/appointments/:appointmentId/status`](../server/routes/businessOperations.js#L60) · guards `requireAuth, requireBusinessAccess, requireBusinessCalendarAccess` · handler `businessAppointmentsController.updateAppointmentStatus`
- [`DELETE /:businessId/pricing-rules/:ruleId`](../server/routes/businessOperations.js#L73) · guards `requireAuth, requireBusinessAccess` · handler `dynamicPricingController.deletePricingRule`

**Refactor work**  [WP-049](#wp-049) · [WP-050](#wp-050) · [WP-051](#wp-051) · [WP-055](#wp-055) · [WP-057](#wp-057)

### businessPackages

[Router source](../server/routes/businessPackages.js) · 8 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L601)

- [`GET /public/:businessId/packages`](../server/routes/businessPackages.js#L8) · guards `scopeExempt` · handler `ctrl.listPublicPackages`
- [`POST /:businessId/packages`](../server/routes/businessPackages.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createPackage`
- [`PUT /:businessId/packages/:packageId`](../server/routes/businessPackages.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updatePackage`
- [`DELETE /:businessId/packages/:packageId`](../server/routes/businessPackages.js#L12) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deletePackage`

**Refactor work**  [WP-055](#wp-055)

### businessProductPricing

[Router source](../server/routes/businessProductPricing.js) · 8 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L609)

- [`GET /:businessId/product-pricing/rules`](../server/routes/businessProductPricing.js#L14) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listPricingRules`
- [`POST /:businessId/product-pricing/rules`](../server/routes/businessProductPricing.js#L16) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createPricingRule`
- [`PUT /:businessId/product-pricing/rules/:ruleId`](../server/routes/businessProductPricing.js#L17) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updatePricingRule`
- [`DELETE /:businessId/product-pricing/rules/:ruleId`](../server/routes/businessProductPricing.js#L18) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deletePricingRule`

**Refactor work**  [WP-053](#wp-053)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-014"></a>

**Server router inventory** · Page 321 of 393 · API-014

## businessProducts through businessRecurringBilling

### businessProducts

[Router source](../server/routes/businessProducts.js) · 11 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L591)

- [`GET /:businessId/products`](../server/routes/businessProducts.js#L16) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listProducts`
- [`POST /:businessId/products`](../server/routes/businessProducts.js#L17) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createProduct`
- [`PUT /:businessId/products/:productId`](../server/routes/businessProducts.js#L24) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateProduct`
- [`DELETE /:businessId/products/:productId`](../server/routes/businessProducts.js#L25) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deleteProduct`

**Refactor work**  [WP-039](#wp-039) · [WP-053](#wp-053) · [WP-081](#wp-081)

### businessProfileImages

[Router source](../server/routes/businessProfileImages.js) · 5 literal method and path entries

**Mount references**  [`/api/business-profile`](../server/index.js#L623)

- [`PUT /cover-image`](../server/routes/businessProfileImages.js#L34) · guards `requireAuth, upload.single, validateFileUpload` · handler `profileImageController.uploadCoverImage`
- [`DELETE /cover-image`](../server/routes/businessProfileImages.js#L40) · guards `requireAuth` · handler `profileImageController.deleteCoverImage`
- [`GET /:businessId/qr-code`](../server/routes/businessProfileImages.js#L51) · guards `scopeExempt` · handler `profileImageController.generateQRCode`
- [`GET /:businessId/qr-code/multi-size`](../server/routes/businessProfileImages.js#L57) · guards `scopeExempt` · handler `profileImageController.generateMultiSizeQRCode`

**Refactor work**  [WP-056](#wp-056)

### businessRecurringBilling

[Router source](../server/routes/businessRecurringBilling.js) · 6 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L594)

- [`GET /:businessId/recurring-billing`](../server/routes/businessRecurringBilling.js#L7) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listRecurring`
- [`POST /:businessId/recurring-billing`](../server/routes/businessRecurringBilling.js#L13) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createRecurring`
- [`PUT /:businessId/recurring-billing/:id`](../server/routes/businessRecurringBilling.js#L19) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateRecurring`
- [`PATCH /:businessId/recurring-billing/:id/toggle`](../server/routes/businessRecurringBilling.js#L25) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.toggleStatus`

**Refactor work**  [WP-054](#wp-054)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-015"></a>

**Server router inventory** · Page 322 of 393 · API-015

## businessReviewMgmt through businessStaff

### businessReviewMgmt

[Router source](../server/routes/businessReviewMgmt.js) · 5 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L596)

- [`GET /:businessId/reviews-manage`](../server/routes/businessReviewMgmt.js#L7) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listReviews`
- [`POST /:businessId/reviews-manage/:reviewId/reply`](../server/routes/businessReviewMgmt.js#L8) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.replyToReview`
- [`DELETE /:businessId/reviews-manage/:reviewId/reply`](../server/routes/businessReviewMgmt.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deleteReply`
- [`POST /:businessId/review-requests`](../server/routes/businessReviewMgmt.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.sendReviewRequest`

**Refactor work**  [WP-030](#wp-030)

### businessReviews

[Router source](../server/routes/businessReviews.js) · 5 literal method and path entries

**Mount references**  [`/api/reviews/business`](../server/index.js#L625)

**Detected router middleware**  `generalLimiter`

- [`POST /:businessId/submit`](../server/routes/businessReviews.js#L15) · guards `authenticate, scopeExempt` · handler `reviewsController.submitReview`
- [`DELETE /:reviewId`](../server/routes/businessReviews.js#L18) · guards `authenticate` · handler `reviewsController.deleteReview`
- [`GET /:businessId`](../server/routes/businessReviews.js#L23) · guards `scopeExempt` · handler `reviewsController.getBusinessReviews`
- [`PUT /:reviewId/respond`](../server/routes/businessReviews.js#L31) · guards `authenticate` · handler `reviewsController.respondToReview`

**Refactor work**  [WP-030](#wp-030)

### businessStaff

[Router source](../server/routes/businessStaff.js) · 44 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L595)

- [`GET /:businessId/staff/shifts`](../server/routes/businessStaff.js#L7) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listShifts`
- [`POST /:businessId/staff/shifts`](../server/routes/businessStaff.js#L8) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createShift`
- [`PUT /:businessId/staff/shifts/:shiftId`](../server/routes/businessStaff.js#L9) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateShift`
- [`PATCH /:businessId/staff/time-entries/:entryId`](../server/routes/businessStaff.js#L54) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.editTimeEntry`

**Refactor work**  [WP-049](#wp-049)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-016"></a>

**Server router inventory** · Page 323 of 393 · API-016

## businessTeam through calendar

### businessTeam

[Router source](../server/routes/businessTeam.js) · 13 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L610)

- [`GET /:businessId/memberships`](../server/routes/businessTeam.js#L33) · guards `authenticate, requireBusinessAccess, requirePermission` · handler `team.listMemberships`
- [`PATCH /:businessId/memberships/:membershipId/role`](../server/routes/businessTeam.js#L48) · guards `authenticate, requireBusinessAccess` · handler `team.changeMembershipRole`
- [`PUT /:businessId/memberships/:membershipId/overrides`](../server/routes/businessTeam.js#L55) · guards `authenticate, requireBusinessAccess` · handler `team.setMembershipOverrides`
- [`POST /:businessId/memberships/:membershipId/approve`](../server/routes/businessTeam.js#L62) · guards `authenticate, rejectImpersonated, requireVortexEnabled, requireBusinessAccess` · handler `access.approveMembership`

**Refactor work**  [WP-008](#wp-008) · [WP-009](#wp-009) · [WP-048](#wp-048)

### businessWaitlist

[Router source](../server/routes/businessWaitlist.js) · 4 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L600)

- [`GET /:businessId/waitlist`](../server/routes/businessWaitlist.js#L8) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listWaitlist`
- [`POST /:businessId/waitlist`](../server/routes/businessWaitlist.js#L9) · guards `requireAuth, scopeExempt` · handler `ctrl.addToWaitlist`
- [`PUT /:businessId/waitlist/:entryId`](../server/routes/businessWaitlist.js#L10) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.updateWaitlistEntry`
- [`DELETE /:businessId/waitlist/:entryId`](../server/routes/businessWaitlist.js#L11) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.removeFromWaitlist`

**Refactor work**  [WP-055](#wp-055)

### calendar

[Router source](../server/routes/calendar.js) · 21 literal method and path entries

**Mount references**  [`/api/calendar`](../server/index.js#L730)

- [`POST /appointments`](../server/routes/calendar.js#L13) · guards `authenticate, rateLimiter` · handler `appointmentController.createAppointment`
- [`GET /appointments`](../server/routes/calendar.js#L14) · guards `authenticate` · handler `appointmentController.getAppointments`
- [`PUT /appointments/:id/reschedule-request/:reqId`](../server/routes/calendar.js#L22) · guards `authenticate, rateLimiter` · handler `appointmentController.respondToReschedule`
- [`DELETE /availability/:id`](../server/routes/calendar.js#L32) · guards `authenticate, rateLimiter` · handler `availabilityController.deleteAvailabilityBlock`

**Refactor work**  [WP-027](#wp-027) · [WP-049](#wp-049)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-017"></a>

**Server router inventory** · Page 324 of 393 · API-017

## cancellationStats through cartCheckout

### cancellationStats

[Router source](../server/routes/cancellationStats.js) · 4 literal method and path entries

**Mount references**  [`/api/cancellation-stats`](../server/index.js#L739)

- [`GET /customer/:userId`](../server/routes/cancellationStats.js#L11) · handler `cancellationStatsController.getCustomerCancellationStats`
- [`GET /customer/:userId/summary`](../server/routes/cancellationStats.js#L18) · handler `cancellationStatsController.getCustomerCancellationSummary`
- [`GET /helper/:userId`](../server/routes/cancellationStats.js#L25) · handler `cancellationStatsController.getHelperCancellationStats`
- [`POST /refresh`](../server/routes/cancellationStats.js#L32) · guards `requireAuth` · handler `cancellationStatsController.refreshCancellationStats`

**Refactor work**  [WP-101](#wp-101)

### careers

[Router source](../server/routes/careers.js) · 21 literal method and path entries

**Mount references**  [`/api/careers`](../server/index.js#L611)

- [`GET /catalog`](../server/routes/careers.js#L28) · handler `pub.getCatalog`
- [`GET /openings`](../server/routes/careers.js#L29) · guards `optionalAuth` · handler `pub.listOpenings`
- [`GET /openings/:id(\d+)`](../server/routes/careers.js#L30) · guards `optionalAuth` · handler `pub.getOpening`
- [`POST /openings/:id(\d+)/apply`](../server/routes/careers.js#L32) · guards `authenticate, careersApplyLimiter` · handler `pub.apply`

**Refactor work**  [WP-031](#wp-031)

### cartCheckout

[Router source](../server/routes/cartCheckout.js) · 4 literal method and path entries

**Mount references**  [`/api/carts`](../server/index.js#L749)

- [`GET /:cartId/session`](../server/routes/cartCheckout.js#L23) · guards `requireAuth`
- [`GET /orders/:orderId`](../server/routes/cartCheckout.js#L27) · guards `requireAuth`
- [`POST /:cartId/payment-intent`](../server/routes/cartCheckout.js#L31) · guards `requireAuth, requireEmailVerified, requireTermsAcceptance, checkRestrictions`
- [`POST /:cartId/confirm`](../server/routes/cartCheckout.js#L32) · guards `requireAuth, requireEmailVerified, requireTermsAcceptance, checkRestrictions`

**Refactor work**  [WP-040](#wp-040)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-018"></a>

**Server router inventory** · Page 325 of 393 · API-018

## chat through connector

### chat

[Router source](../server/routes/chat.js) · 52 literal method and path entries

**Mount references**  [`/api/chat`](../server/index.js#L626)

- [`POST /message`](../server/routes/chat.js#L80) · guards `optionalAuth, supportChatLimiter` · handler `chatMessage`
- [`DELETE /support-thread`](../server/routes/chat.js#L84) · guards `chatLimiter, authenticate` · handler `clearSupportThread`
- [`GET /support-thread`](../server/routes/chat.js#L86) · guards `chatLimiter, authenticate` · handler `getSupportThread`
- [`GET /nudges`](../server/routes/chat.js#L88) · guards `chatLimiter, authenticate` · handler `getSupportNudges`

### config

[Router source](../server/routes/config.js) · 3 literal method and path entries

**Mount references**  [`/api/config`](../server/index.js#L566)

- [`GET /pricing`](../server/routes/config.js#L9) · handler `getPricing`
- [`GET /capabilities`](../server/routes/config.js#L10) · handler `getCapabilities`
- [`PUT /pricing`](../server/routes/config.js#L13) · guards `authenticate, requireRole, requireAdminTotp` · handler `updatePricing`

**Refactor work**  [WP-096](#wp-096)

### connector

[Router source](../server/routes/connector.js) · 15 literal method and path entries

**Mount references**  [`/api/connector/v1`](../server/index.js#L817)

**Detected router middleware**  `connectorAuth`

- [`GET /me`](../server/routes/connector.js#L23) · handler `connector.getMe`
- [`GET /bookings`](../server/routes/connector.js#L24) · handler `connector.listBookings`
- [`GET /bookings/:id`](../server/routes/connector.js#L25) · handler `connector.getBooking`
- [`POST /reconciliation-exceptions/:id/acknowledge`](../server/routes/connector.js#L37) · guards `connectorMutationLimiter, requireConnectorGrant` · handler `connector.acknowledgeReconException`

**Refactor work**  [WP-093](#wp-093)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-019"></a>

**Server router inventory** · Page 326 of 393 · API-019

## consent through consultantScheduling

### consent

[Router source](../server/routes/consent.js) · 2 literal method and path entries

**Mount references**  [`/api/consent`](../server/index.js#L557)

- [`GET /status`](../server/routes/consent.js#L16) · guards `authenticate`
- [`POST /accept`](../server/routes/consent.js#L64) · guards `authenticate`

**Refactor work**  [WP-021](#wp-021) · [WP-102](#wp-102)

### consultantNetwork

[Router source](../server/routes/consultantNetwork.js) · 4 literal method and path entries

**Mount references**  [`/api/consulting/contractor`](../server/index.js#L692)

- [`GET /profile`](../server/routes/consultantNetwork.js#L18) · guards `authenticate` · handler `controller.getMyConsultantProfile`
- [`PUT /profile`](../server/routes/consultantNetwork.js#L19) · guards `authenticate` · handler `controller.upsertMyConsultantProfile`
- [`GET /dashboard`](../server/routes/consultantNetwork.js#L20) · guards `authenticate` · handler `controller.getMyConsultantDashboard`
- [`PATCH /referrals/:requestId`](../server/routes/consultantNetwork.js#L21) · guards `authenticate, gatePayingReferralTransition` · handler `controller.updateMyReferral`

**Refactor work**  [WP-074](#wp-074)

### consultantScheduling

[Router source](../server/routes/consultantScheduling.js) · 9 literal method and path entries

**Mount references**  [`/api/scheduling`](../server/index.js#L693)

- [`GET /consultants/:consultantId/available-slots`](../server/routes/consultantScheduling.js#L7) · handler `consultantSchedulingController.getAvailableSlots`
- [`GET /consultants/:consultantId/next-available`](../server/routes/consultantScheduling.js#L8) · handler `consultantSchedulingController.getNextAvailableDates`
- [`POST /consultants/:consultantId/availability`](../server/routes/consultantScheduling.js#L12) · guards `authenticate` · handler `consultantSchedulingController.setAvailability`
- [`DELETE /consultants/:consultantId/blocked-dates/:dateId`](../server/routes/consultantScheduling.js#L16) · guards `authenticate` · handler `consultantSchedulingController.removeBlockedDate`

**Refactor work**  [WP-075](#wp-075)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-020"></a>

**Server router inventory** · Page 327 of 393 · API-020

## consulting through consultingAdmin

### consulting

[Router source](../server/routes/consulting.js) · 5 literal method and path entries

**Mount references**  [`/api/consulting`](../server/index.js#L683)

- [`POST /submit`](../server/routes/consulting.js#L12) · guards `generalLimiter, requireConsultingEnabled` · handler `consultingController.submitConsultingRequest`
- [`GET /areas`](../server/routes/consulting.js#L13) · guards `generalLimiter, requireConsultingEnabled` · handler `consultingController.getAreasOfHelp`
- [`GET /tiers`](../server/routes/consulting.js#L14) · guards `generalLimiter, requireConsultingEnabled` · handler `consultingController.getServiceTiers`
- [`GET /my-sessions`](../server/routes/consulting.js#L17) · guards `authenticate` · handler `consultingController.getUserConsultingSessions`

**Refactor work**  [WP-076](#wp-076)

### consultingActionItems

[Router source](../server/routes/consultingActionItems.js) · 4 literal method and path entries

**Mount references**  [`/api/consulting`](../server/index.js#L691)

**Detected router middleware**  `authenticate`

- [`GET /sessions/:sessionId/action-items`](../server/routes/consultingActionItems.js#L11) · handler `consultingActionItemsController.getSessionActionItems`
- [`PUT /sessions/:sessionId/action-items/:itemId`](../server/routes/consultingActionItems.js#L21) · handler `consultingActionItemsController.updateActionItem`
- [`DELETE /sessions/:sessionId/action-items/:itemId`](../server/routes/consultingActionItems.js#L24) · handler `consultingActionItemsController.deleteActionItem`
- [`PATCH /sessions/:sessionId/action-items/:itemId/complete`](../server/routes/consultingActionItems.js#L27) · handler `consultingActionItemsController.completeActionItem`

**Refactor work**  [WP-076](#wp-076)

### consultingAdmin

[Router source](../server/routes/consultingAdmin.js) · 22 literal method and path entries

**Mount references**  [`/api/consulting/admin`](../server/index.js#L682)

- [`GET /dashboard-stats`](../server/routes/consultingAdmin.js#L14) · handler `adminConsultingController.getEnhancedDashboardStats`
- [`GET /requests`](../server/routes/consultingAdmin.js#L17) · handler `adminConsultingController.getConsultingRequests`
- [`POST /requests/create`](../server/routes/consultingAdmin.js#L18) · handler `adminConsultingController.createSessionManually`
- [`PATCH /requests/:id/status`](../server/routes/consultingAdmin.js#L19) · handler `adminConsultingController.updateRequestStatusById`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-021"></a>

**Server router inventory** · Page 328 of 393 · API-021

## consultingAllPhases through consultingFeedback

### consultingAllPhases

[Router source](../server/routes/consultingAllPhases.js) · 15 literal method and path entries

**Mount references**  [`/api/consulting`](../server/index.js#L673)

- [`POST /consultants`](../server/routes/consultingAllPhases.js#L10) · handler `consultingController.createConsultant`
- [`GET /consultants`](../server/routes/consultingAllPhases.js#L11) · handler `consultingController.getConsultants`
- [`PUT /consultants/:id`](../server/routes/consultingAllPhases.js#L12) · handler `consultingController.updateConsultant`
- [`PATCH /sessions/:sessionId/phase`](../server/routes/consultingAllPhases.js#L21) · handler `consultingController.updateSessionPhase`

### consultingAnalytics

[Router source](../server/routes/consultingAnalytics.js) · 8 literal method and path entries

**Mount references**  [`/api/consulting/analytics`](../server/index.js#L689)

**Detected router middleware**  `authenticate`, `requireAdmin`, `requirePermission`

- [`GET /platform-stats`](../server/routes/consultingAnalytics.js#L12) · handler `consultingAnalyticsController.getPlatformStats`
- [`GET /consultants`](../server/routes/consultingAnalytics.js#L13) · handler `consultingAnalyticsController.getConsultantsList`
- [`GET /consultants/top`](../server/routes/consultingAnalytics.js#L14) · handler `consultingAnalyticsController.getTopConsultants`
- [`GET /consultants/:consultantId/performance`](../server/routes/consultingAnalytics.js#L15) · handler `consultingAnalyticsController.getConsultantPerformance`

### consultingFeedback

[Router source](../server/routes/consultingFeedback.js) · 3 literal method and path entries

**Mount references**  [`/api/consulting/feedback`](../server/index.js#L685)

- [`POST /:sessionId/:token`](../server/routes/consultingFeedback.js#L9) · guards `strictLimiter` · handler `feedbackController.submitFeedback`
- [`GET /sessions/:sessionId`](../server/routes/consultingFeedback.js#L12) · guards `authenticate` · handler `feedbackController.getSessionFeedback`
- [`GET /consultant/:consultantId`](../server/routes/consultingFeedback.js#L15) · guards `generalLimiter, authenticate, requireAdmin, requirePermission` · handler `feedbackController.getConsultantFeedback`

**Refactor work**  [WP-075](#wp-075)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-022"></a>

**Server router inventory** · Page 329 of 393 · API-022

## consultingPayment through corporateRoles

### consultingPayment

[Router source](../server/routes/consultingPayment.js) · 5 literal method and path entries

**Mount references**  [`/api/consulting`](../server/index.js#L671)

- [`GET /packages`](../server/routes/consultingPayment.js#L11) · guards `generalLimiter` · handler `consultingPaymentController.getPackages`
- [`POST /payment-intent`](../server/routes/consultingPayment.js#L16) · guards `strictLimiter, authenticate, checkRestrictions` · handler `consultingPaymentController.createPaymentIntent`
- [`POST /confirm-payment`](../server/routes/consultingPayment.js#L17) · guards `strictLimiter, authenticate, checkRestrictions` · handler `consultingPaymentController.confirmPayment`
- [`GET /payment/:paymentId/status`](../server/routes/consultingPayment.js#L18) · guards `authenticate` · handler `consultingPaymentController.getPaymentStatus`

**Refactor work**  [WP-075](#wp-075)

### continuityOperations

[Router source](../server/routes/continuityOperations.js) · 11 literal method and path entries

**Mount references**  [`/api/continuity-operations`](../server/index.js#L738)

- [`GET /public/:businessId`](../server/routes/continuityOperations.js#L12) · guards `scopeExempt` · handler `controller.getPublicWorkspace`
- [`POST /public/:businessId/intakes`](../server/routes/continuityOperations.js#L13) · guards `publicIntakeLimiter, generalLimiter, stripPrivilegedIntakeFields, scopeExempt` · handler `controller.createIntakeRequest`
- [`PUT /business/:businessId/settings`](../server/routes/continuityOperations.js#L16) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.updateSettings`
- [`DELETE /business/:businessId/plans/:planId`](../server/routes/continuityOperations.js#L21) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.deletePlan`

**Refactor work**  [WP-059](#wp-059)

### corporateRoles

[Router source](../server/routes/corporateRoles.js) · 17 literal method and path entries

**Mount references**  [`/api/admin/corporate`](../server/index.js#L614)

- [`GET /catalog`](../server/routes/corporateRoles.js#L21) · guards `requireAdmin, requirePermission` · handler `ctrl.getCatalog`
- [`POST /departments`](../server/routes/corporateRoles.js#L26) · guards `requireAdmin, requirePermission` · handler `ctrl.upsertDepartment`
- [`PUT /departments/:id`](../server/routes/corporateRoles.js#L27) · guards `requireAdmin, requirePermission` · handler `ctrl.upsertDepartment`
- [`PATCH /assignments/:id`](../server/routes/corporateRoles.js#L39) · guards `requireAdmin, requirePermission` · handler `ctrl.updateAssignment`

**Refactor work**  [WP-089](#wp-089) · [WP-090](#wp-090)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-023"></a>

**Server router inventory** · Page 330 of 393 · API-023

## countryConfig through creditLicenceAdmin

### countryConfig

[Router source](../server/routes/countryConfig.js) · 4 literal method and path entries

**Mount references**  [`/api/country-config`](../server/index.js#L824)

- [`GET /countries`](../server/routes/countryConfig.js#L13) · guards `generalLimiter` · handler `ctrl.listCountries`
- [`GET /`](../server/routes/countryConfig.js#L14) · guards `generalLimiter` · handler `ctrl.getCountryConfig`
- [`GET /admin`](../server/routes/countryConfig.js#L15) · guards `requireSuperAdmin` · handler `ctrl.adminListCountryPacks`
- [`PATCH /admin/:code`](../server/routes/countryConfig.js#L16) · guards `requireSuperAdmin` · handler `ctrl.adminUpdateCountryPack`

### creativeOperations

[Router source](../server/routes/creativeOperations.js) · 11 literal method and path entries

**Mount references**  [`/api/creative-operations`](../server/index.js#L736)

- [`GET /public/:businessId`](../server/routes/creativeOperations.js#L14) · guards `scopeExempt` · handler `controller.getPublicWorkspace`
- [`POST /public/:businessId/intakes`](../server/routes/creativeOperations.js#L15) · guards `publicIntakeLimiter, generalLimiter, upload.array, validateFileUpload` · handler `controller.createIntakeRequest`
- [`PUT /business/:businessId/settings`](../server/routes/creativeOperations.js#L18) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.updateSettings`
- [`DELETE /business/:businessId/packages/:packageId`](../server/routes/creativeOperations.js#L23) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.deletePackage`

**Refactor work**  [WP-058](#wp-058)

### creditLicenceAdmin

[Router source](../server/routes/creditLicenceAdmin.js) · 51 literal method and path entries

**Mount references**  [Nested mount in Admin](../server/routes/admin.js#L823)

- [`GET /oversight-actions/types`](../server/routes/creditLicenceAdmin.js#L63) · handler `h`
- [`GET /oversight-actions`](../server/routes/creditLicenceAdmin.js#L67) · handler `h`
- [`POST /oversight-actions`](../server/routes/creditLicenceAdmin.js#L76) · handler `h`
- [`PATCH /sar/:id`](../server/routes/creditLicenceAdmin.js#L165) · handler `h`

**Refactor work**  [WP-086](#wp-086)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-024"></a>

**Server router inventory** · Page 331 of 393 · API-024

## didit through directServiceAreaPage

### didit

[Router source](../server/routes/didit.js) · 4 literal method and path entries

**Mount references**  [`/api/didit`](../server/index.js#L588)

- [`POST /session`](../server/routes/didit.js#L8) · guards `authenticate` · handler `createSession`
- [`POST /start`](../server/routes/didit.js#L9) · guards `authenticate` · handler `createSession`
- [`GET /status`](../server/routes/didit.js#L10) · guards `authenticate` · handler `getStatus`
- [`POST /skip`](../server/routes/didit.js#L16) · guards `authenticate` · handler `skipVerification`

**Refactor work**  [WP-007](#wp-007)

### direct

[Router source](../server/routes/direct.js) · 61 literal method and path entries

**Mount references**  [`/api/direct`](../server/index.js#L757)

- [`GET /profile`](../server/routes/direct.js#L90) · guards `optionalAuth` · handler `ctrl.getProfile`
- [`POST /catalog/services/:id/holds`](../server/routes/direct.js#L93) · guards `authenticate, directHoldLimiter` · handler `ctrl.createServiceHold`
- [`PATCH /account/locations/:locationId`](../server/routes/direct.js#L110) · guards `authenticate` · handler `ctrl.saveLocation`
- [`PUT /admin/catalog/services/:id/assignees`](../server/routes/direct.js#L145) · guards `authenticate, requireAdmin, requirePermission, generalLimiter` · handler `ctrl.putAdminServiceAssigneePool`

**Refactor work**  [WP-032](#wp-032) · [WP-033](#wp-033)

### directServiceAreaPage

[Router source](../server/routes/directServiceAreaPage.js) · orchestration or direct-handler module

**Mount references**  [Direct app GET in server startup](../server/index.js#L830)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-025"></a>

**Server router inventory** · Page 332 of 393 · API-025

## discountCodes through disputes

### discountCodes

[Router source](../server/routes/discountCodes.js) · 5 literal method and path entries

**Mount references**  [`/api/admin/discount-codes`](../server/index.js#L815)

- [`POST /`](../server/routes/discountCodes.js#L8) · guards `requireAuth, requireAdmin, requirePermission` · handler `discountCodesController.createDiscountCode`
- [`GET /`](../server/routes/discountCodes.js#L9) · guards `requireAuth, requireAdmin, requirePermission` · handler `discountCodesController.getDiscountCodes`
- [`GET /stats`](../server/routes/discountCodes.js#L10) · guards `requireAuth, requireAdmin, requirePermission` · handler `discountCodesController.getDiscountStats`
- [`PUT /:codeId`](../server/routes/discountCodes.js#L11) · guards `requireAuth, requireAdmin, requirePermission` · handler `discountCodesController.updateDiscountCode`

### discover

[Router source](../server/routes/discover.js) · 5 literal method and path entries

**Mount references**  [`/api/discover`](../server/index.js#L653)

- [`GET /popular`](../server/routes/discover.js#L12) · guards `discoverLimiter, discoverAuthLimiter` · handler `discoverPopular`
- [`GET /`](../server/routes/discover.js#L13) · guards `discoverLimiter, discoverAuthLimiter` · handler `discoverSearch`
- [`POST /alerts`](../server/routes/discover.js#L15) · guards `authenticate` · handler `createDiscoverAlert`
- [`DELETE /alerts/:id`](../server/routes/discover.js#L16) · guards `authenticate` · handler `deleteDiscoverAlert`

**Refactor work**  [WP-024](#wp-024)

### disputes

[Router source](../server/routes/disputes.js) · 10 literal method and path entries

**Mount references**  [`/api/disputes`](../server/index.js#L548)

- [`POST /`](../server/routes/disputes.js#L11) · guards `authenticate`
- [`POST /jobs/:jobId`](../server/routes/disputes.js#L19) · guards `authenticate` · handler `disputeCtrl.openDispute`
- [`GET /my`](../server/routes/disputes.js#L24) · guards `authenticate` · handler `disputeCtrl.getMyDisputes`
- [`GET /admin/all`](../server/routes/disputes.js#L32) · guards `authenticate, requireAdmin, requirePermission` · handler `adminDisputeCtrl.getAllDisputes`

**Refactor work**  [WP-029](#wp-029) · [WP-038](#wp-038) · [WP-088](#wp-088)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-026"></a>

**Server router inventory** · Page 333 of 393 · API-026

## emailPreferences through enforcementPolicy

### emailPreferences

[Router source](../server/routes/emailPreferences.js) · 7 literal method and path entries

**Mount references**  [`/api/notifications/email`](../server/index.js#L821)

- [`GET /`](../server/routes/emailPreferences.js#L7) · guards `requireAuth` · handler `emailPreferencesController.getEmailPreferences`
- [`PUT /`](../server/routes/emailPreferences.js#L10) · guards `requireAuth` · handler `emailPreferencesController.updateEmailPreferences`
- [`POST /unsubscribe-all`](../server/routes/emailPreferences.js#L13) · guards `requireAuth` · handler `emailPreferencesController.unsubscribeFromAll`
- [`POST /resubscribe-all`](../server/routes/emailPreferences.js#L18) · guards `requireAuth` · handler `emailPreferencesController.resubscribeAll`

**Refactor work**  [WP-099](#wp-099)

### enforcement

[Router source](../server/routes/enforcement.js) · 5 literal method and path entries

**Mount references**  [`/api/enforcement`](../server/index.js#L742)

- [`POST /issue`](../server/routes/enforcement.js#L14) · guards `requireAuth, requireAdmin, requirePermission` · handler `enforcementController.issueEnforcementAction`
- [`GET /user/:userId`](../server/routes/enforcement.js#L15) · guards `requireAuth, requireAdmin, requirePermission` · handler `enforcementController.getUserEnforcementActions`
- [`GET /all`](../server/routes/enforcement.js#L16) · guards `requireAuth, requireAdmin, requirePermission` · handler `enforcementController.listEnforcementActions`
- [`POST /:actionId/deactivate`](../server/routes/enforcement.js#L17) · guards `requireAuth, requireAdmin, requirePermission` · handler `enforcementController.deactivateAction`

**Refactor work**  [WP-029](#wp-029) · [WP-101](#wp-101)

### enforcementPolicy

[Router source](../server/routes/enforcementPolicy.js) · 6 literal method and path entries

**Mount references**  [`/api/enforcement-policy`](../server/index.js#L741)

- [`GET /policy`](../server/routes/enforcementPolicy.js#L13) · handler `ctrl.getEnforcementPolicy`
- [`GET /my-status`](../server/routes/enforcementPolicy.js#L16) · guards `requireAuth` · handler `ctrl.getMyEnforcementStatus`
- [`POST /appeals`](../server/routes/enforcementPolicy.js#L17) · guards `requireAuth` · handler `ctrl.submitAppeal`
- [`PUT /admin/appeals/:appealId/review`](../server/routes/enforcementPolicy.js#L22) · guards `requireAuth, requireAdmin, requirePermission` · handler `ctrl.reviewAppeal`

**Refactor work**  [WP-094](#wp-094)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-027"></a>

**Server router inventory** · Page 334 of 393 · API-027

## entities through food

### entities

[Router source](../server/routes/entities.js) · 2 literal method and path entries

**Mount references**  [`/api/entities`](../server/index.js#L550)

- [`GET /me`](../server/routes/entities.js#L111) · guards `authenticate`
- [`GET /:publicId`](../server/routes/entities.js#L123) · guards `authenticate, entityResolveLimiter`

### feeConfig

[Router source](../server/routes/feeConfig.js) · 6 literal method and path entries

**Mount references**  [`/api/fee-config`](../server/index.js#L576)

- [`GET /`](../server/routes/feeConfig.js#L9) · guards `requireAdmin, requirePermission` · handler `ctrl.getFeeConfig`
- [`GET /history`](../server/routes/feeConfig.js#L10) · guards `requireAdmin, requirePermission` · handler `ctrl.getFeeHistory`
- [`POST /stepup-challenges`](../server/routes/feeConfig.js#L11) · guards `requireSuperAdmin, strictLimiter, rejectImpersonated` · handler `issueAdminActionStepup`
- [`PUT /`](../server/routes/feeConfig.js#L12) · guards `requireSuperAdmin, strictLimiter, rejectImpersonated, requireAdminActionStepup` · handler `ctrl.updateFeeConfig`

**Refactor work**  [WP-084](#wp-084)

### food

[Router source](../server/routes/food.js) · 119 literal method and path entries

**Mount references**  [`/api/food`](../server/index.js#L758)

**Detected router middleware**  `authenticate`

- [`GET /markets`](../server/routes/food.js#L34) · handler `ctrl.listMarkets`
- [`POST /restaurants/:restaurantId/campaign-click`](../server/routes/food.js#L42) · guards `optionalAuth, generalLimiter, scopeExempt` · handler `ctrl.trackCampaignClick`
- [`PUT /orders/:orderId/review`](../server/routes/food.js#L53) · guards `optionalAuth` · handler `ctrl.updateOrderReview`
- [`PATCH /customer/profile`](../server/routes/food.js#L77) · guards `authenticate` · handler `ctrl.updateCustomerProfile`

**Refactor work**  [WP-060](#wp-060) · [WP-062](#wp-062) · [WP-063](#wp-063)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-028"></a>

**Server router inventory** · Page 335 of 393 · API-028

## franchise through geo

### franchise

[Router source](../server/routes/franchise.js) · 13 literal method and path entries

**Mount references**  [`/api/franchise`](../server/index.js#L687)

- [`POST /applications`](../server/routes/franchise.js#L32) · guards `generalLimiter, requireFranchiseEnabled` · handler `createFranchiseApplication`
- [`GET /my-applications`](../server/routes/franchise.js#L33) · guards `authenticate, requireFranchiseEnabled` · handler `listMyFranchiseApplications`
- [`PATCH /applications/:id`](../server/routes/franchise.js#L39) · guards `authenticate, requireAdmin, requirePermission` · handler `updateFranchiseApplication`
- [`PUT /applications/:id/agreement`](../server/routes/franchise.js#L42) · guards `authenticate, requireAdmin, requirePermission` · handler `upsertFranchiseAgreement`

**Refactor work**  [WP-078](#wp-078)

### fraudCases

[Router source](../server/routes/fraudCases.js) · 7 literal method and path entries

**Mount references**  [`/api/admin/fraud`](../server/index.js#L813)

- [`GET /cases`](../server/routes/fraudCases.js#L18) · guards `requireAdmin, requirePermission` · handler `fraudCaseController.listFraudCases`
- [`POST /cases`](../server/routes/fraudCases.js#L19) · guards `requireAdmin, requirePermission` · handler `fraudCaseController.createFraudCase`
- [`POST /cases/:id/assign`](../server/routes/fraudCases.js#L20) · guards `requireAdmin, requirePermission` · handler `fraudCaseController.assignFraudCase`
- [`POST /cases/:id/investigate`](../server/routes/fraudCases.js#L21) · guards `requireAdmin, requirePermission` · handler `fraudCaseController.investigateFraudCase`

### geo

[Router source](../server/routes/geo.js) · 5 literal method and path entries

**Mount references**  [`/api/geo`](../server/index.js#L636)

- [`GET /suggest`](../server/routes/geo.js#L8) · guards `geoLimiter` · handler `suggest`
- [`GET /reverse`](../server/routes/geo.js#L9) · guards `geoLimiter` · handler `reverse`
- [`GET /nearby`](../server/routes/geo.js#L10) · guards `geoLimiter` · handler `nearby`
- [`POST /route`](../server/routes/geo.js#L11) · guards `geoLimiter, requireAuth` · handler `route`

**Refactor work**  [WP-024](#wp-024)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-029"></a>

**Server router inventory** · Page 336 of 393 · API-029

## governance through growthInsights

### governance

[Router source](../server/routes/governance.js) · 8 literal method and path entries

**Mount references**  [`/api/admin/super/governance`](../server/index.js#L807)

- [`GET /policies`](../server/routes/governance.js#L19) · guards `requireAdmin, requireSuperAdmin` · handler `governanceCtrl.listPolicies`
- [`POST /policies`](../server/routes/governance.js#L20) · guards `requireAdmin, requireSuperAdmin` · handler `governanceCtrl.createPolicy`
- [`PUT /policies/:id`](../server/routes/governance.js#L21) · guards `requireAdmin, requireSuperAdmin` · handler `governanceCtrl.updatePolicy`
- [`POST /policies/:id/retire`](../server/routes/governance.js#L22) · guards `requireAdmin, requireSuperAdmin` · handler `governanceCtrl.retirePolicy`

**Refactor work**  [WP-089](#wp-089)

### growth

[Router source](../server/routes/growth.js) · 5 literal method and path entries

**Mount references**  [`/api/growth`](../server/index.js#L654)

- [`GET /programs`](../server/routes/growth.js#L13) · guards `generalLimiter` · handler `getPrograms`
- [`GET /wholesale`](../server/routes/growth.js#L14) · guards `generalLimiter` · handler `getWholesale`
- [`GET /grants`](../server/routes/growth.js#L15) · guards `generalLimiter` · handler `getGrants`
- [`POST /wholesale/:id/join`](../server/routes/growth.js#L18) · guards `authenticate` · handler `joinWholesale`

### growthInsights

[Router source](../server/routes/growthInsights.js) · 51 literal method and path entries · 1 computed declarations flagged

**Mount references**  [`/api/admin/growth`](../server/index.js#L563)

**Detected router middleware**  `requireAdmin`, `strictLimiter`

- [`GET /overview`](../server/routes/growthInsights.js#L28) · guards `grant` · handler `wrap`
- [`POST /taxonomy/review-queue/:reviewId/review`](../server/routes/growthInsights.js#L132) · guards `requirePermission` · handler `wrap`
- [`PUT /eligibility/:userId`](../server/routes/growthInsights.js#L339) · guards `requirePermission, requirePermission` · handler `wrap`
- [`PATCH /campaigns/:id`](../server/routes/growthInsights.js#L1591) · guards `grant` · handler `wrap`

**Refactor work**  [WP-091](#wp-091)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-030"></a>

**Server router inventory** · Page 337 of 393 · API-030

## guestChat through helperProducts

### guestChat

[Router source](../server/routes/guestChat.js) · 6 literal method and path entries

**Mount references**  [`/api/guest-chat`](../server/index.js#L631)

- [`POST /sessions`](../server/routes/guestChat.js#L20) · guards `generalLimiter` · handler `createGuestSession`
- [`POST /sessions/:sessionId/messages`](../server/routes/guestChat.js#L27) · guards `generalLimiter` · handler `sendGuestMessage`
- [`GET /sessions/:sessionId`](../server/routes/guestChat.js#L34) · guards `generalLimiter` · handler `getSession`
- [`POST /sessions/:sessionId/claim`](../server/routes/guestChat.js#L42) · guards `authenticate` · handler `helperClaimSession`

**Refactor work**  [WP-035](#wp-035)

### helperCancellationPolicies

[Router source](../server/routes/helperCancellationPolicies.js) · 4 literal method and path entries

**Mount references**  [`/api/helper-settings`](../server/index.js#L694)

- [`GET /policies`](../server/routes/helperCancellationPolicies.js#L10) · guards `requireAuth` · handler `policyController.getPolicies`
- [`PUT /policies`](../server/routes/helperCancellationPolicies.js#L16) · guards `requireAuth` · handler `policyController.updatePolicies`
- [`GET /policies/history`](../server/routes/helperCancellationPolicies.js#L22) · guards `requireAuth` · handler `policyController.getPolicyHistory`
- [`GET /oxsteed-default`](../server/routes/helperCancellationPolicies.js#L28) · handler `policyController.getOxsteadDefaultPolicy`

**Refactor work**  [WP-101](#wp-101)

### helperProducts

[Router source](../server/routes/helperProducts.js) · 5 literal method and path entries

**Mount references**  [`/api/helper-products`](../server/index.js#L647)

- [`GET /me`](../server/routes/helperProducts.js#L20) · guards `authenticate`
- [`POST /`](../server/routes/helperProducts.js#L54) · guards `authenticate`
- [`PATCH /:id`](../server/routes/helperProducts.js#L78) · guards `authenticate`
- [`DELETE /:id`](../server/routes/helperProducts.js#L127) · guards `authenticate`

**Refactor work**  [WP-039](#wp-039)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-031"></a>

**Server router inventory** · Page 338 of 393 · API-031

## helperProfile through helperRegistration

### helperProfile

[Router source](../server/routes/helperProfile.js) · 30 literal method and path entries

**Mount references**  [`/api/helper-profile`](../server/index.js#L645)

- [`GET /me`](../server/routes/helperProfile.js#L50) · guards `helperOnly`
- [`PUT /slug`](../server/routes/helperProfile.js#L95) · guards `helperOnly, generalLimiter`
- [`PATCH /listing`](../server/routes/helperProfile.js#L267) · guards `helperOnly, generalLimiter, requireListingEligible`
- [`POST /services`](../server/routes/helperProfile.js#L371) · guards `helperOnly, generalLimiter`

**Refactor work**  [WP-022](#wp-022)

### helperQuotes

[Router source](../server/routes/helperQuotes.js) · 6 literal method and path entries

**Mount references**  [`/api/helper-quotes`](../server/index.js#L660)

- [`POST /`](../server/routes/helperQuotes.js#L19) · guards `authenticate`
- [`GET /sent`](../server/routes/helperQuotes.js#L74) · guards `authenticate`
- [`PATCH /:id/status`](../server/routes/helperQuotes.js#L161) · guards `authenticate`
- [`DELETE /:id`](../server/routes/helperQuotes.js#L199) · guards `authenticate`

**Refactor work**  [WP-028](#wp-028) · [WP-054](#wp-054)

### helperRegistration

[Router source](../server/routes/helperRegistration.js) · 15 literal method and path entries

**Mount references**  [`/api/helper-registration`](../server/index.js#L572) · [`/api/auth/helper/register`](../server/index.js#L573)

- [`POST /start`](../server/routes/helperRegistration.js#L26) · guards `authLimiter` · handler `startRegistration`
- [`POST /verify-otp`](../server/routes/helperRegistration.js#L27) · guards `authLimiter` · handler `verifyOTP`
- [`GET /categories`](../server/routes/helperRegistration.js#L30) · handler `getCategories`
- [`PUT /onboarding/profile`](../server/routes/helperRegistration.js#L67) · guards `authenticate, requireEmailVerified, requireTermsAcceptance, requireHelperStep` · handler `submitOnboardingProfile`

**Refactor work**  [WP-006](#wp-006)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-032"></a>

**Server router inventory** · Page 339 of 393 · API-032

## helpers through internalWorkspaces

### helpers

[Router source](../server/routes/helpers.js) · 24 literal method and path entries

**Mount references**  [`/api/helpers`](../server/index.js#L637)

- [`POST /:id/remove-credential`](../server/routes/helpers.js#L19) · guards `requireAdmin, requirePermission` · handler `removeCredential`
- [`GET /me/listing`](../server/routes/helpers.js#L22) · guards `authenticate` · handler `getMyListingStatus`
- [`PUT /me/listing`](../server/routes/helpers.js#L23) · guards `authenticate, requireListingEligible` · handler `toggleListing`
- [`DELETE /invoices/:invoiceId`](../server/routes/helpers.js#L34) · guards `authenticate` · handler `deleteHelperInvoice`

**Refactor work**  [WP-022](#wp-022)

### house

[Router source](../server/routes/house.js) · 5 literal method and path entries

**Mount references**  [`/api/house`](../server/index.js#L644)

- [`GET /lookup`](../server/routes/house.js#L13) · guards `geoLimiter` · handler `ctrl.lookupAddress`
- [`POST /my`](../server/routes/house.js#L17) · guards `authenticate` · handler `ctrl.addHome`
- [`PATCH /my/:id`](../server/routes/house.js#L18) · guards `authenticate` · handler `ctrl.updateHome`
- [`DELETE /my/:id`](../server/routes/house.js#L19) · guards `authenticate` · handler `ctrl.deleteHome`

**Refactor work**  [WP-045](#wp-045)

### internalWorkspaces

[Router source](../server/routes/internalWorkspaces.js) · 2 literal method and path entries

**Mount references**  [`/api/internal/workspaces`](../server/index.js#L615)

**Detected router middleware**  `authenticate`

- [`GET /catalog`](../server/routes/internalWorkspaces.js#L11) · handler `ctrl.getCatalog`
- [`GET /:workspace`](../server/routes/internalWorkspaces.js#L12) · handler `ctrl.getWorkspaceDashboard`

**Refactor work**  [WP-083](#wp-083) · [WP-090](#wp-090)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-033"></a>

**Server router inventory** · Page 340 of 393 · API-033

## investor through jobKits

### investor

[Router source](../server/routes/investor.js) · 5 literal method and path entries

**Mount references**  [`/api/investor`](../server/index.js#L651)

- [`GET /kpis`](../server/routes/investor.js#L21) · guards `authenticate, allowInvestor` · handler `getKpis`
- [`GET /revenue-chart`](../server/routes/investor.js#L22) · guards `authenticate, allowInvestor` · handler `getRevenueChart`
- [`GET /franchise`](../server/routes/investor.js#L23) · guards `authenticate, allowInvestor` · handler `getFranchisePipeline`
- [`GET /supply-demand`](../server/routes/investor.js#L24) · guards `authenticate, allowInvestor` · handler `getSupplyDemand`

**Refactor work**  [WP-077](#wp-077)

### invoices

[Router source](../server/routes/invoices.js) · 11 literal method and path entries

**Mount references**  [`/api/invoices`](../server/index.js#L684)

- [`GET /`](../server/routes/invoices.js#L26) · guards `authenticate, generalLimiter`
- [`GET /:id/credit-payee-enrollment`](../server/routes/invoices.js#L56) · guards `authenticate, generalLimiter` · handler `businessInvoiceCreditController.getInvoiceCreditPayeeEnrollment`
- [`POST /:id/pay-with-credit`](../server/routes/invoices.js#L59) · guards `strictLimiter, authenticate, rejectImpersonated` · handler `businessInvoiceCreditController.payInvoiceWithOxsteedCredit`
- [`PATCH /:id/mark-paid`](../server/routes/invoices.js#L103) · guards `authenticate, requireSuperAdmin`

**Refactor work**  [WP-028](#wp-028) · [WP-054](#wp-054)

### jobKits

[Router source](../server/routes/jobKits.js) · 2 literal method and path entries

**Mount references**  [`/api/job-kits`](../server/index.js#L751)

**Detected router middleware**  `authenticate`, `generalLimiter`

- [`GET /`](../server/routes/jobKits.js#L15)
- [`POST /:jobType/build`](../server/routes/jobKits.js#L32)

**Refactor work**  [WP-040](#wp-040) · [WP-041](#wp-041)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-034"></a>

**Server router inventory** · Page 341 of 393 · API-034

## jobs through learn

### jobs

[Router source](../server/routes/jobs.js) · 20 literal method and path entries

**Mount references**  [`/api/jobs`](../server/index.js#L544)

- [`GET /draft`](../server/routes/jobs.js#L26) · guards `authenticate` · handler `getDraft`
- [`PUT /draft`](../server/routes/jobs.js#L27) · guards `authenticate` · handler `saveDraft`
- [`POST /`](../server/routes/jobs.js#L56) · guards `authenticate, requireEmailVerified, requireTermsAcceptance, checkRestrictions` · handler `createJob`
- [`PATCH /:id`](../server/routes/jobs.js#L69) · handler `patchJob`

**Refactor work**  [WP-025](#wp-025) · [WP-026](#wp-026)

### leads

[Router source](../server/routes/leads.js) · 8 literal method and path entries

**Mount references**  [`/api/leads`](../server/index.js#L624)

**Detected router middleware**  `generalLimiter`

- [`GET /my`](../server/routes/leads.js#L16) · guards `authenticate` · handler `leadController.getMyLeads`
- [`GET /business/:businessId`](../server/routes/leads.js#L21) · guards `authenticate, requireBusinessAccess` · handler `leadController.getBusinessLeads`
- [`POST /:businessId/request`](../server/routes/leads.js#L26) · guards `authenticate, scopeExempt` · handler `leadController.createLead`
- [`GET /:leadId`](../server/routes/leads.js#L29) · guards `authenticate` · handler `leadController.getLead`

**Refactor work**  [WP-052](#wp-052)

### learn

[Router source](../server/routes/learn.js) · 37 literal method and path entries

**Mount references**  [`/api/learn`](../server/index.js#L649)

- [`GET /guides`](../server/routes/learn.js#L83) · guards `optionalAuth` · handler `getGuides`
- [`POST /views`](../server/routes/learn.js#L85) · handler `recordView`
- [`PATCH /admin/submissions/:id`](../server/routes/learn.js#L138) · guards `authenticate, requireAdmin, requirePermission` · handler `adminReviewSubmission`
- [`PUT /admin/guides/:id`](../server/routes/learn.js#L152) · guards `authenticate, requireAdmin, requirePermission` · handler `adminUpdateGuide`

**Refactor work**  [WP-044](#wp-044)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-035"></a>

**Server router inventory** · Page 342 of 393 · API-035

## legalDocuments through localDelivery

### legalDocuments

[Router source](../server/routes/legalDocuments.js) · 32 literal method and path entries

**Mount references**  [`/api/legal`](../server/index.js#L744) · [`/api/admin/legal`](../server/index.js#L745)

- [`POST /ccpa-requests`](../server/routes/legalDocuments.js#L22) · guards `strictLimiter` · handler `ccpaController.createCCPARequest`
- [`GET /documents/:documentType`](../server/routes/legalDocuments.js#L139) · guards `generalLimiter`
- [`PUT /documents/:id`](../server/routes/legalDocuments.js#L231) · guards `authenticate, requireAdmin, requirePermission`
- [`DELETE /acceptances/:id/revoke`](../server/routes/legalDocuments.js#L518) · guards `authenticate, requireAdmin, requirePermission`

**Refactor work**  [WP-102](#wp-102)

### lifeDashboard

[Router source](../server/routes/lifeDashboard.js) · 48 literal method and path entries

**Mount references**  [`/api/life`](../server/index.js#L587)

- [`GET /pulse/settings`](../server/routes/lifeDashboard.js#L8) · guards `authenticate` · handler `settingsCtrl.getSettings`
- [`PUT /pulse/settings`](../server/routes/lifeDashboard.js#L9) · guards `authenticate` · handler `settingsCtrl.updateSettings`
- [`POST /expenses`](../server/routes/lifeDashboard.js#L32) · guards `authenticate` · handler `ctrl.createExpense`
- [`DELETE /expenses/:id`](../server/routes/lifeDashboard.js#L34) · guards `authenticate` · handler `ctrl.deleteExpense`

**Refactor work**  [WP-045](#wp-045)

### localDelivery

[Router source](../server/routes/localDelivery.js) · 75 literal method and path entries

**Mount references**  [`/api/delivery`](../server/index.js#L618)

**Detected router middleware**  `authenticatedLimiter`

- [`POST /quote`](../server/routes/localDelivery.js#L21) · guards `requireAuth` · handler `controller.quote`
- [`GET /public/captcha-config`](../server/routes/localDelivery.js#L25) · guards `generalLimiter`
- [`PATCH /driver-profile/availability`](../server/routes/localDelivery.js#L48) · guards `requireAuth, rejectImpersonated` · handler `controller.setDriverAvailability`
- [`DELETE /jobs/:id/tracking/consent`](../server/routes/localDelivery.js#L93) · guards `requireAuth` · handler `trackingController.revokeConsent`

**Refactor work**  [WP-070](#wp-070) · [WP-082](#wp-082)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-036"></a>

**Server router inventory** · Page 343 of 393 · API-036

## logistics through mainApp

### logistics

[Router source](../server/routes/logistics.js) · 82 literal method and path entries

**Mount references**  [`/api/logistics`](../server/index.js#L617)

- [`GET /lanes`](../server/routes/logistics.js#L49) · handler `lanesCtrl.listLanes`
- [`GET /lanes/:id`](../server/routes/logistics.js#L50) · handler `lanesCtrl.getLane`
- [`POST /requests`](../server/routes/logistics.js#L65) · guards `requireAuth` · handler `sourcingCtrl.createRequest`
- [`PATCH /requests/:id/status`](../server/routes/logistics.js#L68) · guards `requireAuth, requireRequestsManage` · handler `sourcingCtrl.updateStatus`

**Refactor work**  [WP-041](#wp-041) · [WP-079](#wp-079) · [WP-080](#wp-080) · [WP-081](#wp-081) · [WP-082](#wp-082)

### logisticsAdmin

[Router source](../server/routes/logisticsAdmin.js) · 67 literal method and path entries

**Mount references**  [`/api/admin/logistics`](../server/index.js#L619)

**Detected router middleware**  `requireAdminTotp`

- [`GET /stats`](../server/routes/logisticsAdmin.js#L92) · guards `requireOperationsWorkspace` · handler `adminCtrl.getStats`
- [`POST /lanes`](../server/routes/logisticsAdmin.js#L96) · guards `requireAdminRole, requireLogisticsProcurement` · handler `lanesCtrl.createLane`
- [`PUT /lanes/:id`](../server/routes/logisticsAdmin.js#L97) · guards `requireAdminRole, requireLogisticsProcurement` · handler `lanesCtrl.updateLane`
- [`PATCH /quotes/:quoteId/review`](../server/routes/logisticsAdmin.js#L119) · guards `requireOperationsWorkspace` · handler `sourcingCtrl.reviewQuote`

**Refactor work**  [WP-080](#wp-080) · [WP-083](#wp-083)

### mainApp

[Router source](../server/routes/mainApp.js) · 27 literal method and path entries

**Mount references**  [`/api/main-app`](../server/index.js#L756)

- [`GET /home`](../server/routes/mainApp.js#L11) · guards `optionalAuth` · handler `ctrl.getHomeDashboard`
- [`GET /activity`](../server/routes/mainApp.js#L12) · guards `authenticate` · handler `ctrl.getActivityFeed`
- [`GET /profile-summary`](../server/routes/mainApp.js#L13) · guards `authenticate` · handler `ctrl.getProfileSummary`
- [`POST /payouts`](../server/routes/mainApp.js#L18) · guards `authenticate, requireTaxIdentity` · handler `ctrl.requestPayout`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-037"></a>

**Server router inventory** · Page 344 of 393 · API-037

## maintenanceRequests through media

### maintenanceRequests

[Router source](../server/routes/maintenanceRequests.js) · 8 literal method and path entries

**Mount references**  [`/api/maintenance-requests`](../server/index.js#L732)

- [`GET /public/:businessId`](../server/routes/maintenanceRequests.js#L13) · guards `scopeExempt` · handler `controller.getPublicBusiness`
- [`POST /public/:businessId`](../server/routes/maintenanceRequests.js#L14) · guards `authenticate, upload.array, validateFileUpload, scopeExempt` · handler `controller.createRequest`
- [`GET /my`](../server/routes/maintenanceRequests.js#L22) · guards `authenticate` · handler `controller.listMyRequests`
- [`PATCH /:id`](../server/routes/maintenanceRequests.js#L26) · guards `authenticate` · handler `controller.updateRequest`

**Refactor work**  [WP-057](#wp-057)

### marketplaceProducts

[Router source](../server/routes/marketplaceProducts.js) · 13 literal method and path entries

**Mount references**  [`/api/marketplace/products`](../server/index.js#L747)

**Detected router middleware**  `generalLimiter`

- [`GET /browse`](../server/routes/marketplaceProducts.js#L14) · guards `optionalAuth` · handler `marketplaceProductsController.browseProducts`
- [`GET /search`](../server/routes/marketplaceProducts.js#L17) · guards `optionalAuth` · handler `marketplaceProductsController.searchProducts`
- [`GET /categories`](../server/routes/marketplaceProducts.js#L20) · handler `marketplaceProductsController.getCategories`
- [`POST /match-tools`](../server/routes/marketplaceProducts.js#L32) · handler `marketplaceProductsController.matchTools`

**Refactor work**  [WP-039](#wp-039) · [WP-053](#wp-053)

### media

[Router source](../server/routes/media.js) · 72 literal method and path entries

**Mount references**  [`/api/media`](../server/index.js#L770)

**Detected router middleware**  `optionalAuth`

- [`GET /capabilities`](../server/routes/media.js#L27)
- [`POST /verification/requests`](../server/routes/media.js#L42) · guards `requireAuth` · handler `verificationCtrl.createRequest`
- [`PATCH /creator/deliverables/:deliverableId`](../server/routes/media.js#L79) · guards `requireAuth` · handler `creatorCtrl.reviewDeliverable`
- [`PUT /posts/:id/links`](../server/routes/media.js#L103) · guards `requireAuth` · handler `ctrl.replacePostLinks`

**Refactor work**  [WP-042](#wp-042) · [WP-043](#wp-043) · [WP-095](#wp-095)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-038"></a>

**Server router inventory** · Page 345 of 393 · API-038

## mediaAdmin through meWorkspace

### mediaAdmin

[Router source](../server/routes/mediaAdmin.js) · 16 literal method and path entries

**Mount references**  [`/api/admin/media`](../server/index.js#L580)

**Detected router middleware**  `requireAdmin`

- [`GET /creator-work-reviews`](../server/routes/mediaAdmin.js#L13) · guards `requirePermission` · handler `workCtrl.listWorkReviews`
- [`POST /creator-work-reviews/:reviewId/resolve`](../server/routes/mediaAdmin.js#L14) · guards `requirePermission` · handler `workCtrl.resolveWorkReview`
- [`GET /creator-disputes`](../server/routes/mediaAdmin.js#L16) · guards `requirePermission` · handler `ctrl.listCreatorDisputes`
- [`POST /creator-disputes/:disputeId/review`](../server/routes/mediaAdmin.js#L17) · guards `requirePermission` · handler `ctrl.reviewCreatorDispute`

**Refactor work**  [WP-043](#wp-043) · [WP-094](#wp-094)

### messages

[Router source](../server/routes/messages.js) · 25 literal method and path entries

**Mount references**  [`/api/messages`](../server/index.js#L586)

**Detected router middleware**  `authenticate`

- [`GET /guest-inquiries`](../server/routes/messages.js#L39) · handler `getGuestInquiries`
- [`POST /guest-inquiries/:id/mark-read`](../server/routes/messages.js#L46) · guards `userChatLimiter` · handler `markGuestInquiryRead`
- [`DELETE /conversations/:conversationId/:messageId`](../server/routes/messages.js#L77) · guards `userChatLimiter, conversationMessageLimiter` · handler `deleteMessage`
- [`PUT /conversations/:conversationId/:messageId`](../server/routes/messages.js#L80) · guards `userChatLimiter, conversationMessageLimiter` · handler `editMessage`

**Refactor work**  [WP-034](#wp-034) · [WP-050](#wp-050)

### meWorkspace

[Router source](../server/routes/meWorkspace.js) · 2 literal method and path entries

**Mount references**  [`/api/me`](../server/index.js#L613)

- [`GET /businesses`](../server/routes/meWorkspace.js#L17) · guards `authenticate` · handler `team.getMyBusinesses`
- [`POST /workspace-context`](../server/routes/meWorkspace.js#L18) · guards `authenticate` · handler `team.setWorkspaceContext`

**Refactor work**  [WP-014](#wp-014) · [WP-047](#wp-047)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-039"></a>

**Server router inventory** · Page 346 of 393 · API-039

## mobile through moderation

### mobile

[Router source](../server/routes/mobile.js) · 19 literal method and path entries

**Mount references**  [`/api/mobile`](../server/index.js#L752)

- [`GET /public/bootstrap`](../server/routes/mobile.js#L13) · handler `mobileController.getPublicBootstrap`
- [`PATCH /profile`](../server/routes/mobile.js#L17) · guards `authenticate` · handler `mobileController.updateMobileProfile`
- [`POST /push-token`](../server/routes/mobile.js#L18) · guards `authenticate` · handler `mobileController.registerPushToken`
- [`DELETE /push-token`](../server/routes/mobile.js#L19) · guards `authenticate` · handler `mobileController.unregisterPushToken`

**Refactor work**  [WP-019](#wp-019)

### modePlatformApprovals

[Router source](../server/routes/modePlatformApprovals.js) · 13 literal method and path entries

**Mount references**  [`/api/mode-approvals userRouter`](../server/index.js#L621) · [`/api/admin adminRouter`](../server/index.js#L622)

- [`GET /policies`](../server/routes/modePlatformApprovals.js#L19) · guards `authenticate` · handler `ctrl.listPublicPolicies`
- [`GET /me`](../server/routes/modePlatformApprovals.js#L20) · guards `authenticate` · handler `ctrl.listMine`
- [`POST /me/:mode/request`](../server/routes/modePlatformApprovals.js#L22) · guards `authenticate` · handler `ctrl.requestMine`
- [`PATCH /mode-policies/:mode`](../server/routes/modePlatformApprovals.js#L30) · guards `authenticate, requireSuperAdmin` · handler `ctrl.adminUpdatePolicy`

**Refactor work**  [WP-010](#wp-010) · [WP-011](#wp-011) · [WP-012](#wp-012)

### moderation

[Router source](../server/routes/moderation.js) · 2 literal method and path entries

**Mount references**  [`/api/moderation`](../server/index.js#L755)

- [`GET /blocklist`](../server/routes/moderation.js#L10) · guards `generalLimiter` · handler `ctrl.getBlocklist`
- [`POST /flag`](../server/routes/moderation.js#L11) · guards `generalLimiter, optionalAuth` · handler `ctrl.flagContent`

**Refactor work**  [WP-094](#wp-094)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-040"></a>

**Server router inventory** · Page 347 of 393 · API-040

## monitoring through offerLinks

### monitoring

[Router source](../server/routes/monitoring.js) · 15 literal method and path entries

**Mount references**  [`/api/monitoring`](../server/index.js#L827)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /health`](../server/routes/monitoring.js#L14) · handler `monitoringController.getSystemHealth`
- [`GET /security-posture`](../server/routes/monitoring.js#L17) · handler `monitoringController.getSecurityPosture`
- [`GET /security-events`](../server/routes/monitoring.js#L20) · handler `monitoringController.getSecurityEvents`
- [`POST /incidents/:incidentId/acknowledge`](../server/routes/monitoring.js#L49) · handler `monitoringController.acknowledgeIncident`

**Refactor work**  [WP-103](#wp-103)

### notifications

[Router source](../server/routes/notifications.js) · 19 literal method and path entries

**Mount references**  [`/api/notifications`](../server/index.js#L552)

- [`GET /`](../server/routes/notifications.js#L7) · guards `authenticate` · handler `notifCtrl.getNotifications`
- [`POST /mark-read`](../server/routes/notifications.js#L8) · guards `authenticate` · handler `notifCtrl.markRead`
- [`PUT /read-all`](../server/routes/notifications.js#L13) · guards `authenticate`
- [`DELETE /webpush/subscribe`](../server/routes/notifications.js#L38) · guards `authenticate` · handler `webPushCtrl.unsubscribe`

**Refactor work**  [WP-020](#wp-020)

### offerLinks

[Router source](../server/routes/offerLinks.js) · 1 literal method and path entries

**Mount references**  [`/api/o`](../server/index.js#L560)

- [`GET /:token`](../server/routes/offerLinks.js#L7) · guards `generalLimiter`

**Refactor work**  [WP-097](#wp-097)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-041"></a>

**Server router inventory** · Page 348 of 393 · API-041

## oneTruth through opsIntegrations

### oneTruth

[Router source](../server/routes/oneTruth.js) · 7 literal method and path entries

**Mount references**  [`/api/admin/one-truth`](../server/index.js#L578)

- [`GET /filters`](../server/routes/oneTruth.js#L14) · handler `ctrl.getFilters`
- [`GET /stats`](../server/routes/oneTruth.js#L15) · handler `ctrl.getStats`
- [`GET /users`](../server/routes/oneTruth.js#L16) · handler `ctrl.listUsers`
- [`POST /access-request`](../server/routes/oneTruth.js#L24) · guards `requireAdmin` · handler `ctrl.requestOneTruthAccess`

**Refactor work**  [WP-091](#wp-091)

### opsActions

[Router source](../server/routes/opsActions.js) · 3 literal method and path entries

**Mount references**  [`/api/admin/ops`](../server/index.js#L804)

- [`GET /queues/dead-letter`](../server/routes/opsActions.js#L11) · guards `requireAdmin, requirePermission` · handler `opsActionsController.listDeadLetter`
- [`POST /queues/dead-letter/:jobId/requeue`](../server/routes/opsActions.js#L18) · guards `requireAdmin, requirePermission` · handler `opsActionsController.requeueDeadLetter`
- [`POST /webhooks/:deliveryId/retry`](../server/routes/opsActions.js#L25) · guards `requireAdmin, strictLimiter, rejectImpersonated, requirePermission` · handler `opsActionsController.retryWebhookDelivery`

### opsIntegrations

[Router source](../server/routes/opsIntegrations.js) · 3 literal method and path entries

**Mount references**  [`/api/admin/ops/integrations`](../server/index.js#L810)

- [`GET /`](../server/routes/opsIntegrations.js#L9) · guards `requireAdmin, requirePermission` · handler `opsIntegrationsController.listIntegrations`
- [`POST /:id/test`](../server/routes/opsIntegrations.js#L16) · guards `requireAdmin, requirePermission` · handler `opsIntegrationsController.testIntegration`
- [`POST /:id/reconnect`](../server/routes/opsIntegrations.js#L23) · guards `requireAdmin, requirePermission` · handler `opsIntegrationsController.reconnectIntegration`

**Refactor work**  [WP-093](#wp-093)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-042"></a>

**Server router inventory** · Page 349 of 393 · API-042

## orders through oxsteedCreditKiosk

### orders

[Router source](../server/routes/orders.js) · 4 literal method and path entries

**Mount references**  [`/api/orders`](../server/index.js#L800)

- [`GET /`](../server/routes/orders.js#L7) · guards `requireAuth` · handler `ordersController.getOrders`
- [`GET /stats`](../server/routes/orders.js#L8) · guards `requireAuth` · handler `ordersController.getOrderStats`
- [`GET /:orderId`](../server/routes/orders.js#L9) · guards `requireAuth` · handler `ordersController.getOrder`
- [`POST /:orderId/cancel`](../server/routes/orders.js#L10) · guards `strictLimiter, requireAuth` · handler `ordersController.cancelOrder`

**Refactor work**  [WP-041](#wp-041) · [WP-079](#wp-079)

### oxsteedCredit

[Router source](../server/routes/oxsteedCredit.js) · 50 literal method and path entries

**Mount references**  [`/api/oxsteed-credit`](../server/index.js#L760)

**Detected router middleware**  `authenticate`, `requireRole`

- [`GET /account`](../server/routes/oxsteedCredit.js#L22) · handler `controller.getMyAccount`
- [`POST /conversions`](../server/routes/oxsteedCredit.js#L25) · guards `creditMutationLimiter, rejectImpersonated, checkRestrictions` · handler `controller.convertMyCredit`
- [`GET /conversion-quotes/:quoteId`](../server/routes/oxsteedCredit.js#L26) · handler `controller.getMyCurrencyQuote`
- [`GET /limits`](../server/routes/oxsteedCredit.js#L27) · handler `controller.getMyCreditLimits`

**Refactor work**  [WP-086](#wp-086)

### oxsteedCreditKiosk

[Router source](../server/routes/oxsteedCreditKiosk.js) · 2 literal method and path entries

**Mount references**  [`/api/restaurants/:restaurantId/credit-kiosks/:deviceId`](../server/index.js#L783)

**Detected router middleware**  `cardController.authenticateCreditKiosk`

- [`POST /redeem`](../server/routes/oxsteedCreditKiosk.js#L41) · guards `kioskDeviceLimiter` · handler `cardController.kioskRedeemCard`
- [`POST /cash-out`](../server/routes/oxsteedCreditKiosk.js#L45) · guards `kioskDeviceLimiter` · handler `cardController.kioskCashOut`

**Refactor work**  [WP-086](#wp-086)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-043"></a>

**Server router inventory** · Page 350 of 393 · API-043

## partners through paymentLayers

### partners

[Router source](../server/routes/partners.js) · 1 literal method and path entries

**Mount references**  [`/api/partners`](../server/index.js#L559)

- [`POST /:code/postback`](../server/routes/partners.js#L8) · guards `strictLimiter`

**Refactor work**  [WP-093](#wp-093) · [WP-097](#wp-097)

### passkeys

[Router source](../server/routes/passkeys.js) · 4 literal method and path entries

**Mount references**  [`/api/2fa/passkeys`](../server/index.js#L569)

- [`GET /`](../server/routes/passkeys.js#L10) · guards `authenticate, requireAdmin` · handler `controller.listPasskeys`
- [`POST /registration/options`](../server/routes/passkeys.js#L11) · guards `authenticate, requireAdmin, rejectImpersonated, strictLimiter` · handler `controller.registrationOptions`
- [`POST /registration/verify`](../server/routes/passkeys.js#L12) · guards `authenticate, requireAdmin, rejectImpersonated, strictLimiter` · handler `controller.verifyRegistration`
- [`DELETE /:id`](../server/routes/passkeys.js#L13) · guards `authenticate, requireAdmin, rejectImpersonated, strictLimiter` · handler `controller.revokePasskey`

**Refactor work**  [WP-018](#wp-018)

### paymentLayers

[Router source](../server/routes/paymentLayers.js) · 36 literal method and path entries

**Mount references**  [`/api/payment-layers`](../server/index.js#L546)

- [`GET /config`](../server/routes/paymentLayers.js#L12) · guards `generalLimiter` · handler `ctrl.getConfig`
- [`PUT /admin/country-policies/:code`](../server/routes/paymentLayers.js#L15) · guards `requireSuperAdmin` · handler `ctrl.adminUpdatePolicy`
- [`POST /jobs/:id/credit-quote`](../server/routes/paymentLayers.js#L19) · guards `authenticate, rejectImpersonated, paymentsLimiter` · handler `ctrl.createCreditQuote`
- [`DELETE /payout-destinations/:id`](../server/routes/paymentLayers.js#L42) · guards `authenticate, rejectImpersonated, paymentsLimiter` · handler `ctrl.removePayoutDestination`

**Refactor work**  [WP-084](#wp-084)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-044"></a>

**Server router inventory** · Page 351 of 393 · API-044

## payments through plannedNeeds

### payments

[Router source](../server/routes/payments.js) · 12 literal method and path entries

**Mount references**  [`/api/payments`](../server/index.js#L547)

- [`POST /connect`](../server/routes/payments.js#L33) · guards `authenticate, requirePaymentsEnabled, requireOnboardingStep, connectAccountLimiter` · handler `createConnectAccount`
- [`GET /connect/status`](../server/routes/payments.js#L34) · guards `authenticate, requirePaymentsEnabled` · handler `getConnectStatus`
- [`POST /connect/disconnect`](../server/routes/payments.js#L35) · guards `authenticate, requirePaymentsEnabled, connectAccountLimiter` · handler `disconnectConnectAccount`
- [`GET /payout/balance`](../server/routes/payments.js#L36) · guards `authenticate, requirePaymentsEnabled` · handler `getPayoutBalance`

**Refactor work**  [WP-084](#wp-084)

### payoutRoutes

[Router source](../server/routes/payoutRoutes.js) · 4 literal method and path entries

**Mount references**  [`/api/payouts`](../server/index.js#L820)

- [`GET /payout-methods`](../server/routes/payoutRoutes.js#L15) · guards `requireAuth` · handler `PayoutController.getPayoutMethods`
- [`POST /payout-methods`](../server/routes/payoutRoutes.js#L16) · guards `requireAuth, requireUserTotpStepUp, requireOnboardingStep` · handler `PayoutController.createPayoutMethod`
- [`PUT /payout-methods/:method_id`](../server/routes/payoutRoutes.js#L17) · guards `requireAuth, requireUserTotpStepUp, requireOnboardingStep` · handler `PayoutController.updatePayoutMethod`
- [`DELETE /payout-methods/:method_id`](../server/routes/payoutRoutes.js#L18) · guards `requireAuth, requireUserTotpStepUp, requireOnboardingStep` · handler `PayoutController.deletePayoutMethod`

**Refactor work**  [WP-085](#wp-085)

### plannedNeeds

[Router source](../server/routes/plannedNeeds.js) · 17 literal method and path entries

**Mount references**  [`/api/planned-needs`](../server/index.js#L642)

- [`GET /suggestions`](../server/routes/plannedNeeds.js#L6) · guards `authenticate` · handler `ctrl.getSuggestions`
- [`POST /`](../server/routes/plannedNeeds.js#L22) · guards `authenticate` · handler `ctrl.createPlannedNeed`
- [`PUT /:id`](../server/routes/plannedNeeds.js#L23) · guards `authenticate` · handler `ctrl.updatePlannedNeed`
- [`DELETE /:id`](../server/routes/plannedNeeds.js#L26) · guards `authenticate` · handler `ctrl.deletePlannedNeed`

**Refactor work**  [WP-045](#wp-045)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-045"></a>

**Server router inventory** · Page 352 of 393 · API-045

## priceGuidance through pricingRulesAdmin

### priceGuidance

[Router source](../server/routes/priceGuidance.js) · 1 literal method and path entries

**Mount references**  [`/api/price-guidance`](../server/index.js#L567)

- [`GET /`](../server/routes/priceGuidance.js#L164)

### pricingOverrides

[Router source](../server/routes/pricingOverrides.js) · 7 literal method and path entries

**Mount references**  [`/api/admin/pricing-overrides`](../server/index.js#L577)

- [`GET /`](../server/routes/pricingOverrides.js#L6) · guards `requireSuperAdmin` · handler `ctrl.getAllPricingOverrides`
- [`GET /comparison`](../server/routes/pricingOverrides.js#L7) · guards `requireSuperAdmin` · handler `ctrl.getPricingComparison`
- [`PUT /:countryCode`](../server/routes/pricingOverrides.js#L10) · guards `requireSuperAdmin` · handler `ctrl.updatePricingOverride`
- [`POST /batch`](../server/routes/pricingOverrides.js#L11) · guards `requireSuperAdmin` · handler `ctrl.batchUpdatePricing`

### pricingRulesAdmin

[Router source](../server/routes/pricingRulesAdmin.js) · 9 literal method and path entries

**Mount references**  [`/api/businesses`](../server/index.js#L592)

- [`POST /:businessId/pricing/service/:serviceId/rules`](../server/routes/pricingRulesAdmin.js#L13) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.createServiceRule`
- [`GET /:businessId/pricing/service/:serviceId/rules`](../server/routes/pricingRulesAdmin.js#L15) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.listServiceRules`
- [`PATCH /:businessId/pricing/service/:serviceId/rules/:ruleId/toggle`](../server/routes/pricingRulesAdmin.js#L17) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.toggleServiceRule`
- [`DELETE /:businessId/pricing/service/:serviceId/rules/:ruleId`](../server/routes/pricingRulesAdmin.js#L19) · guards `requireAuth, requireBusinessAccess` · handler `ctrl.deleteServiceRule`

**Refactor work**  [WP-053](#wp-053)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-046"></a>

**Server router inventory** · Page 353 of 393 · API-046

## privacy through profileSlugs

### privacy

[Router source](../server/routes/privacy.js) · 6 literal method and path entries

**Mount references**  [`/api/privacy`](../server/index.js#L565)

- [`POST /export/verification/request`](../server/routes/privacy.js#L188) · guards `authenticate`
- [`POST /export/verification/verify`](../server/routes/privacy.js#L243) · guards `authenticate`
- [`GET /export`](../server/routes/privacy.js#L304) · guards `authenticate`
- [`DELETE /delete-account`](../server/routes/privacy.js#L522) · guards `strictLimiter, authenticate, requireSensitiveReauth`

**Refactor work**  [WP-021](#wp-021)

### professionalOperations

[Router source](../server/routes/professionalOperations.js) · 11 literal method and path entries

**Mount references**  [`/api/professional-operations`](../server/index.js#L737)

- [`GET /public/:businessId`](../server/routes/professionalOperations.js#L11) · guards `scopeExempt` · handler `controller.getPublicWorkspace`
- [`POST /public/:businessId/intakes`](../server/routes/professionalOperations.js#L12) · guards `publicIntakeLimiter, stripPrivilegedIntakeFields, scopeExempt` · handler `controller.createEngagementRequest`
- [`PUT /business/:businessId/settings`](../server/routes/professionalOperations.js#L15) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.updateSettings`
- [`DELETE /business/:businessId/packages/:packageId`](../server/routes/professionalOperations.js#L20) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.deletePackage`

**Refactor work**  [WP-058](#wp-058)

### profileSlugs

[Router source](../server/routes/profileSlugs.js) · 1 literal method and path entries

**Mount references**  [`/api/profile-slugs`](../server/index.js#L646)

- [`GET /check`](../server/routes/profileSlugs.js#L9) · guards `generalLimiter` · handler `checkSlugAvailability`

**Refactor work**  [WP-022](#wp-022)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-047"></a>

**Server router inventory** · Page 354 of 393 · API-047

## promotionAnalytics through providerHealth

### promotionAnalytics

[Router source](../server/routes/promotionAnalytics.js) · 3 literal method and path entries

**Mount references**  [`/api/promotion-analytics`](../server/index.js#L759)

- [`POST /share`](../server/routes/promotionAnalytics.js#L11) · guards `authenticate, generalLimiter` · handler `ctrl.recordHelperShare`
- [`GET /performance`](../server/routes/promotionAnalytics.js#L12) · guards `authenticate` · handler `ctrl.getHelperPerformance`
- [`POST /visit`](../server/routes/promotionAnalytics.js#L14) · guards `optionalAuth, generalLimiter` · handler `ctrl.recordVisit`

**Refactor work**  [WP-091](#wp-091)

### propertyOperations

[Router source](../server/routes/propertyOperations.js) · 12 literal method and path entries

**Mount references**  [`/api/property-operations`](../server/index.js#L733)

- [`GET /public/:businessId`](../server/routes/propertyOperations.js#L9) · guards `scopeExempt` · handler `controller.getPublicWorkspace`
- [`PUT /business/:businessId/settings`](../server/routes/propertyOperations.js#L12) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.updateSettings`
- [`POST /business/:businessId/units`](../server/routes/propertyOperations.js#L14) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.createUnit`
- [`DELETE /business/:businessId/units/:unitId`](../server/routes/propertyOperations.js#L16) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.deleteUnit`

**Refactor work**  [WP-057](#wp-057)

### providerHealth

[Router source](../server/routes/providerHealth.js) · 4 literal method and path entries

**Mount references**  [`/api/provider-health`](../server/index.js#L812)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /`](../server/routes/providerHealth.js#L19) · handler `providerHealthController.listProviders`
- [`GET /:id`](../server/routes/providerHealth.js#L22) · handler `providerHealthController.getProvider`
- [`POST /:id/probe`](../server/routes/providerHealth.js#L25) · guards `generalLimiter` · handler `providerHealthController.runProbe`
- [`POST /:id/circuit/reset`](../server/routes/providerHealth.js#L28) · guards `generalLimiter` · handler `providerHealthController.resetCircuit`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-048"></a>

**Server router inventory** · Page 355 of 393 · API-048

## qrCodes through quoteRequests

### qrCodes

[Router source](../server/routes/qrCodes.js) · 8 literal method and path entries

**Mount references**  [`/api/qr-codes`](../server/index.js#L663)

**Detected router middleware**  `authenticate`, `generalLimiter`

- [`POST /export-checkout`](../server/routes/qrCodes.js#L46) · guards `checkRestrictions` · handler `createQrExportCheckout`
- [`GET /`](../server/routes/qrCodes.js#L53) · handler `getQRCodes`
- [`PUT /:id`](../server/routes/qrCodes.js#L59) · handler `updateQRCode`
- [`DELETE /:id`](../server/routes/qrCodes.js#L62) · handler `deleteQRCode`

### qrPayments

[Router source](../server/routes/qrPayments.js) · 9 literal method and path entries

**Mount references**  [`/api/qr-payments`](../server/index.js#L640)

- [`POST /codes`](../server/routes/qrPayments.js#L194) · guards `authenticate, paymentsLimiter`
- [`GET /codes`](../server/routes/qrPayments.js#L255) · guards `authenticate`
- [`PATCH /codes/:id`](../server/routes/qrPayments.js#L283) · guards `authenticate, paymentsLimiter`
- [`DELETE /codes/:id`](../server/routes/qrPayments.js#L352) · guards `authenticate, paymentsLimiter`

**Refactor work**  [WP-084](#wp-084)

### quoteRequests

[Router source](../server/routes/quoteRequests.js) · 6 literal method and path entries

**Mount references**  [`/api/quote-requests`](../server/index.js#L672)

- [`POST /`](../server/routes/quoteRequests.js#L9) · guards `generalLimiter, optionalAuth` · handler `ctrl.createQuoteRequest`
- [`GET /my`](../server/routes/quoteRequests.js#L10) · guards `authenticate` · handler `ctrl.getMyQuoteRequests`
- [`GET /admin/list`](../server/routes/quoteRequests.js#L11) · guards `authenticate, requireAdmin, requirePermission` · handler `ctrl.listQuoteRequests`
- [`PATCH /admin/:id`](../server/routes/quoteRequests.js#L13) · guards `authenticate, requireAdmin, requirePermission` · handler `ctrl.updateQuoteRequestAdmin`

**Refactor work**  [WP-028](#wp-028)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-049"></a>

**Server router inventory** · Page 356 of 393 · API-049

## recommendations through referrals

### recommendations

[Router source](../server/routes/recommendations.js) · 2 literal method and path entries

**Mount references**  [`/api/recommendations`](../server/index.js#L650)

- [`GET /`](../server/routes/recommendations.js#L14) · guards `authenticate` · handler `getRecommendations`
- [`POST /:id/dismiss`](../server/routes/recommendations.js#L15) · guards `authenticate` · handler `dismissRecommendation`

**Refactor work**  [WP-024](#wp-024)

### reconciliation

[Router source](../server/routes/reconciliation.js) · 4 literal method and path entries

**Mount references**  [`/api/admin/reconciliation`](../server/index.js#L803)

- [`GET /`](../server/routes/reconciliation.js#L13) · guards `requireAdmin, requirePermission` · handler `reconciliationController.listExceptions`
- [`POST /exceptions/:id/assign`](../server/routes/reconciliation.js#L14) · guards `requireAdmin, requirePermission` · handler `reconciliationController.assignException`
- [`POST /exceptions/:id/acknowledge`](../server/routes/reconciliation.js#L15) · guards `requireAdmin, requirePermission` · handler `reconciliationController.acknowledgeException`
- [`POST /exceptions/:id/resolve`](../server/routes/reconciliation.js#L16) · guards `requireAdmin, requirePermission` · handler `reconciliationController.resolveException`

### referrals

[Router source](../server/routes/referrals.js) · 3 literal method and path entries

**Mount references**  [`/api/referrals`](../server/index.js#L641)

- [`GET /me`](../server/routes/referrals.js#L6) · guards `authenticate` · handler `ctrl.getMyReferral`
- [`GET /balance`](../server/routes/referrals.js#L7) · guards `authenticate` · handler `ctrl.getCreditBalance`
- [`POST /validate`](../server/routes/referrals.js#L8) · guards `authLimiter` · handler `ctrl.validateCode`

**Refactor work**  [WP-097](#wp-097)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-050"></a>

**Server router inventory** · Page 357 of 393 · API-050

## reliability through reputation

### reliability

[Router source](../server/routes/reliability.js) · 6 literal method and path entries

**Mount references**  [`/api/admin/super/reliability`](../server/index.js#L809)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /releases`](../server/routes/reliability.js#L20) · handler `reliabilityController.listReleases`
- [`POST /releases`](../server/routes/reliability.js#L21) · handler `reliabilityController.createRelease`
- [`GET /migrations`](../server/routes/reliability.js#L22) · handler `reliabilityController.listMigrations`
- [`GET /budgets`](../server/routes/reliability.js#L23) · handler `reliabilityController.getBudgets`

### reporting

[Router source](../server/routes/reporting.js) · 5 literal method and path entries

**Mount references**  [`/api/reports`](../server/index.js#L743)

- [`POST /`](../server/routes/reporting.js#L14) · guards `requireAuth` · handler `reportingController.submitReport`
- [`GET /my-reports`](../server/routes/reporting.js#L15) · guards `requireAuth` · handler `reportingController.getMyReports`
- [`GET /admin/all`](../server/routes/reporting.js#L18) · guards `requireAuth, requireAdmin, requirePermission` · handler `reportingController.listReports`
- [`PATCH /admin/:reportId/status`](../server/routes/reporting.js#L20) · guards `requireAuth, requireAdmin, requirePermission` · handler `reportingController.updateReportStatus`

**Refactor work**  [WP-091](#wp-091)

### reputation

[Router source](../server/routes/reputation.js) · 6 literal method and path entries

**Mount references**  [`/api/reputation`](../server/index.js#L740)

- [`GET /:userId`](../server/routes/reputation.js#L20) · handler `getUserReputation`
- [`GET /customers/:userId/reliability`](../server/routes/reputation.js#L23) · handler `getCustomerReliability`
- [`GET /:userId/fee-history`](../server/routes/reputation.js#L26) · guards `requireAuth` · handler `getFeeHistory`
- [`POST /:userId/recalculate`](../server/routes/reputation.js#L29) · guards `requireAuth, requireAdmin, requirePermission` · handler `recalculateReputation`

**Refactor work**  [WP-101](#wp-101)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-051"></a>

**Server router inventory** · Page 358 of 393 · API-051

## restaurantBrands through restaurantDisplays

### restaurantBrands

[Router source](../server/routes/restaurantBrands.js) · 28 literal method and path entries

**Mount references**  [`/api/restaurant-brands`](../server/index.js#L789)

**Detected router middleware**  `authenticate`, `authenticatedLimiter`

- [`GET /`](../server/routes/restaurantBrands.js#L17) · handler `brand.listBrands`
- [`POST /:brandId/menu/publish`](../server/routes/restaurantBrands.js#L21) · handler `brand.publishMenu`
- [`PUT /:brandId/fx-policy`](../server/routes/restaurantBrands.js#L38) · handler `brand.updateBrandFxPolicy`
- [`DELETE /:brandId/franchise-mappings/:locationId`](../server/routes/restaurantBrands.js#L59) · handler `franchiseMappings.removeFranchiseMapping`

**Refactor work**  [WP-056](#wp-056) · [WP-064](#wp-064)

### restaurantDevices

[Router source](../server/routes/restaurantDevices.js) · 3 literal method and path entries

**Mount references**  [`/api/restaurants`](../server/index.js#L788)

- [`POST /:restaurantId/devices/registry/:deviceId/authenticate`](../server/routes/restaurantDevices.js#L13) · guards `strictLimiter, scopeExempt` · handler `fleet.authenticate`
- [`GET /:restaurantId/devices/registry`](../server/routes/restaurantDevices.js#L15) · guards `authenticate, rejectImpersonated, requireRestaurantAccess, authenticatedLimiter` · handler `fleet.listFleet`
- [`PATCH /:restaurantId/devices/registry/:deviceId`](../server/routes/restaurantDevices.js#L16) · guards `authenticate, rejectImpersonated, requireRestaurantAccess, authenticatedLimiter` · handler `fleet.setDeviceStatus`

**Refactor work**  [WP-067](#wp-067)

### restaurantDisplays

[Router source](../server/routes/restaurantDisplays.js) · 7 literal method and path entries

**Mount references**  [`/api/restaurant/displays`](../server/index.js#L790)

- [`POST /pairing-code`](../server/routes/restaurantDisplays.js#L22) · guards `strictLimiter` · handler `displays.issuePairingCode`
- [`POST /status`](../server/routes/restaurantDisplays.js#L28) · guards `displayPollLimiter` · handler `displays.pairingStatus`
- [`GET /`](../server/routes/restaurantDisplays.js#L35) · guards `authenticate, rejectImpersonated, authenticatedLimiter` · handler `displays.listPairings`
- [`DELETE /:id`](../server/routes/restaurantDisplays.js#L37) · guards `authenticate, rejectImpersonated, authenticatedLimiter` · handler `displays.unpairDisplay`

**Refactor work**  [WP-067](#wp-067)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-052"></a>

**Server router inventory** · Page 359 of 393 · API-052

## restaurantPayouts through restaurantSupport

### restaurantPayouts

[Router source](../server/routes/restaurantPayouts.js) · 6 literal method and path entries

**Mount references**  [`/api/restaurants`](../server/index.js#L791)

- [`POST /:restaurantId/payouts/connect`](../server/routes/restaurantPayouts.js#L27) · guards `authenticate, requirePaymentsEnabled, connectAccountLimiter, requirePayoutManager` · handler `createConnectRestaurantAccount`
- [`GET /:restaurantId/payouts/status`](../server/routes/restaurantPayouts.js#L35) · guards `authenticate, requirePaymentsEnabled, requirePayoutManager` · handler `getRestaurantConnectStatus`
- [`POST /:restaurantId/payouts/disconnect`](../server/routes/restaurantPayouts.js#L42) · guards `authenticate, requirePaymentsEnabled, connectAccountLimiter, requirePayoutManager` · handler `disconnectConnectRestaurantAccount`
- [`GET /:restaurantId/wallet-payouts/balance`](../server/routes/restaurantPayouts.js#L54) · guards `authenticate, requirePayoutManager` · handler `walletPayoutCtrl.getPayoutBalance`

**Refactor work**  [WP-073](#wp-073)

### restaurants

[Router source](../server/routes/restaurants.js) · 433 literal method and path entries

**Mount references**  [`/api/restaurants`](../server/index.js#L786)

**Detected router middleware**  `authenticate`

- [`GET /:restaurantId/accounting/:provider/oauth/callback`](../server/routes/restaurants.js#L52) · guards `strictLimiter, scopeExempt` · handler `accounting.finishOAuth`
- [`POST /:restaurantId/devices/:deviceId/screen-orders`](../server/routes/restaurants.js#L69) · guards `strictLimiter, scopeExempt` · handler `screens.createOrder`
- [`PATCH /:restaurantId/devices/:deviceId/printer-jobs/:jobId`](../server/routes/restaurants.js#L86) · guards `appFlow.authenticateKitchenPrinterDevice, scopeExempt` · handler `appFlow.updatePrinterJob`
- [`PUT /:restaurantId/screens/enabled`](../server/routes/restaurants.js#L157) · guards `requireRestaurantAccess` · handler `screens.enable`

**Refactor work**  [WP-060](#wp-060) · [WP-061](#wp-061) · [WP-062](#wp-062) · [WP-063](#wp-063) · [WP-064](#wp-064)

### restaurantSupport

[Router source](../server/routes/restaurantSupport.js) · 16 literal method and path entries

**Mount references**  [`/api/restaurants`](../server/index.js#L784)

**Detected router middleware**  `authenticate`

- [`POST /support/cases`](../server/routes/restaurantSupport.js#L19) · handler `ctrl.createCase`
- [`GET /support/cases/my`](../server/routes/restaurantSupport.js#L20) · handler `ctrl.listMyCases`
- [`GET /support/cases/:caseId`](../server/routes/restaurantSupport.js#L21) · handler `ctrl.getMyCase`
- [`POST /support/cases/:caseId/messages`](../server/routes/restaurantSupport.js#L22) · handler `ctrl.addCustomerMessage`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-053"></a>

**Server router inventory** · Page 360 of 393 · API-053

## restaurantTopups through reviews

### restaurantTopups

[Router source](../server/routes/restaurantTopups.js) · 5 literal method and path entries

**Mount references**  [`/api/restaurants`](../server/index.js#L792)

- [`POST /:restaurantId/topup-eligibility/apply`](../server/routes/restaurantTopups.js#L24) · guards `authenticate, requirePayoutManager` · handler `ctrl.applyForEligibility`
- [`GET /:restaurantId/topup-eligibility`](../server/routes/restaurantTopups.js#L34) · guards `authenticate, scopeExempt` · handler `ctrl.getEligibility`
- [`POST /:restaurantId/topups`](../server/routes/restaurantTopups.js#L39) · guards `authenticate, restaurantTopupIntentLimiter, scopeExempt` · handler `ctrl.createTopup`
- [`POST /:restaurantId/topups/stepup-challenges`](../server/routes/restaurantTopups.js#L45) · guards `authenticate, restaurantTopupIntentLimiter, scopeExempt` · handler `ctrl.issueTopupStepupChallenge`

**Refactor work**  [WP-086](#wp-086)

### reviewModeration

[Router source](../server/routes/reviewModeration.js) · 9 literal method and path entries

**Mount references**  [`/api`](../server/index.js#L746)

- [`POST /reviews/:reviewId/report`](../server/routes/reviewModeration.js#L20) · guards `requireAuth` · handler `ctrl.reportReview`
- [`POST /business-reviews/:reviewId/report`](../server/routes/reviewModeration.js#L21) · guards `requireAuth` · handler `reportWithType`
- [`GET /reviews/my-reports`](../server/routes/reviewModeration.js#L25) · guards `requireAuth` · handler `ctrl.getMyReports`
- [`PUT /admin/reviews/reports/:reportId/resolve`](../server/routes/reviewModeration.js#L30) · guards `requireAuth, requireAdmin, requirePermission` · handler `ctrl.resolveReport`

**Refactor work**  [WP-030](#wp-030)

### reviews

[Router source](../server/routes/reviews.js) · 5 literal method and path entries

**Mount references**  [`/api/reviews`](../server/index.js#L551)

- [`GET /users/:userId`](../server/routes/reviews.js#L8) · handler `reviewCtrl.getUserReviews`
- [`POST /jobs/:jobId`](../server/routes/reviews.js#L11) · guards `authenticate` · handler `reviewCtrl.submitReview`
- [`GET /jobs/:jobId/eligibility`](../server/routes/reviews.js#L16) · guards `authenticate` · handler `reviewCtrl.getReviewEligibility`
- [`PUT /:id/respond`](../server/routes/reviews.js#L21) · guards `authenticate` · handler `reviewCtrl.respondToReview`

**Refactor work**  [WP-030](#wp-030)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-054"></a>

**Server router inventory** · Page 361 of 393 · API-054

## robots through safety

### robots

[Router source](../server/routes/robots.js) · 1 literal method and path entries

**Mount references**  [`/robots.txt`](../server/index.js#L844)

- [`GET /`](../server/routes/robots.js#L6)

### runner

[Router source](../server/routes/runner.js) · 2 literal method and path entries

**Mount references**  [`/api/runner`](../server/index.js#L541)

**Detected router middleware**  `authenticate`

- [`GET /workspaces`](../server/routes/runner.js#L10) · handler `runnerWorkspace.listWorkspaces`
- [`GET /inbox`](../server/routes/runner.js#L11) · handler `runnerWorkspace.getUnifiedInbox`

**Refactor work**  [WP-070](#wp-070)

### safety

[Router source](../server/routes/safety.js) · 3 literal method and path entries

**Mount references**  [`/api/safety`](../server/index.js#L688)

- [`POST /sos`](../server/routes/safety.js#L9) · guards `authenticate, strictLimiter` · handler `sendSOS`
- [`GET /sos`](../server/routes/safety.js#L12) · guards `authenticate, requireAdmin, requirePermission` · handler `listSOS`
- [`POST /sos/:id/acknowledge`](../server/routes/safety.js#L14) · guards `authenticate, requireAdmin, requirePermission, strictLimiter` · handler `acknowledgeSOS`

**Refactor work**  [WP-094](#wp-094)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-055"></a>

**Server router inventory** · Page 362 of 393 · API-055

## savedSearches through settings

### savedSearches

[Router source](../server/routes/savedSearches.js) · 4 literal method and path entries

**Mount references**  [`/api/saved-searches`](../server/index.js#L662)

- [`GET /`](../server/routes/savedSearches.js#L46) · guards `authenticate`
- [`POST /`](../server/routes/savedSearches.js#L60) · guards `authenticate`
- [`PUT /:id`](../server/routes/savedSearches.js#L115) · guards `authenticate`
- [`DELETE /:id`](../server/routes/savedSearches.js#L168) · guards `authenticate`

### serviceOps

[Router source](../server/routes/serviceOps.js) · 6 literal method and path entries

**Mount references**  [`/api/service-ops`](../server/index.js#L806)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /capacity`](../server/routes/serviceOps.js#L15) · handler `serviceOpsController.getCapacity`
- [`POST /runbooks`](../server/routes/serviceOps.js#L20) · handler `serviceOpsController.createRunbook`
- [`PUT /runbooks/:id`](../server/routes/serviceOps.js#L21) · handler `serviceOpsController.updateRunbook`
- [`DELETE /runbooks/:id`](../server/routes/serviceOps.js#L22) · handler `serviceOpsController.deleteRunbook`

**Refactor work**  [WP-100](#wp-100)

### settings

[Router source](../server/routes/settings.js) · 2 literal method and path entries

**Mount references**  [`/api/settings`](../server/index.js#L652)

- [`PATCH /privacy`](../server/routes/settings.js#L8) · guards `authenticate` · handler `patchPrivacySettings`
- [`POST /app-report`](../server/routes/settings.js#L9) · guards `authenticate` · handler `submitAppReport`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-056"></a>

**Server router inventory** · Page 363 of 393 · API-056

## settingsChanges through sharedCarts

### settingsChanges

[Router source](../server/routes/settingsChanges.js) · 7 literal method and path entries

**Mount references**  [`/api/admin/settings-changes`](../server/index.js#L814)

**Detected router middleware**  `requireAdmin`

- [`POST /`](../server/routes/settingsChanges.js#L25) · guards `requirePermission` · handler `settingsChangeController.proposeChange`
- [`GET /`](../server/routes/settingsChanges.js#L26) · guards `requirePermission` · handler `settingsChangeController.listChanges`
- [`GET /:id/preview`](../server/routes/settingsChanges.js#L27) · guards `requirePermission` · handler `settingsChangeController.previewChange`
- [`POST /:id/approve`](../server/routes/settingsChanges.js#L28) · guards `rejectImpersonated, requirePermission` · handler `settingsChangeController.approveChange`

### settlementStatementArchive

[Router source](../server/routes/settlementStatementArchive.js) · 5 literal method and path entries

**Mount references**  [`/api/settlement-statements`](../server/index.js#L774)

**Detected router middleware**  `authenticate`

- [`GET /issue`](../server/routes/settlementStatementArchive.js#L175) · guards `creditExportLimiter`
- [`GET /archive`](../server/routes/settlementStatementArchive.js#L207)
- [`GET /archive/:id.csv`](../server/routes/settlementStatementArchive.js#L266) · guards `creditExportLimiter`
- [`GET /archive/:id`](../server/routes/settlementStatementArchive.js#L278)

**Refactor work**  [WP-073](#wp-073)

### sharedCarts

[Router source](../server/routes/sharedCarts.js) · 9 literal method and path entries

**Mount references**  [`/api/shared-carts`](../server/index.js#L750)

**Detected router middleware**  `generalLimiter`

- [`POST /`](../server/routes/sharedCarts.js#L10) · guards `authenticate` · handler `sharedCartsController.shareCart`
- [`GET /my`](../server/routes/sharedCarts.js#L13) · guards `authenticate` · handler `sharedCartsController.listMySharedCarts`
- [`PUT /:shareToken/items/:itemId`](../server/routes/sharedCarts.js#L19) · guards `optionalAuth` · handler `sharedCartsController.modifySharedCart`
- [`DELETE /:shareToken/items/:itemId`](../server/routes/sharedCarts.js#L25) · guards `optionalAuth` · handler `sharedCartsController.removeItemFromSharedCart`

**Refactor work**  [WP-040](#wp-040)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-057"></a>

**Server router inventory** · Page 364 of 393 · API-057

## shoppingCarts through siteVisits

### shoppingCarts

[Router source](../server/routes/shoppingCarts.js) · 11 literal method and path entries

**Mount references**  [`/api/carts`](../server/index.js#L748)

**Detected router middleware**  `authenticate`, `generalLimiter`

- [`POST /`](../server/routes/shoppingCarts.js#L12) · handler `shoppingCartsController.createCart`
- [`GET /`](../server/routes/shoppingCarts.js#L15) · handler `shoppingCartsController.getCarts`
- [`PUT /:cartId`](../server/routes/shoppingCarts.js#L26) · handler `shoppingCartsController.updateCart`
- [`DELETE /:cartId`](../server/routes/shoppingCarts.js#L29) · handler `shoppingCartsController.deleteCart`

**Refactor work**  [WP-040](#wp-040)

### sitemap

[Router source](../server/routes/sitemap.js) · 1 literal method and path entries

**Mount references**  [`/sitemap.xml`](../server/index.js#L845)

- [`GET /`](../server/routes/sitemap.js#L62)

### siteVisits

[Router source](../server/routes/siteVisits.js) · 3 literal method and path entries

**Mount references**  [`/api/analytics`](../server/index.js#L690)

**Detected router middleware**  `authenticate`, `requireAdmin`, `requirePermission`

- [`POST /pageview`](../server/routes/siteVisits.js#L10) · guards `generalLimiter, optionalAuth` · handler `siteVisitController.recordPageview`
- [`GET /admin/visitors`](../server/routes/siteVisits.js#L15) · handler `siteVisitController.listVisits`
- [`GET /admin/visitors/summary`](../server/routes/siteVisits.js#L16) · handler `siteVisitController.getSummary`

**Refactor work**  [WP-075](#wp-075)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-058"></a>

**Server router inventory** · Page 365 of 393 · API-058

## smsNotifications through statementArchive

### smsNotifications

[Router source](../server/routes/smsNotifications.js) · 5 literal method and path entries

**Mount references**  [`/api/notifications/sms`](../server/index.js#L822)

- [`POST /request-verification`](../server/routes/smsNotifications.js#L7) · guards `requireAuth` · handler `smsNotificationController.requestPhoneVerification`
- [`POST /verify-otp`](../server/routes/smsNotifications.js#L10) · guards `requireAuth` · handler `smsNotificationController.verifyPhone`
- [`GET /preferences`](../server/routes/smsNotifications.js#L13) · guards `requireAuth` · handler `smsNotificationController.getSMSPreferences`
- [`PUT /preferences`](../server/routes/smsNotifications.js#L16) · guards `requireAuth` · handler `smsNotificationController.updateSMSPreferences`

**Refactor work**  [WP-099](#wp-099)

### statementAdmin

[Router source](../server/routes/statementAdmin.js) · 14 literal method and path entries

**Mount references**  [`/api/admin/statements`](../server/index.js#L555)

- [`GET /ops/runs`](../server/routes/statementAdmin.js#L184) · guards `requireAdmin, requirePermission`
- [`GET /ops/runs/:id`](../server/routes/statementAdmin.js#L264) · guards `requireAdmin, requirePermission`
- [`POST /ops/runs/:id/pause`](../server/routes/statementAdmin.js#L318) · guards `requireAdmin, requirePermission`
- [`POST /ops/runs/:id/resume`](../server/routes/statementAdmin.js#L334) · guards `requireAdmin, requirePermission`

### statementArchive

[Router source](../server/routes/statementArchive.js) · 5 literal method and path entries

**Mount references**  [`/api/statement-archive`](../server/index.js#L773)

**Detected router middleware**  `authenticate`

- [`GET /scopes`](../server/routes/statementArchive.js#L506)
- [`GET /archive`](../server/routes/statementArchive.js#L533)
- [`GET /archive/:documentId`](../server/routes/statementArchive.js#L689)
- [`GET /archive/:documentId/download`](../server/routes/statementArchive.js#L747) · guards `creditExportLimiter`

**Refactor work**  [WP-087](#wp-087)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-059"></a>

**Server router inventory** · Page 366 of 393 · API-059

## statementCenter through statementExports

### statementCenter

[Router source](../server/routes/statementCenter.js) · 1 literal method and path entries

**Mount references**  [`/api`](../server/index.js#L776)

- [`GET /statements/center`](../server/routes/statementCenter.js#L18) · guards `authenticate`

**Refactor work**  [WP-073](#wp-073) · [WP-087](#wp-087)

### statementDisputeMessages

[Router source](../server/routes/statementDisputeMessages.js) · 2 literal method and path entries

**Mount references**  [`/api`](../server/index.js#L780)

**Detected router middleware**  `authenticate`

- [`GET /statements/disputes/:disputeId/messages`](../server/routes/statementDisputeMessages.js#L162)
- [`POST /statements/disputes/:disputeId/messages`](../server/routes/statementDisputeMessages.js#L177) · guards `disputeMessageLimiter`

### statementExports

[Router source](../server/routes/statementExports.js) · 14 literal method and path entries

**Mount references**  [`/api/statements/exports`](../server/index.js#L775)

**Detected router middleware**  `authenticate`

- [`GET /`](../server/routes/statementExports.js#L28) · handler `action`
- [`POST /bulk`](../server/routes/statementExports.js#L34) · guards `creditExportLimiter` · handler `action`
- [`POST /bulk/package`](../server/routes/statementExports.js#L40) · guards `creditExportLimiter` · handler `action`
- [`DELETE /notes/:id`](../server/routes/statementExports.js#L66) · handler `action`

**Refactor work**  [WP-087](#wp-087)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-060"></a>

**Server router inventory** · Page 367 of 393 · API-060

## statementInvestigation through statementRenditions

### statementInvestigation

[Router source](../server/routes/statementInvestigation.js) · 7 literal method and path entries

**Mount references**  [`/api`](../server/index.js#L779)

**Detected router middleware**  `authenticate`, `requireRole`

- [`GET /statements/:documentId/entries`](../server/routes/statementInvestigation.js#L924)
- [`GET /statements/:documentId/entries/:entryId`](../server/routes/statementInvestigation.js#L948)
- [`POST /statements/:documentId/entries/:entryId/cases`](../server/routes/statementInvestigation.js#L970) · guards `creditMutationLimiter`
- [`GET /statements/:documentId/entries/:entryId/cases`](../server/routes/statementInvestigation.js#L1044)

**Refactor work**  [WP-100](#wp-100)

### statementIssuance

[Router source](../server/routes/statementIssuance.js) · 5 literal method and path entries

**Mount references**  [`/api/statement-issuance`](../server/index.js#L556)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`POST /runs`](../server/routes/statementIssuance.js#L92)
- [`POST /runs/:id/pause`](../server/routes/statementIssuance.js#L110)
- [`POST /runs/:id/resume`](../server/routes/statementIssuance.js#L128)
- [`GET /runs/:id/stats`](../server/routes/statementIssuance.js#L162)

### statementRenditions

[Router source](../server/routes/statementRenditions.js) · 2 literal method and path entries

**Mount references**  [`/api/statements`](../server/index.js#L778)

- [`GET /documents/:documentId/renditions/:language/pdf`](../server/routes/statementRenditions.js#L435) · guards `authenticate`
- [`GET /documents/:documentId/renditions/:language/html`](../server/routes/statementRenditions.js#L436) · guards `authenticate`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-061"></a>

**Server router inventory** · Page 368 of 393 · API-061

## statementSearch through storeHubs

### statementSearch

[Router source](../server/routes/statementSearch.js) · 5 literal method and path entries

**Mount references**  [`/api/statements`](../server/index.js#L777)

**Detected router middleware**  `authenticate`

- [`GET /search`](../server/routes/statementSearch.js#L52)
- [`GET /saved-views`](../server/routes/statementSearch.js#L65)
- [`POST /saved-views`](../server/routes/statementSearch.js#L73)
- [`DELETE /saved-views/:id`](../server/routes/statementSearch.js#L85)

**Refactor work**  [WP-087](#wp-087)

### storage

[Router source](../server/routes/storage.js) · 2 literal method and path entries

**Mount references**  [`/api/storage`](../server/index.js#L754)

- [`GET /public/*`](../server/routes/storage.js#L115)
- [`GET /files/*`](../server/routes/storage.js#L123)

**Refactor work**  [WP-095](#wp-095)

### storeHubs

[Router source](../server/routes/storeHubs.js) · 10 literal method and path entries

**Mount references**  [`/api/restaurants`](../server/index.js#L787)

- [`GET /:restaurantId/hubs`](../server/routes/storeHubs.js#L16) · guards `authenticate, rejectImpersonated, requireRestaurantAccess, authenticatedLimiter` · handler `hub.listHubs`
- [`POST /:restaurantId/hubs`](../server/routes/storeHubs.js#L17) · guards `authenticate, rejectImpersonated, requireRestaurantAccess, authenticatedLimiter` · handler `hub.registerHub`
- [`POST /:restaurantId/hubs/:hubId/replay`](../server/routes/storeHubs.js#L18) · guards `authenticate, rejectImpersonated, requireRestaurantAccess, strictLimiter` · handler `hub.replaySales`
- [`GET /:restaurantId/hubs/:hubId/offline-sales`](../server/routes/storeHubs.js#L19) · guards `authenticate, rejectImpersonated, requireRestaurantAccess, authenticatedLimiter` · handler `hub.listOfflineSales`

**Refactor work**  [WP-072](#wp-072)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-062"></a>

**Server router inventory** · Page 369 of 393 · API-062

## subscription through supportAgents

### subscription

[Router source](../server/routes/subscription.js) · 7 literal method and path entries

**Mount references**  [`/api/subscription`](../server/index.js#L543)

- [`GET /plans`](../server/routes/subscription.js#L15) · handler `subCtrl.getPlans`
- [`POST /checkout`](../server/routes/subscription.js#L17) · guards `authenticate, rejectImpersonated, requireSubscriptionsLaunched, checkRestrictions` · handler `subCtrl.createCheckout`
- [`GET /current`](../server/routes/subscription.js#L18) · guards `authenticate` · handler `subCtrl.getSubscription`
- [`GET /badges/:userId`](../server/routes/subscription.js#L19)

**Refactor work**  [WP-096](#wp-096)

### support

[Router source](../server/routes/support.js) · 202 literal method and path entries

**Mount references**  [`/api/support`](../server/index.js#L632)

**Detected router middleware**  `requireAuth`

- [`POST /public/conversations`](../server/routes/support.js#L60) · guards `conversationMessageLimiter` · handler `publicSupport.createGuestConversation`
- [`GET /public/conversations/:conversationId`](../server/routes/support.js#L63) · guards `publicSupport.guestToken` · handler `publicSupport.loadGuestConversation`
- [`PUT /public/conversations/:conversationId/messages/:messageId`](../server/routes/support.js#L65) · guards `conversationMessageLimiter, publicSupport.guestToken` · handler `publicSupport.updateGuestMessage`
- [`PATCH /agent/me/availability`](../server/routes/support.js#L91) · handler `supportAgentPortalController.patchMyAvailability`

**Refactor work**  [WP-035](#wp-035)

### supportAgents

[Router source](../server/routes/supportAgents.js) · 3 literal method and path entries

**Mount references**  [`/api/support/agents`](../server/index.js#L635)

- [`GET /employers/me`](../server/routes/supportAgents.js#L13) · guards `authenticate` · handler `listMySupportEmployers`
- [`POST /employers/helper`](../server/routes/supportAgents.js#L18) · guards `authenticate` · handler `ensureMyHelperEmployer`
- [`POST /onboard`](../server/routes/supportAgents.js#L23) · guards `authenticate` · handler `onboardAgent`

**Refactor work**  [WP-036](#wp-036)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-063"></a>

**Server router inventory** · Page 370 of 393 · API-063

## supportChannelWebhooks through supportRouting

### supportChannelWebhooks

[Router source](../server/routes/supportChannelWebhooks.js) · 1 literal method and path entries

**Mount references**  [`/api/support/webhooks`](../server/index.js#L352)

- [`POST /:channel`](../server/routes/supportChannelWebhooks.js#L7) · handler `controller.ingestChannelWebhook`

**Refactor work**  [WP-099](#wp-099)

### supportChat

[Router source](../server/routes/supportChat.js) · 3 literal method and path entries

**Mount references**  [`/api/support-chat`](../server/index.js#L633)

- [`GET /admin-status`](../server/routes/supportChat.js#L15) · handler `getAdminStatus`
- [`POST /initiate`](../server/routes/supportChat.js#L23) · guards `authLimiter, optionalAuth` · handler `initiateSupportChat`
- [`POST /messages`](../server/routes/supportChat.js#L30) · guards `conversationMessageLimiter, optionalAuth` · handler `sendSupportMessage`

**Refactor work**  [WP-035](#wp-035)

### supportRouting

[Router source](../server/routes/supportRouting.js) · 9 literal method and path entries

**Mount references**  [`/api/support-routing`](../server/index.js#L634)

- [`GET /status`](../server/routes/supportRouting.js#L38) · guards `requireAuth` · handler `supportRoutingController.getStatus`
- [`POST /connect`](../server/routes/supportRouting.js#L40) · guards `authenticatedLimiter, requireAuth`
- [`POST /conversations`](../server/routes/supportRouting.js#L51) · guards `conversationMessageLimiter, requireAuth`
- [`PUT /:businessId/conversations/:ticketId/status`](../server/routes/supportRouting.js#L77) · guards `requireAuth, scopeExempt` · handler `supportRoutingController.updateStatus`

**Refactor work**  [WP-036](#wp-036)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-064"></a>

**Server router inventory** · Page 371 of 393 · API-064

## tax through toolRentals

### tax

[Router source](../server/routes/tax.js) · 3 literal method and path entries

**Mount references**  [`/api/tax`](../server/index.js#L658)

- [`GET /summary`](../server/routes/tax.js#L15) · guards `authenticate`
- [`GET /expenses`](../server/routes/tax.js#L99) · guards `authenticate`
- [`GET /1099-preview`](../server/routes/tax.js#L136) · guards `authenticate`

**Refactor work**  [WP-085](#wp-085)

### templates

[Router source](../server/routes/templates.js) · 12 literal method and path entries

**Mount references**  [`/api/templates`](../server/index.js#L823)

- [`GET /`](../server/routes/templates.js#L11) · handler `ctrl.listTemplates`
- [`POST /activate`](../server/routes/templates.js#L21) · guards `authenticate` · handler `ctrl.activateTemplate`
- [`PATCH /admin/pricing/:slug`](../server/routes/templates.js#L38) · guards `authenticate, requireAdmin, requirePermission` · handler `ctrl.adminUpdatePricing`
- [`PUT /admin/pricing/bulk`](../server/routes/templates.js#L41) · guards `authenticate, requireAdmin, requirePermission` · handler `ctrl.adminBulkUpdatePricing`

**Refactor work**  [WP-058](#wp-058)

### toolRentals

[Router source](../server/routes/toolRentals.js) · 40 literal method and path entries

**Mount references**  [`/api/tool-rentals`](../server/index.js#L639)

- [`GET /categories`](../server/routes/toolRentals.js#L315)
- [`POST /payment-method`](../server/routes/toolRentals.js#L448) · guards `authenticate` · handler `paymentMethodController.setPaymentMethod`
- [`DELETE /payment-method`](../server/routes/toolRentals.js#L449) · guards `authenticate` · handler `paymentMethodController.deletePaymentMethod`
- [`PUT /:id`](../server/routes/toolRentals.js#L540) · guards `authenticate, upload.single, validateFileUpload`

**Refactor work**  [WP-037](#wp-037) · [WP-038](#wp-038)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-065"></a>

**Server router inventory** · Page 372 of 393 · API-065

## tradesOperations through treasury

### tradesOperations

[Router source](../server/routes/tradesOperations.js) · 12 literal method and path entries

**Mount references**  [`/api/trades-operations`](../server/index.js#L734)

- [`GET /public/:businessId`](../server/routes/tradesOperations.js#L14) · guards `scopeExempt` · handler `controller.getPublicWorkspace`
- [`POST /public/:businessId/requests`](../server/routes/tradesOperations.js#L15) · guards `publicIntakeLimiter, generalLimiter, upload.array, validateFileUpload` · handler `controller.createDiagnosticRequest`
- [`PUT /business/:businessId/settings`](../server/routes/tradesOperations.js#L18) · guards `authenticate, requireBusinessAccess.manager` · handler `controller.updateSettings`
- [`DELETE /business/:businessId/recommendations/:recommendationId`](../server/routes/tradesOperations.js#L25) · guards `authenticate, requireBusinessAccess.member` · handler `controller.deleteRecommendation`

**Refactor work**  [WP-058](#wp-058)

### translate

[Router source](../server/routes/translate.js) · 15 literal method and path entries

**Mount references**  [`/api/translate`](../server/index.js#L648)

- [`GET /languages`](../server/routes/translate.js#L6) · handler `controller.handleLanguages`
- [`POST /detect-language`](../server/routes/translate.js#L8) · guards `generalLimiter, controller.optionalAuth` · handler `controller.handleDetectLanguage`
- [`PATCH /glossaries/:id`](../server/routes/translate.js#L20) · guards `controller.authenticate` · handler `controller.handleUpdateGlossary`
- [`DELETE /glossaries/:id`](../server/routes/translate.js#L21) · guards `controller.authenticate` · handler `controller.handleDeleteGlossary`

### treasury

[Router source](../server/routes/treasury.js) · 11 literal method and path entries

**Mount references**  [`/api/admin/treasury`](../server/index.js#L579)

**Detected router middleware**  `requireAdmin`, `requirePermission`

- [`GET /entities`](../server/routes/treasury.js#L15) · handler `controller.listEntities`
- [`POST /entities`](../server/routes/treasury.js#L16) · guards `writeGate` · handler `controller.createEntity`
- [`GET /accounts`](../server/routes/treasury.js#L18) · handler `controller.listAccounts`
- [`POST /accounts`](../server/routes/treasury.js#L19) · guards `writeGate` · handler `controller.createAccount`

**Refactor work**  [WP-100](#wp-100)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-066"></a>

**Server router inventory** · Page 373 of 393 · API-066

## twoFactor through userPasskeys

### twoFactor

[Router source](../server/routes/twoFactor.js) · 6 literal method and path entries

**Mount references**  [`/api/2fa`](../server/index.js#L568)

- [`GET /status`](../server/routes/twoFactor.js#L21) · guards `authenticate` · handler `get2FAStatus`
- [`POST /setup`](../server/routes/twoFactor.js#L27) · guards `authenticate, rejectImpersonated, strictLimiter` · handler `setup2FA`
- [`POST /verify-setup`](../server/routes/twoFactor.js#L30) · guards `authenticate, rejectImpersonated, strictLimiter` · handler `verifySetup`
- [`POST /validate`](../server/routes/twoFactor.js#L33) · guards `strictLimiter` · handler `validate2FA`

**Refactor work**  [WP-018](#wp-018) · [WP-090](#wp-090)

### upload

[Router source](../server/routes/upload.js) · 4 literal method and path entries

**Mount references**  [`/api/upload`](../server/index.js#L753)

**Detected router middleware**  `authenticate`, `authenticatedLimiter`

- [`POST /profile-photo`](../server/routes/upload.js#L115) · guards `upload.single, validateFileUpload`
- [`POST /image`](../server/routes/upload.js#L201) · guards `upload.single, validateFileUpload`
- [`POST /document`](../server/routes/upload.js#L205) · guards `upload.single, validateFileUpload`
- [`POST /`](../server/routes/upload.js#L209) · guards `upload.single, validateFileUpload`

**Refactor work**  [WP-095](#wp-095)

### userPasskeys

[Router source](../server/routes/userPasskeys.js) · 7 literal method and path entries

**Mount references**  [`/api/passkeys`](../server/index.js#L571)

- [`GET /`](../server/routes/userPasskeys.js#L9) · guards `authenticate` · handler `controller.listPasskeys`
- [`POST /registration/options`](../server/routes/userPasskeys.js#L12) · guards `authenticate, rejectImpersonated, strictLimiter` · handler `controller.registrationOptions`
- [`DELETE /:id`](../server/routes/userPasskeys.js#L14) · guards `authenticate, rejectImpersonated, strictLimiter` · handler `controller.revokePasskey`
- [`PATCH /:id`](../server/routes/userPasskeys.js#L15) · guards `authenticate, rejectImpersonated, strictLimiter` · handler `controller.renamePasskey`

**Refactor work**  [WP-018](#wp-018)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-067"></a>

**Server router inventory** · Page 374 of 393 · API-067

## users through vehicles

### users

[Router source](../server/routes/users.js) · 6 literal method and path entries

**Mount references**  [`/api/users`](../server/index.js#L542)

- [`GET /me`](../server/routes/users.js#L15) · guards `authenticate` · handler `getMe`
- [`PATCH /me`](../server/routes/users.js#L16) · guards `authenticate, rejectImpersonated` · handler `updateProfile`
- [`GET /me/sessions`](../server/routes/users.js#L19) · guards `authenticatedLimiter, authenticate` · handler `listMySessions`
- [`DELETE /me/sessions/:sessionId`](../server/routes/users.js#L20) · guards `strictLimiter, authenticate` · handler `revokeMySession`

**Refactor work**  [WP-022](#wp-022)

### userSkills

[Router source](../server/routes/userSkills.js) · 6 literal method and path entries

**Mount references**  [`/api/user-skills`](../server/index.js#L638)

- [`GET /categories`](../server/routes/userSkills.js#L16)
- [`POST /`](../server/routes/userSkills.js#L79) · guards `authenticate`
- [`PUT /:id`](../server/routes/userSkills.js#L122) · guards `authenticate`
- [`DELETE /:id`](../server/routes/userSkills.js#L164) · guards `authenticate`

**Refactor work**  [WP-044](#wp-044)

### vehicles

[Router source](../server/routes/vehicles.js) · 7 literal method and path entries

**Mount references**  [`/api/vehicles`](../server/index.js#L643)

- [`GET /makes`](../server/routes/vehicles.js#L13) · guards `geoLimiter` · handler `ctrl.getMakes`
- [`POST /my`](../server/routes/vehicles.js#L19) · guards `authenticate` · handler `ctrl.addVehicle`
- [`PATCH /my/:id`](../server/routes/vehicles.js#L20) · guards `authenticate` · handler `ctrl.updateVehicle`
- [`DELETE /my/:id`](../server/routes/vehicles.js#L21) · guards `authenticate` · handler `ctrl.deleteVehicle`

**Refactor work**  [WP-045](#wp-045)

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-068"></a>

**Server router inventory** · Page 375 of 393 · API-068

## verification through webhook

### verification

[Router source](../server/routes/verification.js) · 6 literal method and path entries

**Mount references**  [`/api/subscription/background-check`](../server/index.js#L574) · [`/api/subscription/identity`](../server/index.js#L575) · [`/api/verification`](../server/index.js#L585)

- [`POST /background-check`](../server/routes/verification.js#L7) · guards `authenticate` · handler `ctrl.initiateBackgroundCheck`
- [`GET /background-check/status`](../server/routes/verification.js#L8) · guards `authenticate` · handler `ctrl.getBackgroundCheckStatus`
- [`POST /identity/session`](../server/routes/verification.js#L17) · guards `authenticate` · handler `ctrl.createIdentitySession`
- [`GET /identity/status`](../server/routes/verification.js#L18) · guards `authenticate` · handler `ctrl.getIdentityStatus`

**Refactor work**  [WP-007](#wp-007) · [WP-085](#wp-085) · [WP-095](#wp-095)

### vortex

[Router source](../server/routes/vortex.js) · 2 literal method and path entries

**Mount references**  [`/api/vortex`](../server/index.js#L612)

- [`POST /preview`](../server/routes/vortex.js#L32) · guards `authenticate, rejectImpersonated, requireVortexEnabled, vortexRedeemLimiter` · handler `access.previewCode`
- [`POST /redeem`](../server/routes/vortex.js#L33) · guards `authenticate, rejectImpersonated, requireVortexEnabled, vortexRedeemLimiter` · handler `access.redeemCode`

**Refactor work**  [WP-009](#wp-009)

### webhook

[Router source](../server/routes/webhook.js) · 4 literal method and path entries

**Mount references**  [`/api/webhooks`](../server/index.js#L326)

- [`POST /stripe`](../server/routes/webhook.js#L6) · guards `express.raw` · handler `webhookCtrl.stripeWebhook`
- [`POST /stripe/connect`](../server/routes/webhook.js#L7) · guards `express.raw`
- [`POST /didit`](../server/routes/webhook.js#L13) · guards `express.raw` · handler `webhookCtrl.diditWebhook`
- [`POST /resend`](../server/routes/webhook.js#L16) · guards `express.raw`

<div style="break-before: page; page-break-before: always;"></div>

<a id="api-069"></a>

**Server router inventory** · Page 376 of 393 · API-069

## workAgreements through workforce

### workAgreements

[Router source](../server/routes/workAgreements.js) · 19 literal method and path entries

**Mount references**  [`/api/work-agreements`](../server/index.js#L549)

- [`POST /draft`](../server/routes/workAgreements.js#L13) · guards `authenticate` · handler `wa.draftAgreement`
- [`GET /by-job/:jobId`](../server/routes/workAgreements.js#L14) · guards `authenticate` · handler `wa.getByJob`
- [`POST /`](../server/routes/workAgreements.js#L15) · guards `authenticate` · handler `wa.createAgreement`
- [`GET /`](../server/routes/workAgreements.js#L16) · guards `authenticate` · handler `wa.listAgreements`

**Refactor work**  [WP-029](#wp-029)

### workforce

[Router source](../server/routes/workforce.js) · 5 literal method and path entries

**Mount references**  [`/api/admin/super/workforce`](../server/index.js#L808)

- [`GET /staff`](../server/routes/workforce.js#L18) · handler `controller.getStaff`
- [`GET /delegations`](../server/routes/workforce.js#L19) · handler `controller.listDelegations`
- [`POST /delegations`](../server/routes/workforce.js#L20) · handler `controller.createDelegation`
- [`POST /delegations/:id/revoke`](../server/routes/workforce.js#L21) · handler `controller.revokeDelegation`

**Refactor work**  [WP-089](#wp-089)

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-001"></a>

**Browser route inventory** · Page 377 of 393 · WEB-001

## App route declarations 1–18

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/impersonate` | `ImpersonatePage` | [View declaration](../client/src/App.jsx#L479) |
| `/` | `Guarded` | [View declaration](../client/src/App.jsx#L481) |
| `/status` | `Guarded` | [View declaration](../client/src/App.jsx#L482) |
| `/login` | `Guarded` | [View declaration](../client/src/App.jsx#L483) |
| `/investor/login` | `Guarded` | [View declaration](../client/src/App.jsx#L484) |
| `/register/customer` | `Navigate` | [View declaration](../client/src/App.jsx#L485) |
| `/register/helper` | `Navigate` | [View declaration](../client/src/App.jsx#L486) |
| `/join` | `Guarded` | [View declaration](../client/src/App.jsx#L490) |
| `/forgot-password` | `Guarded` | [View declaration](../client/src/App.jsx#L491) |
| `/reset-password/:token` | `Guarded` | [View declaration](../client/src/App.jsx#L492) |
| `/how-it-works` | `Guarded` | [View declaration](../client/src/App.jsx#L493) |
| `/how-it-works/:area` | `Guarded` | [View declaration](../client/src/App.jsx#L494) |
| `/features` | `Navigate` | [View declaration](../client/src/App.jsx#L495) |
| `/hire` | `Navigate` | [View declaration](../client/src/App.jsx#L497) |
| `/direct/service-area` | `Navigate` | [View declaration](../client/src/App.jsx#L500) |
| `/help/crew` | `Guarded` | [View declaration](../client/src/App.jsx#L501) |
| `/help/display` | `Guarded` | [View declaration](../client/src/App.jsx#L502) |
| `/help/inventory` | `Guarded` | [View declaration](../client/src/App.jsx#L503) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-002"></a>

**Browser route inventory** · Page 378 of 393 · WEB-002

## App route declarations 19–36

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/help/kitchen` | `Guarded` | [View declaration](../client/src/App.jsx#L504) |
| `/help/manager` | `Guarded` | [View declaration](../client/src/App.jsx#L505) |
| `/help/pos` | `Guarded` | [View declaration](../client/src/App.jsx#L506) |
| `/help/restaurant` | `Guarded` | [View declaration](../client/src/App.jsx#L507) |
| `/help/runner` | `Guarded` | [View declaration](../client/src/App.jsx#L508) |
| `/help/:restaurantAppHelpSlug` | `Guarded` | [View declaration](../client/src/App.jsx#L509) |
| `/learn` | `Guarded` | [View declaration](../client/src/App.jsx#L510) |
| `/translator` | `Guarded` | [View declaration](../client/src/App.jsx#L511) |
| `/about` | `Guarded` | [View declaration](../client/src/App.jsx#L512) |
| `/careers` | `Guarded` | [View declaration](../client/src/App.jsx#L513) |
| `/careers/me` | `Guarded` | [View declaration](../client/src/App.jsx#L514) |
| `/careers/employers` | `Guarded` | [View declaration](../client/src/App.jsx#L515) |
| `/careers/employers/:slug` | `Guarded` | [View declaration](../client/src/App.jsx#L516) |
| `/careers/salaries` | `Guarded` | [View declaration](../client/src/App.jsx#L517) |
| `/careers/interview-tips` | `Guarded` | [View declaration](../client/src/App.jsx#L518) |
| `/careers/interview-room/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L519) |
| `/careers/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L520) |
| `/careers/:id/confirm` | `Guarded` | [View declaration](../client/src/App.jsx#L521) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-003"></a>

**Browser route inventory** · Page 379 of 393 · WEB-003

## App route declarations 37–54

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/business/:businessId/careers` | `Guarded` | [View declaration](../client/src/App.jsx#L522) |
| `/jobs` | `Guarded` | [View declaration](../client/src/App.jsx#L523) |
| `/saved-searches` | `Guarded` | [View declaration](../client/src/App.jsx#L524) |
| `/jobs/:id/edit` | `Guarded` | [View declaration](../client/src/App.jsx#L525) |
| `/jobs/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L526) |
| `/bids/:bidId` | `Guarded` | [View declaration](../client/src/App.jsx#L527) |
| `/jobs/public/:jobId` | `JobPublicPage` | [View declaration](../client/src/App.jsx#L528) |
| `/profile/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L529) |
| `/helpers` | `Guarded` | [View declaration](../client/src/App.jsx#L530) |
| `/direct/skills` | `Guarded` | [View declaration](../client/src/App.jsx#L531) |
| `/helpers/public/:helperId` | `LegacyHelperProfileRedirect` | [View declaration](../client/src/App.jsx#L532) |
| `/h/:helperId` | `LegacyHelperProfileRedirect` | [View declaration](../client/src/App.jsx#L533) |
| `/discover` | `Guarded` | [View declaration](../client/src/App.jsx#L534) |
| `/consulting-intake` | `Guarded` | [View declaration](../client/src/App.jsx#L535) |
| `/direct` | `Guarded` | [View declaration](../client/src/App.jsx#L536) |
| `/direct/services` | `Guarded` | [View declaration](../client/src/App.jsx#L537) |
| `/direct/tools` | `Guarded` | [View declaration](../client/src/App.jsx#L538) |
| `/direct/request-quote` | `Guarded` | [View declaration](../client/src/App.jsx#L539) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-004"></a>

**Browser route inventory** · Page 380 of 393 · WEB-004

## App route declarations 55–72

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/direct/request-quote/thanks` | `Guarded` | [View declaration](../client/src/App.jsx#L540) |
| `/media` | `Guarded` | [View declaration](../client/src/App.jsx#L542) |
| `/media/compose` | `Guarded` | [View declaration](../client/src/App.jsx#L543) |
| `/media/bookmarks` | `Guarded` | [View declaration](../client/src/App.jsx#L544) |
| `/media/verification` | `Guarded` | [View declaration](../client/src/App.jsx#L545) |
| `/media/verify-identity` | `Guarded` | [View declaration](../client/src/App.jsx#L546) |
| `/media/creator` | `Guarded` | [View declaration](../client/src/App.jsx#L547) |
| `/media/post/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L548) |
| `/media/search` | `Guarded` | [View declaration](../client/src/App.jsx#L549) |
| `/media/communities` | `Guarded` | [View declaration](../client/src/App.jsx#L550) |
| `/media/communities/:slug` | `Guarded` | [View declaration](../client/src/App.jsx#L551) |
| `/media/notifications` | `Guarded` | [View declaration](../client/src/App.jsx#L552) |
| `/media/messages` | `Guarded` | [View declaration](../client/src/App.jsx#L553) |
| `/media/:handle` | `Guarded` | [View declaration](../client/src/App.jsx#L554) |
| `/direct/view-quote` | `Guarded` | [View declaration](../client/src/App.jsx#L555) |
| `/direct/quotes/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L556) |
| `/direct/book-slot` | `Guarded` | [View declaration](../client/src/App.jsx#L557) |
| `/direct/book/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L558) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-005"></a>

**Browser route inventory** · Page 381 of 393 · WEB-005

## App route declarations 73–90

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/direct/jobs/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L559) |
| `/direct/payments/:id/proof` | `Guarded` | [View declaration](../client/src/App.jsx#L560) |
| `/direct/payments/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L561) |
| `/direct/history` | `Guarded` | [View declaration](../client/src/App.jsx#L562) |
| `/direct/support` | `Guarded` | [View declaration](../client/src/App.jsx#L563) |
| `/direct/account` | `Guarded` | [View declaration](../client/src/App.jsx#L564) |
| `/direct/jobs/:id/change` | `Guarded` | [View declaration](../client/src/App.jsx#L565) |
| `/direct/admin` | `Guarded` | [View declaration](../client/src/App.jsx#L566) |
| `/direct/admin/dashboard` | `Guarded` | [View declaration](../client/src/App.jsx#L567) |
| `/direct/admin/inbox` | `Guarded` | [View declaration](../client/src/App.jsx#L568) |
| `/direct/admin/quotes/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L569) |
| `/direct/admin/calendar` | `Guarded` | [View declaration](../client/src/App.jsx#L570) |
| `/direct/admin/jobs/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L571) |
| `/direct/admin/payments/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L572) |
| `/direct/admin/customers/:userId` | `Guarded` | [View declaration](../client/src/App.jsx#L573) |
| `/direct/admin/settings` | `Guarded` | [View declaration](../client/src/App.jsx#L574) |
| `/direct/admin/catalog` | `Guarded` | [View declaration](../client/src/App.jsx#L575) |
| `/direct/admin/reports` | `Guarded` | [View declaration](../client/src/App.jsx#L576) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-006"></a>

**Browser route inventory** · Page 382 of 393 · WEB-006

## App route declarations 91–108

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/direct/admin/team` | `Guarded` | [View declaration](../client/src/App.jsx#L577) |
| `/direct/admin/email-test` | `Guarded` | [View declaration](../client/src/App.jsx#L578) |
| `/request-quote` | `Guarded` | [View declaration](../client/src/App.jsx#L579) |
| `/quote-request` | `Guarded` | [View declaration](../client/src/App.jsx#L580) |
| `/consulting/feedback/:sessionId/:token` | `Guarded` | [View declaration](../client/src/App.jsx#L581) |
| `/business-launch-status` | `Guarded` | [View declaration](../client/src/App.jsx#L582) |
| `/franchise/apply` | `Guarded` | [View declaration](../client/src/App.jsx#L583) |
| `/franchise/status` | `Guarded` | [View declaration](../client/src/App.jsx#L584) |
| `/franchise/territory` | `Guarded` | [View declaration](../client/src/App.jsx#L585) |
| `/helpers/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L586) |
| `/businesses/public/:businessId` | `Guarded` | [View declaration](../client/src/App.jsx#L587) |
| `/b/:businessId` | `Guarded` | [View declaration](../client/src/App.jsx#L588) |
| `/book/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L589) |
| `/book/business/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L590) |
| `/business/:businessId/onboarding` | `Guarded` | [View declaration](../client/src/App.jsx#L594) |
| `/business/:businessId/workspace` | `Guarded` | [View declaration](../client/src/App.jsx#L595) |
| `/business/:businessId/workspace/:tab` | `Guarded` | [View declaration](../client/src/App.jsx#L596) |
| `/business/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L597) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-007"></a>

**Browser route inventory** · Page 383 of 393 · WEB-007

## App route declarations 109–126

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/business/:businessId/maintenance-request` | `Guarded` | [View declaration](../client/src/App.jsx#L598) |
| `/business/:businessId/trades-request` | `Guarded` | [View declaration](../client/src/App.jsx#L599) |
| `/business/:businessId/beauty-intake` | `Guarded` | [View declaration](../client/src/App.jsx#L600) |
| `/business/:businessId/creative-intake` | `Guarded` | [View declaration](../client/src/App.jsx#L601) |
| `/business/:businessId/professional-intake` | `Guarded` | [View declaration](../client/src/App.jsx#L602) |
| `/business/:businessId/continuity-intake` | `Guarded` | [View declaration](../client/src/App.jsx#L603) |
| `/tool-rentals` | `Guarded` | [View declaration](../client/src/App.jsx#L604) |
| `/tool-rentals/:toolId` | `Guarded` | [View declaration](../client/src/App.jsx#L605) |
| `/my-bookings` | `Guarded` | [View declaration](../client/src/App.jsx#L606) |
| `/tool-rentals/analytics` | `Guarded` | [View declaration](../client/src/App.jsx#L607) |
| `/invoice/p/:token` | `Guarded` | [View declaration](../client/src/App.jsx#L608) |
| `/products` | `Guarded` | [View declaration](../client/src/App.jsx#L611) |
| `/cart/:cartId` | `Guarded` | [View declaration](../client/src/App.jsx#L612) |
| `/shared-cart/:shareToken` | `Guarded` | [View declaration](../client/src/App.jsx#L613) |
| `/checkout/:cartId` | `Guarded` | [View declaration](../client/src/App.jsx#L614) |
| `/marketplace/orders/:orderId` | `Guarded` | [View declaration](../client/src/App.jsx#L621) |
| `/life-dashboard/expenses` | `Guarded` | [View declaration](../client/src/App.jsx#L624) |
| `/life-dashboard/goals` | `Guarded` | [View declaration](../client/src/App.jsx#L625) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-008"></a>

**Browser route inventory** · Page 384 of 393 · WEB-008

## App route declarations 127–144

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/life-dashboard/home-tasks` | `Guarded` | [View declaration](../client/src/App.jsx#L626) |
| `/vehicles` | `Guarded` | [View declaration](../client/src/App.jsx#L627) |
| `/house` | `Guarded` | [View declaration](../client/src/App.jsx#L628) |
| `/orders` | `Guarded` | [View declaration](../client/src/App.jsx#L629) |
| `/orders/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L630) |
| `/food/orders/:orderId` | `Guarded` | [View declaration](../client/src/App.jsx#L631) |
| `/food/track/:token` | `FoodTrackPage` | [View declaration](../client/src/App.jsx#L632) |
| `/support` | `Navigate` | [View declaration](../client/src/App.jsx#L635) |
| `/support/escalation` | `Guarded` | [View declaration](../client/src/App.jsx#L636) |
| `/support/my-tickets/:ticketId` | `Guarded` | [View declaration](../client/src/App.jsx#L637) |
| `/support/agent` | `Guarded` | [View declaration](../client/src/App.jsx#L638) |
| `/support/agent/workspace` | `Guarded` | [View declaration](../client/src/App.jsx#L639) |
| `/restaurants/support/cases` | `Guarded` | [View declaration](../client/src/App.jsx#L640) |
| `/restaurants/support/cases/:caseId` | `Guarded` | [View declaration](../client/src/App.jsx#L641) |
| `/restaurants/merchant/support` | `Guarded` | [View declaration](../client/src/App.jsx#L642) |
| `/restaurants/merchant/support/cases/:caseId` | `Guarded` | [View declaration](../client/src/App.jsx#L643) |
| `/terms` | `Guarded` | [View declaration](../client/src/App.jsx#L646) |
| `/privacy` | `Guarded` | [View declaration](../client/src/App.jsx#L647) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-009"></a>

**Browser route inventory** · Page 385 of 393 · WEB-009

## App route declarations 145–162

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/privacy/upcoming` | `Guarded` | [View declaration](../client/src/App.jsx#L648) |
| `/settings/privacy` | `Guarded` | [View declaration](../client/src/App.jsx#L649) |
| `/offers/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L650) |
| `/do-not-sell` | `Guarded` | [View declaration](../client/src/App.jsx#L651) |
| `/security` | `Guarded` | [View declaration](../client/src/App.jsx#L652) |
| `/cookie-policy` | `Guarded` | [View declaration](../client/src/App.jsx#L653) |
| `/accessibility` | `Guarded` | [View declaration](../client/src/App.jsx#L654) |
| `/legal/background-check` | `Guarded` | [View declaration](../client/src/App.jsx#L655) |
| `/legal/arbitration` | `Guarded` | [View declaration](../client/src/App.jsx#L656) |
| `/legal/escrow-policy` | `Guarded` | [View declaration](../client/src/App.jsx#L657) |
| `/legal/credit-terms` | `Guarded` | [View declaration](../client/src/App.jsx#L658) |
| `/legal/account-termination` | `Guarded` | [View declaration](../client/src/App.jsx#L659) |
| `/legal/dispute-resolution` | `Guarded` | [View declaration](../client/src/App.jsx#L660) |
| `/legal/independent-contractor` | `Guarded` | [View declaration](../client/src/App.jsx#L661) |
| `/verify-email` | `Guarded` | [View declaration](../client/src/App.jsx#L665) |
| `/verify-identity` | `Guarded` | [View declaration](../client/src/App.jsx#L667) |
| `/dashboard` | `Guarded` | [View declaration](../client/src/App.jsx#L670) |
| `/investor/dashboard` | `Guarded` | [View declaration](../client/src/App.jsx#L671) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-010"></a>

**Browser route inventory** · Page 386 of 393 · WEB-010

## App route declarations 163–180

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/affiliate` | `Guarded` | [View declaration](../client/src/App.jsx#L672) |
| `/helper-dashboard` | `Guarded` | [View declaration](../client/src/App.jsx#L673) |
| `/helper/clients` | `Guarded` | [View declaration](../client/src/App.jsx#L674) |
| `/activity` | `Guarded` | [View declaration](../client/src/App.jsx#L675) |
| `/upgrade` | `Guarded` | [View declaration](../client/src/App.jsx#L676) |
| `/templates` | `Guarded` | [View declaration](../client/src/App.jsx#L677) |
| `/promote` | `Guarded` | [View declaration](../client/src/App.jsx#L678) |
| `/dashboard/ai-preview` | `Guarded` | [View declaration](../client/src/App.jsx#L679) |
| `/business/:id/ai-preview` | `Guarded` | [View declaration](../client/src/App.jsx#L680) |
| `/post-job` | `Guarded` | [View declaration](../client/src/App.jsx#L683) |
| `/my-jobs` | `Guarded` | [View declaration](../client/src/App.jsx#L684) |
| `/my-bids` | `Guarded` | [View declaration](../client/src/App.jsx#L685) |
| `/helper/payouts` | `Guarded` | [View declaration](../client/src/App.jsx#L686) |
| `/invoices` | `Guarded` | [View declaration](../client/src/App.jsx#L687) |
| `/consultant-availability` | `Guarded` | [View declaration](../client/src/App.jsx#L688) |
| `/consulting/contractor-dashboard` | `Guarded` | [View declaration](../client/src/App.jsx#L689) |
| `/profile/tool-rentals` | `Navigate` | [View declaration](../client/src/App.jsx#L691) |
| `/settings` | `Guarded` | [View declaration](../client/src/App.jsx#L692) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-011"></a>

**Browser route inventory** · Page 387 of 393 · WEB-011

## App route declarations 181–198

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/settings/2fa` | `Guarded` | [View declaration](../client/src/App.jsx#L693) |
| `/settings/passkeys` | `Guarded` | [View declaration](../client/src/App.jsx#L694) |
| `/settings/sessions` | `Guarded` | [View declaration](../client/src/App.jsx#L695) |
| `/settings/your-data` | `Guarded` | [View declaration](../client/src/App.jsx#L696) |
| `/settings/notifications` | `Guarded` | [View declaration](../client/src/App.jsx#L697) |
| `/settings/country` | `Guarded` | [View declaration](../client/src/App.jsx#L699) |
| `/settings/payment-policies` | `Guarded` | [View declaration](../client/src/App.jsx#L700) |
| `/dashboard/edit-profile` | `Guarded` | [View declaration](../client/src/App.jsx#L702) |
| `/business/edit-profile` | `Guarded` | [View declaration](../client/src/App.jsx#L705) |
| `/enforcement-policy` | `Guarded` | [View declaration](../client/src/App.jsx#L706) |
| `/disputes` | `Guarded` | [View declaration](../client/src/App.jsx#L709) |
| `/disputes/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L710) |
| `/messages` | `Guarded` | [View declaration](../client/src/App.jsx#L713) |
| `/messages/guest/:inquiryId` | `Guarded` | [View declaration](../client/src/App.jsx#L714) |
| `/messages/:conversationId` | `Guarded` | [View declaration](../client/src/App.jsx#L715) |
| `/messages/conversations/:conversationId` | `Guarded` | [View declaration](../client/src/App.jsx#L717) |
| `/helper/messages` | `Guarded` | [View declaration](../client/src/App.jsx#L718) |
| `/helper/messages/guest/:inquiryId` | `Guarded` | [View declaration](../client/src/App.jsx#L719) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-012"></a>

**Browser route inventory** · Page 388 of 393 · WEB-012

## App route declarations 199–216

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/helper/messages/:conversationId` | `Guarded` | [View declaration](../client/src/App.jsx#L720) |
| `/planned-needs` | `Guarded` | [View declaration](../client/src/App.jsx#L722) |
| `/car-care` | `Guarded` | [View declaration](../client/src/App.jsx#L723) |
| `/food` | `Guarded` | [View declaration](../client/src/App.jsx#L728) |
| `/food/restaurants/:restaurantId` | `Guarded` | [View declaration](../client/src/App.jsx#L729) |
| `/food/queue/:restaurantId` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L730) |
| `/food/kiosk/:restaurantId` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L731) |
| `/food/kitchen/:restaurantId/pair` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L733) |
| `/food/merchant` | `Guarded` | [View declaration](../client/src/App.jsx#L734) |
| `/food/kitchen/:restaurantId` | `DeviceOrStaffRoute` | [View declaration](../client/src/App.jsx#L735) |
| `/restaurants` | `Guarded` | [View declaration](../client/src/App.jsx#L741) |
| `/restaurants/r/:restaurantId` | `Guarded` | [View declaration](../client/src/App.jsx#L742) |
| `/restaurants/queue/:restaurantId` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L743) |
| `/restaurants/kiosk/:restaurantId` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L744) |
| `/restaurants/merchant` | `Guarded` | [View declaration](../client/src/App.jsx#L745) |
| `/restaurants/:restaurantId/portal` | `Guarded` | [View declaration](../client/src/App.jsx#L750) |
| `/restaurants/screens/:restaurantId/:screenRole` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L751) |
| `/restaurants/kitchen/:restaurantId` | `DeviceOrStaffRoute` | [View declaration](../client/src/App.jsx#L752) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-013"></a>

**Browser route inventory** · Page 389 of 393 · WEB-013

## App route declarations 217–234

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/restaurants/kitchen/:restaurantId/pair` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L754) |
| `/restaurants/pos/:restaurantId` | `ProtectedRoute` | [View declaration](../client/src/App.jsx#L755) |
| `/restaurants/inventory/:restaurantId` | `ProtectedRoute` | [View declaration](../client/src/App.jsx#L756) |
| `/restaurants/runner/:restaurantId` | `ProtectedRoute` | [View declaration](../client/src/App.jsx#L757) |
| `/restaurant-credit` | `Guarded` | [View declaration](../client/src/App.jsx#L758) |
| `/statements` | `Guarded` | [View declaration](../client/src/App.jsx#L759) |
| `/restaurant-credit/statements` | `Guarded` | [View declaration](../client/src/App.jsx#L760) |
| `/restaurant-credit/statements/archive` | `Guarded` | [View declaration](../client/src/App.jsx#L761) |
| `/restaurant-settlement/statements` | `Guarded` | [View declaration](../client/src/App.jsx#L762) |
| `/helper-earnings/statements` | `Guarded` | [View declaration](../client/src/App.jsx#L763) |
| `/business/statements` | `Guarded` | [View declaration](../client/src/App.jsx#L764) |
| `/oxsteed-credit/statements` | `Guarded` | [View declaration](../client/src/App.jsx#L765) |
| `/oxsteed-credit/statements/archive` | `Guarded` | [View declaration](../client/src/App.jsx#L766) |
| `/statements/:documentId/entries/:entryId` | `Guarded` | [View declaration](../client/src/App.jsx#L767) |
| `/statements/:documentId/accessible` | `Guarded` | [View declaration](../client/src/App.jsx#L768) |
| `/statements/exports/:jobId` | `Guarded` | [View declaration](../client/src/App.jsx#L769) |
| `/oxsteed-credit/transactions/:transactionId` | `Guarded` | [View declaration](../client/src/App.jsx#L770) |
| `/oxsteed-credit` | `Guarded` | [View declaration](../client/src/App.jsx#L771) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-014"></a>

**Browser route inventory** · Page 390 of 393 · WEB-014

## App route declarations 235–252

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/wallet` | `Guarded` | [View declaration](../client/src/App.jsx#L772) |
| `/oxsteed-credit/cards` | `Guarded` | [View declaration](../client/src/App.jsx#L773) |
| `/delivery` | `Guarded` | [View declaration](../client/src/App.jsx#L776) |
| `/delivery/jobs/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L777) |
| `/delivery/payouts` | `Guarded` | [View declaration](../client/src/App.jsx#L779) |
| `/t/:token` | `Guarded` | [View declaration](../client/src/App.jsx#L781) |
| `/pay/:code` | `Guarded` | [View declaration](../client/src/App.jsx#L783) |
| `/pay/:code/success` | `Guarded` | [View declaration](../client/src/App.jsx#L784) |
| `/delivery/operations` | `Guarded` | [View declaration](../client/src/App.jsx#L785) |
| `/delivery/operations/tracking/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L786) |
| `/logistics` | `Guarded` | [View declaration](../client/src/App.jsx#L787) |
| `/logistics/login` | `Guarded` | [View declaration](../client/src/App.jsx#L788) |
| `/logistics/internal/login` | `Guarded` | [View declaration](../client/src/App.jsx#L789) |
| `/logistics/operations/login` | `Guarded` | [View declaration](../client/src/App.jsx#L790) |
| `/logistics/compliance-workspace/login` | `Guarded` | [View declaration](../client/src/App.jsx#L791) |
| `/logistics/admin-control/login` | `Guarded` | [View declaration](../client/src/App.jsx#L792) |
| `/internal/:workspace/login` | `Guarded` | [View declaration](../client/src/App.jsx#L793) |
| `/internal/:workspace` | `Guarded` | [View declaration](../client/src/App.jsx#L794) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-015"></a>

**Browser route inventory** · Page 391 of 393 · WEB-015

## App route declarations 253–270

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/logistics/buyer` | `Guarded` | [View declaration](../client/src/App.jsx#L795) |
| `/logistics/organizer` | `Guarded` | [View declaration](../client/src/App.jsx#L796) |
| `/logistics/business-procurement` | `Guarded` | [View declaration](../client/src/App.jsx#L797) |
| `/logistics/distributor` | `Guarded` | [View declaration](../client/src/App.jsx#L798) |
| `/logistics/operations/finance` | `Guarded` | [View declaration](../client/src/App.jsx#L799) |
| `/logistics/allocations/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L800) |
| `/logistics/operations` | `Guarded` | [View declaration](../client/src/App.jsx#L801) |
| `/logistics/operations/sourcing-ops` | `Guarded` | [View declaration](../client/src/App.jsx#L802) |
| `/logistics/operations/organizer-approvals` | `Guarded` | [View declaration](../client/src/App.jsx#L803) |
| `/logistics/operations/shipment-ops` | `Guarded` | [View declaration](../client/src/App.jsx#L804) |
| `/logistics/operations/warehouse-ops` | `Guarded` | [View declaration](../client/src/App.jsx#L805) |
| `/logistics/operations/allocations` | `Guarded` | [View declaration](../client/src/App.jsx#L806) |
| `/logistics/operations/disputes` | `Guarded` | [View declaration](../client/src/App.jsx#L807) |
| `/logistics/compliance-workspace` | `Guarded` | [View declaration](../client/src/App.jsx#L808) |
| `/logistics/compliance-workspace/review` | `Guarded` | [View declaration](../client/src/App.jsx#L809) |
| `/logistics/compliance-workspace/customs` | `Guarded` | [View declaration](../client/src/App.jsx#L810) |
| `/logistics/compliance-workspace/restrictions` | `Guarded` | [View declaration](../client/src/App.jsx#L811) |
| `/logistics/admin-control` | `Guarded` | [View declaration](../client/src/App.jsx#L812) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-016"></a>

**Browser route inventory** · Page 392 of 393 · WEB-016

## App route declarations 271–288

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/logistics/campaigns` | `Guarded` | [View declaration](../client/src/App.jsx#L813) |
| `/logistics/campaigns/new` | `Guarded` | [View declaration](../client/src/App.jsx#L814) |
| `/logistics/campaigns/:id/edit` | `Guarded` | [View declaration](../client/src/App.jsx#L815) |
| `/logistics/campaigns/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L816) |
| `/logistics/sourcing` | `Guarded` | [View declaration](../client/src/App.jsx#L817) |
| `/logistics/requests/new` | `Guarded` | [View declaration](../client/src/App.jsx#L818) |
| `/logistics/requests/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L819) |
| `/logistics/orders` | `Guarded` | [View declaration](../client/src/App.jsx#L820) |
| `/logistics/orders/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L821) |
| `/logistics/shipments` | `Guarded` | [View declaration](../client/src/App.jsx#L822) |
| `/logistics/shipments/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L823) |
| `/logistics/warehousing` | `Guarded` | [View declaration](../client/src/App.jsx#L824) |
| `/logistics/distribution` | `Guarded` | [View declaration](../client/src/App.jsx#L825) |
| `/logistics/compliance` | `Guarded` | [View declaration](../client/src/App.jsx#L826) |
| `/logistics/finance` | `Guarded` | [View declaration](../client/src/App.jsx#L827) |
| `/logistics/checkout` | `Guarded` | [View declaration](../client/src/App.jsx#L829) |
| `/logistics/payments` | `Guarded` | [View declaration](../client/src/App.jsx#L830) |
| `/vortex` | `Guarded` | [View declaration](../client/src/App.jsx#L833) |

<div style="break-before: page; page-break-before: always;"></div>

<a id="web-017"></a>

**Browser route inventory** · Page 393 of 393 · WEB-017

## App route declarations 289–301

| React Router path | First rendered wrapper | Source |
| --- | --- | --- |
| `/network` | `Guarded` | [View declaration](../client/src/App.jsx#L837) |
| `/access-gate/recovery` | `RouteErrorBoundary` | [View declaration](../client/src/App.jsx#L839) |
| `/business-hub` | `Guarded` | [View declaration](../client/src/App.jsx#L841) |
| `/credit/apply` | `Guarded` | [View declaration](../client/src/App.jsx#L843) |
| `/calendar` | `Guarded` | [View declaration](../client/src/App.jsx#L846) |
| `/calendar/appointments/:appointmentId` | `Guarded` | [View declaration](../client/src/App.jsx#L847) |
| `/qr-generator` | `Guarded` | [View declaration](../client/src/App.jsx#L850) |
| `/qr-payments` | `Guarded` | [View declaration](../client/src/App.jsx#L852) |
| `/agreements/new` | `Guarded` | [View declaration](../client/src/App.jsx#L854) |
| `/agreements/:id` | `Guarded` | [View declaration](../client/src/App.jsx#L855) |
| `/consulting/portal` | `Guarded` | [View declaration](../client/src/App.jsx#L858) |
| `/consulting` | `Guarded` | [View declaration](../client/src/App.jsx#L861) |
| `*` | `NotFoundPage` | [View declaration](../client/src/App.jsx#L863) |
