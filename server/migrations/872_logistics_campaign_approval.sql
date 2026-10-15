-- 872_logistics_campaign_approval.sql
-- Phase 2 (logistics refactor): campaign draft submission and approval lifecycle.
--
-- The approval state is stored SEPARATELY from the fulfillment `status`
-- column on pooled_orders: approval decides whether a campaign may be
-- published, fulfillment decides where the published campaign is in its
-- lifecycle. Every review decision is recorded in
-- logistics_campaign_approval_decisions (who / when / reason).

ALTER TABLE pooled_orders
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_approval_state') THEN
    ALTER TABLE pooled_orders
      ADD CONSTRAINT valid_approval_state
      CHECK (approval_state IN ('draft', 'pending_review', 'revisions_requested', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pooled_orders_approval_state
  ON pooled_orders(approval_state);

-- Backfill: campaigns already past the draft fulfillment stage were published
-- under the pre-approval flow; treat them as approved so public visibility
-- and existing lifecycles are unchanged.
UPDATE pooled_orders
   SET approval_state = 'approved'
 WHERE status <> 'draft'
   AND approval_state = 'draft';

-- Approval history: one row per decision, immutable record of who/when/reason.
CREATE TABLE IF NOT EXISTS logistics_campaign_approval_decisions (
  id                  SERIAL PRIMARY KEY,
  pooled_order_id     INTEGER NOT NULL REFERENCES pooled_orders(id) ON DELETE CASCADE,
  decision            TEXT NOT NULL
                      CHECK (decision IN ('submitted_for_review', 'withdrawn', 'approved',
                                          'revisions_requested', 'rejected')),
  from_state          TEXT,
  to_state            TEXT,
  decided_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_approval_decisions_order
  ON logistics_campaign_approval_decisions(pooled_order_id, created_at DESC);
