# OxSteed Credit Card Ecosystem

Added 2026-09-17. Source-only; not deployed, not migrated into any live
database, and not covered by isolated Docker/Colima verification yet. This
document exists so the next engineering pass (human or agent) has the design
rationale before running migration 530 or building the client UI.

## What this is

A card credential layer on top of the existing OxSteed Credit ledger
(`server/services/oxsteedCreditService.js`). A card is **never a second value
store** -- it is an alternate, revocable credential that resolves back to the
customer's existing `oxsteed_credit_accounts` row, the same way a restaurant
QR session resolves to a restaurant wallet today. Every spend, refund, hold,
settlement, and currency safeguard already built into the core ledger is
reused unchanged.

This intentionally stays closed-loop: no bank sponsor, no card network (Visa/
Mastercard), no BIN, no ATM-network membership. It supports:

- **Virtual cards** -- minted instantly, active immediately.
- **Physical cards** -- request -> admin fulfillment lifecycle
  (`pending -> printed -> shipped -> delivered`) -> customer activation with a
  one-time printed activation code.
- **Redemption at a partner restaurant** -- a card credential is just another
  way to identify the customer for the existing, fully-verified
  `purchaseWithCreditInTransaction` purchase pipeline. No new spend logic.
- **Kiosk cash-out** -- a new `cash_out` ledger transaction type (the mirror
  of `load`: value leaves the customer wallet and returns to
  `platform_treasury`), gated by a card PIN and its own, deliberately tighter,
  single-transaction and daily caps, because physical cash cannot be clawed
  back the way a partner refund can.

## Files added/changed

| File | Purpose |
| --- | --- |
| `server/migrations/530_oxsteed_credit_cards.sql` | `oxsteed_credit_cards` table, `cash_out` transaction type, `credit_kiosk` device app-key, account-status-propagation trigger |
| `server/services/oxsteedCreditCardService.js` | Issuance, fulfillment, activation, freeze/unfreeze/lost/reissue/revoke, PIN management, redemption, cash-out |
| `server/services/oxsteedCreditService.js` | Additive: `cash_out` transaction type + direction validation in `postJournalTransaction`; additive exports the card service needs |
| `server/controllers/oxsteedCreditCardController.js` | Customer, admin, and kiosk-device HTTP handlers |
| `server/controllers/restaurantAppFlowController.js` | Additive exports (`requireDeviceCredential`, `deviceTokenFromRequest`, `assertDeviceApp`) + `credit_kiosk` added to `APP_KEYS`, so kiosk hardware reuses the existing POS/Kitchen/Display device-pairing model instead of a new one |
| `server/routes/oxsteedCredit.js` | Customer card routes (`/api/oxsteed-credit/cards/*`) |
| `server/routes/oxsteedCreditKiosk.js` | Device-authenticated kiosk routes (`/api/restaurants/:restaurantId/credit-kiosks/:deviceId/{redeem,cash-out}`) |
| `server/routes/admin.js` | Super Admin card routes (`/api/admin/super/oxsteed-credit/cards/*`) |
| `server/index.js` | Mounts the kiosk route |
| `server/__tests__/oxsteedCreditCard.test.js` | Focused mock-DB unit/controller tests |

## Kiosk hardware provisioning (no new device model)

A cash-out/redemption kiosk pairs exactly like a POS/Kitchen/Display device:
`POST /api/restaurants/:restaurantId/devices/pairing-codes` with
`appKey: 'credit_kiosk'`, then the existing `pairDevice` flow, using the
existing `restaurant_app_devices` table and device-token auth. Nothing new to
build there -- migration 530 only widens the existing `app_key` and
`transaction_type` CHECK constraints.

## Security notes

- Raw card credentials, PINs, and physical-card activation codes are **never
  persisted**. Only a SHA-256 hash (PINs also get a per-card random salt) is
  stored. Raw values are returned to the caller exactly once.
- PIN attempts lock the card after `OXSTEED_CREDIT_MAX_CARD_PIN_ATTEMPTS`
  (default 5) for `OXSTEED_CREDIT_CARD_PIN_LOCKOUT_MINUTES` (default 15).
- Cash-out has its own caps, separate from general spend:
  `OXSTEED_CREDIT_MAX_CASH_OUT_TRANSACTION_CENTS` (default $200),
  `OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CASH_OUT_CENTS` (default $200),
  `OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CASH_OUT_COUNT` (default 3/day). These
  are placeholder defaults -- tune before any real cash movement.
- Reporting a card lost/stolen immediately revokes it and (unless the caller
  opts out) issues a virtual replacement so the customer is never without a
  working credential while a physical replacement ships.
- If a customer's OxSteed Credit account is ever closed, a new database
  trigger (`oxsteed_credit_account_status_guard_cards`) automatically revokes
  every card tied to it, mirroring migration 485's existing restaurant-status
  propagation pattern.

## What is explicitly NOT done here

- **No migration has been run against any database.** Run migration 530
  against an isolated fixture first, per the project's existing evidence
  discipline (see `docs/oxsteed-credit-requirements-matrix.md`).
- **No client/admin UI.** The backend contract above needs a customer-facing
  "My Cards" screen, an admin fulfillment queue, and a kiosk hardware
  application (screen + card reader/PIN pad + optional cash dispenser
  integration).
- **No physical cash-dispenser hardware integration.** `cashOutWithCard`
  posts the ledger movement and returns success; the actual bill-dispensing
  command to kiosk hardware (e.g. a GRGintech/ITK-Dev cash dispenser SDK call)
  is a hardware-integration follow-up once physical kiosks are chosen.
- **No live regulatory/licensing review.** Per the existing project convention,
  human licensing, money-transmission analysis, and provider approvals belong
  to the separate launch handoff -- they are out of scope for this code
  change, same as the rest of the OxSteed Credit rail.
- **Isolated race/concurrency verification.** The existing Credit rail has
  extensive real-Postgres race verifiers (`scripts/credit-isolated-races.js`
  etc.); the new `cash_out` path and card-credential resolution should get the
  same treatment before being trusted at volume.
