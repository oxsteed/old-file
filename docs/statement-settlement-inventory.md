# Statement Settlement Inventory (workstream 8, Stage A)

Factual inventory of the existing financial/settlement records the
`restaurant_settlement`, `helper_earnings`, and `business` statement adapters
read from. Read-only: no table below is modified by the statement adapters.
Migration numbers are the ones that created or last materially extended the
table. Statuses are quoted verbatim from CHECK constraints.

Related design constraint: the statement framework's non-negotiables are
integer minor-unit arithmetic, exact reconciliation, one scope per statement
(product/tenant/restaurant/legal-entity/account/currency never mix), and
append-only issued originals with corrections via amendment only.

## 1. Restaurant money

### 1a. Restaurant sub-bank journal (the authoritative OxSteed-side ledger)

Tables: `oxsteed_credit_accounts` + `oxsteed_credit_transactions` +
`oxsteed_credit_transaction_entries` (421), extended by 632, 655.

- One `restaurant_sub_bank` account per `(restaurant_id, currency_code)`
  (unique index `uq_oxsteed_credit_restaurant_sub_bank`, 632). The balance must
  equal the aggregate outstanding customer food-wallet balances at that
  restaurant; every food-wallet mutation dual-posts through
  `postJournalTransaction`, so the balanced-pair guard (424), append-only
  guard (430), and ledger-write guard (491) apply.
- Entries are append-only and carry `entry_side` (`debit`/`credit`),
  `amount_cents` (BIGINT, > 0), `balance_after_cents`, `sequence` (unique per
  account), and a hash chain (`previous_entry_hash`/`entry_hash`). This is the
  only restaurant-money source that supports exact reconciliation
  (opening + credits - debits = closing verified against
  `balance_after_cents`).
- Transaction types touching the sub-bank: `sub_bank_load`, `sub_bank_redemption`,
  `sub_bank_refund`, `sub_bank_opening_balance` (632),
  `sub_bank_conversion` (later migration), and `sub_bank_payout` (680):
  debit sub-bank, credit platform treasury, paired with the Stripe Transfer
  of a restaurant wallet-earnings payout.
- Transaction statuses: `pending`, `posted`, `reversed`, `voided` (421).
  Only `posted` (and `reversed`, whose reversing leg is itself posted) count
  in statements; `pending`/`voided` are excluded.
- CAVEAT (known, not re-verified per task brief): the restaurant payout path
  (`restaurantPayoutService.executePayout`) is not atomic — it creates the
  Stripe Transfer first and posts the journal second, with no webhook
  reconciliation. `restaurant_payouts.status = 'completed'` therefore means
  "the Transfer API call succeeded and the journal leg posted in the same
  flow", not "the provider confirmed settlement". `processing` = in flight;
  `failed` = transfer or journal error (retryable by a new payout row);
  `requested`/`approved` = not yet executed; `rejected`/`cancelled` = never
  executed. Payout initiation and provider-connection status are never proof
  of payout success.
- Ambiguity documented in the source itself: 632 defines the sub-bank as
  OxSteed's customer-credit liability, while `restaurantPayoutService`
  treats the same balance as the restaurant's payoutable wallet earnings
  (`getPayoutableBalance` reads `balance_cents` of the sub-bank). The
  statement labels each leg exactly as the journal records it and never
  renames liability into earnings or vice versa.

### 1b. Restaurant customer-credit wallet ledger (customer money, NOT merchant money)

Tables: `food_customer_wallet_accounts`, `food_customer_wallet_ledger`,
`food_customer_wallet_holds` (346).

- One row per `(restaurant_id, customer_id)`; `balance_cents` >= 0;
  statuses `active`, `suspended`, `closed`.
- Ledger `entry_type` in (`credit`, `debit`, `refund`, `adjustment`) with
  `balance_after_cents` per entry. This is the ledger behind the existing
  customer-facing `restaurant` statement product (`creditStatementService`).
