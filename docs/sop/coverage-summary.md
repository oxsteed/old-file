# SOP Coverage Summary

Coverage audit for the OxSteed Visual SOP library. Source of truth: `coverage-matrix.json` in this directory.
Branch audited: `feat/sop-library`. Generated 2026-10-16.

Scope: primary user workflows only. Platform admin pages, support-agent tooling, and internal
operations procedures are excluded entirely. Every route, screen, and handler claim below was
verified against the actual code; nothing was guessed.

## Counts per family per status

| Family | Supported | Conditional | Unavailable | Total |
|---|---|---|---|---|
| account | 9 | 0 | 0 | 9 |
| hiring | 13 | 0 | 0 | 13 |
| helper-work | 10 | 1 | 0 | 11 |
| business-work | 9 | 1 | 1 | 11 |
| restaurants | 9 | 0 | 0 | 9 |
| financial | 7 | 1 | 0 | 8 |
| logistics | 10 | 2 | 0 | 12 |
| other | 9 | 0 | 0 | 9 |
| **Total** | **76** | **5** | **1** | **82** |

## Conditional workflows and their conditions

1. **helper-earnings** (View earnings overview) - Visible only when the `helperEarnings` launch
   flag is enabled (default off in `client/src/utils/launchScope.js`). The flag hides the
   dashboard earnings section in `HelperDashboard.jsx`. The `/helper/payouts` page and
   helper-earnings statements are not flag-gated and remain available.
2. **business-specialized-intakes** (Submit specialized intake requests: maintenance, trades,
   beauty, creative, professional, continuity) - Requires the `specializedProfileTemplates`
   launch flag (default false). While disabled, `server/middleware/launchGate.js` returns 404
   for the public intake API and the client hides the flow. Hub intake tabs are pre-registered
   in `LAUNCH_BUSINESS_HUB_TABS` for launch.
3. **financial-oxsteed-credit** (Use OxSteed Credit: top-ups, transfers, withdrawals, cards) -
   Requires the `oxsteed_credit_enabled` feature flag (feature_flags table). It is ON in
   production as of 2026-10-11. When the rail is off, food-wallet writes fail open with
   backfill markers replayed by a sweeper on re-enable, while fiat paths (top-ups,
   withdrawals, conversions, cards, compliance) fail closed.
4. **logistics-accept-quotes** (Publish and accept quotes) - Requires
   `LOGISTICS_PAYMENTS_ENABLED=true` (default off). While disabled the quote lifecycle
   routes (`/api/logistics/finance/quotes*`) answer 503 via
   `server/middleware/requireLogisticsPayments.js`.
5. **logistics-confirm-payments** (Confirm payments at checkout) - Same
   `LOGISTICS_PAYMENTS_ENABLED` gate (default off). While disabled, `/logistics/checkout`
   and `/logistics/payments` answer 503 and the client checkout shows a disabled state.

## Unavailable workflows and reasons

1. **business-leads** (Work the lead pipeline) - `client/src/pages/BusinessLeadsPage.jsx`
   exists but is never imported or routed in `client/src/App.jsx`, so there is no reachable
   UI. Server lead-pipeline APIs (`/api/business-leads`, `/api/business-lead-pipeline`)
   exist but have no user surface. No SOP guide can be written against a reachable workflow.

## Notable gaps and ambiguities

- **OxSteed Credit vs Restaurant Credit are distinct products** and are tracked as separate
  workflows (`financial-oxsteed-credit`, `financial-restaurant-credit`). OxSteed Credit is
  user-scoped with cards, top-ups, and withdrawals; Restaurant Credit is per-restaurant
  wallets used at food checkout. Guides must not conflate them.
- **Quotes exist in three separate systems**: helper quotes (`/api/helper-quotes`), business
  quotes (`/api/businesses/:businessId/quotes`), and Direct quote requests
  (`/api/quote-requests`), plus gated logistics finance quotes. Each has its own lifecycle
  and audience.
- **Receipts have no standalone hub** (`financial-receipts`): receipts render in context
  (Direct payment receipt view, food order detail). A receipts guide should point at those
  surfaces rather than a dedicated page.
- **Logistics claims and refund requests have no standalone pages**: both are filed via API
  and surfaced inside the buyer dashboard (`/logistics/buyer`) and finance page.
- **Car care is a vehicle garage, not a service-booking flow** (`other-car-care`): it manages
  owned-vehicle records via `/api/vehicles`. Do not write it as a booking guide.
- **Client management for helpers is conversation-based** (`helper-clients`): the
  `/helper/clients` page manages conversations, guest inquiries, and quote history; there
  is no separate helper CRM record store.
- **Unlaunched product surfaces present in the repo but excluded from workflows**:
  product marketplace and carts (`productMarketplace: false`, launchGate 404s
  `/api/marketplace/products`, `/api/carts`, `/api/shared-carts`, `/api/job-kits`,
  `/api/templates`), background-check request UI (`backgroundChecks: false`),
  subscriptions (`subscriptions: false`), affiliate rewards (`AFFILIATE_ENABLED` gate),
  generic QR generator flag (`genericQrGenerator: false`, though the `/qr-generator` page
  itself has no code-level gate), Vortex (`VORTEX_ENABLED`), and the personal life
  dashboard (`personalLifeDashboard: false`). These must not get SOP guides until launched.
- **Mode/role model**: `server/utils/modeRole.js` maps modes to RBAC roles; customer and
  helper are the base roles, with `helper_pro` and `broker` as helper tiers. Business,
  restaurant, consultant, and tool-owner modes are helper-class at the DB level. Granted
  modes (business_manager, business_representative, business_employee,
  business_support_agent) require membership and manual entry via the mode switcher.
- **Permission patterns verified**: `requireAuth` on nearly all mutations;
  `requireEmailVerified` and `requireTermsAcceptance` on booking creation;
  `bizIdAccess('any'|'manager')` capability checks on business-scoped writes;
  `checkRestrictions('checkout')` on money movement; `requireLogisticsPayments` 503 gate
  on logistics payments; tax-identity (W-9) gate on helper payouts.
- **Ambiguity**: the Direct quote-request lookup (`/direct/view-quote`) is guest-accessible
  by code, while quote detail requires auth; guides should note both paths.
- **Ambiguity**: `/wallet` is an overview and `/oxsteed-credit` is the full credit page;
  the wallet guide should direct detail-seekers to the credit page.
