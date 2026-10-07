# Consulting invoices (admin-only, launch-hidden)

Consulting invoices live in `consulting_invoices` and are managed only through
`/api/consulting/admin/*` routes (`manage_operations` / `view_financials` gates).
The public product surface redirects away from `/consulting`; do not expose these
invoices on `/invoices` until launch scope explicitly includes consulting.

## Consistency rules

- **Purchase-backed generate** (`POST /invoices/generate`): requires a purchase,
  sets `user_id`, `customer_email`, and `customer_name` from the purchaser.
- **Manual generate** (`POST /invoices/generate-manual`): stores `customer_email`
  and `customer_name` on the row; links `user_id` when an active account exists.
- **List** (`GET /invoices`): returns `client_email` / `client_name` via
  `COALESCE` of stored customer fields and joined user profile.

CSV download remains the admin artifact; there is no payer public token flow.
