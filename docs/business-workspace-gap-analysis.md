# Per-Business Workspace — Gap Analysis

**Date:** 2026-05-15
**Scope:** Audit current state of per-business messaging, booking, products/inventory, and dynamic pricing; identify gaps to reach **workspace-style strict tenancy** (each business has its own dashboard/inbox/calendar/catalog; team members switch between businesses; no cross-business data leakage).
**Outcome of this document:** No code changes. Findings + recommended sequencing only.

---

## 1. Executive Summary

The codebase is **further along than CLAUDE.md indicates**. A wave of recent migrations (181–218) added substantial per-business infrastructure that isn't reflected in the project status notes. The schema for all four target systems exists. **The dominant gap pattern is not "missing tables" — it is "parallel systems that aren't wired together."**

> ⚠️ **Critical finding surfaced during verification: migration number collisions.** Migration numbers **181–193 exist twice** in `server/migrations/` — once for security/infrastructure fixes (e.g., `181_repair_jobs_location_country.sql`, `184_login_alert_enhancements.sql`) and once for the business-workspace work (e.g., `181_business_messaging.sql`, `184_service_dynamic_pricing_base.sql`). Both sets currently sit in the same folder. Depending on filesystem read order in `server/migrate.js`, deploys may apply different subsets on different boxes — and the security-branch migrations and business-branch migrations have the same `_migrations` row id, so once one runs the other gets silently skipped. **This must be resolved before any further business-workspace work.** Renumber the business set to start at 219 (since 200–218 are already taken), or merge them. See §10.

| System | Schema | Controllers | UI | Integrated | Verdict |
|---|---|---|---|---|---|
| Business core (tenancy) | ✅ | ⚠️ scattered checks | ✅ | ⚠️ | Functional, no middleware |
| Messaging | ✅ (new + legacy) | ⚠️ partial | ✅ tab present | ❌ parallel to user DMs | Schema ready, not unified |
| Booking | ✅ (services, staff, rules) | ❌ no slot engine | ⚠️ pages exist | ❌ no slot-finding | Schema ready, runtime missing |
| Products + Inventory | ✅ (variants, stock) | ✅ CRUD | ✅ tab present | ❌ isolated from carts/orders | Functional but unsellable |
| Dynamic Pricing (4 dims) | ✅ (rules, tiers, segments) | ❌ no admin endpoints | ⚠️ tabs present | ❌ no rule engine | Tables exist, dormant |

**The recurring theme:** new per-business tables were created but the **calculation/integration layer** that would make them function in checkout, the cart, the inbox routing, and slot-finding **does not exist yet**. Five focused engines and ~6 integration points would close most of the gap.

**Strict tenancy gaps that span all four systems:**
1. No middleware (`requireBusinessAccess(role)`); access checks live inside controllers.
2. No `/business/:businessId/*` URL prefix; business ID lives in localStorage.
3. No socket rooms scoped to a business inbox (`business_<id>_inbox`).
4. No business switcher in the global Navbar.

---

## 2. Business Core (Tenancy) — Current State

**Source:** `server/migrations/034_trial_identity_businesses.sql`, `062_business_members.sql`, `152_profile_templates.sql`, `214_business_full_independence.sql`; `server/utils/businessOwnership.js`; `client/src/pages/BusinessHubPage.jsx`.

### What exists
- `businesses` (SERIAL id, `user_id` owner, `is_primary`, `is_active`, `active_template`, full address/branding/service fields).
- `business_members` — many-to-many with roles `manager` (full access except finance write — confirm) and `representative` (chat/job acceptance only).
- `business_invite_tokens` (with `created_by_id` from migration 157).
- Access utility functions in `server/utils/businessOwnership.js`:
  - `ownedBusiness(userId, bizId)` — owner only
  - `canEditProfile(userId, bizId)` — owner or active manager
  - `canAccessBusinessTeam(userId, bizId)` — owner or any active member
  - `canManageBusinessFinance(userId, bizId)` — owner or manager
- Client-side switcher in `BusinessHubPage.jsx` (lines 173–206) merges owned + managed businesses; persists choice in `localStorage` key `oxs:bh:lastBusinessId`; supports `?biz={id}` URL param.

