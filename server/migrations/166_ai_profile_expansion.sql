-- 166: Profile AI expansion — owner ai_knowledge + AI-initiated appointments (guest / system placeholder)
-- Idempotent: safe to re-run.

BEGIN;

-- ── ai_knowledge on profiles (owner-edited text for profile assistant) ─────
ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS ai_knowledge TEXT;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS ai_knowledge TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_helper_profiles_ai_knowledge_len'
  ) THEN
    ALTER TABLE helper_profiles
      ADD CONSTRAINT chk_helper_profiles_ai_knowledge_len
      CHECK (ai_knowledge IS NULL OR char_length(ai_knowledge) <= 8000);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_businesses_ai_knowledge_len'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT chk_businesses_ai_knowledge_len
      CHECK (ai_knowledge IS NULL OR char_length(ai_knowledge) <= 8000);
  END IF;
END $$;

-- ── Internal user for AI-created guest appointments (customer_id NOT NULL) ───
INSERT INTO users (
  id, email, password_hash, first_name, last_name, role,
  email_verified, is_active, subscription_status,
  background_check_status, identity_verified
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'ai-booking-placeholder@oxsteed.internal',
  '$2a$10$N9qo8uLOickgx2ZMRShaOuV51lhzYGYlDbcJQRWx.9KGHyJ5PsRm',
  'OxSteed',
  'AI Bookings',
  'customer',
  true,
  false,
  'none',
  'not_submitted',
  false
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '00000000-0000-4000-8000-000000000001'::uuid);

-- ── appointments: AI chat source + guest fields + thread idempotency ───────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'user';

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS ai_thread_id VARCHAR(96);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS guest_name VARCHAR(200);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS guest_email VARCHAR(254);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_appointments_source'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_appointments_source
      CHECK (source IN ('user', 'ai_chat'));
  END IF;
END $$;

-- AI guest bookings use a fixed internal customer_id + guest_* contact fields.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_appointments_ai_chat_guest'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_appointments_ai_chat_guest
      CHECK (
        source <> 'ai_chat'
        OR (guest_email IS NOT NULL AND length(trim(guest_email)) > 0)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_ai_thread_unique
  ON appointments (helper_id, ai_thread_id)
  WHERE ai_thread_id IS NOT NULL AND source = 'ai_chat';

COMMIT;
