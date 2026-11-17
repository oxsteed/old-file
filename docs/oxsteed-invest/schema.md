# OxSteed Invest schema (Track 1)

Date: 2026-11-17. Migrations: `20261117123200_oxsteed_credit_balance_lots.sql`
and `20261117123300_investment_domain.sql`. Flag posture revised 2026-11-17
~07:58 EST (Emile: everything ships default-on): `INVEST_ENABLED` defaults
TRUE, so every surface is visible and usable without a flag flip; only live
Credit commitments, closing, proceeds release, and distributions stay
disabled behind `INVEST_COMMITMENTS_ENABLED` (default off) until counsel +
partner approve a pilot.

## Credit lots: why they exist

The wallet kept one fungible balance per customer per currency with no
record of origin, so investment eligibility could not be decided
(`credit-origin-verification.md`, verdict: CANNOT). Lots fix that. Every
wallet inflow is tagged to exactly one lot, and a lot keeps its source
and restrictions for its whole life. The existing journal, hash chain,
locking, and `reserved_cents` invariant are untouched; lots sit
alongside them.

### `oxsteed_credit_balance_lots`

One row per inflow slice. Columns: `id`, `account_id` (FK to
`oxsteed_credit_accounts`), `customer_id`, `currency_code`, `source`,
`amount_cents`, `remaining_cents`, `settled_at`, `approval_ref`,
`dispute_status` (`none` / `encumbered` / `resolved`),
`encumbered_cents`, `originating_transaction_id` (FK to
`oxsteed_credit_transactions`, one lot per journal transaction),
`topup_id` (FK to `oxsteed_credit_topups`, one lot per top-up),
`reference_type`, `reference_id`, `metadata`, timestamps.

Sources: `purchased`, `earned`, `promotional`, `referral`, `borrowed`,
`adjustment`, `distribution`, `unknown`. Invariants enforced in the
table: `remaining_cents` stays between 0 and `amount_cents`;
`encumbered_cents` never exceeds `remaining_cents`; `earned` requires
an `approval_ref`; `purchased` requires a `settled_at`.

Eligibility at launch: `purchased` settled only is eligible in practice.
`earned` settled plus approved is modeled but has no issuance path yet,
so no earned lot can exist until one is built with an approval record.
`promotional`, `referral`, `borrowed`, `distribution`, and `unknown`
are NOT eligible. A disputed lot contributes only its unencumbered
remainder. An `unknown` lot is ineligible by default and is never
silently reclassified.

### `oxsteed_credit_lot_reclassifications`

Admin attestation path for reclassifying a lot. Every change records
the actor, the reason, and an evidence reference (required when
reclassifying to `purchased`). Reclassification never happens silently.

### Backfill rule

Existing balances have no recorded origin. The backfill script
(`server/scripts/invest-credit-backfill.js`, `--dry-run` / `--apply`)
creates a `purchased` settled lot for each provably completed top-up
(status `completed` with a posted journal transaction), capped at the
still-untagged balance, and an `unknown` lot for the remainder. Never
claim a balance is eligible that the records cannot prove.

## Spend-allocation rule (the one deterministic rule)

Oldest settled eligible lot first (`settled_at` ascending, then
`created_at` ascending). It is implemented once, in
`server/services/invest/creditLots.js` (`allocateEligibleLots`), and
used by the commitment path and the closing recheck. A commitment
records exactly which lots and amounts it consumed in
`investment_commitment_lots`; a release flips those rows to `released`
and touches no lot balance, so the value returns to the ORIGINAL lots
with their original classification and restrictions. A capture debits
the lots and the wallet together through the journal (journal type
`adjustment`, metadata direction `debit`, attributed to the executing
approver; `settlement` is bound to approved partner payout snapshots
and `purchase` to partner agreements, so neither can represent this
movement).

Eligibility is always computed inside the reservation transaction:
`getEligibleBalance` locks the account row and the eligible lot rows
`FOR UPDATE`, and the result is capped by the wallet available balance
(`balance_cents - reserved_cents`), so ordinary holds that carry no lot
allocation still reduce what a commitment may take.

