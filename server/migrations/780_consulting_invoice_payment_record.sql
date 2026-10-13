-- Review P3-1070: record how an admin consulting invoice was paid when an
-- operator marks it paid (off-platform bank transfer, check, cash, ...).
ALTER TABLE consulting_invoices
  ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_method    VARCHAR(30),
  ADD COLUMN IF NOT EXISTS paid_reference VARCHAR(200),
  ADD COLUMN IF NOT EXISTS paid_by        UUID REFERENCES users(id) ON DELETE SET NULL;

-- Sessions paid off-platform get a completed consulting_payments row (no
-- Stripe intent), which is what bookings check (P3-1069).
CREATE INDEX IF NOT EXISTS idx_consulting_payments_session_completed
  ON consulting_payments (session_scheduled_id) WHERE status = 'completed';
