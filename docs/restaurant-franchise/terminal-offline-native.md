# Offline card (Stripe Terminal store-and-forward): native POS contract (F-08)

The server side is done and tested. Collecting a card with no internet is the
native POS app's job (the web POS cannot run the Terminal SDK's offline mode).
This doc is the contract that app must follow. Nothing here has been tested
in a real outage yet; that needs a physical reader and a staged outage.

Off by default: `RESTAURANT_TERMINAL_OFFLINE_ENABLED=true` plus a reviewed
per-store policy (`PUT /restaurants/:id/locations/:locationId/terminal/offline-policy`:
allowed brands, per-sale cap, per-day cap, settlement mode `manual_review`).

## 1. Before an outage: take a lease (online)

At drawer open, and again whenever the lease is near expiry:

```
POST /api/restaurants/:restaurantId/pos/offline-leases
X-Device-Token: <paired POS token>
{ "locationId": 12, "deviceId": 34, "shiftId": 56, "budgetCents": 50000 }   // budget optional
→ { "lease": { "id", "budgetCents", "maxTransactionCents", "allowedBrands",
               "expiresAt", "stripeAccount", "currencyCode", "captureMethod": "manual" } }
```

- One active lease per POS; repeating the call returns it. Default 12 h
  (`RESTAURANT_TERMINAL_OFFLINE_LEASE_HOURS`, max 24).
- Budget comes out of the same store/day pool as online offline-permits, so
  two registers cannot each spend the full daily cap.
- Refused (409) when the policy is off, no open drawer, the daily pool is
  used up, or the review queue has items older than 24 h
  (`terminal_offline_reconciliation_backlog`).
- Store the lease (id, limits, expiry, account) in encrypted device storage.

## 2. During the outage

- Configure the SDK with `offlineBehavior: prefer_online` (never
  `force_offline` for normal sales) and Stripe's own offline limits no higher
  than the lease limits.
- Before each offline sale, enforce locally: brand in `allowedBrands`,
  amount ≤ `maxTransactionCents`, running total ≤ `budgetCents`, now ≤
  `expiresAt`. If any fails, refuse the card and take cash or wait.
- Generate `offlineId` (UUID v4) per sale and create the PaymentIntent with
  `capture_method: manual`, `metadata: { offlineId, offlineLeaseId, food_order_id? }`.
  `offlineId` is what the server searches for if the device never reports back.
- Save the ticket through the existing offline ticket outbox
  (`/screens/offline-tickets`, ticket UUID) and keep
  `{ offlineId, leaseId, amountCents, collectedAt, screenTicketId }` in a local
  outbox. Never delete an outbox row until the server answers 200/202.

## 3. After reconnecting

1. Let the SDK forward stored payments (Stripe forwards them automatically).
2. Flush the ticket outbox as today.
3. For every offline sale, register it (retries are safe; the same
   `offlineId` with different facts is rejected with 409):

```
POST /api/restaurants/:restaurantId/pos/offline-leases/:leaseId/payments
X-Device-Token: …
{ "deviceId": 34, "offlineId": "uuid", "intentId": "pi_…" (once forwarded),
  "amountCents": 1250, "collectedAt": "2026-10-26T18:04:00Z",
  "screenTicketId": "uuid" | "foodOrderId": 789 }
→ 200 { attached: true, settled: true|false, status, reviewReasons }
→ 202 { attached: false, waitingForTicket: true }  // ticket not accepted yet
```

4. Close the lease at drawer close:
   `POST …/offline-leases/:leaseId/close { deviceId }`.

## What the server guarantees

- Money taken offline is never dropped: over-limit, outside-window, wrong
  amount, already-paid or unmatched payments are recorded with
  `review_reasons` and shown to managers (Payouts tab → "Offline card
  payments to review").
- Only Stripe's account-bound PaymentIntent can mark an order paid (amount,
  currency, `offlineId` and order must match). SDK callbacks are hints.
- A 5-minute sweep (`restaurantTerminalOfflineSweep`) expires leases,
  attaches payments when their ticket is accepted, and searches Stripe by
  `metadata.offlineId` for permits the device never reported. After 72 h with
  nothing found, they go to the review queue.
- Managers (`pos.manage`) resolve with a note: **Accept** needs exactly one
  live Stripe intent; **Void** is refused if Stripe has any live charge
  (refund it instead). Both are audited.

## Not covered by code

- Native app implementation and Stripe Terminal SDK integration.
- Real outage drills with a physical reader (forwarding delays, reader
  storage limits, expired cards declined on forward).
- Stripe account settings for offline mode and the business decision on
  limits per store (a risk decision for the owner).
