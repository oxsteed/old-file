-- Migration 538: Unify calendar + messenger booking_requests lifecycle
-- Canonical store remains booking_requests (see migration 537).
-- Backfill legacy counter_* proposals into status = counter_proposed.
-- Normalize source for calendar-originated rows without chat linkage.

BEGIN;

-- 1) Legacy calendar counter-propose → canonical status enum
-- Only when still pending and a counter offer is waiting on the customer.
UPDATE booking_requests
   SET status = 'counter_proposed',
       requested_date = COALESCE(counter_date, requested_date),
       requested_start_time = COALESCE(counter_start_time, requested_start_time),
       requested_end_time = COALESCE(counter_end_time, requested_end_time),
       helper_response_reason = COALESCE(helper_response_reason, counter_message),
       updated_at = CURRENT_TIMESTAMP
 WHERE status = 'pending'
   AND counter_status = 'pending'
   AND counter_date IS NOT NULL
   AND counter_start_time IS NOT NULL
   AND counter_end_time IS NOT NULL;

-- 2) Source defaults: calendar-only rows without chat/guest linkage
UPDATE booking_requests
   SET source = 'calendar',
       updated_at = CURRENT_TIMESTAMP
 WHERE (source IS NULL OR source = '' OR source = 'direct')
   AND conversation_id IS NULL
   AND guest_session_id IS NULL
   AND quote_id IS NULL;

-- 3) Ensure messenger-ish sources are labeled when conversation/guest present but source still generic
UPDATE booking_requests
   SET source = CASE
         WHEN guest_session_id IS NOT NULL THEN COALESCE(NULLIF(source, ''), 'guest_chat')
         WHEN conversation_id IS NOT NULL THEN COALESCE(NULLIF(source, ''), 'messenger')
         ELSE source
       END,
       updated_at = CURRENT_TIMESTAMP
 WHERE (source IS NULL OR source IN ('', 'direct', 'calendar'))
   AND (conversation_id IS NOT NULL OR guest_session_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_booking_requests_helper_inbox
  ON booking_requests(helper_id, status, created_at DESC)
  WHERE status IN ('pending', 'counter_proposed', 'expired');

COMMENT ON COLUMN booking_requests.source IS
  'Origin: calendar, messenger, messenger_picker, quote_schedule, guest_chat, ai_chat, direct, etc.';

COMMIT;

-- Non-migratable (documented): appointments with status=requested that never
-- produced a booking_requests row remain calendar-only appointments; ops may
-- backfill manually if needed. Do not invent rows without requester identity.
