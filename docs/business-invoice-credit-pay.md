# Business / helper invoice — OxSteed Credit pay (MVP)

## Scope landed

- Payer-only (client email match via `isInvoicePayer`); issuer cannot pay their own invoice.
- Payable statuses: `sent`, `partial`, `overdue`.
- Launch gate: `BUSINESS_INVOICE_CREDIT_PAY_ENABLED=1` plus live `oxsteed_credit_enabled` feature flag.
- Spend uses `creditSpendAdapter` surface `invoices` with ledger `reference_type` `business_invoice`.
- Invoice `amount_paid` / status sync from summed Credit purchases (idempotent retries safe).
- Routes: `GET|POST /api/invoices/:id/credit-eligibility|pay-with-credit` and mirrored under `/api/mobile/invoices/:invoiceId/…`.
- `rejectImpersonated` on pay POST.
- UI: public invoice view (signed-in payer) and received-invoice modal on `/invoices`.

## Deferred / gaps

- **Helper payees without `credit_participants`:** falls back to helper-linked **business** participants or legacy `oxsteed_credit_partners.business_id` restaurant partners. Helpers with no linked business and no `invoice_seller` participant remain ineligible until enrolled.
- **Full participant generalization** (admin approval, Didit on activate, per-surface limits) follows `credit_participants` / `invoice_seller` enrollment — not auto-created on send invoice.
- **Stripe Connect** online card pay remains separate (`BUSINESS_INVOICE_STRIPE_CONNECT_ENABLED`); Credit does not mark paid without a successful ledger purchase.
- **Partial Credit pay:** API accepts `amountCents`; UI pays full remaining balance in MVP.

## Verification

```bash
cd server && npx jest --testPathPatterns='businessInvoiceCreditPay|businessInvoiceFlow'
```

Enable in dev: `BUSINESS_INVOICE_CREDIT_PAY_ENABLED=1` and ensure payee has an active `invoice_seller` or business-linked partner with `invoices` in `allowed_surfaces`.