### Gaps for strict tenancy
| Gap | Impact | Fix |
|---|---|---|
| **No `requireBusinessAccess(role)` middleware.** Access checks duplicated in 17+ controllers. | Easy to forget on a new route → cross-business leakage. | Add `server/middleware/requireBusinessAccess.js` taking `role` enum; mount on every `/api/businesses/:businessId/*` route. |
| **No `/business/:businessId/*` route prefix.** Business ID is in client state, not URL. | No deep-linking, refresh loses tab, no per-business browser history. | Wrap workspace under `/business/:businessId/...` in React Router; read `businessId` from `useParams` not localStorage. |
| **No global business switcher.** Switcher lives only inside `BusinessHubPage`. | Users with multiple businesses cannot jump between them from anywhere else. | Add switcher to `Navbar.jsx` (visible when user has ≥1 business). |
| **No business-scoped audit log.** | Hard to investigate cross-tenant incidents. | New `business_audit_log` table; emit from middleware. |
| **`businesses.id` is SERIAL (int) but most newer per-business tables use UUID `business_id`.** | Schema drift; FK type mismatches caused prior deploys to fail (CLAUDE.md notes the 149→150 fix). | Pin a convention going forward — recommend keeping `businesses.id` as INT and ensuring all new FKs use INT (or do a one-shot UUID migration; risky). |

---

## 3. Messaging — Current State

**Source:** `server/migrations/024_create_messaging_tables.sql`, `063_*` (added `conversations.business_id`), `181_business_messaging.sql`, `140_support_messaging.sql`; `server/controllers/messageController.js`, `chatController.js`, `businessMessagingController.js`; `server/services/socketService.js`; `client/src/pages/MessagesPage.jsx`.

### What exists
- **Legacy `conversations` + `messages`** keyed on `customer_id` + `helper_id`. Migration 063 bolted on a nullable `business_id` so a customer can have separate threads with the same helper across businesses.
- **NEW: `business_conversations` + `business_messages` + `business_conversation_participants`** (migration 181) — a fully parallel schema with `conversation_type` (`'team'` | `'customer'`) and a `sender_type` discriminator. Built for business inbox.
- `businessMessagingController.js` exists and gates access on `business.user_id OR business_team_members.user_id`.
- `BusinessMessagingTab` is wired into `BusinessHubPage.jsx` (line 1282).
- `support_messages` (migration 144 — note the 140 slot is taken) handle support tickets only.

### Gaps
| Gap | Impact | Fix |
|---|---|---|
| **Two parallel messaging systems.** Customer-facing entry points still create rows in the old `conversations` table, even when the customer arrives from a business profile (`chatController.js` line 662 resolves businessId → user_id and writes to the legacy table — verified). | Business inbox shows half the customer messages; team members miss inquiries that landed on the owner's personal DM. | Route guest-from-business inquiries to `business_conversations`; migrate any existing legacy rows with non-null `business_id`. Or merge tables and drop the parallel one. |
| **No socket room scoped to a business inbox.** `socketService.broadcastToConversation` uses `conv_<conversationId>` only. | When a team member is online, they only see real-time updates for conversations they've actively joined. No "new message arrived for the business" notification. | Add `business_<id>_inbox` room; join all active team members on socket connect; broadcast on every business_messages insert. |
| **No team assignment / claim model.** Any team member can reply; nothing tracks who is responsible for a thread. | Duplicate replies; cold threads with no owner. | Add `business_conversations.assigned_to_user_id`; add claim/release endpoints; show in tab. |
| **No saved replies, canned responses, or templates** at the business level. | Slows team response. | `business_message_templates` table; merge into compose UI. |
| **No read state per team member.** `business_conversation_participants.last_read_message_id` exists — confirm it's actually written on view. | "Unread" counts will be wrong. | Verify + wire on inbox open. |

---

## 4. Booking / Calendar / Availability — Current State

