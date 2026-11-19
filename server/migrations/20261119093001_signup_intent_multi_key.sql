BEGIN;

-- PR #804 G-32: a second signup intent silently overwrote the first because
-- access_signup_intents was keyed UNIQUE (user_id). Key by (user_id, intent)
-- so every expressed intent stays resumable. Consumed rows are kept as
-- history (consumed_at is stamped, never deleted); re-expressing an intent
-- reopens its row (consumed_at cleared) through the upsert in
-- server/services/access/signupIntent.js.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'access_signup_intents_user_unique'
      AND conrelid = 'access_signup_intents'::regclass
  ) THEN
    ALTER TABLE access_signup_intents DROP CONSTRAINT access_signup_intents_user_unique;
  END IF;
END $$;

ALTER TABLE access_signup_intents
  ADD CONSTRAINT access_signup_intents_user_intent_unique UNIQUE (user_id, intent);

CREATE INDEX IF NOT EXISTS access_signup_intents_pending_idx
  ON access_signup_intents (user_id) WHERE consumed_at IS NULL;

COMMIT;
