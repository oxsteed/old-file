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
- `xcodebuild` Debug simulator build for OxSteed after wiring reconciliation v2 into the Business Dashboard
- `xcodebuild` Debug simulator build for OxSteed POS after replacing the Pay tab placeholder with the real payment terminal
- `node -c controllers/foodController.js`
- `npm test -- --runInBand __tests__/foodWallet.test.js` after adding the kiosk pending restaurant-credit regression test
- `xcodebuild` Debug simulator build for OxSteed Display after enabling kiosk restaurant-credit checkout
- `xcodebuild` Debug simulator build for OxSteed Kitchen after preserving `requires_payment` as a distinct kitchen payment state
- `xcodebuild` Debug simulator build for OxSteed Restaurant after replacing hardcoded USD fallbacks with market-aware currency formatting across checkout, cart, orders, favorites, and restaurant detail
- `xcodebuild` Debug simulator build for OxSteed Restaurant after extending currency-aware formatting to home reorder cards and discover price tiers
- `xcodebuild` Debug simulator build for OxSteed Restaurant after wiring restaurant support case history, detail threads, attachments, and reply/reopen/accept-resolution actions into the account support sheet
- `xcodebuild` Debug simulator build for OxSteed after adding a wallet statement drill-down to the business dashboard
- `xcodebuild` Debug simulator build for OxSteed Restaurant after adding customer wallet history, wallet integrity checks, and payments/receipts navigation in the account area
- `xcodebuild` Debug simulator build for OxSteed Restaurant after adding wallet-level payment issue remediation that opens a support case tied to the restaurant wallet

## App-Side Owner Visibility Added

- OxSteed now decodes the reconciliation v2 backend contract in the main food API models.
- The Business Dashboard wallet reconciliation card now surfaces POS restaurant-credit totals, refund totals, net settled credit, QR redemptions, pending/failed POS payment counts, stale QR sessions, unbalanced currencies, per-currency debit/refund variances, and receipt audit summaries.
- The UI remains backward-compatible with older reconciliation responses while production deploys roll forward.

## International Currency Formatting Added

- OxSteed Restaurant now formats money using the active restaurant currency or market currency instead of hardcoded USD strings in checkout, order confirmation, cart, orders, favorites, and restaurant detail views.
- Home reorder cards and discover cards now follow the same market-aware formatting path so the browsing surface stays consistent with checkout.
- Quantity summaries, totals, and order confirmation screens now respect the current locale while still falling back safely if a formatter cannot resolve.
- Restaurant price tier indicators now render using the configured market currency symbol instead of a USD-only placeholder.

## POS Payment Surface Added

- OxSteed POS no longer shows a prototype-only Pay tab. The Pay tab now opens the same backend-backed payment terminal used from active tickets.
- The payment terminal supports restaurant-credit QR redemption, restaurant-credit wallet lookup, pay-at-restaurant state recording, direct payment reference capture, discounts, voiding, and backend order/payment sync through the existing POS API contract.
- The modal ticket checkout path still keeps its Back behavior, while the tab-mounted terminal stays in place after successful payment and clears tender inputs for the next transaction.

## Display Kiosk Restaurant-Credit Flow Added

- OxSteed Display now offers Restaurant Credit for dine-in and takeout kiosk checkout instead of limiting it to delivery-only language.
- Unauthenticated kiosk restaurant-credit orders are created as `requires_payment` without debiting a wallet immediately, which lets a guest create an order at the kiosk and settle with their OxSteed Pay QR at POS before pickup or handoff.
- Signed-in mobile restaurant-credit orders still support immediate wallet debit and paid order creation.
- POS remains the secure restaurant-credit settlement point for shared devices: QR session validation, currency checks, idempotency, POS payment records, and reconciliation stay centralized in the backend.

## Kitchen Payment-State Safety Added

- OxSteed Kitchen now decodes `requires_payment` as a distinct operational payment state instead of collapsing it into generic `Unpaid`.
- Ticket cards and ticket details show a visible payment warning for orders that still need POS QR settlement or payment confirmation.
- This protects the international kiosk/POS flow by helping kitchen and expo staff avoid releasing food before the restaurant-credit payment is settled.

## Customer Support History Added

- OxSteed Restaurant now treats support cases as durable customer history items instead of a dead-end submit form.
- The account support sheet can open a live case detail thread with messages, attachments, and case-history events pulled from the backend.
- Customers can reply directly into the case thread, reopen resolved/closed cases, and accept an offered resolution so support actions stay visible from the app.
- This closes the long-term gap where refund/dispute/support activity could feel like it disappeared after submission.

## Merchant Ledger Statement Drill-Down Added

- OxSteed now exposes a backend-backed wallet statement drill-down from the business dashboard so operators can inspect receipt-level movements, balances, and audit details for a restaurant wallet.
- The statement view defaults to a recent date range and supports customer filtering, making it useful for production support, reconciliation, and receipt review without leaving the app.
- This closes the long-term visibility gap between the reconciliation summary and the underlying ledger rows.

## Customer Wallet History Added

- OxSteed Restaurant now exposes customer wallet and transaction history from the account area instead of hiding all restaurant-credit movement behind checkout-only flows.
- The new wallet history view lists restaurant wallet accounts, recent ledger entries, and integrity/audit results so users can review debit, credit, and settlement activity over time.
- This gives the restaurant-credit system a long-term receipts-and-history surface that aligns with the support case history work instead of leaving payments opaque after purchase.

## Wallet Payment Issue Remediation Added

- The customer wallet detail screen now offers a first-class payment support action for failed QR sessions, missing settlements, or wallet mismatches.
- That action pre-fills a support case with restaurant-wallet context so the issue remains visible in support history instead of disappearing as an untracked payment failure.
- The support form routes through the existing restaurant support case backend contract, so no new payment-case API was needed to make the remediation durable.

## Remaining Before Calling It Fully Production Ready

- Run end-to-end device/simulator QA with a seeded non-USD restaurant credit wallet, QR payment, kiosk pending order, POS redemption, kitchen/display order update, partial refund, full refund, and reconciliation review.
- Confirm production migrations are applied in order, especially wallet QR sessions, receipt audit contract, wallet-credit POS payment type, and any newer payment ledger migrations.
- Confirm exported App Store builds for POS, Kitchen, Display, and OxSteed are built from the same backend contract versions verified here.
- Operational monitoring is now covered by the restaurant wallet watchdog: stale active QR sessions, overdue and recent failed POS payments, reserved-balance drift, account/ledger balance drift, and recent wallet integrity locks create durable deduplicated incidents. The remaining work is production configuration and end-to-end device/simulator QA.

## Release Decision

The backend is materially closer to long-term international readiness for restaurant credit, especially around currency safety, QR hardening, refunds, and reconciliation. The ecosystem should not be called fully production-ready internationally until the remaining end-to-end app QA and operational monitoring checks are complete.
