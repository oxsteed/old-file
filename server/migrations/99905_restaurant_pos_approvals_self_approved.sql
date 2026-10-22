-- Auth-audit finding 26: manager self-approvals left no approval record.
-- consumeManagerApproval now writes a dual-control row with
-- status = 'self_approved' (approver_user_id = the acting manager) when the
-- actor already holds pos.manage. Extend the status CHECK accordingly.
-- Existing rows ('approved', 'denied', 'consumed') are untouched.

ALTER TABLE restaurant_pos_approvals
  DROP CONSTRAINT IF EXISTS restaurant_pos_approvals_status_check;
ALTER TABLE restaurant_pos_approvals
  ADD CONSTRAINT restaurant_pos_approvals_status_check
  CHECK (status IN ('approved', 'denied', 'consumed', 'self_approved'));
