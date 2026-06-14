# OxSteed Network & OxSteed Restaurants — Product, Architecture & Build Plan

**Status:** Strategy + Phase-1 rebrand landed in this session
**Author:** Product strategy / SaaS architecture pass
**Last updated:** 2026-06-14
**Scope:** Transform the existing *OxSteed Food* foundation into *OxSteed Restaurants* inside *OxSteed Network*, and define the franchise-grade restaurant operating system roadmap.

> This document is the governing spec for the Restaurants branch. It is grounded in the
> code that already exists in this repo: migration `305_oxsteed_food.sql`, `foodController.js`
> (20 handlers), `routes/food.js` mounted at `/api/food`, the six web screens under
> `client/src/pages/food/`, the pack architecture (`docs/oxsteed-pack-architecture.md`,
> migrations 304), the team-roles/permissions spine (migration 245), and the corporate
> hierarchy overlay (migration 246). The immediate rebrand has been implemented additively —
> nothing under `/food` or `/api/food` was removed.

---

## 1. Executive summary

OxSteed is no longer a single marketplace. It is a **multi-branch business platform** — one account (**OxSteed ID**), many branches, each with its own product surface, accessed by role, permission, organization membership, and subscription. The parent layer, **OxSteed Network**, is the app switcher and shared identity/billing/notification spine that ties the branches together.

The two flagship branches are:

- **OxSteed Marketplace** — the local skills-and-services marketplace that already exists (post jobs, browse helpers, bid, message, pay with optional Stripe escrow).
- **OxSteed Restaurants** — a **franchise-grade operating system for independent restaurants**. The promise: *run your restaurant with the structure of a major franchise system, without giving up your brand, menu, identity, or ownership.*

The Restaurants branch already has a working ordering foundation (discovery, onboarding, menu builder, online ordering, in-store kiosk, kitchen display, queue board, merchant order dashboard, plus an iOS app). The work splits into two layers:

1. **Immediate (this session — done):** rebrand *Food → Restaurants*, add `/restaurants/*` route aliases (preserving `/food/*`), introduce the **OxSteed Network** switcher, move major branches out of *Resources*, add a Marketplace-help connection, and seed an **Operations** hub with "coming next" placeholders (inventory, checklists, training, audits, reports).
2. **Long-term:** grow Restaurants into a true restaurant OS — POS, inventory tied to recipes, employee scheduling, SOP library, training, checklists, quality audits, incident reports, multi-location dashboards, supplier management, loyalty, and an AI operations assistant — added module-by-module **without breaking the ordering foundation**.

Success looks like this: an independent restaurant owner logs in once, sees OxSteed Restaurants as a serious operating system (not a food-ordering page), runs daily operations through it, hires help through OxSteed Marketplace when something breaks, and never has to leave the OxSteed account to do any of it.

---

## 2. OxSteed Network concept

OxSteed Network is the **parent ecosystem and app-switching layer**. It is not a product the user "works inside" — it is the membrane that connects products. Its jobs:

- **Identity** — one OxSteed ID authenticates the user everywhere.
- **Wayfinding** — the Network switcher shows every branch the user can reach and routes them there.
- **Shared services** — profile, language, notifications, billing, organizations, roles, audit logs, support.
- **Cross-branch flows** — e.g. a restaurant manager posting a Marketplace job from inside the Restaurants dashboard, pre-filled with restaurant context.

**Parent message:** *"OxSteed Network connects marketplace services, restaurant operations, logistics, business launch tools, support, and AI-powered workspaces under one account."*

**Branch message (Restaurants):** *"OxSteed Restaurants helps independent restaurants run with franchise-grade systems while keeping their own brand, menu, identity, and ownership."*

Branches currently in the Network: **Marketplace, Restaurants, Logistics, Business Launch, Consulting, Support Workspace, Vortex, Settings.** (Vortex is the workspace-join/management surface; Settings is the shared account center.)

---

## 3. Brand architecture

```
OxSteed (master brand)
│
├── OxSteed Network ............ parent ecosystem + app switcher + OxSteed ID
│
├── OxSteed Marketplace ........ local skills & services marketplace
├── OxSteed Restaurants ........ restaurant operating system (was "OxSteed Food")
├── OxSteed Logistics .......... sourcing, pooled orders, shipments
├── OxSteed Business Launch .... start & stand up a new business
├── OxSteed Consulting ......... advisory + expert sessions
├── OxSteed Support Workspace .. agent ticketing & live chat
└── Vortex ..................... workspace join/management
```

