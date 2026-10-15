-- 882_logistics_funding_gates.sql
-- Phase 3 follow-up (logistics refactor): funding/fulfillment gates and the
-- correction of migration 879's legacy backfill.
--
-- 1. pooled_orders.deposit_deadline — the explicit deposit-window deadline
--    the pledging → deposit_phase guard requires before staff may open the
--    deposit window (spec: "staff opens a deposit window with explicit
--    deadlines").
-- 2. logistics_review_exceptions — staff review cases for missed funding /
--    missed minimums at deadline. Raised by the funding sweeper
--    (sweepFundingDeadlines); a missed deadline NEVER auto-advances,
--    auto-refunds, or otherwise mutates the campaign.
-- 3. 'placement_approved' decision — the recorded Operations approval the
--    locked → placed guard requires before supplier placement.
-- 4. Corrects migration 879: participant paid cents that were assumed from
--    the *due* amount (deposit_amount_usd / final_payment_usd) wherever a
--    legacy paid_at timestamp existed are cleared back to 0 and the
--    participant is enqueued in logistics_reconciliation_queue for human
--    reconciliation — unless a genuinely settled payment attempt
--    (status = 'succeeded', reachable only via signed Stripe webhook or a
--    committed OxSteed Credit debit) corroborates the installment, in which
--    case the row is never touched. Idempotent: re-running only processes
--    rows that still carry unverified cents and have no open queue item.

-- ─── 1. Explicit deposit deadline ──────────────────────────────

ALTER TABLE pooled_orders
  ADD COLUMN IF NOT EXISTS deposit_deadline TIMESTAMPTZ;

-- ─── 2. Review exceptions for missed funding / missed minimums ─

CREATE TABLE IF NOT EXISTS logistics_review_exceptions (
  id                 BIGSERIAL PRIMARY KEY,
  reference          TEXT NOT NULL UNIQUE,
  pooled_order_id    INTEGER NOT NULL REFERENCES pooled_orders(id) ON DELETE CASCADE,
  exception_type     TEXT NOT NULL
                     CHECK (exception_type IN ('funding_shortfall', 'min_demand_unmet')),
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'acknowledged', 'resolved')),
  details            JSONB NOT NULL DEFAULT '{}'::jsonb,
  raised_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at    TIMESTAMPTZ,
  resolved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        TIMESTAMPTZ,
  resolution_notes   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one OPEN exception per (campaign, type): the sweeper inserts with
-- ON CONFLICT DO NOTHING against this index, so re-runs never duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_logistics_review_exceptions_open
  ON logistics_review_exceptions (pooled_order_id, exception_type)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_logistics_review_exceptions_status
  ON logistics_review_exceptions (status, raised_at DESC);

-- ─── 3. Placement approval decision ────────────────────────────
-- Extends the 872 approval-decision vocabulary with the staff approval that
-- authorizes supplier placement (the locked → placed gate requires it).
-- The original inline CHECK constraint name is Postgres-generated, so the
-- old constraint is located by its definition text, not by name.

DO $$
DECLARE
  old_constraint TEXT;
BEGIN
  SELECT conname INTO old_constraint
    FROM pg_constraint
   WHERE conrelid = 'logistics_campaign_approval_decisions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%submitted_for_review%'
   LIMIT 1;
  IF old_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE logistics_campaign_approval_decisions DROP CONSTRAINT %I',
      old_constraint
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_approval_decision') THEN
    ALTER TABLE logistics_campaign_approval_decisions
      ADD CONSTRAINT chk_campaign_approval_decision
      CHECK (decision IN ('submitted_for_review', 'withdrawn', 'approved',
                          'revisions_requested', 'rejected', 'placement_approved'));
  END IF;
END $$;

-- ─── 4. Correct the 879 assumed-paid backfill ───────────────────
-- 879 set deposit_paid_cents = ROUND(deposit_amount_usd * 100) (the amount
-- DUE, not paid) wherever deposit_paid_at was set, and likewise for the
-- final leg. Those assumed cents are not payment evidence. Enqueue each
-- affected participant/installment for reconciliation, then clear the
-- assumed cents. Participants corroborated by a genuinely settled attempt
-- are excluded from both statements.

