-- Per-recipient delivery ledger for scheduled reports (Domain 9 follow-up).
-- deliverScheduledReport used to re-send to every recipient on retry:
-- the senders' idempotency keys deduped the send, not the work. This
-- table records the outcome per recipient per delivery (one delivery row
-- per schedule per business date), so a retry sends only to recipients
-- whose last recorded outcome was not 'sent'.
CREATE TABLE IF NOT EXISTS restaurant_scheduled_report_recipient_deliveries (
  id BIGSERIAL PRIMARY KEY,
  delivery_id BIGINT NOT NULL REFERENCES restaurant_scheduled_report_deliveries(id) ON DELETE CASCADE,
  scheduled_report_id BIGINT NOT NULL,
  business_date DATE NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user', 'email')),
  recipient TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_id, recipient_type, recipient, channel)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_report_recipient_deliveries
  ON restaurant_scheduled_report_recipient_deliveries(delivery_id, status);