**Visual system (already in repo, keep it):** dark theme, orange accent (`#F97316`), card-based dashboards, rounded buttons/panels, the OxSteed 4-arrow ring mark. Each branch reuses the master mark with a branch wordmark (e.g. `OxSteed Restaurants`, rendered by `FoodBrand` in `client/src/pages/food/foodShared.jsx`, now defaulting to the **Restaurants** label). No sub-brand gets its own logo — consistency signals "one platform, many branches."

**Naming rule:** branches are always written `OxSteed <Branch>`. The exception is **Vortex**, which is a feature name, not an `OxSteed <X>` branch.

**Anti-copy rule:** OxSteed Restaurants gives independent restaurants franchise-*grade* structure. It does **not** copy any company's manuals, trademarks, trade dress, workflows, or confidential processes. All SOPs, checklists, audits, and training are original templates the restaurant owns and customizes.

---

## 4. Navigation redesign

The core problem today: major branches (Logistics, Food) were buried under **Resources**, alongside how-to content. The fix separates **branches** from **learning/help**.

**Top navigation (signed in):**

| Slot | Item | Notes |
|---|---|---|
| 1 | OxSteed logo | → `/` |
| 2 | Browse Jobs | Marketplace quick link |
| 3 | Post Job | Marketplace quick link |
| 4 | Messages | unread badge |
| 5 | Dashboard | mode-aware (`routeForMode`) |
| 6 | Support Workspace | only if user is a support agent |
| 7 | **OxSteed Network ▾** | branch switcher (new) |
| 8 | Resources ▾ | learning/help only |
| 9 | Sign out | |
| right | Mode · Language · Theme | existing controls |

**OxSteed Network ▾** contains: Marketplace, Restaurants, Logistics, Business Launch, Consulting, Support Workspace (conditional), Vortex, Settings.

**Resources ▾** now contains learning/help only: How OxSteed Works, Browse Tools, Learn to DIY, and (for helpers) Business hub + QR generator. Future home for: Guides, FAQs, Blog, Help Center, Policies.

> **Implemented this session** in `client/src/components/Navbar.jsx`:
> - New `OxSteedNetworkSwitcher` component added to desktop nav and mobile menu.
> - Branch links (Logistics, Food→Restaurants, Business Launch Status, Settings) removed from Resources and relocated to Network.
> - Resources reduced to learning/help + helper tools.

---

## 5. App switcher design

The switcher (`client/src/components/OxSteedNetworkSwitcher.jsx`) is a launcher button (3×3 grid glyph + "OxSteed Network" + chevron) opening a two-column grid of branch cards. Each card shows a **title** + **one-line hint** and routes to that branch's existing surface. It **routes only — it does not grant access**; each destination enforces its own role/permission gate.

| Branch | Route | Hint |
|---|---|---|
| OxSteed Marketplace | `/jobs` | Hire local helpers, post jobs, compare bids |
| OxSteed Restaurants | `/restaurants` | Franchise-grade tools for independent restaurants |
| OxSteed Logistics | `/logistics` | Sourcing, pooled orders, shipments |
| OxSteed Business Launch | `/business-launch-status` | Start and stand up a new business |
| OxSteed Consulting | `/consulting` | Expert guidance and advisory sessions |
| OxSteed Support Workspace | `/support/agent` | Handle tickets and live chats *(conditional)* |
| Vortex | `/vortex` | Join or manage your workspaces |
| Settings | `/settings` | Account, billing, notifications, language |

**Behaviors:** outside-click + Escape close; `aria-current` highlights the active branch; a `mobile` prop renders an inline list inside the hamburger menu. i18n keys live under `network.*` and `nav.network` across all five locales (en/es/fr/ht/ar). The component degrades gracefully — labels fall back to English defaults if a key is missing.

**Future enhancement:** badge each branch card with the user's role there (e.g. "Owner", "Manager", "Cashier") and hide branches the user has no access to once branch-level access checks (Section 6) are wired into a `/network/apps` endpoint.

---

## 6. OxSteed ID architecture

OxSteed ID is the shared identity layer. It already partly exists: JWT access (15m) + refresh (7d) with rotation in the `sessions` table, social/email login, `users.default_mode`, `language_preferences`, MFA scaffolding, and two membership systems — `business_members` (team roles, migration 245) and `corporate_assignments` (corporate hierarchy, migration 246).

**Principles**

- **One profile, one set of preferences** (language, notifications), **one billing identity** where appropriate.
- **Access is resolved, never hard-coded.** A user's capabilities in a branch come from: organization membership → role → permissions (+ per-member overrides), scoped by branch and (via the pack architecture) by country.
- **Tenant isolation.** Every branch row is owned by an organization/restaurant/business; queries filter by membership. OxSteed admins get access through explicit, audited grants — not ambient superuser reads.

