-- 99980: growth erasure anonymization support.
--
-- Numbering note: server/migrate.js sorts migration filenames
-- lexicographically, so a 4-digit 1xxx name would run BEFORE 951_*.sql on a
-- fresh database (before the tables below exist). The 99980+ range sorts
-- after all 9xx migrations.
--
-- Privacy retention policy (Emile 2026-10-22): on erasure, delivered
-- campaign/contact history is anonymized to the internal recipient_id
-- instead of deleted (aggregates and audit trails survive), which requires
-- the user_id link to be nullable. Suppression lists are NOT touched by
-- this migration and must persist through erasure.
--
-- offer_campaign_recipients.user_id: NULL = anonymized delivered recipient.
--   Rows with no delivered/opened/clicked history are still deleted by
--   rights.erase; only delivered history is kept, keyed by recipient id.
-- marketing_contact_log.user_id: NULL = anonymized contact history.

ALTER TABLE offer_campaign_recipients ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE marketing_contact_log ALTER COLUMN user_id DROP NOT NULL;
