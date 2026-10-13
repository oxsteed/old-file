# OxSteed Credit Everywhere — Admin Approval per Participant

**Report type:** Findings + design only (no implementation)  
**Branch:** `origin/old-files-claude`  
**Tip SHA:** `0d83dc6afb9c2e09c82d0a1c7cd5d6b9f512e896` (2026-10-07 ~08:02 EDT)  
**Credit evidence baseline:** Prior spend map tip `af347ab0ceb071a59491bc3af3f87d93cd9dfdd7`. Tip moved **+2 commits** (Vortex / Business Hub / `launchScope` / i18n / process-state). **No Credit ledger, partner, or spend files in that delta** — current-state Credit claims below remain valid at tip.  
**Date:** 2026-10-07 (America/New_York)  
**Product decisions:** **LOCKED 2026-10-07** in chat with Emile (12/12) — see [Locked decisions](#locked-decisions-2026-10-07).  
**Owner of fixes:** Emile (this report does not implement or push)

---

## Executive summary

Today OxSteed Credit is a **restricted stored-value rail** that customers can spend only at **admin-enrolled restaurant partners** (plus messenger pay when the payee resolves to such a partner via `business_id`). The rail flag `oxsteed_credit_enabled` defaults **FALSE**; every money-initiating spend path calls `assertCreditRailEnabled` and also respects operator **rail freeze**. Spend primitives already exist (`purchaseWithCreditInTransaction`, hold→capture, card kiosk redeem, chat Credit pay) and are gated by `findSpendAgreement` / eligibility / caps / currency / `rejectImpersonated` on customer mutations.

**“Credit everywhere” is not a flag flip.** Most commercial surfaces (jobs `payment_method: 'oxsteed'`, Direct, subscriptions, QR pay, local delivery, consulting, invoices/products/rentals, food self-serve kiosk) never call the Credit ledger. Jobs’ `oxsteed` method is **platform escrow naming**, not this ledger. Dashboard copy saying “Spendable across OxSteed” overclaims; Credit page copy correctly says participating restaurants.

The proposed control plane is: **keep a shared spend adapter over existing purchase/hold primitives**, and require every merchant/payee to be an **OxSteed-admin-approved Credit participant** (pending → approved/active → suspended → revoked/terminated) with a versioned **agreement** (currency, categories/surfaces, limits, settlement). Emile locked the open product decisions on 2026-10-07: guest Credit with risk limits; jobs hybrid (hold Credit as escrow collateral); POS always debit then adjust; hold vs debit via per-surface matrix; **separate participant table** linking to partners; maker-checker on partner activate; admin-only **and** self-serve apply; chat without restaurant row; subscriptions recurring Credit in v1; wire Credit behind launch flags before un-hide; same settlement cycle as restaurants; Didit mandatory before participant `active`. Extend Super Admin Partners / Agreements / Approvals rather than inventing a parallel enrollment system.

---

## Current state (brief)

| Area | Today | Evidence |
|------|--------|----------|
| Rail | `oxsteed_credit_enabled` inserted **FALSE**; spend 503 when off; separate freeze table | `server/migrations/422_oxsteed_credit_emergency_controls.sql:7-14`; `oxsteedCreditService.js:286-318` |
| Who can be a partner | **Restaurants only** — `restaurant_id BIGINT NOT NULL UNIQUE`; optional `business_id` | `421_oxsteed_credit_foundation.sql:8-13` |
| Partner statuses | `pending` → `active` / `suspended` / `terminated` | foundation `:12-13`; `oxsteedCreditAdminService.js:1093-1097` |
| Agreements | `draft` → `pending_approval` → `active` (+ suspend/expire/terminate); one active per partner | foundation `:30-31`; admin `:2162-2167`; uniqueness migration 439 |
| Admin enrollment | Super Admin registers restaurant, transitions partner, creates/transitions agreement, optional entitlements | `server/routes/admin.js:402-417`; Partners UI |
| Maker-checker | **Money-moving** admin actions (pending-actions + step-up), **not** partner register/activate | `ApprovalsPage.jsx`; `oxsteedCreditPendingActionService.js`; controller Phase 7 comments |
| Spend that works | Food online (signed-in, immediate debit); POS hold→capture (exact amount); card kiosk redeem; chat pay to enrolled partner | `foodController.js:2540,3301-3320`; `restaurantAppFlowController.js:4151-4208`; `oxsteedCreditCardService.js:650-660`; `chatOxsteedCreditPaymentController.js:200-407` |
| Spend that does not | Jobs `oxsteed`, Direct, subscriptions, QR, local delivery Stripe, consulting, self-serve kiosk (`pay_at_counter` set), guests, invoices/products/rentals; Runner only **checks** prepaid `oxsteed_credit` orders | Prior map + `jobController.js:603-714`; `launchScope.js`; `foodController.js:2453`; `restaurantRunnerController.js:84-86` |

### Existing admin Credit surfaces (extend, don’t duplicate)

| Surface | Role | NEW vs extend |
|---------|------|----------------|
| Super Admin → OxSteed Credit → **Partners** | Enroll restaurant, transition status, create agreements | **Extend** via new participant table + Partners UI for non-restaurant types |
| → **Approvals** | Maker-checker queue + agent adjustments | **Extend** — partner activation **must** dual-control (LOCKED) |
| → Overview / Rail / Freeze | Kill switch + freeze | Keep as global gates |
| → Customers / Entitlements | Per-customer access when agreement requires entitlement | Keep; guest risk-limits policy (LOCKED) sits here / eligibility |
| → Settlements / Money-out / Reserves / Ledger / Cards / Disputes / Compliance / Audit / Health | Ops | Keep; **same settlement cycle** for non-restaurant participants (LOCKED) |
| Restaurant partner portals (`/restaurants/:id/oxsteed-credit/*`) | Partner self-serve read (settlements, txs, ledger, CSV) | Extend after participant table supports non-restaurant payees |
| `RestaurantCreditAdmin` | Separate **restaurant-scoped wallet** admin — **not** OxSteed Credit ledger | Do not conflate |

---

## Proposed model: Credit everywhere + admin approval per participant

### 1) Shared spend adapter (design)

Single entry used by every surface:

1. Resolve **participant** (payee) → `participant_id` → linked `partner_id` (LOCKED: separate participant table).
2. `assertCreditRailEnabled` (+ freeze).
3. `rejectImpersonated` (or equivalent) on customer-initiated spend.
4. `findSpendAgreement` / eligibility (order type / category / surface / geo / amount / caps) — including **guest** path with risk limits when unlocked.
5. Choose **immediate debit** vs **hold** per **surface matrix** (LOCKED): food online + chat = debit; POS + jobs = hold (jobs hold = escrow collateral; POS post-capture path becomes **debit then adjust**).
6. Write surface-specific `reference_type` / `reference_id` / metadata; settle into `partner_payable` on the **same cycle as restaurants** (LOCKED).

**Do not** fork a second ledger. Chat and card kiosk already call `purchaseWithCreditInTransaction`.

### 2) Participant registry (control plane)

Every payee that can **accept** Credit must be an admin-approved Credit participant.

| Field (conceptual) | Today | Proposed (LOCKED) |
|--------------------|-------|-------------------|
| Identity | `restaurant_id` required unique | **Separate participant table** linking to partners; polymorphic subject (`restaurant` / `business` / `helper` / …); keep restaurant path backward-compatible via link rows |
| Status | `pending` / `active` / `suspended` / `terminated` | Map product language: pending → **approved(=active)** → suspended → **revoked(=terminated)**; **Didit mandatory before `active`** (LOCKED) |
| Agreement | Versioned terms, limits, geo, categories, order types | Add **allowed_surfaces** (e.g. `food_online`, `pos`, `chat`, `jobs`, `direct`, `qr`, `subscriptions`, …) |
| Settlement | Partner payable + settlement cycle (restaurant-centric) | **Same cycle as restaurants** for all participant types (LOCKED); same journal |

**Who is a “participant” (types to support “everywhere”):**

| Type | Exists as Credit partner today? | Notes (post-lock) |
|------|----------------------------------|-------------------|
| `restaurant` | **Yes** — only concrete type | Foundation of current rail |
| `business` / Direct provider | **Partial** — `business_id` on a **restaurant** partner; chat resolves business → partner | Pure business-without-restaurant **unlocked by participant table** + chat without restaurant row (LOCKED) |
| `chat_partner` | Same as business resolution | Resolves via participant → partner; no restaurant required (LOCKED) |
| `helper` / marketplace counterparty | No | Jobs: **hybrid hold Credit as escrow collateral** (LOCKED) |
| `subscription_merchant` | No | Stripe today; **recurring Credit debit in v1** (LOCKED); wire behind launch flag first |
| `qr_merchant` | No | Stripe Checkout; wire Credit behind launch flag before un-hide (LOCKED) |
| `delivery_merchant` | No | Local delivery Stripe; same flag-before-unhide rule |
| `consulting_seller` | No | Launch redirects `/consulting`; wire behind flags first |
| `invoice` / `product` / `rental` seller | No | Wire behind launch flags before un-hide (LOCKED) |

### 3) OxSteed admin workflow (proposed)

Reuse existing Partners + Agreements machine; label gaps clearly.

| Step | Today | Proposed (LOCKED) |
|------|-------|-------------------|
| Apply / request | **No** self-serve apply — Super Admin invents partner | **Both:** admin-initiated enroll **and** self-serve apply queue |
| Register | `POST .../partners` → `pending` | Same; create **participant** row + link to partner; accept `participant_type` + subject ids |
| Review | Manual | Checklist: **Didit mandatory** on owners before activate, business flags, sanctions, settlement currency, surface list |
| Approve partner | `transition` → `active` (single admin + audit reason) | **Maker-checker dual control** on partner activate (route through Approvals / pending-actions); Didit clear required |
| Agreement | Create `draft` → `pending_approval` → `active` | Require **active agreement** before customer eligibility (already enforced in `findSpendAgreement`) |
| Material change | New agreement version; suspend old | Re-review: new version must go `pending_approval` → `active`; auto-suspend spend on material term change |
| Suspend / revoke | Partner + agreement transitions | Partner suspend blocks spend immediately; rail freeze blocks **all** initiation |

Customer spend still independently needs: rail enabled, not frozen, customer role (or **guest with risk limits** — LOCKED), agreement/entitlement rules, caps.

### 4) Customer-side gates (updated for locks)

- **Signed-in customer** path unchanged (`role = customer`).
- **Guest Credit allowed with risk limits** (LOCKED) — define guest wallet / entitlement caps, device/session binding, lower daily/lifetime/max-ticket than signed-in; food guest 401 today (`foodController.js:2540-2541`) becomes a deliberate guest policy, not a hard product ban.
- Eligibility + optional entitlements (`CUSTOMER_SPEND_ACCESS_SQL`, `oxsteedCreditService.js:1441-1444`).
- Currency match partner settlement vs surface currency.
- Daily / lifetime / max ticket from agreement ∩ entitlement (stricter for guests).
- Impersonation blocked on Credit mutations (`rejectImpersonated` on `/api/oxsteed-credit/*` money routes).

### 5) Hold vs debit matrix (LOCKED)

| Surface | Mode | Notes |
|---------|------|-------|
| Food online | Immediate debit | Existing path |
| Messenger / chat | Immediate debit | Existing path; broaden payee resolution |
| Card kiosk redeem | Immediate debit | Existing path |
| Restaurant POS | **Hold, then always debit then adjust** | Replace exact-amount capture-only; tip / partial / overage via adjust after debit |
| Marketplace jobs | **Hold Credit as escrow collateral** | Hybrid with platform escrow naming; release/capture on job complete/cancel |
| Direct / QR / subscriptions / others | Per agreement `allowed_surfaces`; default debit unless fulfillment unknown | Subscriptions = recurring debit in v1 |

---

## Surface-by-surface rollout table

| # | Surface | Today | Proposed Credit path | Participant type (admin-approved) | Debit vs hold | Priority / dependency | Notes / gaps |
|---|---------|-------|----------------------|-----------------------------------|---------------|----------------------|--------------|
| 1 | Food online checkout | **Works** (signed-in; mode `oxsteed_credit`) | Keep via adapter; add **guest + risk limits** | `restaurant` | Immediate debit | P0 — production path | Guest policy NEW (LOCKED) |
| 2 | Restaurant POS | **Works** — customer hold; cashier pastes hold ID; exact amount | Keep hold; change finalize to **debit then adjust** | `restaurant` | Hold → debit+adjust | P0 | Tip/partial/overage unlocked (LOCKED) |
| 3 | Card kiosk redeem | **Works** — device + PIN → purchase | Keep | `restaurant` | Immediate debit | P0 | Partner must be active for restaurant |
| 4 | Messenger / live chat pay | **Works** — `PayWithCreditModal` → chat controller | Keep; resolve via **participant** (no restaurant row required) | `business` / helper participant | Immediate debit | P0/P1 | Chat without restaurant (LOCKED); needs participant table |
| 5 | Food self-serve / in-store kiosk order | **No** — Credit not in supported modes | Add `oxsteed_credit` **or** force POS hold→debit+adjust | `restaurant` | Prefer hold or signed-in/guest debit | P2 | Distinct from card-redeem kiosk |
| 6 | Marketplace jobs assign | **No Credit** — `oxsteed` = platform escrow | **Hybrid:** hold Credit as escrow collateral | `helper` or `business` | Hold (collateral) | P2 | LOCKED hybrid; rename UX still recommended alongside |
| 7 | Direct (quotes / portals) | Stripe / proof of payment | Adapter + pay picker | `business` / Direct provider | Debit or hold per quote | P1 after participant table | Chat overlap; pure business now in scope |
| 8 | QR scan-to-pay | Stripe Checkout | Credit option on pay page | `qr_merchant` | Immediate debit | P2 | **Wire behind launch flag before un-hide** (LOCKED) |
| 9 | Local delivery extras | Stripe / payment sync | Adapter on delivery merchant | Delivery merchant / restaurant | Debit | P3 | Wire behind flags first |
| 10 | Subscriptions | Stripe | **Recurring Credit debit in v1** | `subscription_merchant` | Recurring debit | P1/P2 — still `subscriptions: false` in launchScope | LOCKED in v1; wire behind flag before un-hide |
| 11 | Consulting sessions | No Credit; `/consulting` → business-hub | Adapter if product returns | `consulting_seller` / business | Debit or hold | P3 | Wire behind flags first |
| 12 | Business invoices | Owner payment methods / proof | Optional Credit settle | Invoice issuer as `business` | Debit | P3 | Wire behind flags first |
| 13 | Marketplace products | No Credit; launch-hidden | Checkout picker | Product seller participant | Debit | P3 | Wire behind flags first |
| 14 | Tool rentals / rental invoices | Owner payment identifiers | Optional | Rental owner participant | Debit | P3 | Wire behind flags first |
| 15 | Restaurant Runner handoff | Does **not** accept Credit; treats `oxsteed_credit` as prepaid | No change for accept | N/A | N/A | P0 awareness | Not a payee enrollment target |
| 16 | Guest checkout (food) | **Blocked** for Credit | **Allow with risk limits** | Same restaurant / participant | Debit (capped) | P1 — guest policy | LOCKED |
| 17 | Customer↔customer transfer | Exists on Credit rail (not merchant accept) | Out of “accept Credit” scope | N/A | Transfer | Ops only | |
| 18 | Top-up / load / conversion / withdraw | Funding & money-out — not merchant accept | Unchanged gates | N/A | — | Keep before expanding spend | |
| 19 | Restaurant-scoped wallet (`restaurant_credit`) | Separate product | Do not merge ledgers | Restaurant wallet | — | Clarify UX | Different from OxSteed Credit |
| 20 | Admin capture / break-glass holds | Admin can capture holds | Keep; extend for debit+adjust / jobs collateral release | Partner of hold | Capture / adjust | Ops | |

**Rollout table surface count: 20**

---

## Admin approval requirements (detailed)

### Required to approve a participant (proposed checklist)

| Requirement | Exists today? | Notes (post-lock) |
|-------------|---------------|-------------------|
| Super Admin actor + audit reason | **Yes** | `requireAdministrativeActor`, `requireAuditReason` |
| Linked restaurant active (for restaurant type) | **Yes** | Cannot activate partner if restaurant not `active` (`transitionPartner` `:1123-1124`); non-restaurant types use participant subject checks |
| Settlement currency supported | **Yes** | `assertSupportedCreditCurrency` on register |
| Versioned agreement with starts_at, limits, geo, order types/categories | **Yes** | Agreement create + transition to `active`; add `allowed_surfaces` |
| Optional customer entitlements | **Yes** | When `requires_customer_entitlement`; guest risk-limit profile (LOCKED) |
| Didit / identity verification on owners | **Platform exists**; **not** wired as Credit partner enrollment gate | **LOCKED: Didit mandatory before participant `active`** |
| Maker-checker on partner activate | **No** (money only) | **LOCKED: require dual control** via Approvals / pending-actions |
| Self-serve “apply to accept Credit” | **No** | **LOCKED: both** admin-only enroll **and** self-serve apply |
| Non-restaurant participant row | **No** | **LOCKED: separate participant table** linking to partners |

### Agreement terms to carry forward

- Settlement currency; max ticket; daily / lifetime customer limits (guest caps stricter)  
- Allowed order types / categories / menu items (food-shaped today — generalize to **surfaces**)  
- Geography JSON  
- Customer terms text; metadata  
- Settlement / reserve / fee schedule — **same cycle as restaurants** for all types (LOCKED)

### Suspension / freeze interaction

| Control | Scope | Behavior |
|---------|-------|----------|
| Partner `suspended` / `terminated` | One payee | `findSpendAgreement` requires `p.status = 'active'` — spend fails |
| Agreement non-active | One agreement | Same |
| Rail `oxsteed_credit_enabled = false` | Global | All initiation 503 |
| Rail freeze (`oxsteed_credit_rail_freezes`) | Global initiation | Block new money; in-flight completions may bypass freeze only |

### Impersonation / break-glass

- Customer Credit mutations: `rejectImpersonated` on holds, topups, withdrawals, cards, etc. (`server/routes/oxsteedCredit.js`).
- Admin Credit mutations: Super Admin + audit; money-moving via pending-actions + step-up (`pending_action_approve`); **partner activate also dual-controlled** (LOCKED).
- **Do not** allow impersonated sessions to spend Credit on new surfaces.

---

## Half-wired / copy / naming cleanup

| Issue | Evidence | Recommendation |
|-------|----------|----------------|
| Dashboard: “Spendable across OxSteed” | `client/src/locales/en.json` (`oxsteedCreditScope`, `noOxsteedCreditText`) | Align with Credit page until everywhere ships; then “approved participants” |
| Credit page copy (correct today) | `client/src/i18n/locales/en/credit.json` `heroDescription`, `authorizeCopy` | Update when non-restaurant + guest go live |
| Jobs `payment_method: 'oxsteed'` ≠ Credit ledger | `jobController.js:603-714` | Keep escrow naming clear; **bridge via Credit hold as collateral** (LOCKED hybrid) |
| Chat “partner” vs restaurant-only schema | Chat resolves `business_id` on `oxsteed_credit_partners` still requiring `restaurant_id` | Participant table + chat without restaurant (LOCKED) removes this block |
| Runner prepaid list includes `oxsteed_credit` | `restaurantRunnerController.js:85` | Fine if food debit already posted; don’t advertise Runner as Credit accept |

---

## Suggested phased build order (design only)

1. **Schema + admin control plane** — **separate participant table** linking to partners; extend Partners UI; **maker-checker on activate**; **Didit gate before active**; agreement `allowed_surfaces`; **self-serve apply + admin enroll**.  
2. **Shared spend adapter** — wrap purchase/hold; enforce **per-surface matrix**; POS **debit then adjust**; jobs **hold-as-collateral**; standardize reference metadata.  
3. **Guest risk-limits policy** — entitlement / caps / session binding; unlock food + later surfaces under those caps.  
4. **Copy cleanup** — dashboard vs Credit page; jobs escrow vs Credit collateral naming.  
5. **P0 harden existing** — food / POS / card kiosk / chat (already live when rail on); chat resolution without restaurant row.  
6. **P1 Direct + pure business + subscriptions recurring debit** — first non-restaurant acceptors; subscriptions **in v1** but still behind launch flag until product un-hide.  
7. **P2** self-serve food kiosk Credit; QR Credit option; jobs hybrid collateral path.  
8. **P3** consulting / invoices / products / delivery — **wire Credit behind launch flags before un-hide** (LOCKED); same settlement cycle; disputes playbooks.  
9. **Compliance** — Didit mandatory on approve; participant suspend runbooks; freeze drills; dual-control audit on enrollment.

---

## Locked decisions (2026-10-07)

Product decisions locked in chat with Emile on **2026-10-07** (America/New_York). Current-state tip/evidence above still describes **code as of tip** `0d83dc6a`; these rows define the **target design**.

| # | Decision | Status | Locked choice |
|---|----------|--------|---------------|
| 1 | Guest Credit? | **LOCKED** 2026-10-07 | Allow guest Credit **with risk limits** |
| 2 | Jobs in scope? | **LOCKED** 2026-10-07 | **Hybrid:** hold Credit as escrow collateral |
| 3 | Tip / partial capture on POS? | **LOCKED** 2026-10-07 | POS: **always debit then adjust** |
| 4 | Hold vs debit policy? | **LOCKED** 2026-10-07 | **Per-surface matrix** (food/chat debit; POS/jobs hold) |
| 5 | Participant schema shape? | **LOCKED** 2026-10-07 | **Separate participant table** linking to partners |
| 6 | Maker-checker on partner approval? | **LOCKED** 2026-10-07 | **Require dual control** on partner activate |
| 7 | How do participants enroll? | **LOCKED** 2026-10-07 | **Both** admin-only enroll **and** self-serve apply |
| 8 | Chat Credit without restaurant row? | **LOCKED** 2026-10-07 | **Allow** Credit without restaurant row |
| 9 | Subscriptions recurring Credit in v1? | **LOCKED** 2026-10-07 | **In v1** — recurring debit |
| 10 | Credit on launch-hidden surfaces? | **LOCKED** 2026-10-07 | **Wire Credit behind flags** before un-hide |
| 11 | Settlement for non-restaurant participants? | **LOCKED** 2026-10-07 | **Same cycle** as restaurants |
| 12 | Didit before participant active? | **LOCKED** 2026-10-07 | **Mandatory** before participant `active` |

---

## Bottom line

Credit everywhere means: **(a)** a shared spend adapter on existing purchase/hold primitives with a **locked per-surface debit/hold matrix** (food/chat debit; POS/jobs hold, with POS finalize as debit-then-adjust and jobs hold as escrow collateral), **(b)** every payee is an OxSteed-admin-approved participant behind a **new participant table** linked to partners, with **Didit mandatory** and **maker-checker dual control** on activate, and **(c)** enrollment is both admin-initiated and self-serve apply, chat works without a restaurant row, guest spend is allowed under risk limits, subscriptions recurring Credit is **in v1**, launch-hidden surfaces get Credit wired **behind flags before un-hide**, and non-restaurant settlement uses the **same cycle as restaurants**. The rail flag and freeze remain global kill switches; admin approval is the **per-payee** control plane. Do not treat jobs’ `oxsteed` or dashboard “across OxSteed” copy as evidence that Credit already spends site-wide — they don’t; the hybrid jobs path and copy cleanup are part of the build.

Emile owns implementation; this document is findings/design only. Product decisions locked 2026-10-07 in chat with Emile.