**How one user holds different roles in different branches**

The same `users.id` can be: a Marketplace customer (posts jobs, no restaurant access), a helper (bids on jobs; only sees restaurant tools if a restaurant invites them), a restaurant owner (full Restaurants access + can hire via Marketplace), a restaurant cashier (POS only), a supplier (supplier features only), and so on. Role is **per organization**, not global. This is exactly the model already in `business_members` (`owner/manager/representative/support_agent/employee`) extended with restaurant-specific roles.

**Branch access resolution (target design)**

```
user → organization_members (org, role)
     → role → permissions (defaults)
     → membership_permission_overrides (allow/deny)
     → branch_access (which branches this org/role can open)
     → country_packs veto (persona/feature availability by country)
= effective capability set, cached ~30–60s (matches permissionsService pattern)
```

**Sensitive-action audit.** Every privileged action (role change, payout, refund mark-paid, data export, admin impersonation) writes an audit row. The repo already has `business_audit_log`, `corporate_assignment_audit_log`, `access_gate_attempts/lockouts`, and `admin_audit_log` — Restaurants reuses this pattern, never invents a parallel one.

**Role & permission matrix (initial)**

| Role | Marketplace | Restaurants surfaces | Notes |
|---|---|---|---|
| OxSteed customer | post/browse/hire/pay | order as guest/customer | no admin surfaces |
| Marketplace helper | bid/message/get paid | none unless invited | restaurant access is invite-only |
| Restaurant owner | hire help | **all** restaurant modules + billing | can manage multiple restaurants |
| Restaurant manager | hire help | all except billing/ownership/payouts | per-location scope |
| Cashier | — | POS, order status | no menu/inventory/reports edit |
| Kitchen staff | — | Kitchen Display, ticket advance | read menu; no pricing |
| Inventory worker | — | Inventory, purchase requests | no POS/menu pricing |
| Trainer | — | Training authoring, training status | no POS/finance |
| Supplier | — | Supplier portal (POs, catalog) | scoped to their supplier record |
| Logistics driver | — | delivery assignment (read) | Logistics-branch primary |
| OxSteed support agent | ticket tools | read with explicit grant | audited |
| OxSteed super admin | platform mgmt | platform mgmt | strict, audited, no ambient PII |

---

## 7. User roles and permissions (Restaurants detail)

Restaurant roles extend the existing team-role spine. Add a `restaurant_users` join (user × restaurant × role × location scope) mirroring `business_members`, with a permission catalog scoped to restaurant capabilities.

**Permission groups (codes):** `menu.*`, `orders.*`, `pos.*`, `kitchen.*`, `inventory.*`, `suppliers.*`, `employees.*`, `training.*`, `sops.*`, `checklists.*`, `audits.*`, `reports.*`, `loyalty.*`, `promotions.*`, `restaurant.settings.*`, `restaurant.billing.*`, `locations.*`.

**Default mapping (illustrative):**

- **Owner** → all codes (incl. `restaurant.billing.*`, `locations.*`).
- **Manager** → all except `restaurant.billing.*`, `restaurant.ownership`, `payouts.manage`; scoped to assigned locations.
- **Cashier** → `pos.*`, `orders.view`, `orders.create`, `loyalty.apply`, `promotions.apply`.
- **Kitchen** → `kitchen.*`, `orders.view`, `menu.view`.
- **Inventory** → `inventory.*`, `suppliers.view`, `purchase_orders.create`.
- **Trainer** → `training.*`, `sops.view`, `employees.view`.
- **Supplier** → `suppliers.self`, `purchase_orders.respond`, `catalog.manage` (own catalog only).

Enforce with a `requireRestaurantAccess({ minRole, location })` middleware + a `requireRestaurantPermission('inventory.edit')` factory — the same two-layer pattern as `requireBusinessAccess` + `requirePermission` already in the repo. Guards: managers cannot grant permissions they don't hold; only owners change ownership/billing; per-location scope is enforced on every list/read.

---

## 8. OxSteed Marketplace design

Marketplace is the existing product; it needs no rebuild, only integration into the Network and a clean connection into Restaurants.

**Core features (exist):** post a job, browse jobs, browse helpers, helper profiles, service categories, bidding, messaging, scheduling, secure payments (Stripe Connect, optional escrow `capture_method: 'manual'`), reviews/ratings, dispute flow, customer + helper dashboards, admin moderation.

**Connection to Restaurants — use cases:** hire cleaning, equipment repair, temporary kitchen help, sign installation, delivery support, pest control, marketing help, photographer/menu designer, emergency maintenance.

**Cross-branch flow (job from restaurant context):**

