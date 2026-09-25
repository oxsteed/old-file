-- Migration 564: backfill the first-year Pro trial for recent accounts
-- =====================================================================
-- Migration 561 applies the 365-day default to future user inserts. This
-- migration gives existing, non-deleted accounts created within the last
-- year the same remaining first-year entitlement.

UPDATE users
SET
  trial_started_at = COALESCE(trial_started_at, created_at),
  trial_ends_at = GREATEST(
    COALESCE(trial_ends_at, created_at + INTERVAL '365 days'),
    created_at + INTERVAL '365 days'
  ),
  updated_at = NOW()
WHERE deleted_at IS NULL
  AND created_at >= NOW() - INTERVAL '365 days'
  AND created_at <= NOW()
  AND (
    trial_ends_at IS NULL
    OR trial_ends_at < created_at + INTERVAL '365 days'
  );
