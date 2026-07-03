# Restaurant Credit International Production Readiness

Last updated: 2026-07-03

## Goal

Make OxSteed restaurant credit safe for international production use across the customer app, POS, Kitchen, Display, and backend. The payment model is restaurant credit, pay-at-restaurant, and direct payment recorded by the restaurant; processor-backed card payments remain outside this readiness scope until explicitly enabled.

## Current Backend Guarantees

- Restaurant-credit QR sessions are single-active-session per customer and restaurant. Creating a new QR payment session cancels or expires older active sessions before issuing the new token.
- POS wallet-credit redemption validates the QR session currency and the wallet currency against the order/ticket currency before debiting.
- Restaurant-credit POS refunds are ledger-backed: the customer wallet is credited back, the POS refund payment is recorded, the original wallet-credit POS payment tracks refunded amount, and a receipt audit event is written.
- Refund idempotency handles split wallet refunds by checking exact parent keys and child keys using the parent-key prefix.
- Reconciliation now includes wallet ledger movement, POS wallet-credit payments/refunds, QR payment session state, receipt audit events, stale QR sessions, pending/failed POS payments, and per-currency variance checks.

## Production Readiness Schema

Each restaurant-credit production release should verify:

- `Currency enforcement`: order, restaurant, wallet account, QR session, POS payment, refund, receipt, and reconciliation use the same ISO currency code for the transaction.
- `Idempotency`: payment and refund requests can be safely retried without double debit or double refund.
- `QR safety`: stale or replaced QR codes cannot silently redeem against the wrong amount, restaurant, order, wallet, customer, or currency.
- `Ledger parity`: wallet debits/refunds reconcile to POS wallet-credit payments/refunds by currency.
- `Receipt auditability`: every restaurant-credit debit/refund has an operator-visible receipt/audit trail.
- `International formatting`: apps display amounts using the restaurant/order currency instead of hardcoded USD symbols.
- `Fallback honesty`: unavailable payment methods say coming soon or pay at restaurant, instead of pretending processor payments are active.

## Verified In This Pass

- `node -c controllers/foodWalletController.js`
- `node -c controllers/restaurantAppFlowController.js`
- `npm test -- --runInBand __tests__/foodWallet.test.js`
- `npm test -- --runInBand __tests__/restaurantAppFlow.test.js`
- `xcodebuild` Debug simulator build for OxSteed POS
- `xcodebuild` Debug simulator build for OxSteed
- `xcodebuild` Debug simulator build for OxSteed Kitchen
- `xcodebuild` Debug simulator build for OxSteed Display

## Remaining Before Calling It Fully Production Ready

- Add or confirm app-side screens for reconciliation review, failed QR session handling, refund history, and receipt/audit visibility for restaurant owners.
- Run end-to-end device/simulator QA with a seeded non-USD restaurant credit wallet, QR payment, kitchen/display order update, partial refund, full refund, and reconciliation review.
- Confirm production migrations are applied in order, especially wallet QR sessions, receipt audit contract, wallet-credit POS payment type, and any newer payment ledger migrations.
- Confirm exported App Store builds for POS, Kitchen, Display, and OxSteed are built from the same backend contract versions verified here.
- Add operational monitoring for stale active QR sessions, unbalanced reconciliation rows, failed POS payments, and wallet integrity locks.

## Release Decision

The backend is materially closer to long-term international readiness for restaurant credit, especially around currency safety, QR hardening, refunds, and reconciliation. The ecosystem should not be called fully production-ready internationally until the remaining end-to-end app QA and operational monitoring checks are complete.
