-- Track payment reminder milestones (d7, d3, d1, overdue) for business/helper invoices.

ALTER TABLE business_invoices
  ADD COLUMN IF NOT EXISTS payment_reminder_milestones TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_business_invoices_payment_reminders
  ON business_invoices (due_date)
  WHERE status IN ('sent', 'partial', 'overdue')
    AND client_email IS NOT NULL;