1. Manager in Restaurants → Operations → **"Find help through OxSteed Marketplace."**
2. App routes to `/post-job?source=restaurant` with navigation state `{ restaurantPrefill: { title, location_city, location_state, source } }`.
3. `PostJobPage` reads the prefill (it already supports `location.state` prefill from the booking flow), pre-populating title + location.
4. Helpers bid; the restaurant accepts a bid; job completes; payment releases.
5. **Future:** a `restaurant_marketplace_jobs` link table surfaces the job's status back inside the restaurant dashboard so the manager tracks it without leaving Restaurants.

> **Implemented this session:** the Operations tab's "Find help through OxSteed Marketplace" CTA with restaurant-context prefill.

---

## 9. OxSteed Restaurants design

**Positioning:** *Run your restaurant with the structure of a major franchise system, without giving up your brand.*

The branch grows in modules. Modules 1–9 substantially exist today; 10–25 are the roadmap. For each module: **purpose · main users · key screens · key data · MVP · future · permissions · connections.**

### Existing foundation (modules 1–9, shipped)

1. **Restaurant profile** — name, cuisine, hours, branding. Tables: `food_restaurants`. Users: owner/manager. Connects to: everything.
2. **Location management (partial)** — currently one restaurant = one storefront. Future: `restaurant_locations` to make a restaurant multi-site.
3. **Menu management** — categories, items, modifier groups (min/max/required). Tables: `food_menu_categories`, `food_menu_items`, `food_modifier_groups`, `food_modifiers`. Screen: Menu builder (`FoodMerchantPage` → Menu tab). Permissions: `menu.*`.
4. **Online ordering** — public storefront, cart, modifiers, pickup/dine-in, queue number. Screen: `FoodRestaurantPage`. Payment model: **track-only** (`payment_status` always `unpaid`; merchant marks paid in store).
5. **POS / in-store ordering** — kiosk self-order today (`FoodKioskPage`, guest, auto-reset). Future: staffed POS (Section 10, module 4).
6. **Kitchen display system** — `FoodKitchenPage`, 3 columns, tap-to-advance, 5s poll.
7. **Order status tracking** — per-day `queue_number` with `FOR UPDATE` lock; status state machine (received→accepted/preparing→ready→completed; cancel/refund branches).
8. **Payment tracking** — `updateOrderPayment` (mark paid/unpaid/refunded). *The platform never processes food payments* — liability stays with the merchant.
9. **Queue board** — public wall display (`FoodQueueBoardPage`, preparing/ready split).

### Roadmap modules (10–25)

| # | Module | Purpose | Primary users | MVP | Key tables (new) |
|---|---|---|---|---|---|
| 10 | Loyalty | reward repeat customers | owner, customer | points per order, redeem at POS | `loyalty_accounts`, `loyalty_ledger` |
| 11 | Promotions/coupons | drive demand | owner, manager | %/fixed codes, time windows | `restaurant_promotions` |
| 12 | Inventory | stop stockouts/waste | manager, inventory | items + units + low-stock alerts | `inventory_items` |
| 13 | Recipes/ingredients | tie sales to stock | manager | item↔ingredient mapping; order decrements stock | `ingredients`, `recipes` |
| 14 | Suppliers | manage vendors | manager, supplier | vendor records, catalogs, POs | `suppliers`, `purchase_orders` |
| 15 | Employees & scheduling | staff the floor | manager | roster, roles, shifts | `restaurant_employees`, `shifts` |
| 16 | Training & onboarding | consistency | trainer, manager, staff | assigned modules + quiz + status | `training_modules`, `training_assignments` |
| 17 | SOP library | document the "how" | manager, staff | versioned SOP docs by category | `sop_documents` |
| 18 | Checklists (open/close/clean) | daily discipline | manager, staff | templated checklists + completion log | `checklists`, `checklist_tasks`, `checklist_runs` |
| 19 | Food-safety checklists | compliance | manager | temp logs, HACCP-style records | (checklist subtype) |
| 20 | Quality audits | catch drift | manager, owner | audit template, findings, corrective actions | `audits`, `audit_findings`, `corrective_actions` |
| 21 | Incident reports | safety/liability trail | manager | structured incident log | `incident_reports` |
| 22 | Sales reports | know the numbers | owner, manager | revenue by day/item/location | (views over orders) |
| 23 | Labor reports | control cost | owner | hours, labor % of sales | (views over shifts) |
| 24 | Inventory reports | reduce waste | manager | usage, variance, reorder | (views over inventory) |
| 25 | AI ops assistant | guidance on demand | all | answer ops questions, draft SOPs/checklists, summarize reports | reuses `helperContext`-style prompt builder |