- Separation rule for the adapters: this ledger records money OxSteed owes
  to customers. It never appears on a settlement statement as merchant
  earnings, and no settlement ledger ever appears on a customer wallet
  statement. The only bridge shown is the sub-bank aggregate (1a), labeled
  explicitly as "customer-credit liability (aggregate)".

### 1c. Food orders (order proceeds)

Table: `food_orders` (+ `food_order_items`) (305), extended by 676
(`kitchen_notes`, `pickup_contact_name/phone`, `scheduled_for`).

- Money fields in integer cents: `subtotal_cents`, `tax_cents`, `tip_cents`,
  `discount_cents`, `total_cents`; `currency_code` CHAR(3).
- Statuses: `received`, `accepted`, `preparing`, `ready`, `completed`,
  `cancelled`, `refunded`. Payment statuses: `unpaid`, `requires_payment`,
  `paid`, `failed`, `refunded`.
- Money-flow semantics (from the payout and card-checkout services):
  card payments settle directly to the restaurant's Stripe Connect account
  via destination charges, so OxSteed never holds them and has no payout
  record for them; wallet/credit payments accumulate as OxSteed's liability
  (see 1a). Card-checkout orders have a Stripe payment intent id and an
  idempotency-keyed `food_card_payment_intents` record (676); the order
  create re-verifies the intent via the Stripe API (402 otherwise,
  fail-closed) and the webhook reconciles succeeded/failed.
- What the records support: per-order totals, payment method, and refund
  state. What they do NOT support: an OxSteed-side ledger of card proceeds
  (no OxSteed journal leg exists for destination charges). Settlement
  statements therefore show card-order proceeds as "settled directly to the
  restaurant's Connect account (per order record); no OxSteed-held payout
  applies", never as received OxSteed money.

### 1d. OxSteed Credit partner settlements (OxSteed partner settlements)

Table: `oxsteed_credit_settlements` (421), extended by 447, 448, 634, 635.

- One row per (partner, currency, period): `gross_cents`, `refund_cents`,
  `fee_cents`, `net_cents` (BIGINT, >= 0), with the DB CHECK
  `net_cents = GREATEST(0, gross_cents - refund_cents - fee_cents)` (voided/
  pending exempt). Snapshot fields are immutable after creation (448,
  extended 635: partner/agreement/currency/period/amounts/idempotency/cycle
  linkage/value and settlement dates).
- Statuses: `pending`, `approved`, `paid`, `disputed`, `voided`.
  `approved`/`paid` require `approved_by` (human approval evidence); approval
  stays a human action, the cycle job never marks paid.
- Settlement cycles (635): `oxsteed_credit_settlement_cycles` with half-open
  UTC window `[period_start, period_end)`, explicit `cutoff_at`,
  `value_date` (date of period end), `settlement_date` (next business day).
  Activity with posted timestamp >= period_end belongs to the next period.
- Payout bookkeeping (634): `stripe_transfer_id` (unique),
  `payout_status` in (`none`, `initiated`, `paid`, `failed`),
  `payout_initiated_by`, `payout_initiated_at`, `payout_destination_account`.
  Transitions: `none` -> `initiated` (admin `initiateSettlementPayout`
  creates the Stripe Connect transfer, reserves net on partner_payable) ->
  `paid` (webhook `confirmSettlementPayoutFromTransfer` verifies the
  transfer object against the Stripe API; the mark-paid journal leg
  partner_payable -> platform_treasury moves then) or `failed` (webhook
  failure branch). There is also a manual mark-paid path via
  `transitionSettlement` to `paid` with a `payment_reference` for off-rail
  payment.
- Verified payout meaning for statements: `payout_status = 'paid'`
  (provider-webhook confirmed) OR `status = 'paid'` with a
  `payment_reference` (manual off-rail mark-paid with audit evidence).
  `payout_status = 'initiated'` = transfer created but NOT confirmed — shown
  as "in transit", never as received. `failed` = shown as failed with the
  recorded reason; retry is a new initiation, never an overwrite.
