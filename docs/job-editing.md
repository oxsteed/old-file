# Editing posted jobs

This covers how a posted job changes after it is published, and how the
design holds up with millions of users. Status rules are in
`docs/job-status-transitions.md`.

## API

| Method | Path | Who | Notes |
|---|---|---|---|
| PATCH | `/api/jobs/:id` | owner | JSON merge-patch. Needs `If-Match` or `expected_version`. |
| PUT | `/api/jobs/:id` | owner | Legacy. Null and empty values are ignored; precondition optional. |
| GET | `/api/jobs/:id/revisions` | owner, bidders, admin | Bidders only see material changes, without private fields. |
| POST | `/api/bids/:id/reconfirm` | helper | Re-binds a flagged bid to the current revision. Optional `job_revision`. |
| PATCH | `/api/admin/jobs/:jobId` | admin | Requires a precondition and a `reason` (5+ characters). Audited. |
| GET | `/api/admin/jobs/:jobId/revisions` | admin | Full history with snapshots. |
| POST | `/api/admin/jobs/:jobId/revisions/:revisionId/rollback` | admin | Restores the "from" values as a new revision. Audited. |

Owner and admin writes go through `[authenticate, rejectImpersonated,
jobEditLimiter, checkRestrictions('job_posting')]`.

### Concurrency

- `jobs.version` is bumped by a trigger on any change except counters
  (`bid_count`, `updated_at`, `search_document`).
- Owners and admins get a weak ETag, `W/"job-<id>-v<version>"`, from
  `GET /api/jobs/:id`.
- Errors:
  - A stale `If-Match` returns 412 `precondition_failed`, with the current ETag.
  - A stale body `expected_version` returns 409 `version_conflict`.
  - A PATCH without either returns 428 `precondition_required`.
- Retries: send `Idempotency-Key`. A replay returns the current job and the
  `Idempotent-Replayed: true` header, and does not apply the edit again.
- Lock order is always `jobs` then `bids`:
  - Edits and bid acceptance lock the job row `FOR UPDATE`.
  - Bid creation and reconfirmation lock it `FOR SHARE`.
  - An edit and an accept cannot both succeed. A real-Postgres race test
    proves this (`server/__tests__/jobEditRace.db.test.js`).

### Validation

- `client/src/shared/jobSchema.js` (ESM) and `server/validation/jobSchema.js`
  (CommonJS) must stay identical. `client/scripts/jobSchema.test.mjs` enforces
  this.
- A validation failure returns `422 { code: 'validation_failed', fields: { field: code } }`.
- Possible field codes: `required`, `too_short`, `too_long`, `invalid`,
  `invalid_option`, `budget_negative`, `budget_too_large`, `out_of_range`,
  `budget_order`, `coordinates_pair`, `in_past`, `too_many`, `not_editable`,
  `locked_after_acceptance`.
- The client shows these through `jobEdit.errors.*` in all five locales.

## Material edits and bids

These fields are material: title, description, category, budget fields,
urgency, site access, recurrence, location fields and coordinates, schedule,
requirements, and required skills. If an owner changes one of them while
pending bids exist:

1. `jobs.revision` goes up by 1.
2. Every pending bid on an older revision gets `needs_reconfirm = true`. Its
   `expires_at` becomes the earlier of its current value and
   `now() + JOB_RECONFIRM_WINDOW_HOURS`.
3. The customer can't accept a flagged bid. The server returns 409
   `bid_needs_reconfirm`, or 409 `bid_expired` once the bid has expired.
4. The helper reconfirms the bid or revises it. Either action records the
   current revision on the bid and stores a snapshot of the job terms
   (`bids.job_snapshot`).
5. Owners get at most `JOB_MAX_MATERIAL_EDITS_PER_DAY` material edits per job
   in 24 hours while bids exist. Past that, the server returns 429
   `material_edit_limit`. This stops bait-and-switch pricing.

## Single source of truth (migration 760)

The trigger `jobs_canonical_fields` keeps these in sync:

- Money: the `*_cents` columns are canonical. `budget_min` and `budget_max`
  mirror them. Bids keep `amount_cents` in step with `amount` through
  `bids_canonical_amount`.
