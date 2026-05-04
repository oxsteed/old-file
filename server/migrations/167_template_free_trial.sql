-- Migration 167: 1-Year Free Trial on All Templates
-- Adds 'free_trial' as a valid access_type and backfills all existing users
-- with a 1-year trial on every paid (non-free) active template.

-- ── 1. Extend the access_type CHECK constraint ──────────────────────────────
ALTER TABLE template_access DROP CONSTRAINT IF EXISTS template_access_type_check;
ALTER TABLE template_access ADD CONSTRAINT template_access_type_check
  CHECK (access_type IN (
    'purchase_monthly',
    'purchase_lifetime',
    'admin_grant',
    'bundle_monthly',
    'bundle_lifetime',
    'free_trial'
  ));

-- ── 2. Backfill: grant 1-year free trial to every existing user ─────────────
-- Skips users that already have a free_trial row for a given slug (idempotent).
INSERT INTO template_access
  (user_id, template_slug, access_type, grant_type,
   start_date, expiry_date, status, internal_note)
SELECT
  u.id,
  tp.slug,
  'free_trial',
  'timed',
  NOW(),
  NOW() + INTERVAL '1 year',
  'active',
  '1-year launch free trial'
FROM users u
CROSS JOIN template_pricing tp
WHERE u.deleted_at IS NULL
  AND tp.is_free    = FALSE
  AND tp.is_active  = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM template_access ta
    WHERE ta.user_id       = u.id
      AND ta.template_slug = tp.slug
      AND ta.access_type   = 'free_trial'
  );