- Money movement for settlements goes through the journal with types
  `settlement` (debit partner_payable, credit platform_treasury) and
  `settlement_reversal` (421/632 direction guards).

### 1e. Reserve regime

Tables: `oxsteed_credit_reserve_policies`,
`oxsteed_credit_reserve_funding_requirements` (636); `partner_reserve`
accounts (514).

- Per-(partner, currency) prefunding policy (default per currency:
  1000 bps = 10%, floor 50000 minor units), seeded for every rail currency.
- Enforcement: postings that would breach the floor are rejected
  (403 `credit_reserve_floor_breach`); payout initiation is blocked while
  the reserve is below max(floor, ratio * net / 10000)
  (409 `credit_settlement_payout_reserve_breach`). Funding is an explicit
  admin action (`recordPartnerFunding`); the monitor never moves money.
- Reserve movements post with types `funding` and `reserve_release`.
  Open funding requirements (status `open`, at most one per
  (partner, currency)) are disclosable obligations, not posted money.

### 1f. Restaurant payouts (wallet-earnings payout requests)

Table: `restaurant_payouts` (680).

- Lifecycle: `requested` -> `approved` -> `processing` -> `completed`;
  `requested` -> `rejected`; `approved`/`processing` -> `failed`
  (Stripe or ledger error); plus `cancelled`.
- Row lock (`FOR UPDATE`) during execution; the ledger posting and the
  Stripe Transfer share the payout's idempotency key
  (`uq_restaurant_payouts_idempotency` on (restaurant_id, idempotency_key)).
- Journal leg (680/oxsteedCreditService): `sub_bank_payout` — debit the
  restaurant's sub-bank account, credit platform treasury, with
  `reference_type = 'restaurant_payout'`, `reference_id` = payout id, and the
  Stripe transfer id in metadata. `completed` sets `stripe_transfer_id` and
  `ledger_transaction_id` on the row.
- Eligibility gating (service, not schema): business owner only, restaurant
  `active`, minimum payout amount, amount <= sub-bank balance, Stripe
  account connected (`payout_account_not_connected` otherwise).
- What the records support: a verified-outcome payout ledger per
  (restaurant, currency). What they do NOT support: provider-side
  settlement confirmation (no webhook reconciliation — see 1a caveat).

### 1g. Related but out of statement scope

- `oxsteed_credit_reconciliation_runs` (421): rail-level balance proofs
  (account vs journal); operator evidence, not per-merchant statements.
- `oxsteed_credit_disputes` (421) and dispute provisional postings (678):
  customer disputes; surface on settlement statements only as linked
  settlement/refund facts, never as adjudicated outcomes.
- `restaurant_topups` (663): customer->restaurant top-up applications;
  customer-side funding, not merchant earnings.

## 2. Helper earnings

### 2a. Jobs (earnings accrual and payable position)

Table: `jobs` (core schema), money columns added by 352.

- Integer minor-unit columns: `helper_payout_cents`, `platform_fee_cents`,
  `customer_total_cents`, `final_price_cents`, `job_value_cents`,
  `protection_fee_cents`, `broker_fee_cents`; all >= 0 (352 CHECK).
  `currency_code` CHAR(3) with ISO-4217 check.
- `payout_status` in (`not_ready`, `earned`, `pending`, `processing`,
  `paid`, `failed`, `reversed`, `cancelled`) (352). Backfill semantics:
  completed + `paid_at` set -> `paid`; completed without `paid_at` ->
  `earned`. No runtime writer for the intermediate transitions was found;
  the states are a position snapshot, not an event log.
- Timestamps: `completed_at` (earnings event date), `paid_at` (settlement
  event date), `payout_available_at`. `updated_at` is mutable and is not a
  reliable event date.
- The app's own convention (mainAppController): available =
  `earned`+`not_ready`; pending = `pending`+`processing`; paid = `paid`.