**Source:** `server/migrations/112_calendar_appointments.sql`, `176_booking_requests.sql`, `179_booking_requests_confirmation.sql`, `182_business_services.sql`, `214_business_full_independence.sql`, `216_business_appointments.sql`; `server/controllers/bookingController.js`, `appointmentController.js`, `availabilityController.js`; `client/src/pages/BookHelperPage.jsx`, `BookBusinessPage.jsx`, `BookServicePage.jsx`; `client/src/components/calendar/*`.

### What exists
- **Legacy helper-keyed tables:** `appointments`, `availability_blocks`, `helper_availability` — all `helper_id` / `user_id`.
- **NEW business-keyed tables (migration 182):**
  - `business_services` (id, business_id, duration, base_price_cents, capacity, notice/cancel rules)
  - `business_service_staff` (service_id → user_id, optional price override)
  - `business_service_availability` (weekly recurring slots, optional staff scope)
  - `business_service_blocked_times` (time-bounded blocks)
  - `business_booking_rules` (min advance, max advance, payment upfront, cancellation policy)
- **`business_appointments`** (`183_business_appointments.sql`, patched by `216_fix_business_services_booking_schema.sql`) — full lifecycle: business_id, service_id, optional staff_id, payment status, reminders, feedback.
- **`booking_requests.business_id`** (migration 214) — already nullable FK so customers can book a business without naming a helper.
- Frontend: `BookBusinessPage`, `BookServicePage` exist.

### Gaps
| Gap | Impact | Fix |
|---|---|---|
| **No slot-finding engine.** No endpoint computes "available 30-min slots for service X on date Y across assigned staff." Frontend has no real availability to render. | Customers see empty calendars or "any time" inputs with no validation. | New `server/services/bookingSlotEngine.js`: take service_id + date range → intersect `business_service_availability` (recurring) − `business_service_blocked_times` − `business_appointments` per assigned staff → return slot array. |
| **No business calendar endpoint.** `GET /api/businesses/:id/calendar` doesn't exist. `BusinessCalendarView` tab in hub has nothing to fetch. | Owners can't see all bookings across staff and services in one place. | Add the endpoint; union `business_appointments` + (optionally) legacy `appointments` for the owner-helper to ease migration. |
| **No staff assignment logic.** `business_appointments.staff_id` exists but is set manually. | All bookings still flow to the business owner. | Add an `assignmentStrategy` per service (`manual` | `round_robin` | `load_balanced`); compute on booking accept. |
| **`business_booking_rules` not enforced.** Schema present, no controller reads it. | Customers can book violating min-notice / max-advance / required-upfront-payment. | Pre-insert validation in `bookingController.create`. |
| **No overbooking guard on `business_appointments`.** The legacy `appointments` table has overlap-prevention indexes; the new one doesn't. | Two customers book the same staff member at the same time. | Add EXCLUDE constraint using `tstzrange` and `staff_id`, or pre-insert overlap query inside a transaction. |
| **Reminders / cancellation hooks not wired** for `business_appointments`. The legacy reminder cron (described in CLAUDE.md 2026-05-09 hardening) operates on `appointments`, not `business_appointments`. | Customers won't get reminders for business bookings. | Extend `appointmentController.respondToReschedule` cancel/re-issue pattern to the new table; add it to the reminder cron. |

---

## 5. Products + Inventory — Current State

**Source:** `server/migrations/125_marketplace_products.sql`, `129_marketplace_orders.sql`, `217_business_products_inventory.sql`; `server/controllers/businessProductsController.js`, `cartCheckoutController.js`, `adminProductsController.js`; `client/src/components/businessHub/ProductManagement.jsx`.

### What exists
- **Three product universes:**
  1. `marketplace_products` (admin-managed; Home Depot affiliate + internal)
  2. `helper_products` (minimal helper self-listings, no stock)
  3. `business_products` (full SKU + variants + per-variant inventory; migration 217)
- `business_product_variants` (variant_name, sku, price_adjustment_cents)
- `business_product_inventory` (stock_quantity, reorder_level, reserved_quantity)
- `business_product_low_stock_alerts`
- `businessProductsController.js` — full CRUD, ownership-checked on every write.
- `ProductManagement.jsx` tab in `BusinessHubPage`.