Known limit, not hidden: ordinary spending does not yet allocate lots,
so a partial ordinary spend does not reduce specific lots. The lot
view and the wallet balance stay consistent because the eligible
available amount is capped by the wallet available balance, and the
backfill invariant (sum of lot remaining equals the wallet balance)
is checked by reconciliation. Lot-aware ordinary spending is later work,
not part of Track 1.

## Investment domain tables

### `investment_opportunities`

The entity raise. `business_id` (FK to `businesses`), `created_by`,
`title`, `purpose`, `target_cents`, `minimum_cents`, `deadline_at`,
`status`, `structure` (only `revenue_share`), `country_code` (only
`US`), `valuation_rule`, `use_of_proceeds`, `intermediary_ref`,
`current_agreement_version_id`, `closing_conditions` (JSONB),
`closing_conditions_approved_at` / `_by`, `closed_at`,
`cancelled_at`, `cancellation_reason`, `expected_version`
(optimistic lock). Statuses: `draft`, `submitted`, `under_review`,
`approved`, `published`, `paused`, `closing`, `closed`, `cancelled`,
`unsuccessful`, `withdrawn`. `unsuccessful` is the terminal
fail-close state (Track 6 migration
`20261117144108_invest_fail_close_unsuccessful.sql`): a raise whose
target was missed or whose deadline passed, with every pending
reservation released back to its original lots; `cancelled_at` /
`cancellation_reason` record when and why it failed. Entity
ownership alone cannot publish: publish requires status `approved`
(a platform review step).

### `investment_agreement_versions`

The exact agreement text an investor accepts. `opportunity_id`,
`version_number` (unique per opportunity), `content_hash` (SHA-256 of
the body), `body`, `created_by`. A commitment records both the version
id and the version number, and must match the opportunity current
version at commit time. A new version becomes the current version
only when its amendment becomes effective; the exception is the first
version on a draft with no live applications and no commitments,
which becomes current immediately.

### `investment_participation_applications`

One live application per investor per opportunity (partial unique
index). `user_id`, `opportunity_id`, `status` (`draft`, `submitted`,
`under_review`, `needs_information`, `approved`, `rejected`,
`withdrawn` — `needs_information` added by the Track 2 migration
`20261117124812_invest_track2_authority.sql`; declined is stored as
`rejected` and presented as `declined` by the API),
`identity_verified`, `authority_verified`, `eligibility` (JSONB),
`agreement_version_id`, `agreement_accepted_at`, `reviewed_by`,
`reviewed_at`, `review_note`, `idempotency_key` (unique),
`expected_version`. Approval requires identity and authority
verification, and the reviewer cannot be the applicant.

### `investment_commitments`

One investor reservation, then position. `user_id`,
`opportunity_id`, `application_id`, `amount_cents`, `currency_code`,
`status` (`reserved`, `completed`, `cancelled`, `failed`),
`agreement_version_id` plus `agreement_version_number`,
`credit_reservation_id` (FK to `oxsteed_credit_reservations`, the real
Credit hold), `journal_transaction_id` (set at completion),
`credit_reference_rate`, `eligibility_rechecked_at`,
`idempotency_key` (unique), `expected_version`, `cancelled_at`,
`cancellation_reason`, `completed_at`. A completed commitment must
have a journal transaction id.

### `investment_commitment_lots`

Which lots a commitment reserves. `commitment_id`, `lot_id`,
`amount_cents`, `status` (`active`, `released`, `captured`). Unique
per commitment and lot.

### `investment_positions`

Completed commitments. `user_id`, `opportunity_id`, `commitment_id`
(unique), `amount_cents`, `currency_code`, `agreement_version_id`
plus version number, `status` (`active`, `exited`, `written_off`),
`acquired_at`.

### `investment_closing_approvals`

Separate review and execution for closing. `opportunity_id`, `stage`
(`review` / `execution`, one row per stage per opportunity),
`approver_user_id`, `decision` (`approved` / `rejected`), `note`,
`decided_at`. The service enforces distinct approvers and that
neither is the entity representative.

### `investment_settlements`

