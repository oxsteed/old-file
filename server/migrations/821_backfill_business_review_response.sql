BEGIN;

-- 821: Converge divergent owner-response columns (P2-8-F17).
-- The canonical owner-response column on business_reviews is `response`
-- (migration 078; read by the public review endpoints and the business
-- profile). The review-management UI wrote a parallel `owner_reply` column
-- (migration 239), so replies posted there never appeared publicly and
-- vice versa. The management endpoints now write `response`; backfill any
-- replies that only exist in `owner_reply`.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'business_reviews' AND column_name = 'owner_reply'
  ) THEN
    UPDATE business_reviews
    SET response = NULLIF(BTRIM(owner_reply), ''),
        owner_reply_at = COALESCE(owner_reply_at, updated_at)
    WHERE (response IS NULL OR BTRIM(response) = '')
      AND owner_reply IS NOT NULL
      AND BTRIM(owner_reply) <> '';
  END IF;
END $$;

COMMIT;