- Schedule: `scheduled_start_at` and `scheduled_precision` are canonical.
  Precision is `date` (anchored at 09:00 UTC) or `datetime`.
  `scheduled_date` and `scheduled_time` mirror them.
- Location: `location_lat` and `location_lng` are canonical. The trigger
  recomputes `location_point` and the fuzzed `location_approx_*`. If the
  address changes without new coordinates, the geo fields are cleared so a
  stale pin is never shown.
- Search: `search_document` (a tsvector) is built from title (A),
  category (B), and description (C).

The serializer (`server/services/jobSerializer.js`) never returns exact
coordinates, `location_point`, or `search_document`. Public viewers also don't
get party-only fields, and helpers don't get owner-only fields.

## Side effects: transactional outbox

Each edit writes its revision row and its `job_event_outbox` rows in the same
transaction.

- Pending rows coalesce on `coalesce_key`, so rapid edits produce one notice.
  Debounce window: `JOB_MATERIAL_NOTIFY_DEBOUNCE_SECONDS`.
- The worker in `server/jobs/jobEventOutbox.js` runs every 15 seconds under a
  fenced job lock and claims rows with `FOR UPDATE SKIP LOCKED` and a lease
  token. Failures retry with backoff and are marked `failed` after 8
  attempts.
- On delivery it:
  - Publishes to Redis on `oxsteed:job-events` and emits socket `job:updated`
    to the owner and bidders.
  - Notifies helpers whose bids are flagged. Fan-out is keyset-paged in
    chunks of 500, with an idempotency key per helper and revision, capped
    at `JOB_EDIT_NOTIFY_MAX_PER_HOUR` per helper.
  - Sends saved-search alerts for `job.published` and for material changes.
  - Sends change-order notices.
- Rows that are sent or failed are pruned after
  `JOB_EVENT_OUTBOX_RETENTION_DAYS`.

## Revisions

- `job_revisions` is partitioned by month.
- `server/jobs/jobRevisionMaintenance.js` creates partitions 3 months ahead.
- It drops partitions older than `JOB_REVISION_RETENTION_MONTHS` (default 36,
  minimum 12).

## Change orders after hiring

When a work-agreement change order is approved, these all happen in one
transaction (`server/services/jobChangeOrderFinance.js`):

- The agreed price changes (`job_value_cents` and the fee breakdown through
  `setFinancials`).
- Card payment:
  - On a decrease, the capture amount is lowered. Capture uses
    `payments.capture_amount_cents`.
  - On an increase above the authorized amount, the difference goes into
    `payments.pending_increase_cents`. The job is flagged with
    `metadata.paymentAdjustmentRequired`. Both parties are told the customer
    must authorize the difference.
- OxSteed Credit collateral hold: the hold is released and placed again at
  the new price. This is fail-closed: if there isn't enough Credit, the
  approval rolls back.
- A `job_revisions` row (`source = 'change_order'`) and a
  `job.change_order_applied` event are written.

## Search and feed

- Full-text search uses a prefix tsquery against `search_document`.
- Paging uses a keyset cursor with microsecond precision (`next_cursor`).
- `include_total=false` skips the `COUNT`.
- Budget filters and sorting use the cents columns.

## Observability

- `job_edit.*` counters and a Sentry span named `job.edit`.
- Outbox metrics: `job_event_outbox.delivery_ms`, `job_event_outbox.failed`,
  and the gauge `job_event_outbox.due_backlog`.

## Environment variables

All of these are optional.

| Variable | Default | Purpose |
|---|---|---|
| `JOB_RECONFIRM_WINDOW_HOURS` | 48 | How long a flagged bid stays valid |
| `JOB_MAX_MATERIAL_EDITS_PER_DAY` | 5 | Material edits per job per 24 h while bids exist |
| `JOB_MATERIAL_NOTIFY_DEBOUNCE_SECONDS` | 120 | Window for coalescing bidder notices |
| `JOB_EDIT_NOTIFY_MAX_PER_HOUR` | 6 | Job-edit notices per helper per hour |
| `JOB_EDIT_RATE_LIMIT_PER_15M` | 30 | Edit requests per user per 15 minutes |
| `JOB_EVENT_OUTBOX_RETENTION_DAYS` | 14 | How long sent and failed outbox rows are kept |
| `JOB_REVISION_RETENTION_MONTHS` | 36 | How long revision partitions are kept (minimum 12) |