-- 4a. Deposit leg: enqueue unverified assumed deposits.
INSERT INTO logistics_reconciliation_queue (source, entity_id, reason, payload, status)
SELECT 'logistics_backfill_unverified',
       p.id,
       'Legacy deposit marked paid from the due amount (migration 879) with no payment evidence; verify before treating as paid.',
       jsonb_build_object(
         'installment', 'deposit',
         'assumed_deposit_paid_cents', p.deposit_paid_cents,
         'deposit_paid_at', p.deposit_paid_at,
         'pooled_order_id', p.pooled_order_id,
         'correction_migration', '882'
       ),
       'pending'
  FROM pooled_order_participants p
 WHERE p.deposit_paid_at IS NOT NULL
   AND p.deposit_paid_cents > 0
   AND NOT EXISTS (
         SELECT 1 FROM logistics_payment_attempts a
          WHERE a.participant_id = p.id
            AND a.installment = 'deposit'
            AND a.status = 'succeeded'
       )
   AND NOT EXISTS (
         SELECT 1 FROM logistics_reconciliation_queue q
          WHERE q.source = 'logistics_backfill_unverified'
            AND q.entity_id = p.id
            AND q.status <> 'resolved'
            AND q.payload ->> 'installment' = 'deposit'
       );

-- 4b. Deposit leg: clear the assumed cents once enqueued.
UPDATE pooled_order_participants p
   SET deposit_paid_cents = 0,
       updated_at = NOW()
 WHERE p.deposit_paid_at IS NOT NULL
   AND p.deposit_paid_cents > 0
   AND NOT EXISTS (
         SELECT 1 FROM logistics_payment_attempts a
          WHERE a.participant_id = p.id
            AND a.installment = 'deposit'
            AND a.status = 'succeeded'
       )
   AND EXISTS (
         SELECT 1 FROM logistics_reconciliation_queue q
          WHERE q.source = 'logistics_backfill_unverified'
            AND q.entity_id = p.id
            AND q.status <> 'resolved'
            AND q.payload ->> 'installment' = 'deposit'
       );

-- 4c. Final-payment leg: enqueue unverified assumed finals.
INSERT INTO logistics_reconciliation_queue (source, entity_id, reason, payload, status)
SELECT 'logistics_backfill_unverified',
       p.id,
       'Legacy final payment marked paid from the due amount (migration 879) with no payment evidence; verify before treating as paid.',
       jsonb_build_object(
         'installment', 'final',
         'assumed_final_paid_cents', p.final_paid_cents,
         'final_paid_at', p.final_paid_at,
         'pooled_order_id', p.pooled_order_id,
         'correction_migration', '882'
       ),
       'pending'
  FROM pooled_order_participants p
 WHERE p.final_paid_at IS NOT NULL
   AND p.final_paid_cents > 0
   AND NOT EXISTS (
         SELECT 1 FROM logistics_payment_attempts a
          WHERE a.participant_id = p.id
            AND a.installment = 'final'
            AND a.status = 'succeeded'
       )
   AND NOT EXISTS (
         SELECT 1 FROM logistics_reconciliation_queue q
          WHERE q.source = 'logistics_backfill_unverified'
            AND q.entity_id = p.id
            AND q.status <> 'resolved'
            AND q.payload ->> 'installment' = 'final'
       );

-- 4d. Final-payment leg: clear the assumed cents once enqueued.
UPDATE pooled_order_participants p
   SET final_paid_cents = 0,
       updated_at = NOW()
 WHERE p.final_paid_at IS NOT NULL
   AND p.final_paid_cents > 0
   AND NOT EXISTS (
         SELECT 1 FROM logistics_payment_attempts a
          WHERE a.participant_id = p.id
            AND a.installment = 'final'
            AND a.status = 'succeeded'
       )
   AND EXISTS (
         SELECT 1 FROM logistics_reconciliation_queue q
          WHERE q.source = 'logistics_backfill_unverified'
            AND q.entity_id = p.id
            AND q.status <> 'resolved'
            AND q.payload ->> 'installment' = 'final'
       );
