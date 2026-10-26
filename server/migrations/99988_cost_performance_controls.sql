-- Append-only operational controls for the Monday cost/performance audit.
ALTER TABLE users ADD COLUMN IF NOT EXISTS didit_session_payload_ciphertext TEXT;
ALTER TABLE learn_guides ADD COLUMN IF NOT EXISTS ai_tagging_content_hash TEXT;
ALTER TABLE guest_profile_chat_inbound
  ADD COLUMN IF NOT EXISTS verification_last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_send_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS order_sms_budgets (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_key TEXT NOT NULL,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  reserved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,order_key,day)
);
CREATE INDEX IF NOT EXISTS order_sms_budgets_day_idx ON order_sms_budgets(day);
ALTER TABLE restaurant_gift_card_fulfillments ADD COLUMN IF NOT EXISTS provider_event_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS restaurant_gift_provider_lookup ON restaurant_gift_card_fulfillments(provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS digest_pending_user_id ON email_digest_queue(user_id,id) WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS support_ai_pending_content_cache ON support_ai_reply_drafts(business_id,conversation_id,requested_by,language,md5(source_content),created_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION clear_terminal_didit_session_payload() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.didit_status IN ('verified','approved','failed','duplicate','declined','expired','skipped') THEN
    NEW.didit_session_payload_ciphertext := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_clear_terminal_didit_session_payload ON users;
CREATE TRIGGER users_clear_terminal_didit_session_payload
  BEFORE UPDATE OF didit_status ON users FOR EACH ROW
  EXECUTE FUNCTION clear_terminal_didit_session_payload();