- What the records support: per-currency payable buckets (accrued / in
  transit / settled / not owed) and per-job links (job id, title, customer
  total, platform fee, helper payout). What they do NOT support: an exact
  historical period ledger — rows mutate in place, there is no append-only
  earnings journal, and failed/reversed transitions carry no reliable event
  date. The helper_earnings adapter therefore builds a deterministic
  event-dated snapshot (earnings dated by `completed_at`, settlements by
  `paid_at`) and states this limitation on the statement itself. It never
  describes unpaid (`earned`/`not_ready`/`pending`/`processing`) earnings as
  received.

### 2b. Payments (job payment events)

Table: `payments` (014).

- `job_id`, `payer_id`, `payee_id`; `amount` NUMERIC(10,2),
  `platform_fee` NUMERIC(10,2), `helper_payout` NUMERIC(10,2),
  `platform_fee_percent` default 15.00; `currency` default 'usd'.
- Statuses: `pending`, `authorized`, `captured`, `released`, `refunded`,
  `disputed`, `failed`. Escrow statuses: `none`, `held`, `released`,
  `refunded`. Stripe ids: payment intent / transfer / charge.
- Webhook flow (webhookController): `payment_intent.amount_capturable_updated`
  -> `authorized` (funds held); `payment_intent.succeeded` on a Connect
  direct charge -> `captured` + escrow `released` (money is on its way to the
  helper's Connect balance); refunds/disputes update to `refunded`/`disputed`
  with `refunded_at`/`refund_amount`/`refund_reason`.
- NUMERIC dollars are converted to integer minor units at read time
  (ROUND(x * 100)); the statement fails closed (409) if any value is not
  exactly representable.
- What the records do NOT support: Stripe Connect payout-to-bank outcomes
  for helpers (no helper payout ledger exists; `payout_transactions` (137)
  covers affiliate payouts only). A `captured`/`released` payment means the
  helper's Connect balance was credited, not that cash reached their bank.

### 2c. Payout methods and Connect accounts

Tables: `payout_methods`, `connect_accounts` (014/137).

- `connect_accounts`: per user, `stripe_account_id`, `charges_enabled`,
  `payouts_enabled`, `onboarding_complete`. This is the destination for
  helper earnings; `payouts_enabled = TRUE` is the closest record to "can
  receive payouts".
- `payout_methods`: helper_id, method types `bank_account`/`paypal`/
  `stripe_connect`, statuses `pending`/`verified`/`active`/`inactive`.
- Disclosed as account-on-file facts only; never as proof of a payout.

## 3. Business

### 3a. Businesses and membership

Tables: `businesses` (034), `business_members` (062).

- `businesses`: single owner (`user_id`), `is_active`, soft-delete
  (`deleted_at`), per-business Stripe Connect (`stripe_account_id`,
  `stripe_payouts_enabled`), service identity (214: own geo, reviews,
  bookings, Connect account — never the owner's personal identity).
- `business_members`: roles `manager` (full dashboard access incl. invoices)
  vs `representative` (customer chat/job acceptance only; migration 062
  explicitly: "no access to financial data"); statuses
  `pending`/`active`/`revoked`. The statement's finance standing is:
  owner (`businesses.user_id` or `food_restaurants.owner_user_id`) or an
  ACTIVE `manager`. Representatives and revoked/pending members get nothing.
- `business_integrations`: Stripe integration `is_connected`/`is_enabled`
  (used by settlement payout resolution).
- Parent/franchise: `franchise_programs`/`franchise_applications`/
  `franchise_agreements` (247) are program/application records, not
  financial entities. There is no ledger-level parent/child linkage between
  business entities and no cross-entity consolidation account. Statements
  are therefore per (business, currency) with no cross-entity visibility by
  default; any consolidation is an explicit owner decision, not a default.

### 3b. Business receivables and payables (activity records, not a ledger)

Tables: `business_invoices` (061, 355), `business_expenses` (235).

- Invoices: `invoice_number` (human readable), statuses
  `draft`/`sent`/`paid`/`overdue`/`cancelled`/`partial`; amounts
  NUMERIC(12,2) dollars (`subtotal`, `tax_amount`, `total`, `amount_paid`);
  optional `job_id` link; `paid_at`. 355 adds a currency code column.
- Expenses: `amount_cents` INTEGER (> 0), category check
  (`materials`/`labor`/`vehicle`/`software`/`marketing`/`equipment`/
  `utilities`/`other`), `expense_date`, optional receipt.
- What the records support: per-(business, currency) receivables aging
  (sent/partial/overdue vs paid) and payables (expenses) as dated activity
  lists. What they do NOT support: an exact reconciliation equation — there
  is no business double-entry ledger, invoice amounts are NUMERIC dollars
  (converted at read, fail closed on inexact values), and there is no
  append-only journal. The business adapter therefore presents an activity
  reconciliation (opening outstanding + invoiced - collected = closing
  outstanding, each term derived from the same deterministic snapshot) and
  states the limitation on the statement.

### 3c. Business-linked OxSteed money (read through the partner graph)

- `oxsteed_credit_partners.business_id` (421, nullable, ON DELETE SET NULL)
  links a partner to a business; partner settlement/reserve records (1d/1e)
  for those partners are business-relevant and appear on the business
  statement under "OxSteed partner settlements", scoped by the settlement's
  own currency.
- `food_restaurants.business_id` (305): the business's restaurants;
  `restaurant_payouts` (1f) and sub-bank accounts (1a) for those restaurants
  appear on the business statement as per-restaurant sections, never merged
  across restaurants or currencies.

## 4. Status meaning cheat sheet (verified vs initiated)

| Record | Verified (show as received/settled) | Initiated only (show as in transit) | Failed (show as failed) |
|---|---|---|---|
| `oxsteed_credit_settlements` payout | `payout_status='paid'` (webhook-confirmed) or `status='paid'` + `payment_reference` (manual off-rail) | `payout_status='initiated'` | `payout_status='failed'` |
| `restaurant_payouts` | `status='completed'` (Transfer API ok + journal posted; no provider settlement proof — stated on the document) | `requested`/`approved`/`processing` | `failed`; `rejected`/`cancelled` = never executed |
| `payments` (job) | `captured`/`released` (helper Connect balance credited; not proof of bank payout) | `pending`/`authorized` (escrow held) | `failed`; `refunded`/`disputed` shown as reversals |
| `jobs.payout_status` | `paid` (has `paid_at`) | `earned`/`not_ready` (accrued), `pending`/`processing` (in transit) | `failed`/`reversed`/`cancelled` (not owed) |
| `oxsteed_credit_transactions` | `status='posted'` (or the posted reversing leg of `reversed`) | `pending` excluded | `voided` excluded |
| `business_invoices` | `paid` (has `paid_at`) | `sent`/`partial`/`overdue` (receivable, not cash) | `cancelled` excluded; `draft` excluded |

## 5. Explicit "cannot support" list

1. No append-only helper earnings ledger exists. Period statements for
   helpers are deterministic event-dated snapshots, not period-exact
   re-derivable ledgers (2a). The adapter states this on the document.
2. No business double-entry ledger exists. The business statement is an
   activity reconciliation over invoices/expenses/partner settlements, not a
   balance-sheet proof (3b).
3. No provider-confirmed settlement record exists for restaurant payouts
   (no webhook reconciliation on `restaurant_payouts`) or for helper
   Connect payouts (no helper payout ledger at all). Statements label
   `completed`/`captured` honestly and never claim bank settlement (1a, 2b).
4. No cross-entity financial consolidation structure exists. No
   consolidation statements; per-entity scopes only (3a).
5. The amendment workflow's proposal/version tables (686/687) FK to
   `credit_statement_documents`; extending formal amendments to settlement
   products needs its own FK migration (coordinator follow-up). The
   settlement adapters expose the same `rederive` rebuild primitive the
   amendment workflow uses.