## Client

- `/jobs/:id/edit` is `JobEditPage`. It uses PageShell and the shared schema,
  sends merge-patches with `expected_version` and an `Idempotency-Key`, and
  offers "Load the latest version" when there is a conflict.
- Job detail page:
  - Owners see an edit button (`can_edit`) and the change history.
  - Bids awaiting reconfirmation are marked and can't be accepted.
  - Helpers whose bid was flagged get a reconfirm banner.
- The admin job detail page shows the revision history with rollback.
- All copy lives in the `jobEdit` namespace in both catalogs (`src/locales`
  and `src/i18n/locales/*/common.json`) for en, es, fr, ht, and ar.

## Change orders that raise the price (customer re-authorization)

Migration 761 adds `job_payment_reauthorizations` (one row per attempt).
Service: `server/services/jobPaymentReauthorizationService.js`.

When an approved change order needs more money than is held, `jobs.metadata` gets a flag:

| Flag | Cause | Customer action |
|---|---|---|
| `paymentAdjustmentRequired: 'reauthorization_required'` | Card already authorized for less | Authorize a replacement manual-capture PaymentIntent for the full new amount on the helper's connected account (Stripe Elements `confirmCardPayment`, so SCA/3-D Secure runs in the browser). |
| `paymentAdjustmentRequired: 'intent_reprice_required'` | Original intent not yet confirmed | The intent amount and application fee are updated in place; the customer finishes the normal payment step. |
| `creditAdjustmentRequired: true` | Not enough OxSteed Credit to re-place escrow collateral at the new price | Add Credit, then hold it. Approval no longer fails on insufficient Credit: a savepoint keeps the old hold, and the customer is asked instead. |

While a flag is set (or `payments.pending_increase_cents > 0`), completion, `/payments/capture`, the capture worker and `/payments/intent` return `409 payment_reauthorization_required`.

API (customer; the assigned helper and admins can read the state):

- `GET /api/jobs/:id/payment-reauthorization`: `{ required, requirement, can_authorize, latest_attempt }`
- `POST /api/jobs/:id/payment-reauthorization` with `{ method: 'card' | 'credit' }`. A card attempt returns `client_secret`, `stripe_account_id`, `publishable_key`. A retry resumes the open attempt instead of creating another hold. Stripe idempotency keys are `job-payment-reauth:<job>:<attempt>`.
- `POST /api/jobs/:id/payment-reauthorization/:attemptId/confirm`: the browser calls this after `confirmCardPayment`.

Guards: `authenticate`, `rejectImpersonated`, `paymentsLimiter`, and `FEATURE_PAYMENTS_ENABLED` (card steps only).

**On success** (confirm endpoint or the `payment_intent.amount_capturable_updated` webhook, whichever comes first; both are idempotent):
- The payments row moves onto the new intent: amount, fee and capture ceiling are updated, `pending_increase_cents` becomes 0, and the old intent is recorded in `metadata.superseded_payment_intent_ids`.
- The flag is cleared, and the old intent is canceled after commit so only one authorization is ever captured.
- `job.payment_reauthorized` is queued in the outbox, which notifies the customer and the helper.

**Decline:** the attempt stays open with `failure_code` set, and `job.payment_reauth_failed` notifies the customer. The original authorization is untouched.

**Expiry:** open attempts older than `JOB_PAYMENT_REAUTH_TTL_HOURS` (default 24), or on jobs that were cancelled or closed, are expired every 10 minutes by the outbox worker. Their intents are canceled and the customer is notified.

**Webhooks:**
- A `payment_intent.canceled` or `payment_failed` event for an intent that no longer backs a payments row no longer resets `jobs.escrow_status`.
- Re-authorization intents carry `metadata.job_reauthorization = 'true'`.

**UI:** `PaymentReauthorizationBanner` on the job page (customer and assigned helper) and the work-agreement page. Strings are in the `jobPaymentReauth` namespace.
