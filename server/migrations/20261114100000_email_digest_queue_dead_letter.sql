-- Migration: email digest queue dead-letter columns (notifications audit item 28)
--
-- The digest queue had no dead-letter or expiry: rows for deleted /
-- unsubscribed users were rescanned forever, and rows whose delivery
-- kept failing were retried on every run with no bound. attempt_count
-- tracks consecutive failed delivery attempts; dead_lettered_at marks
-- rows that reached the max (3, see digestDelivery.js) so the batch
-- stops selecting them, and the purge removes them after retention.

ALTER TABLE email_digest_queue ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_digest_queue ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_email_digest_queue_dead_letter
  ON email_digest_queue(dead_lettered_at) WHERE dead_lettered_at IS NOT NULL;
