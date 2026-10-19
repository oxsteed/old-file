-- Migration 902: fail closed when an admin region is deleted.
-- admin_permission_grants.region_id is ON DELETE SET NULL, which would
-- silently turn a regional grant into a GLOBAL one. Revoke grants on the
-- region before it is deleted instead (additive trigger; FK unchanged).

CREATE OR REPLACE FUNCTION revoke_grants_for_deleted_region()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE admin_permission_grants
     SET revoked_at = COALESCE(revoked_at, NOW()),
         notes = CONCAT_WS(E'\n', NULLIF(notes, ''), 'Revoked automatically: region ' || OLD.id || ' was deleted.')
   WHERE region_id = OLD.id AND revoked_at IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS admin_regions_revoke_grants_on_delete ON admin_regions;
CREATE TRIGGER admin_regions_revoke_grants_on_delete
BEFORE DELETE ON admin_regions
FOR EACH ROW EXECUTE FUNCTION revoke_grants_for_deleted_region();
