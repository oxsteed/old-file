# OxSteed invoice flow — findings only

**Tip:** `e47d125c` (`origin/old-files-claude` — *Fix job assign coming-soon test under globally-enabled payments flag*)  
**Date:** 2026-10-07 (America/New_York)  
**Repo:** `oxsteed/old-file` @ `old-files-claude`  
**Scope:** create → edit → send → view → pay → mark paid → overdue/reminders → cancel/void → PDF/export → authz → launchScope. Business, helper, rental, consulting, quotes/recurring. No implementation.

---

## One-sentence summary

Three parallel invoice systems exist (business/helper `business_invoices`, tool-rental `tool_rental_invoices`, consulting `consulting_invoices`); business/helper is the launch Hub surface but **cannot collect money correctly on-platform**, never auto-marks overdue, and **does not email or expose Credit** — send is clipboard/notif only, Stripe PI (if used) settles to the platform with no Connect payout.

---

## Flow map

### A. Business Hub invoices (`business_invoices`)

| Step | Path | Evidence |
|------|------|----------|
| Create | `POST /api/businesses/:id/invoices` | `businessInvoiceController.js:113-167`; route `businesses.js:114` + `bizIdAccess('any')` then `canManageBusinessFinance` (owner/manager) |
| Edit | `PUT .../invoices/:invoiceId` | `:170-221` — no status gate |
| Send | `POST .../send` | `:373-447` — sets `sent` + in-app notif if client email matches a user; returns `publicToken`; **no email** |
| Public view | `GET /api/businesses/invoices/public/:token` → `/invoice/p/:token` | `:293-369`; `PublicInvoiceView.jsx`; **no auth**; any status including draft |
| Owner list | Hub tab `invoices` (in `LAUNCH_BUSINESS_HUB_TABS`) | `launchScope.js:43`; Hub API `listInvoices` |
| Issuer aggregate page | `GET /api/invoices` → `/invoices` | `routes/invoices.js:29-61`; filters `user_id = requester` only |
| Mark paid (issuer) | `POST .../pay` | `:225-261` — trust-based; overwrites `amount_paid` |
| Mark paid (super-admin) | `PATCH /api/invoices/:id/mark-paid` / `status` | `routes/invoices.js:75-139` |
| Stripe pay (mobile) | `POST /api/mobile/invoices/:id/payment-intent` + `confirm-payment` | `mobileController.js:456-552` |
| Delete | `DELETE` draft/cancelled only | `:264-291` |
| Quote → invoice | `POST .../quotes/:id/convert` | `businessQuotesController.js:197-270` → draft + `public_token` |
| Recurring → invoice | `POST .../recurring-billing/:id/generate-invoice` | `businessRecurringBillingController.js:117-172` → draft, **no `public_token`** |

### B. Helper invoices (same table, `business_id IS NULL`)

Routes under `/api/helpers/invoices` (`helpers.js:27-32`). UI gated by `LAUNCH_VISIBILITY.helperInvoices: true` (`HelperDashboard.jsx`). Same send/pay/update semantics as business.

### C. Tool rental invoices (`tool_rental_invoices`) — Option C

| Step | Path |
|------|------|
| Create+send | `POST /api/tool-rentals/invoices` — idempotency key, email via `invoiceEmail.js`, or in-platform |
| View | `GET .../invoices/:id` (owner or customer) |
| PDF | `GET .../pdf` — embeds owner payment identifier + QR |
| Confirm paid | `POST .../confirm-payment` — owner attests; immutability + audit log |

Launch: `LAUNCH_VISIBILITY.toolRentals: true`. Off-platform payment (Cash App / Venmo / bank handle) — OxSteed is facilitator only.

### D. Consulting invoices (`consulting_invoices`)

Admin-only generate/list/CSV download (`consultingAdmin.js`). **Launch-hidden** (`getLaunchRedirect` sends `/consulting` → `/business-hub`). Not end-user lifecycle.

### E. Not present

- No marketplace/product invoice entity.
- No Credit debit/settle path on any invoice surface (Credit-everywhere report: invoices/products/rentals = P3, wire behind flags — **not built**).
- No overdue cron/worker writing `business_invoices.status = 'overdue'`.
- No reminder emails for business/helper invoices.
- No business/helper PDF export (rental + consulting CSV only).

---

## Prioritized findings

### P0

**P0-1 — Stripe invoice payment settles to platform; invoice marked paid with no seller payout**  
- **What:** `createInvoicePaymentIntent` creates a PaymentIntent with `amount`/`currency`/`metadata` only — no Connect `transfer_data`, no destination account. `confirmInvoicePayment` then marks `business_invoices` paid. Payer money lands on OxSteed’s Stripe account; seller ledger is lied to.  
- **Where:** `server/controllers/mobileController.js:469-478`, `:529-538`.  
- **Do:** Disable or gate mobile invoice PI until Connect/payout/Credit settle exists; or route funds to enrolled participant and only then mark paid from webhook (idempotent).

