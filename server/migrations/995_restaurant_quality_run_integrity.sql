-- Quality runs belong to stores; template edits retain historical item identities.
ALTER TABLE restaurant_audit_templates ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE restaurant_training_modules ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE restaurant_audit_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE restaurant_audits ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_audits ADD COLUMN IF NOT EXISTS snapshot_items JSONB;
ALTER TABLE restaurant_checklist_runs ADD COLUMN IF NOT EXISTS location_id BIGINT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_run_store_fk') THEN
    ALTER TABLE restaurant_audits ADD CONSTRAINT audit_run_store_fk
      FOREIGN KEY(restaurant_id,location_id) REFERENCES restaurant_locations(restaurant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='checklist_run_store_fk') THEN
    ALTER TABLE restaurant_checklist_runs ADD CONSTRAINT checklist_run_store_fk
      FOREIGN KEY(restaurant_id,location_id) REFERENCES restaurant_locations(restaurant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_snapshot_array_check') THEN
    ALTER TABLE restaurant_audits ADD CONSTRAINT audit_snapshot_array_check
      CHECK(snapshot_items IS NULL OR jsonb_typeof(snapshot_items)='array');
  END IF;
END $$;
WITH single_store AS (SELECT restaurant_id,MIN(id) AS id FROM restaurant_locations GROUP BY restaurant_id HAVING COUNT(*)=1)
UPDATE restaurant_audits a SET location_id=l.id FROM single_store l WHERE a.restaurant_id=l.restaurant_id AND a.location_id IS NULL;
WITH single_store AS (SELECT restaurant_id,MIN(id) AS id FROM restaurant_locations GROUP BY restaurant_id HAVING COUNT(*)=1)
UPDATE restaurant_checklist_runs c SET location_id=l.id FROM single_store l WHERE c.restaurant_id=l.restaurant_id AND c.location_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_audits_store_started ON restaurant_audits(restaurant_id,location_id,started_at);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_store_started ON restaurant_checklist_runs(restaurant_id,location_id,started_at);
INSERT INTO team_permissions(code,group_key,description) VALUES('audit.manage','operations','Manage quality templates and corrective actions.') ON CONFLICT(code) DO NOTHING;

-- Pin open legacy runs once. Replays never replace an existing snapshot.
UPDATE restaurant_audits a SET snapshot_items=COALESCE((
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order,i.id)
  FROM restaurant_audit_items i WHERE i.template_id=a.template_id AND i.is_active=TRUE
), '[]'::jsonb)
WHERE a.status='in_progress' AND a.snapshot_items IS NULL;
