-- Dual-posting auto-provision carve-out for the Credit partner creator guard.
--
-- Migration 488 requires every oxsteed_credit_partners row to carry an
-- active administrator creator. That is correct for admin-registered
-- partners, but it makes live dual-posting auto-provision impossible:
-- ensureRestaurantPartner (server/services/oxsteedCreditSubBankService.js)
-- creates a `pending` row on first food-wallet activity, and there is no
-- administrator in that path to attribute. Before this migration the
-- auto-provision INSERT failed the trigger every time, so any restaurant
-- with wallet activity before admin partner registration could never
-- dual-post.
--
-- The exemption is deliberately narrow, and it is the ONLY exemption:
--   * partners table only (the other three tables guarded by migration 488
--     keep the unmodified rule),
--   * INSERT only (UPDATE OF created_by is never exempt, so an existing
--     row can never gain a bogus or missing creator through this path),
--   * auto_provisioned = TRUE (set only by ensureRestaurantPartner; every
--     other insert path defaults to FALSE),
--   * status = 'pending' (an auto-provisioned row is born pending),
--   * created_by IS NULL (an attributed row takes the normal path).
-- A pending insert without the marker still fails, a non-pending insert
-- without an admin creator still fails, and every other table still fails.
-- Activation does not go through this exemption: partner status changes
-- are status-only UPDATEs, which the migration 488 trigger does not fire
-- on, and admin registration replays against the existing row.
--
-- This migration does not touch migration 488; it replaces the shared
-- trigger function and adds the marker column the function reads.

ALTER TABLE oxsteed_credit_partners
  ADD COLUMN IF NOT EXISTS auto_provisioned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN oxsteed_credit_partners.auto_provisioned IS
  'TRUE only for rows created by dual-posting auto-provision (ensureRestaurantPartner); the sole input to the migration 488 creator-guard carve-out.';

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_admin_creator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Narrow auto-provision carve-out. The table check is outer so the
  -- function never reads NEW.auto_provisioned on a table without that
  -- column (the other three guarded tables do not have it).
  IF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'oxsteed_credit_partners' THEN
    IF NEW.auto_provisioned IS TRUE
       AND NEW.status = 'pending'
       AND NEW.created_by IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.created_by IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM users
        WHERE id = NEW.created_by
          AND is_active = TRUE
          AND role IN ('admin', 'super_admin')
     ) THEN
    RAISE EXCEPTION 'OxSteed Credit control records require an active administrator creator'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