### Gaps
| Gap | Impact | Fix |
|---|---|---|
| **Carts and orders can't carry business products.** `shopping_cart_items.product_id` FKs `marketplace_products` only. `marketplace_orders` → `marketplace_order_items` → same. | Businesses have a catalog but cannot sell anything from it. **This is the single highest-leverage gap in the whole audit.** | Choose one: (a) add `business_product_id` column to `shopping_cart_items` (polymorphic; messier), or (b) make `business_products` rows also insertable into `marketplace_products` with `source='business'` (cleaner — preserves checkout pipeline). |
| **No reservation on add-to-cart.** `reserved_quantity` exists but isn't decremented. | Oversell when multiple carts hold the last unit. | Decrement on add, restore on cart timeout, finalize on order. Background job already pattern exists for `plannedNeedsScheduler` style. |
| **No public business product discovery.** Marketplace browse hits `marketplace_products` only. | Customers can't find business catalogs unless they go to `/business/:id`. | Either union in browse query, or copy business products into `marketplace_products` (per the option above). |
| **No purchase order / restock workflow.** | Owners manually update `stock_quantity`. | Out of scope for v1; flag for v2. |
| **No multi-location inventory.** Stock is per-variant globally. | Businesses with multiple locations can't reflect that. | `business_locations` + `business_product_inventory.location_id`; defer. |
| **No image / variant images.** Variants share parent thumbnail. | Common e-commerce requirement. | `business_product_variant_images` table. |

---

## 6. Dynamic Pricing — Current State

**Source:** `server/migrations/133_discount_codes_system.sql`, `139_ab_testing.sql`, `160_location_based_pricing.sql`, `184_service_dynamic_pricing_base.sql`, `218_business_product_pricing.sql`; `server/services/pricingService.js`, `discountService.js`; `server/controllers/pricingOverrideController.js`, `discountCodesController.js`, `cartCheckoutController.js`.

### What exists
- **Discount codes** (133) — mature: fixed/percentage, caps, scope, time windows.
- **Location-based premium subscription pricing** (160) — mature but narrow (subscription plan only).
- **A/B testing framework** (139) — mature for discount-code experiments; statistical engine in `ABTestController` (chi-square, Wilson intervals).
- **Service dynamic pricing schema** (184): `service_price_rules` parent + child tables for each dimension:
  - `service_price_time_rules` (DoW + start/end + peak flag + multiplier)
  - `service_price_demand_rules` (availability % threshold + surge multiplier)
  - `service_price_volume_rules` (min/max qty + period + multiplier)
  - `service_price_customer_segment_rules` (segment_type enum + booking count thresholds + JSONB criteria)
  - `service_price_seasonal_rules` (date ranges + multiplier/fixed/modifier)
  - `service_price_constraints` (min/max caps)
- **Product dynamic pricing schema** (218):
  - `product_pricing_rules` (rule_type + conditions_json + pricing_adjustment_json + priority)
  - `product_promotions` (percentage/fixed/bogo, time-bounded)
  - `product_bundles` + `product_bundle_items`
  - `product_bulk_tiers` (per-product min_quantity tiers)
  - `product_promo_codes` (separate from `discount_codes`)
  - `product_pricing_history` (audit)
- `PricingRulesManager` + `ProductPricingManager` tabs visible in `BusinessHubPage.jsx` (lines 1301, 1306).