**P0-2 — `createInvoice` / `createHelperInvoice` BEGIN then early-return without ROLLBACK (pool poison)**  
- **What:** After `pool.connect()` + `BEGIN`, validation failures `return res.status(4xx)` inside `try`/`finally`. `finally` releases the client **still in an open transaction**, poisoning the next borrower.  
- **Where:** `businessInvoiceController.js:114-129` (and helper `:493-506`).  
- **Do:** Validate before `BEGIN`, or `ROLLBACK` on every early return; never release a client mid-transaction.

**P0-3 — Overdue is a dead status**  
- **What:** Schema + Hub summaries + `businessHealthAlertsController` count `status='overdue'`, but **no worker/cron/endpoint** ever `SET status='overdue'` from due dates. Alerts and Pulse outstanding-by-overdue never fire unless someone manually patches status.  
- **Where:** Counts in `businessInvoiceController.js:77-84`, `businessHealthAlertsController.js:85`, `businessController.js:989-992`; **zero writers** found under `server/workers`, `server/jobs`, controllers.  
- **Do:** Nightly job: `sent|partial` + `due_date < CURRENT_DATE` → `overdue`; optional reminder email; keep cancelled/paid excluded.

**P0-4 — Public “Login to pay” is a dead end**  
- **What:** `PublicInvoiceView` unpaid CTA links to `/login` with no return URL and **no web pay UI**. Only mobile PI endpoints can charge (and those are broken per P0-1). Guests cannot pay; logged-in payers on web have no path.  
- **Where:** `PublicInvoiceView.jsx:273-280`; pay APIs only on `server/routes/mobile.js:19-20`.  
- **Do:** Either remove pay CTA until a real checkout exists, or build authenticated web pay + return-to-invoice, with funds routing fixed first.

### P1

**P1-1 — Send does not email external clients**  
- **What:** `sendInvoice` / `sendHelperInvoice` only insert an in-app notification when `client_email` matches an active user; Hub copies public URL to clipboard. `/api/invoices/:id/resend-email` sends a bare subject/body (no link/PDF), swallows send failures, still returns success and flips draft→sent. Rental path correctly uses `sendInvoiceEmail` with retries.  
- **Where:** `businessInvoiceController.js:401-439`; `routes/invoices.js:141-166`; contrast `invoiceController.js:167-226` + `utils/invoiceEmail.js`.  
- **Do:** Reuse rental-style email (localized HTML + public link); fail closed if delivery fails; don’t claim success on catch.

**P1-2 — Sent/paid business invoices remain fully mutable**  
- **What:** `updateInvoice` / `updateHelperInvoice` accept line items, totals, and `status` with no immutability check. Client can create with `status: 'paid'` (`createInvoice` body). Paid amounts and histories can be rewritten. Rental path has confirm immutability + audit; business does not.  
- **Where:** `businessInvoiceController.js:124`, `:186-201`, `:555-571`.  
- **Do:** Lock fields after `sent` (except cancel/void + payment append); forbid create-as-paid; audit status transitions.

**P1-3 — Manual `markInvoicePaid` overwrites `amount_paid` (does not accumulate)**  
- **What:** `resolvePaidAmount` + `SET amount_paid = $1` replaces prior partials. Mobile Stripe confirm correctly uses `amount_paid + $1`. Two partial marks can erase history / understate collections.  
- **Where:** `businessInvoiceController.js:239-254` vs `mobileController.js:531-534`.  
- **Do:** Accumulate with `LEAST(total, amount_paid + delta)`; reject if already paid; record payment events table.

**P1-4 — Issuer can open a payment intent on their own invoice**  
- **What:** `getPayableInvoice` allows `bi.user_id = requester` **or** client email match. Owner/helper can PI+confirm their own bill (combined with P0-1 = platform charges itself / whoever’s card, marks paid).  
- **Where:** `mobileController.js:427-439`.  
- **Do:** Allow only payer identity (`client_email` / linked client user id); never issuer.

**P1-5 — Currency ignored on charge**  
- **What:** Invoices store `currency_code` (migration 355); Stripe PI hardcodes `currency: 'usd'`. Non-USD invoices would under/overcharge or mismatch confirm check.  
- **Where:** `mobileController.js:471`, `:517`; create sets currency from business `:135-141`.  
- **Do:** Charge in invoice currency or reject non-USD until multi-currency supported.

**P1-6 — Recurring-generated invoices have no `public_token`**  
- **What:** `generateInvoice` INSERT omits `public_token`; cannot use public view/send link until something else patches it (update doesn’t mint tokens).  
- **Where:** `businessRecurringBillingController.js:146-156`.  
- **Do:** `randomUUID()` on insert like create/convert.

**P1-7 — Helper invoice numbers race**  
- **What:** `nextHelperInvoiceNumber` uses `MAX(seq)+1` without lock; concurrent creates can collide. No UNIQUE on `(invoice_number)` for helper rows. Business path correctly bumps `businesses.invoice_seq`.  
- **Where:** `businessInvoiceController.js:747-759`.  
- **Do:** Sequence table or `INSERT … ON CONFLICT` with advisory lock / year-scoped sequence.

