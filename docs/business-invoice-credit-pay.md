# Business / helper invoice — OxSteed Credit pay

## Payer flow

- Payer-only (`isInvoicePayer`); statuses `sent` / `partial` / `overdue`.
- Launch: `BUSINESS_INVOICE_CREDIT_PAY_ENABLED=1` + `oxsteed_credit_enabled` rail flag.
- Spend: `creditSpendAdapter` surface `invoices`, ledger `reference_type` `business_invoice`.
- `amount_paid` syncs from summed Credit purchases (idempotent retries).
- Partial amounts supported in API and UI (`amountCents` ≤ remaining balance).

## Payee enrollment (no auto-enroll on send)

Sending an invoice does **not** create or activate Credit participants. Didit and admin activation stay on the enrollment side.

| Invoice type | Primary enrollment |
|--------------|-------------------|
| Business (`business_id` set) | `invoice_seller` participant on **business_id**, `allowed_surfaces` includes `invoices` |
| Helper (issuer `user_id`, no `business_id`) | `invoice_seller` participant on **helper user_id** — **no business partner required** |
| Fallbacks | `business` / `helper` participants; helper-linked businesses; legacy `oxsteed_credit_partners.business_id` |

Issuer/admin hook (read-only):

`GET /api/invoices/:id/credit-payee-enrollment` — returns enrollment status, hints, and `canAcceptCreditInvoices`. Use when onboarding helpers who invoice without a business entity.

Admin enrollment API (existing): Credit admin `enrollParticipant` with `participantType: invoice_seller`, `subjectUserId` or `businessId`, and `allowedSurfaces` including `invoices`.

## Routes

- Payer: `GET|POST /api/invoices/:id/credit-eligibility|pay-with-credit` (+ mobile mirrors).
- Issuer/admin: `GET /api/invoices/:id/credit-payee-enrollment`.
- Pay POST uses `rejectImpersonated`.

## Out of scope here

- Stripe Connect card settlement (`BUSINESS_INVOICE_STRIPE_CONNECT_ENABLED`).
- Auto-provisioning participants when an invoice is sent.

## Verification

```bash
cd server && npx jest --testPathPatterns='businessInvoiceCreditPay'
```