### Gaps
| Gap | Impact | Fix |
|---|---|---|
| **No rule evaluation engine.** All those tables are dormant. `cartCheckoutController` reads `mp.price_cents` directly (line 92–95) then applies `discount_codes` only. `pricingService.js` handles subscription pricing only. | The entire dynamic-pricing schema is non-functional. **The single highest-leverage gap on the pricing side.** | New `server/services/pricingEngine.js`: input `{customer, businessId, productOrServiceId, quantity, requestedTimeISO}`; load rules ordered by priority; apply each (time → seasonal → volume → segment → demand) within constraints; return `{basePriceCents, adjustedPriceCents, appliedRules[]}`. Call from `cartCheckoutController` and `bookingController` before computing totals. |
| **No customer-segment detection.** `service_price_customer_segment_rules` references segments but nothing classifies a customer at runtime. | Segment rules can't fire. | Helper `getCustomerSegment(userId, businessId)` — counts past bookings/orders with this business; returns enum (`new`, `returning`, `vip`, `loyalty_tier_X`). Cache 10 min. |
| **No demand signal.** `service_price_demand_rules.availability_threshold` exists but nothing computes "current availability %." | Surge pricing can't fire. | Compute at rule eval: `1 - booked_slots / total_slots` for the day. For products: `1 - reserved / stock`. |
| **No admin endpoints to manage rules.** `pricingRulesController.js` etc. don't exist. | Owners can't actually create the rules even if the engine existed. | New controllers: `serviceRicingRules`, `productPricingRules`; CRUD scoped to business_id. |
| **BOGO is declared but not implemented.** `product_promotions.discount_type IN (..., 'bogo')`. | UI option that does nothing. | Implement in engine when ready, or strip from enum. |
| **No scheduled price activation.** Rules with future `start_date` need to "go live" without polling on every checkout. | Either checkout is slow, or rules don't fire on time. | A `pricing_rule_status` materialized view refreshed every 5 min, OR evaluate in-line with a small index hit (acceptable at this scale). |
| **`discount_codes` and `product_promo_codes` are two parallel promo systems.** | Maintenance burden, confused admins. | Pick one. Recommend keeping `discount_codes` (more mature, used in A/B tests) and migrating `product_promo_codes` into it with a `scope_type` field. |

---

## 7. Cross-Cutting Gaps (Strict Workspace Tenancy)

| Layer | Gap | Recommended fix |
|---|---|---|
| **Auth** | No `requireBusinessAccess` middleware — checks duplicated across 17+ controllers. | Single middleware factory: `requireBusinessAccess({ minRole: 'manager' })`. |
| **Routing** | No `/business/:businessId/*` URL prefix. Tab state stored in localStorage. | Move workspace under `/business/:businessId/...`; tabs as nested routes (`/messages`, `/calendar`, `/products`, `/pricing`). Enables deep links + browser history. |
| **Navigation** | No business switcher in global Navbar. Users with multiple businesses must navigate to the hub first. | Add switcher (avatar + business name dropdown) in Navbar; persist via React context, not just localStorage. |
| **Real-time** | No socket room per business inbox or per business calendar. | `business_<id>_inbox` and `business_<id>_calendar` rooms; auto-join active members on socket connect. |
| **Audit** | No business-scoped audit log. | `business_audit_log` table (business_id, user_id, action, before, after, ip, ts); emit from middleware. |
| **Data isolation** | Queries in some legacy controllers (jobs, conversations) don't yet filter by business_id even when one is present. | Pass over jobs/conversations/payments queries after the new prefix lands — verify every `WHERE` clause. |
| **Performance** | `business_products`, `business_appointments`, `business_messages` have business_id indexes but the **rule-engine join graph hasn't been exercised**. | Once the pricing engine ships, add `EXPLAIN ANALYZE` of a typical evaluation; index any sequential scans hit. |
| **FK type drift** | `businesses.id` is `SERIAL/INT`; many newer per-business tables use `UUID business_id` columns (verify migration 217, 218). | Inventory all `business_id` FK types; standardize. Past deploys broke on this (CLAUDE.md 149→150 fix). |

---

## 8. Recommended Build Sequence

Five focused engines + six integration points close most of the gap. Order is chosen to maximize value per effort and respect dependencies.

### Phase 0 — Tenancy spine (1 week)
Unblocks everything else. No new features.
- `requireBusinessAccess` middleware; back-fill onto every `/api/businesses/:businessId/*` route.
- `/business/:businessId/*` URL prefix; refactor `BusinessHubPage` tabs to nested routes.
- Global business switcher in `Navbar`.
- `business_audit_log` table + middleware emit.
- FK type audit + standardization.

