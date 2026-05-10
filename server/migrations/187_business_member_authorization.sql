-- ATTACK #5 FIX: Business Member Authorization Hardening
-- Ensures role changes are properly authorized and atomic

ALTER TABLE business_members ADD COLUMN IF NOT EXISTS role_updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS role_updated_by UUID;

-- Index for audit trail: who changed whose role
CREATE INDEX IF NOT EXISTS idx_business_members_role_audit
  ON business_members(business_id, role_updated_by, role_updated_at DESC);

-- Ensure only owners can update roles
CREATE OR REPLACE FUNCTION validate_member_role_update()
RETURNS TRIGGER AS $$
BEGIN
  -- On role change, verify that the executor is an owner of the business
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    -- Check if updater is the owner
    IF NOT EXISTS(
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = NEW.business_id
        AND bm.member_id = NEW.role_updated_by
        AND bm.role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only owners can modify member roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate role updates
DROP TRIGGER IF EXISTS trigger_validate_member_role_update ON business_members;
CREATE TRIGGER trigger_validate_member_role_update
  BEFORE UPDATE ON business_members
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION validate_member_role_update();

COMMENT ON COLUMN business_members.role_updated_by IS 'User ID of who changed this role - used for audit trail and authorization validation';