**Connections that matter:** menu↔recipes↔inventory (an order decrements stock); inventory↔suppliers (low stock → purchase request → supplier or Marketplace helper); employees↔training↔checklists (only trained staff can sign off certain checklists); audits↔corrective actions↔Marketplace (a failed-equipment finding can open a Marketplace repair job); everything↔reports.

---

## 10. Restaurant workflows

**1. Onboarding** — owner creates OxSteed account → opens Network → Restaurants → setup wizard: profile → location → hours → menu categories → menu items → employees + roles → language/currency/tax/payment-tracking settings → publish ordering page (`updateRestaurant` status draft→active) → first dashboard.

**2. Online order** — customer opens storefront → picks items + modifiers → places order (track-only) → order hits POS + Kitchen Display → kitchen accepts → preparing → ready → customer notified (queue board / push) → completed; merchant marks paid in store.

**3. POS** — cashier starts order → dine-in/pickup/delivery → items + modifiers → take payment (recorded, not processed by platform) → send to kitchen → receipt → sales report updates.

**4. Kitchen** — order appears with items/modifiers/notes/time → mark started → mark ready → manager sees delays vs. target prep time.

**5. Inventory** — menu item linked to ingredients → order decrements stock → low-stock alert → manager raises purchase request → fulfilled by supplier **or** a Marketplace helper if no supplier covers it.

**6. Training** — employee invited → logs in with OxSteed ID → sees assigned modules → completes SOP lessons → takes quiz → manager sees status; gated checklists unlock only for trained staff.

**7. Quality audit** — manager opens audit checklist → reviews cleanliness/prep/storage/safety/service → records findings → assigns corrective actions → tracks completion → builds improvement history.

**8. Marketplace connection** — restaurant needs repair → "Find help through OxSteed Marketplace" → pre-filled job → local helpers bid → restaurant hires → status visible from the restaurant dashboard (future link table).

---

## 11. UX screen list

For each screen: **goal · key components · CTAs · empty state · mobile · permissions.** (Abbreviated; full specs in design files.)

**Platform/public:** Homepage (multi-branch positioning); Network app switcher (built); branch selection; login/signup (OxSteed ID); account settings; billing center.

**Marketplace (exist):** homepage, browse jobs, post a job, job details, helper profile, bids, messages, customer dashboard, helper dashboard.

**Restaurants:**