### Phase 1 — Messaging integration (3–5 days)
Highest user-visible win; smallest engineering surface.
- Reroute guest-from-business inquiries to `business_conversations` (patch `chatController.js`).
- Add `business_<id>_inbox` socket room; emit on insert.
- Add `assigned_to_user_id` + claim/release endpoints.
- Backfill historical `conversations` rows with non-null `business_id` into `business_conversations` (one-shot migration).

### Phase 2 — Booking slot engine (1–1.5 weeks)
Unlocks the new `BookServicePage` and `BookBusinessPage`.
- `server/services/bookingSlotEngine.js` — pure function over service availability, blocks, and appointments.
- `GET /api/businesses/:businessId/services/:serviceId/slots?from=…&to=…&staff_id?=…`
- `GET /api/businesses/:businessId/calendar` (owner view).
- Enforce `business_booking_rules` at insert.
- Overbooking guard on `business_appointments`.
- Extend reminder cron to `business_appointments`.

### Phase 3 — Cart/order plumbing for business products (1 week)
The single highest-leverage product gap. Two design options — recommend (b):
- **(a)** Add polymorphic `business_product_id` to `shopping_cart_items` + branch in `cartCheckoutController`. Messier.
- **(b) Recommended:** Make `business_products` rows also live in `marketplace_products` (`source='business'`, `business_id` set). Existing cart + order pipelines work unchanged. Single source of truth at checkout.
- Reservation flow: decrement `reserved_quantity` on add, restore on cart timeout, finalize on paid order.

### Phase 4 — Pricing engine (2 weeks)
- `server/services/pricingEngine.js` — evaluate rules in priority order across the 4 dimensions; respect `service_price_constraints` caps.
- Customer segment classifier (`getCustomerSegment`).
- Demand signal (availability % for services, stock % for products).
- Admin endpoints: `/api/businesses/:businessId/pricing-rules/service` and `/product`.
- Wire engine into `cartCheckoutController` and `bookingController` *before* totals are computed.
- Merge `product_promo_codes` into `discount_codes`.

### Phase 5 — Polish (~1 week)
- BOGO implementation or removal.
- Scheduled price activation (or in-line lookup if EXPLAIN says cheap enough).
- `business_message_templates` (canned replies).
- Reservation + low-stock alert wiring for inventory.

**Total estimate:** 6–8 calendar weeks for one engineer, less with parallelism after Phase 0.

---

## 9. Open Questions

1. **`businesses.id` keying:** keep as SERIAL/INT or migrate to UUID? Decision affects every new FK.
2. **Multi-business team membership:** can a single user be a `manager` of business A and a `representative` of business B simultaneously? Schema allows it; UX needs to reflect it (the switcher does).
3. **`helper_products` deprecation:** with `business_products` shipping, is `helper_products` still needed for solo helpers without a business? Could every helper auto-get a "default business"?
4. **Currency:** rules tables are denominated in cents but currency lives on the business (`businesses.tax_rate` exists; currency lookups happen client-side via `getDefaultCurrency`). Pricing engine needs a clear contract.
5. **A/B testing scope:** the existing framework targets discount codes only. Should `pricingEngine` rules be A/B-testable from day one, or after?

---

## 10. Migration Number Collision — Resolution Plan

Found during verification. The following pairs share the same migration number, in the same directory:

| # | Security/infra branch | Business-workspace branch |
|---|---|---|
| 181 | `181_repair_jobs_location_country.sql` | `181_business_messaging.sql` |
| 182 | `182_expand_location_state.sql` | `182_business_services.sql` |
| 183 | `183_mobile_push_tokens.sql` | `183_business_appointments.sql` |
| 184 | `184_login_alert_enhancements.sql` | `184_service_dynamic_pricing_base.sql` |
| 185 | `185_security_audit_log.sql` | `185_service_pricing_audit.sql` |
| 186 | `186_admin_2fa_enforcement.sql` | `186_customer_loyalty_segments.sql` |
| 187 | `187_business_member_authorization.sql` | `187_business_calendar_settings.sql` |
| 188 | `188_job_state_transition_safety.sql` | `188_appointment_notifications.sql` |
| 189 | `189_invoice_idempotency_hardening.sql` | `189_business_integrations.sql` |
| 190 | `190_registration_unique_constraint.sql` | `190_business_analytics.sql` |
| 191 | `191_refresh_token_invalidation.sql` | `191_business_policies.sql` |
| 192 | `192_invite_token_security.sql` | `192_appointment_waitlist.sql` |
| 193 | `193_appointment_overbooking_prevention.sql` | `193_business_feature_settings.sql` |

