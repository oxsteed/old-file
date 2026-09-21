# In-chat OxSteed Credit payments — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Branch: old-files-claude  
Surfaces: helper/business live messenger (auth customer), provider inbox threads

## Problem

Quotes and proof-of-payment (POP) already live in chat, but customers still leave the thread (or upload off-platform receipts) to settle a shared quote / payment request. OxSteed Credit already has a production ledger (`oxsteedCreditService`) for holds, purchases, and partner payables — chat should reuse it, not invent a second balance.

## Goals

1. Authenticated customer can pay a shared quote or payment request with **OxSteed Credit** without leaving chat.
2. On success: **ledger purchase** → confirmed POP (`method=oxsteed_credit`) auto-posted → quote payment metadata updated when linked → both sides see confirmation in-thread (socket).
3. Provider can send a **Request payment** card (amount + memo + optional quote link) with a **Pay with OxSteed Credit** CTA for the customer.
4. Guests: **auth-only** for credit (clear sign-in CTA). POP upload remains available for guests.
5. Admin break-glass continues to see POP + payment-request artifacts.

## Non-goals

- Second ledger / shadow wallet.
- Full refund UX in chat (reuse existing `refundCredit` / admin refund APIs; stub only).
- Enrolling every helper as a credit partner without partner records.

## Partner eligibility

`oxsteed_credit_partners` are restaurant-backed and optionally linked via `business_id`. Chat pay resolves an **active partner** from `payeeBusinessId` / conversation `business_id`. If the provider is helper-only (no eligible partner business), the API returns `credit_provider_not_eligible` with clear copy. Helpers cannot be paid via customer→customer transfer (recipient must be role `customer`).

## API

| Method | Path | Who | Notes |
|---|---|---|---|
| `POST` | `/api/chat/payments/oxsteed-credit` | Auth customer | Body: `{ conversationId, quoteId?, amountCents, currency, payeeHelperId?, payeeBusinessId?, paymentRequestId?, idempotencyKey, memo? }` |
| `POST` | `/api/chat/payments/request` | Provider | Creates payment-request + posts `[payment_req:…]` marker |
| `GET` | `/api/chat/payments/request/:id` | Members | Card payload |
| `GET` | `/api/chat/payments/credit-hint` | Auth | Balance + partner eligibility for thread |

Pay flow (single DB transaction):

1. Auth + conversation membership; **customer only**.
2. Resolve partner; fail clearly if not eligible.
3. `purchaseWithCreditInTransaction` (existing ledger).
4. Insert POP `status=confirmed`, `payment_method=oxsteed_credit`, `credit_txn_id`.
5. Mark payment request `paid` if linked; bump quote `amount_paid_cents` / `payment_status`.
6. Post POP marker message; socket notify.

## Markers

```
[payment_req:id|amount_cents|currency|status|memo_enc|quote_kind|quote_id]
[pop:id|confirmed|amount|oxsteed_credit|txn|paid_on|quote_kind|quote_id]
```

## Client

- `messengerCreditPay.js` — markers + gates (tested)
- `PaymentRequestCard` / `PaymentRequestSharePanel` / `PayWithCreditModal`
- QuoteCard: Pay with OxSteed Credit on sent/accepted (auth) or sign-in CTA
- Wired in `MessageBubble`, `ConversationThread`

## Guests

No guest credit account today → require login for credit pay. Verified guests keep POP upload path.

## Refunds

Existing `refundCredit` / `refundCreditForReference` APIs. Chat does not expose a refund button in this slice; support/admin use credit refund tooling keyed by `reference_type=chat_payment`.

## Success criteria

- Auth customer can pay → POP confirmed in-thread, ledger moved once (idempotent).
- Ineligible provider → clear error, no charge.
- Guest → sign-in CTA; POP upload still works.
- `test:messenger-dock` + server helper tests + `verify:i18n` green.
- Admin break-glass returns `payment_requests` + POPs.