Partner settlement records. `opportunity_id`, `commitment_id`
(nullable), `kind` (`escrow_expectation`, `proceeds_release`,
`distribution`), `status` (`pending_partner_confirmation`,
`confirmed`, `released`, `cancelled`, `failed`), `amount_cents`,
`currency_code`, `credit_reference_rate`, `partner_ref`, `note`,
`created_by`, `confirmed_at`, `released_at`. These record the
expectation and its confirmation; there is no partner integration, no
fiat movement, and no external call. See SETTLEMENT_ASSUMPTIONS.md.

### `investment_proceeds`

Entity side of a closed opportunity. `opportunity_id`,
`settlement_id`, `amount_cents`, `currency_code`, `status`
(`awaiting_release`, `released`, `cancelled`), `released_at`,
`released_by`. Proceeds cannot release before approved closing
conditions; the releaser cannot be the entity representative.

### `investment_distributions`

Value credited back to an investor. `opportunity_id`, `position_id`,
`user_id`, `settlement_id`, `amount_cents`, `currency_code`, `status`
(`pending`, `credited`, `failed`, `reversed`),
`journal_transaction_id` (required when credited), `lot_id` (the
`distribution` lot the credit created), `idempotency_key` (unique),
`failure_reason`.

### `investment_amendments`

Controlled amendment process for material changes. `opportunity_id`,
`status` (`draft`, `proposed`, `effective`, `withdrawn`, `rejected`),
`changes` (JSONB), `previous_agreement_version_id`,
`new_agreement_version_id`, `notice_sent_at`,
`reconfirmation_deadline_at`, `created_by`, `reviewed_by`,
`review_note` (the reviewer note recorded on the effective/reject
decision), `expected_version`. Only a proposed amendment can be
decided by a reviewer; `effective` is set only by that reviewer
decision, which applies the allow-listed changes to the opportunity
and moves the current agreement version to the amendment's new
version. Reconfirmation is open only while the amendment is
`proposed`.

### `investment_opportunity_questions`

Q and A. `opportunity_id`, `user_id`, `question`, `answer`,
`answered_by`, `status` (`open`, `answered`, `withdrawn`).

### `investment_opportunity_updates`

Reporting schedule and obligations. `opportunity_id`, `title`,
`body`, `status` (`draft`, `published`, `overdue`), `due_at`,
`published_at`, `created_by`. Missed updates are shown overdue.

### `investment_documents`

Confidential material with relationship-scoped visibility.
`opportunity_id`, `uploaded_by`, `title`, `storage_ref`,
`visibility` (`public`, `applicants`, `committed`, `reviewers`),
`confidential`.

### `investment_ledger_entries`

Immutable subledger journal. `entry_type` (`reservation`,
`release`, `completion`, `proceeds_awaiting`, `proceeds_released`,
`distribution_credit`, `correction`, `reversal`), `category`
(`pending_reservations`, `cancelled_released`,
`completed_contributions`, `proceeds_awaiting_release`,
`released_proceeds`, `distributions`, `corrections_reversals`),
`opportunity_id`, `commitment_id`, `user_id`, signed
`amount_cents` (positive into the category, negative out),
`currency_code`, `reference_type`, `reference_id`,
`idempotency_key` (unique), `metadata`. UPDATE and DELETE are
rejected by database triggers; corrections are new compensating
entries. Every category total is a SUM over this table, never a
stored total, and staff never edit totals directly.

## Track 2 note (2026-11-17, migration `20261117124812_invest_track2_authority.sql`)

One migration added the columns the authority and route layer genuinely
needed and Track 1 had not stored:

- `investment_opportunities.details` (JSONB, default `{}`): the entity
  fundraising submission (legal details, financials, ownership, risks,
  related parties), validated server-side to those keys.
- `investment_opportunities.verification_summary` (JSONB, default `{}`),
  `verified_at`, `verified_by`: what a reviewer verified at approval, so
  the detail page verification badge can describe it.
- `investment_opportunities.published_at`: the directory sorts neutrally
  by publication date or closing date.
- `investment_participation_applications` status CHECK now includes
  `needs_information`, the specified lifecycle state. Declined is still
  stored as `rejected` (Track 1 vocabulary, kept) and presented as
  `declined` by the API.

No other Track 1 table changed. The full route and authority surface is
documented in `docs/oxsteed-invest/api.md`.