**P1-8 — Rental invoice stores + PDFs plaintext payment identifiers**  
- **What:** Decrypted owner payment handle is written into `tool_rental_invoices.payment_identifier` and printed on PDF/QR. Column is plaintext by schema.  
- **Where:** `invoiceController.js:141-157`, `:422-423`; `079b_option_c_payment_system.sql`.  
- **Do:** Store encrypted or reference `owner_payment_methods` id; mask on PDF; rotate if leaked.

**P1-9 — Rental PDF stream construction is unsafe**  
- **What:** `new Readable()` with no `_read`, `doc.pipe(stream)`, then both `stream.pipe(res)` and manual `stream.on('data')` writes — risk of corrupt/hung PDF responses.  
- **Where:** `invoiceController.js:339-453`.  
- **Do:** `doc.pipe(res)` directly, or buffer then send once.

**P1-10 — `/invoices` page is issuer-only; payers have no inbox**  
- **What:** Page loads `GET /api/invoices` filtered by `user_id`. Client billed by email who is an OxSteed user only gets a notification (if send succeeded) — no list of “invoices to pay,” no deep link from notif data in this page.  
- **Where:** `routes/invoices.js:40-50`; `InvoicesPage.jsx:87-91`.  
- **Do:** Payer inbox by `client_email` / linked user; deep-link from notification `data.invoiceId`.

### P2

**P2-1 — Draft invoices resolvable via public token** — `getPublicInvoice` does not require `status IN ('sent','partial','overdue','paid')`. Token minted at create (`:134`). Restrict to post-send or rotate token on send.

**P2-2 — Cancel/void is ad-hoc** — status enum has `cancelled`; update can set it; no dedicated void that freezes public link, clears pay eligibility, or requires reason. Super-admin `/status` can set any state without `paid_at` consistency.

**P2-3 — List pagination `total: rows.length`** — `routes/invoices.js:56` reports page length, not COUNT(*).

**P2-4 — Authz layering noise** — write routes use `bizIdAccess('any')` but controller enforces finance=owner/manager (`businessOwnership.js:63-81`). Safe outcome (404), but any-member hits route before finance check; prefer `minRole: 'manager'` on finance routes.

**P2-5 — Consulting invoices launch-hidden; CSV not PDF** — admin generate/download CSV only; redirect hides product surface.

**P2-6 — Inert RLS already dropped** — `084` created `no_invoice_deletion` policy without enabling RLS; `705_drop_inert_policy.sql` removed it. Immutability remains app-only for rentals (OK if enforced) — document so nobody re-adds inert policies.

**P2-7 — No reminders** — i18n has overdue health copy; no email/push reminder schedule for unpaid invoices.

**P2-8 — Resend email content useless** — subject/body are notification strings without amount, due date, or public URL (`routes/invoices.js:150-156`).

---

## Authz / gates

| Surface | Gate |
|---------|------|
| Business invoice CRUD/send/pay/delete | Authenticated + `canManageBusinessFinance` (owner or active `manager`) |
| Business list/get | Same finance check (no `bizIdAccess` on GET; controller-only) |
| Helper invoices | Authenticated + `user_id` + `business_id IS NULL` |
| Public token view | **Unauthenticated** bearer UUID |
| `/api/invoices` mark-paid / status | `requireSuperAdmin` + audit |
| `/api/invoices` resend | Owner (`user_id`) or admin role via `getInvoiceForUser` |
| Mobile PI / confirm | Authenticated; payable if issuer **or** client email match (see P1-4) |
| Rental invoices | Owner create/confirm; owner or customer get/PDF |
| Consulting | Admin permissions `manage_operations` / `view_financials` |
| Launch | Hub `invoices` tab **on**; `helperInvoices: true`; `toolRentals: true`; consulting **redirected away**; product marketplace **off** |

---

## Gaps vs Credit everywhere (locked decisions)

Credit-everywhere locks put **invoice / product / rental seller** on the P3 “wire Credit behind launch flags before un-hide” track, same settlement cycle, Didit + participant table, etc.

**Current invoice flow:**

- **No Credit path** on public view, Hub mark-paid, mobile PI, or rental confirm.
- Business/helper “pay” is either trust mark-paid or broken platform Stripe (P0-1).
- Rental remains off-platform handles (compatible with facilitator model; Credit would be additive).
- Subscriptions Credit (locked in v1) is a **different** surface (`subscriptionCreditWorkers` etc. at tip) — not invoice settle.

Until participant enrollment + spend adapter accept `invoice` as a surface, do **not** advertise Credit on invoice CTAs.

---

## Bottom line

Ship-blocking for “invoices that collect money”: **fix or disable Stripe invoice PI (P0-1), fix create transaction ROLLBACK (P0-2), implement overdue (P0-3), and stop promising pay on the public page until checkout exists (P0-4).** Next: real send email (P1-1), immutability + honest partials (P1-2/3), payer-only charge + currency (P1-4/5). Credit remains intentionally absent — align with locked P3 when participant schema is ready; do not bolt Credit onto the current PI.

**Counts:** P0 × 4 · P1 × 10 · P2 × 8  
