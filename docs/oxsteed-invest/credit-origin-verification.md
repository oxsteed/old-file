# Credit-origin verification (OxSteed Invest, Track 0)

Date: 2026-11-17. Base: branch `feat/oxsteed-invest` off default `2d8a4f19`
(PR #797 merged). Scope: read-only verification of whether the existing
Credit ledger can reliably establish the source and restrictions of Credit
used for an investment. Every claim below was verified against the code and
migrations in the worktree.

## The eligibility rules the ledger must support

Per the build brief, only this Credit may fund a commitment: purchased
settled Credit, and earned settled plus approved Credit. NOT eligible:
promotional/referral Credit, borrowed/advanced Credit, disputed, frozen, or
restricted Credit. Returned commitments must restore the ORIGINAL balance
classification and restrictions. Eligibility must be decidable reliably at
commit time (and rechecked at closing), across mixed-source balances,
partial spending, pending reservations, refunds/reversals, and concurrent
transactions.

## Verdict: CANNOT

The existing ledger **cannot** support those eligibility rules. It records
one fungible balance per customer per currency and keeps no record of where
any unit of that balance came from. The gap is structural, not a missing
query: there is no source or classification column on any balance or
journal row, no lot or sub-balance model, and no issuance path that tags
earned Credit as settled and approved. The ledger work in the "Prerequisite
ledger work" section below must be built before any live commitment can
rely on eligibility, and commitments must stay disabled until it exists.
What the ledger CAN do reliably today (concurrency, reservations,
immutability, reconciliation) is listed under "What is already sound", so
the prerequisite work builds on it rather than replacing it.

## The ledger as it actually exists

### One fungible balance per customer per currency

`server/migrations/421_oxsteed_credit_foundation.sql:80-124` defines
`oxsteed_credit_accounts`: one row per customer per currency for
`account_type = 'customer_wallet'` (unique index
`uq_oxsteed_credit_customer_account`), with a single `balance_cents` and a
single `reserved_cents`. There is no source, classification, lot, or
sub-balance column. Once value enters the wallet, its origin is gone: a
wallet holding 10,000 cents could be all purchased, all admin-granted, or
any mix, and no query can tell.

### Journal rows carry type and references, not origin

`oxsteed_credit_transactions` (migration 421, lines 126-163) has
`transaction_type` limited to `load`, `purchase`, `refund`, `transfer`,
`adjustment`, `settlement`, `fee`, `expiration`, `chargeback`; a `status`
of `pending`, `posted`, `reversed`, or `voided`; `reference_type` and
`reference_id`; `metadata` JSONB; and a unique `idempotency_key`. There is
no source-category column. `reference_type` is a free-form string set by
each caller, not a controlled classification, and `metadata` is
unstructured. The double-entry legs in
`oxsteed_credit_transaction_entries` (lines 165-186) carry amounts and a
hash chain, not origin. A later migration history search confirms no
migration adds a source or classification column to either table.

### How value enters the wallet today

- Purchased: `server/services/oxsteedCreditTopupService.js:426-436` posts a
  `load` with `reference_type: 'stripe_topup'` when a Stripe top-up
  completes. Top-ups have their own lifecycle table
  (`server/migrations/633_oxsteed_credit_topups.sql:31-32`, statuses
  `pending`, `completed`, `failed`, `requires_attention`), so "settled" is
  at least definable for this path: a top-up whose status is `completed`
  and whose `load` is posted. But the posted `load` row itself does not say
  "purchased settled"; that has to be re-derived by joining back to the
  top-up row, and nothing stops another `load` with a different reference
  from mingling into the same fungible balance.
- Admin load: `server/services/oxsteedCreditService.js:2095-2150`
  (`loadCustomerCredit`) posts a `load` from the platform treasury with a
  caller-supplied `referenceType`, `reason`, and `metadata`. Any admin
  actor can load any amount with any reference string. This is the only
  general issuance path, and it carries no source semantics at all.
- Adjustments: `oxsteedCreditService.js:2734-2769`
  (`adjustCustomerCreditInTransaction`) posts `adjustment` rows for admin
  corrections and dispute credits, again with free-form reason and
  reference. A dispute credit and a genuine purchase correction are
  indistinguishable in the journal except by reading the reason text.
- Earned: there is **no issuance path that puts earned Credit into a
  customer wallet with an earned tag**. Helper earnings accrue on
  `partner_payable` accounts, not customer wallets, and cash-out
  (`server/services/creditCashoutService.js:1-40`) treats "funds earned in
  the last `cashout_hold_days`" as a time-based hold, not a source tag.
  The brief's "earned settled plus approved" category therefore has no
  ledger representation at all today: no table, no transaction type, no
  approval record feeds the wallet.
- Promotional/referral: this Credit lives in a **separate ledger**,
  `platform_ledger`, via `server/services/referralCreditLedger.js:1-100`
  (types `referral_credit`, `dispute_credit`, `promo_credit`,
  `credit_release`, `credit_applied`, with its own idempotency keys and
  advisory locks). No code path converts `platform_ledger` promo/referral
  balances into `oxsteed_credit_accounts`, and no code path was found that
  reads a referral balance when posting to the Credit wallet. So promo
  Credit cannot leak into the wallet through the referral ledger today,
  but that is an accident of separation, not an enforced eligibility rule:
  an admin `load` or `adjustment` could credit the same amount into the
  wallet with no marker, and the wallet could not tell it apart from a
  purchase.
- Guest Credit: retired. `server/services/creditSpendAdapter.js` (security
  review F-01) refuses guest spend outright, and
  `server/services/creditGuestPolicy.js` keeps only historical caps. No
  guest issuance path remains to classify.
- Borrowed/advanced: **no such product exists in the code**. A grep for
  borrow/advance issuance across the Credit services returns nothing
  except the word "borrowing" in a JWT comment. There is no borrowed
  balance to exclude today, but there is also no mechanism that would
  exclude it if such a product were ever added; any future borrowed
  issuance would land in the same fungible balance.

### Category-by-category findings

| Credit category | Does the ledger record origin? | Can eligibility be decided at commit time? |
|---|---|---|
| Purchased | Partially. The `load` row exists and the top-up row records `completed`, but the wallet balance is fungible and the `load` row carries no "purchased settled" classification. | No. Available balance includes every `load` and `adjustment` ever posted, with no way to say how much of it is purchased settled. |
| Earned (settled plus approved) | No. No earned issuance path into the customer wallet exists, and no approval record is linked to wallet value. | No. There is no earned balance to measure, and no definition of "approved" in ledger terms. |
| Promotional / referral | No in the wallet; yes in the separate `platform_ledger` (typed rows). | No as an eligibility rule. Separation today is incidental. The wallet cannot prove a given cent did not arrive via an admin `load` standing in for a promotion. |
| Borrowed / advanced | No. No such issuance exists. | No mechanism exists to exclude it if introduced. |
| Disputed | Partially, at transaction level only. `oxsteed_credit_disputes` (migration 421, lines 292-314) keys disputes to a `transaction_id` with statuses `open`, `in_review`, `resolved`, `rejected`. An open dispute does not encumber any balance: the disputed amount stays spendable in the fungible wallet. | No. You can list open disputes for a customer, but you cannot say which cents are disputed or exclude them from the eligible amount. |
| Frozen / restricted | Account-wide and rail-wide only. `oxsteed_credit_accounts.status` is `active`, `suspended`, or `closed`; the rail freeze (`oxsteedCreditService.js:386-410`, `oxsteed_credit_rail_freezes`) is global and fails closed on every money initiation. | Partially. A suspended account or a frozen rail can block a commitment wholesale, which is the correct fail-closed behavior, but a partially restricted balance (some cents frozen, some free) cannot be represented. |
| Unsettled (pending top-up) | Yes, outside the wallet. A top-up in status `pending` has not posted a `load`, so its value is not in `balance_cents`. | Yes for this one case: only posted `load` value is in the balance. But "posted" is not the same as "settled" for non-top-up loads, which post immediately with no settlement state. |

### The six stress cases

- Mixed-source balances: FAIL. One fungible `balance_cents`; no lots, no
  sub-balances, no source tags. After any two different kinds of inflow,
  composition is unrecoverable.
- Partial spending: FAIL. Spends debit the fungible balance
  (`creditSpendAdapter.js` spends via `purchaseWithCreditInTransaction`
  or a hold, with no lot selection). There is no FIFO or eligible-first
  allocation, so a partial spend cannot be attributed to a source, and
  the remaining balance composition after any spend is unknowable.
- Pending reservations: SOUND. Holds (`oxsteed_credit_holds`, migration
  421 lines 187-218, statuses `active`, `captured`, `released`,
  `expired`) plus `oxsteed_credit_reservations`
  (`server/services/oxsteedCreditReservationService.js:1-206`) maintain
  the invariant `reserved_cents = SUM(active holds) + SUM(active
  reservations)`, enforced with `SELECT ... FOR UPDATE` and guarded
  increments/decrements. Available balance is `balance_cents -
  reserved_cents` (`oxsteedCreditService.js:738`). The investment
  reservation can reuse this mechanism, but a reservation row today
  records only an amount, not which lots it reserves.
- Refunds / reversals: FAIL on attribution, SOUND on arithmetic. A refund
  posts a `refund` transaction back into the same fungible balance and is
  capped at the original purchase amount
  (`oxsteedCreditService.js:3360-3400`), and reversed transactions keep
  their history. But a refund restores value to the fungible pool, not to
  the lot it came from, so a refunded purchase mingles with everything
  else. The brief's requirement that returned commitments "restore the
  original classification" is unimplementable on this model.
- Concurrent transactions: SOUND at the account level.
  `postJournalTransaction` and the hold/reservation paths lock account
  rows `FOR UPDATE`, check available balance under the lock, and enforce
  unique idempotency keys (`oxsteedCreditService.js:951, 1024, 2874,
  2910, 3046, 3144`; reservation service advisory handling and partial
  unique index on active reservations). Concurrent requests cannot
  overspend a balance or double-post the same key. This is the one
  eligibility-adjacent property that already holds, and the investment
  commit path should reuse exactly these primitives.
- Restrictions on promotional, borrowed, disputed, or unsettled Credit:
  FAIL. No per-unit restriction exists. The only restrictions are
  whole-account suspension, whole-rail freeze, and (for cash-out only) a
  time-based earned-funds hold. None of these can express "this many
  cents are promo and ineligible while the rest is eligible".

### Related ledgers and reconciliation (context, not eligibility)

- The central journal / dual-posting path
  (`server/services/oxsteedCreditSubBankService.js`, backfill table
  `credit_dual_posting_backfill` from migration 655) mirrors restaurant
  sub-bank wallet writes into a central journal and replays them when the
  rail is re-enabled. It proves totals reconcile; it does not track
  customer wallet source, and it is scoped to restaurant sub-bank flows.
- Immutability and audit are strong: journal entries are append-only by
  rule (migration 421, `oxsteed_credit_entries_no_update` /
  `no_delete`), entries carry a hash chain (migration 467), and
  corrections must be compensating transactions. The investment subledger
  should inherit these properties.
- `oxsteed_credit_settlements`, `oxsteed_credit_reconciliation_runs`, and
  the FX reference rates (migration 20261027110400) cover partner
  settlement and currency conversion. They do not record Credit origin.

## Prerequisite ledger work (outline for the Track 1 builder, no code)

Build this before any commitment can rely on eligibility. Keep every
existing invariant (append-only journal, hash chain, `FOR UPDATE`
locking, unique idempotency keys, the `reserved_cents` invariant) and add
source tracking alongside, not instead of:

1. New classification model. Add a lot or sub-balance record keyed to the
   customer wallet, for example an `oxsteed_credit_balance_lots` table:
   each lot records `source` (enum: `purchased`, `earned`, `promo`,
   `referral`, `borrowed`, `adjustment`, `unknown`), `settled_at`,
   `approval_ref` (nullable, for earned approvals and dispute
   resolutions), `amount_cents`, `remaining_cents`, and the originating
   transaction id. Alternatively, add a controlled `source_category`
   column to `oxsteed_credit_transactions` plus a per-category balance
   view; the lot form is preferred because it survives partial spending.
   New migration, timestamped after the newest on the base; applied
   migrations are never edited.
2. Issuance tagging. Every path that posts value into a customer wallet
   must create or top up a lot with the correct source: top-up completion
   creates a `purchased` lot only when the top-up is `completed`
   (settled); admin loads and adjustments must pass an explicit, validated
   source instead of a free-form reference string; earned issuance (if it
   is ever built) creates an `earned` lot only with a recorded approval.
   Any issuance without a known source creates an `unknown` lot, and
   `unknown` is ineligible by default.
3. Spend allocation rule. Define one deterministic rule and enforce it in
   the spend path: for example, ordinary spending consumes lots in a
   fixed order, while an investment commitment consumes only eligible
   lots (`purchased` settled, `earned` settled plus approved) and records
   exactly which lots and amounts it consumed. The rule must be a single
   function used by both the commit path and the closing recheck.
4. Reservation records lots. Investment reservations (reusing the holds /
   reservations mechanism) must record the lot ids and amounts reserved,
   so a release restores value to the original lots with their original
   classifications and restrictions, and a capture debits those lots.
   A release that returns value to the fungible pool instead of the
   original lots does not satisfy the brief.
5. Refunds and reversals restore lots. A refund of a purchase must credit
   back the lots the original spend consumed, in the same proportions,
   not the fungible pool. A reversal of a load must reduce the lot it
   created. Disputed amounts must encumber the specific lots they touch:
   an open dispute marks its lots (or a portion of them) ineligible until
   resolved, rather than relying on whole-account suspension.
6. Backfill and default. Existing balances have no recorded origin. The
   migration must classify every existing cent as `unknown` (ineligible)
   except where a provable join exists (for example, a `load` whose
   reference is a `completed` top-up). Do not assume existing balances
   are purchased. Provide an admin attestation path with an audit record
   for reclassifying `unknown` lots, and never silently reclassify.
7. Eligibility query. One server-side function, used at commit time and
   rechecked at closing: given a customer and an amount, it returns the
   eligible available amount (eligible lots minus their active
   reservations), computed under the same row locks as the reservation
   itself, so the check and the hold cannot race. The commit path must
   call it inside the same transaction as the reservation.
8. Tests. Repro tests for each stress case above: mixed lots with a
   partial spend, a reservation that spans lots, a refund restoring lot
   identity, a disputed lot excluded from eligibility, concurrent
   commits against the same eligible balance, and an idempotent retry
   that does not double-reserve lots.

## What changes in the build plan

- The investment subledger cannot be built on the current wallet as if
  eligibility were a query. The lot/classification work above is a
  prerequisite inside the build, not a later hardening pass, and it is
  the largest ledger risk in Track 1.
- The brief's "earned settled plus approved" rule cannot be implemented
  until someone defines, in ledger terms, what an earned issuance and its
  approval record are. That definition is an open question for Emile and
  counsel, not something Track 1 should invent: if no earned issuance
  path is defined, the eligible set is purchased settled only, and earned
  Credit simply does not exist as a fundable category.
- Promo/referral Credit needs no new exclusion code in the wallet, since
  it lives in `platform_ledger` and never enters the wallet today; but
  the separation must be pinned by a test, and admin loads must not
  become an unmarked back door for promo value.
- Nothing in this verification changes the flags plan: live commitments
  stay disabled behind `INVEST_ENABLED` / `INVEST_COMMITMENTS_ENABLED`
  (both default off) until the ledger work, counsel review, and partner
  validation are all done.

## Open questions

1. What is the ledger definition of "earned settled plus approved": which
   system issues earned Credit into a customer wallet, and what record
   constitutes approval and settlement?
2. Should existing balances be backfilled as `unknown` (ineligible) with
   an admin attestation path, or is there a provable purchase history
   that justifies a purchased classification for some of them?
3. Is the lot model above the intended shape, or is a per-category
   sub-balance preferred? The choice affects the migration and the spend
   allocation rule and should be settled before Track 1 writes the
   migration.
