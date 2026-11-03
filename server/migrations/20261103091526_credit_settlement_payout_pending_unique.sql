-- Nov 3 audit item 7: make the settlement-payout double-queue guard
-- atomic. The maker route and requestPendingAction both pre-check for an
-- existing pending credit_settlement_payout, but two concurrent makers
-- can both pass the SELECT and queue two checker approvals (the second
-- only 409s at execution). This partial unique index closes the race:
-- at most one pending payout queue row per settlement. Decided, approved
-- and rejected rows are unaffected, so a settlement can be re-queued
-- after its first payout action leaves pending. The execution backstop
-- (FOR UPDATE, approved-only, payout_status none-only, deterministic
-- Stripe key) is unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_pending_actions_settlement_payout_pending
  ON oxsteed_credit_pending_actions (action_type, (payload ->> 'settlementId'))
  WHERE status = 'pending';