1. **Landing** — "Franchise-grade tools for independent restaurants." CTA: Get started / Owner sign-in. Empty: value props + sample dashboard. Mobile: stacked. Perms: public.
2. **Setup wizard** — multi-step (profile→location→hours→menu→staff→settings→publish). CTA: Next/Publish. Empty: step 1. Perms: owner.
3. **Owner dashboard** — KPI cards (today's orders, revenue tracked, prep-time, low-stock count), location switcher, quick links. Perms: owner/manager.
4. **Location dashboard** — per-site orders, queue, staff on shift. Perms: manager (scoped).
5. **Menu builder** — categories, items, modifiers, sold-out toggle (built). Perms: `menu.edit`.
6. **POS screen** — order pad, modifiers, payment record, send-to-kitchen. Empty: "Start an order." Mobile: tablet-first. Perms: `pos.*`.
7. **Kitchen Display** — columns New/Preparing/Ready (built). Perms: `kitchen.*`.
8. **Online ordering page** — public storefront (built). Perms: public.
9. **Inventory dashboard** — items, stock levels, low-stock alerts, reorder. Empty: "Add your first ingredient." Perms: `inventory.*`.
10. **Employee management** — roster, roles, invites, scope. Perms: `employees.*`.
11. **Training dashboard** — assignments, completion %, quiz scores. Perms: `training.*`.
12. **SOP library** — searchable, versioned docs by category. Perms: `sops.*`.
13. **Checklist screen** — today's open/close/clean/safety runs, sign-off. Mobile: one-hand. Perms: `checklists.*`.
14. **Quality audit screen** — template, findings, corrective actions. Perms: `audits.*`.
15. **Reports dashboard** — sales/labor/inventory, date + location filters, export. Perms: `reports.*`.
16. **Multi-location dashboard** — roll-up across sites; compare locations. Perms: owner/multi-site manager.
17. **Operations hub (built this session)** — entry to modules 12–24 with "coming next" placeholders + Marketplace-help CTA.

**Admin:** restaurant moderation, plan/billing management, audit-log viewer, country-pack flags (existing pattern).

---

## 12. Database model

**Shared OxSteed Core (exists or partial):** `users`, `organizations`/`businesses`, `organization_members`/`business_members`, `roles`, `permissions`, `user_roles`, `branch_access` *(new)*, `subscriptions`, `billing_profiles`, `notifications`, `messages`, `audit_logs` (`business_audit_log`/`admin_audit_log`), `language_preferences`, `support_tickets`, `country_packs`.

**Marketplace domain (exists):** `jobs`, `job_categories`, `bids`, `helper_profiles`, `job_messages`/`conversations`, `job_payments`/`payments`, `reviews`, `disputes`.

**Restaurant domain:** existing — `food_restaurants`, `food_menu_categories`, `food_menu_items`, `food_modifier_groups`, `food_modifiers`, `food_orders`, `food_order_items`, `food_order_item_modifiers`. New (roadmap) — `restaurant_locations`, `restaurant_users`, `inventory_items`, `ingredients`, `recipes`, `suppliers`, `purchase_orders`, `restaurant_employees`, `shifts`, `training_modules`, `training_assignments`, `sop_documents`, `checklists`, `checklist_tasks`, `checklist_runs`, `audits`, `audit_findings`, `corrective_actions`, `incident_reports`, `loyalty_accounts`, `loyalty_ledger`, `restaurant_promotions`.

**Tenant model & isolation**

- **Ownership:** every restaurant row carries `restaurant_id` (and, when multi-site, `location_id`); `food_restaurants` already carries an owner + business linkage.
- **Isolation:** all reads filter by the caller's `restaurant_users` membership; cross-restaurant reads are impossible without a membership row. Marketplace and Restaurants never share tenant scope.
- **One user, many orgs:** membership rows, not user flags. **One restaurant, many locations:** `restaurant_locations` FK to restaurant. **One owner, many restaurants:** multiple `restaurant_users` rows with role `owner`.
- **Admin support without abuse:** OxSteed admins read restaurant data only via an explicit, time-boxed, audited grant (mirror `access_gate` + `admin_audit_log`); no ambient superuser SELECT on tenant PII.

**Naming note:** keep the `food_*` table prefix (migration 305 shipped it; renaming is a destructive migration with no product value). New tables use the `restaurant_*` prefix. The product name is "Restaurants"; the storage prefix is an implementation detail.

---

## 13. API structure

Keep `/api/food` mounted and working (it backs the iOS app and deployed kiosks/queue boards). Add `/api/restaurants/*` as the canonical surface; both can share the same controllers during transition.

```
/auth                                   OxSteed ID
/account                                profile, preferences
/organizations                          orgs + memberships
/network/apps                           branches the user can open (drives switcher) [new]
/marketplace/jobs | /bids | /helpers    existing marketplace
/restaurants                            list/create (= current /food/restaurants)
/restaurants/{id}/locations             multi-site
/restaurants/{id}/menus                 categories/items/modifiers
/restaurants/{id}/orders                online + in-store
/restaurants/{id}/kitchen               KDS feed
/restaurants/{id}/inventory             items, stock, low-stock
/restaurants/{id}/suppliers             vendors + POs
/restaurants/{id}/employees             roster, roles, shifts
/restaurants/{id}/training              modules + assignments
/restaurants/{id}/checklists            templates + runs
/restaurants/{id}/audits                audits + findings + corrective actions
/restaurants/{id}/reports               sales/labor/inventory
```

**Per group:** *purpose · main endpoints · required permission · validation · security.* Examples — **orders:** create (track-only; `payment_status=unpaid`; `optionalAuth` for kiosk/counter guests; `FOR UPDATE` on the restaurant for queue numbers); status transition guarded by the state machine (409 on illegal). **inventory:** edits require `inventory.edit`; quantities validated ≥0; decrement happens in the order transaction. **reports:** require `reports.*`; always scoped to the caller's restaurant/location; never leak cross-tenant aggregates. **Public read endpoints** (queue board, kiosk, storefront) stay unauthenticated but expose no PII and no payment data.

---

## 14. Security model

- **Auth:** JWT access (15m) + rotating refresh (7d) in `sessions`; social/email; **MFA** option; secure cross-branch logout (invalidate session server-side).
- **Authorization:** role + permission + per-member overrides, branch- and location-scoped; managers can't escalate beyond their own grants; owners-only for billing/ownership.
- **Tenant isolation:** every tenant query filtered by membership; admin reads require explicit audited grants (reuse access-gate + lockout + recovery pattern, migration 278).
- **Payments:** Restaurants is **track-only** — the platform never processes food payments, sharply reducing PCI/liability surface. Marketplace payments stay on Stripe Connect.
- **Audit logs:** privileged actions (role change, mark-paid, refund, export, impersonation) write audit rows.
- **Data rights:** export + deletion endpoints (exist for core); extend to restaurant data.
- **Uploads:** S3 with signed URLs for private docs (SOPs, training, audit photos), public URLs for menu images.
- **Messaging safety / fraud / abuse:** treat links in messages as suspicious; rate-limit; report/block; verify businesses and helpers.

**Trust features:** verified helpers, verified restaurants, ratings/reviews, dispute process, secure Marketplace payments, business verification, clear terms/policies.

---

## 15. Multilingual & global strategy

i18n stack already exists: `react-i18next` + five locales (en/es/fr/ht/ar) with enforced key parity. Country behavior is data-driven via **country packs** (migration 304: locale, currency, payment rails, addressing, enabled personas; US active, HT/DO/RW/BR seeded coming-soon).

- **Translatable UI:** all strings via `t('key')`; never hard-code English. New Network/Restaurants keys added under `network.*`, `nav.network`, `restaurants.*` across all five locales this session.
- **Country settings:** currency, tax, time zone, date/address formats, payment-method differences resolved from the country pack — not from `if (country === 'US')` checks.
- **RTL readiness:** Arabic locale present; carry through `dir="rtl"` and logical CSS properties as RTL ships.
- **Restaurant-managed translations (roadmap):** menu item translations (per-locale name/description), customer-facing vs. staff-facing language, receipts in the customer's language, training content per locale.

**Order:** English → Spanish → French → Haitian Creole (ready) → additional languages later. Machine translations are flagged for human review of restaurant-specific terminology.

---

## 16. Marketplace + Restaurants integration

Two directions:

1. **Restaurants → Marketplace (built):** Operations hub "Find help through OxSteed Marketplace" pre-fills a job from restaurant context (`/post-job?source=restaurant` + nav-state prefill). Roadmap: a `restaurant_marketplace_jobs` link table to show job status back inside the restaurant dashboard.
2. **Inventory/audit triggers (roadmap):** a low-stock alert with no supplier coverage, or a quality-audit equipment finding, can open a pre-filled Marketplace job in one click (e.g. "walk-in cooler repair").

Both directions rely only on OxSteed ID + organization membership — no second login, no data duplication.

---

## 17. MVP roadmap

**Phase 1 — Network foundation (this session):** OxSteed ID (exists), app switcher (built), branches moved out of Resources (done), `/restaurants` aliases (done), Restaurants rebrand (done), Operations placeholders + Marketplace help (done). *Don't build yet:* `/network/apps` access gating, branch role badges.

**Phase 2 — Marketplace stabilization:** harden existing jobs/bids/messaging/profiles/payments/reviews. *Don't build:* new marketplace features — stabilize.

**Phase 3 — Restaurants MVP:** restaurant profile (exists), location setup (`restaurant_locations`), menu builder (exists), online ordering (exists), staffed **POS** screen, Kitchen Display (exists), **basic inventory**, employee roles (`restaurant_users`), **open/close checklist**, **basic sales report**. *Don't build:* training, audits, multi-location reporting.

**Phase 4 — Operations upgrade:** training modules, SOP library, quality audits + corrective actions, supplier management, loyalty, promotions, multi-location reporting. *Don't build:* AI assistant, deep logistics.

**Phase 5 — Network integration:** hire Marketplace help from the restaurant dashboard with status round-trip, Logistics connection (supplier sourcing), Support Workspace, AI ops assistant, Business Launch recommendations.

**Per phase, define:** goal, features, screens, tables, APIs, success metrics, and explicit "not yet" list (above).

---

## 18. Monetization

**Marketplace:** free job posting; promoted jobs (paid boost); service fee on completed jobs; helper subscription (Free/Pro, exists); business verification fee.

**Restaurants (plan names + contents):**

| Plan | For | Includes |
|---|---|---|
| **Counter** (starter) | one small restaurant | profile, menu, online ordering, kiosk, KDS, queue board, basic orders + sales report |
| **Kitchen** (professional) | a growing single site | Counter + POS, inventory, employees/scheduling, checklists, SOPs, training |
| **Multi** (multi-location) | operators | Kitchen + multi-location dashboard, quality audits, advanced reports, supplier tools |
| **Add-ons** | any | loyalty, advanced reporting, training authoring, supplier marketplace, AI assistant |

Plus: payment-processing revenue (Marketplace side only — food stays track-only), optional setup/onboarding fee, optional consulting package (via OxSteed Consulting).

**Network:** shared billing center; branch-level subscriptions; org-level billing; trial periods (the template/free-trial pattern already exists — 1-year trials, location-based PPP pricing via `pricing_overrides`); contextual upgrade prompts when a user hits a gated module.

---

## 19. Recommended build stack

Stay on the proven stack — don't introduce new frameworks:

- **Frontend:** React 18 + Vite + Tailwind (dark mode via `class`), `react-i18next`, Leaflet for maps, Recharts for reports, Socket.IO for live updates. Reuse the `fd-*` namespace + CSS-var theme for Restaurants screens; in-store screens stay fixed dark fullscreen.
- **Backend:** Node + Express, PostgreSQL via `pg`, JWT auth, Stripe Connect (Marketplace), Socket.IO rooms (`business_<id>_inbox`-style, extend to `restaurant_<id>` rooms), node-cron for scheduled work, S3 for files.
- **Patterns:** `withTransaction` for multi-step writes; state machines for order/PO/shipment lifecycles; `requireBusinessAccess`/`requirePermission`-style middleware for the new restaurant guards; 30–60s in-process caches for permission/pack lookups; structured NDJSON logging.
- **iOS:** SwiftUI `OxSteedFood` app — rename surface to Restaurants, keep additive API (it already decodes live `/api/food`).

---

## 20. Next 30-day action plan

**Week 1 — Land & verify Phase 1 (mostly done this session)**
- ✅ Network switcher, `/restaurants` aliases, Resources trim, Operations hub + Marketplace help, i18n keys (5 locales).
- Run the client build (`npm run build`) and click-test the switcher on desktop + mobile, and `/restaurants` + `/food` parity.
- Update iOS surface labels Food → Restaurants (no pbxproj change needed).

**Week 2 — Access & data spine**
- Add `restaurant_users` table + `requireRestaurantAccess`/`requireRestaurantPermission` middleware (clone the business pattern).
- Add `/network/apps` endpoint returning branches the user can open; wire the switcher to hide inaccessible branches + show role badges.
- Add `restaurant_locations` and make `/restaurants/{id}/locations` real.

**Week 3 — POS + basic inventory (Phase 3 core)**
- Build the staffed POS screen (reuse `ItemModal` from `FoodRestaurantPage`); record payments (track-only) and push to KDS.
- Ship `inventory_items` + low-stock alerts; wire an order→stock decrement behind a feature flag.
- Replace one Operations placeholder (Inventory) with the live module.

**Week 4 — Checklists + basic reports + polish**
- Ship open/close checklist templates + runs (`checklists`, `checklist_runs`) and a basic sales report view.
- Replace the Checklists and Reports placeholders.
- QA pass on permissions (cashier can't edit menu, kitchen can't see pricing), i18n parity, and the Marketplace round-trip; write the `restaurant_marketplace_jobs` link table spec for Phase 5.

**Definition of done for the 30 days:** an owner can set up a restaurant, take orders on POS + online, run a kitchen display + queue board, track basic inventory with low-stock alerts, complete an open/close checklist, see a sales report, and hire a Marketplace helper from inside Restaurants — all under one OxSteed ID, with role-scoped access.

---

## Appendix A — What changed in the codebase this session (Phase 1)

**New files**
- `client/src/components/OxSteedNetworkSwitcher.jsx` — branch switcher (desktop dropdown + mobile inline list).
- `docs/oxsteed-restaurants-strategy.md` — this document.

**Modified**
- `client/src/App.jsx` — added `/restaurants`, `/restaurants/r/:restaurantId`, `/restaurants/queue/:restaurantId`, `/restaurants/kiosk/:restaurantId`, `/restaurants/merchant`, `/restaurants/kitchen/:restaurantId` (all `/food/*` routes preserved).
- `client/src/components/Navbar.jsx` — mounted the Network switcher (desktop + mobile); removed branch links from Resources; reduced Resources to learning/help + helper tools; added `.ox-net-option` styles.
- `client/src/pages/food/foodShared.jsx` — `FoodBrand` now defaults to the **Restaurants** wordmark (label-overridable).
- `client/src/pages/food/FoodMerchantPage.jsx` — new **Operations** tab with "coming next" module placeholders (inventory, checklists, training, audits, reports) + "Find help through OxSteed Marketplace" CTA; in-store screen links repointed to `/restaurants/*`.
- `client/src/locales/{en,es,fr,ht,ar}.json` — added `nav.network`, `network.*`, `restaurants.nav.entry`, `restaurants.ops.*`, `food.merchant.tab.operations` (parity verified for the new keys across all five locales).

**Deliberately not done (next phases)**
- No table renames (`food_*` kept); no removal of `/food` or `/api/food`.
- No `restaurant_users`/access middleware, `/network/apps` gating, or branch role badges yet.
- No staffed POS, live inventory, checklists, training, audits, or reports yet — placeholders only.
- iOS label rename pending.

**Verification:** esbuild syntax check passed on all five touched JS/JSX files; all five locale JSON files valid; new i18n keys present in all five locales; Navbar branch links fully relocated to the Network switcher.
