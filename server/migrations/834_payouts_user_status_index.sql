-- 834: index backing the admin user-list earnings subquery (ADM-061).
-- The correlated subquery on payouts(user_id, status) runs per result row;
-- without an index it degrades to a sequential scan per row.
DO $$
BEGIN
  IF to_regclass('public.payouts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_payouts_user_status
      ON payouts (user_id, status);
  END IF;
END $$;