**Why this is dangerous:** `server/migrate.js` deduplicates by the numeric prefix when checking the `_migrations` table. On a fresh DB it will apply both files (they don't write conflicting rows because the schemas differ), but on a DB that already has, say, `181` recorded, the second file with prefix 181 is silently skipped. Different production replicas can therefore end up with different schemas if they were boot-strapped at different times. A redeploy will not catch this.

**Recommended resolution (before any business-workspace work proceeds):**
1. Rename the business-workspace files to start at `219` (immediately after `218_business_product_pricing.sql`), preserving their relative order: `219_business_messaging.sql`, `220_business_services.sql`, `221_business_appointments.sql`, `222_service_dynamic_pricing_base.sql`, etc.
2. Add a one-shot reconciliation migration `233_business_workspace_collision_cleanup.sql` that detects whether the old (renamed) versions actually ran on this database and, if not, inserts the equivalent rows / runs the equivalent DDL idempotently.
3. Add a CI check that fails the build if two files in `server/migrations/` share the same numeric prefix.
4. Update CLAUDE.md "Database Migrations" section with the new convention and the CI check.

**Why renumber the business set rather than the security set:** the security migrations 181–199 were merged first (CLAUDE.md tracks them) and are more likely to have already shipped to production. Renumbering them risks the inverse "silently skipped" problem on prod.

---

## 11. Appendix — File / Migration Index

**Key migrations (chronological):**
- `024_create_messaging_tables.sql` — legacy `conversations`, `messages`
- `034_trial_identity_businesses.sql` — `businesses` table
- `062_business_members.sql` — team membership + roles
- `063_*_business_id_on_conversations.sql` — legacy bolt-on
- `112_calendar_appointments.sql` — legacy `appointments`, `availability_blocks`
- `125_marketplace_products.sql`, `129_marketplace_orders.sql`
- `133_discount_codes_system.sql`
- `139_ab_testing.sql`
- `144_support_message_retention.sql`
- `152_profile_templates.sql` — `active_template`
- `160_location_based_pricing.sql` — premium subscription PPP
- `176_booking_requests.sql`, `179_booking_requests_confirmation.sql`
- `181_business_messaging.sql` — `business_conversations`, `business_messages` ⭐
- `182_business_services.sql` — `business_services`, `_staff`, `_availability`, `_blocked_times`, `_booking_rules` ⭐
- `184_service_dynamic_pricing_base.sql` — service `price_rules` family ⭐
- `214_business_full_independence.sql` — `booking_requests.business_id`, business expansion
- `216_business_appointments.sql` ⭐
- `217_business_products.sql` — products + variants + inventory ⭐
- `218_business_product_pricing.sql` — product `pricing_rules`, bundles, tiers ⭐

⭐ = recent, undocumented in CLAUDE.md "Current Status" — flag for a CLAUDE.md update in the next session.

**Key controllers to touch first:**
- `server/middleware/` (new: `requireBusinessAccess.js`)
- `server/services/` (new: `bookingSlotEngine.js`, `pricingEngine.js`)
- `server/controllers/chatController.js` (line 662 — reroute guest inquiries)
- `server/controllers/cartCheckoutController.js` (lines 92–95 — wire engine)
- `server/controllers/bookingController.js` (slot validation + rule enforcement)
- `server/services/socketService.js` (business inbox + calendar rooms)

**Key UI components to touch first:**
- `client/src/pages/BusinessHubPage.jsx` (move to `/business/:id/*` nested routes)
- `client/src/components/Navbar.jsx` (global business switcher)
- `client/src/components/businessHub/ProductManagement.jsx` (will surface business products in marketplace after Phase 3)

---

*End of gap analysis. No code has been changed.*
