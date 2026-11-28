-- G10-7 (D-768): marking a consulting invoice paid used to be a single
-- admin's act with an optional reference, and it conjured a completed
-- consulting_payments row that unlocks booking. Two distinct admins must
-- now approve the mark-paid first; the approvals ride on the invoice row,
-- mirroring the referral-commission maker-checker
-- (career_referral_commissions.first_approver / second_approver).
ALTER TABLE consulting_invoices
  ADD COLUMN IF NOT EXISTS mark_paid_first_approver UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mark_paid_first_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mark_paid_second_approver UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mark_paid_second_approved_at TIMESTAMPTZ;
