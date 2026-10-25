-- Canonical authorization for paired hub/printer roles and source deletion.
ALTER TABLE restaurant_app_devices DROP CONSTRAINT IF EXISTS restaurant_app_devices_app_key_check;
ALTER TABLE restaurant_app_devices ADD CONSTRAINT restaurant_app_devices_app_key_check
  CHECK (app_key IN ('manager','pos','kitchen','display','inventory','crew','runner','restaurant','credit_kiosk','hub','printer'));

CREATE OR REPLACE FUNCTION restaurant_device_registry_from_app_device() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE role_key TEXT;
BEGIN
  role_key := CASE NEW.app_key
    WHEN 'restaurant' THEN 'manager' WHEN 'credit_kiosk' THEN 'kiosk'
    ELSE NEW.app_key END;
  INSERT INTO restaurant_devices
    (restaurant_id,location_id,device_role,capabilities,pairing_source,source_app_device_id,source_key,status,last_seen_at)
  VALUES (NEW.restaurant_id,NEW.location_id,role_key,
    COALESCE(NEW.config,'{}'::jsonb)||jsonb_build_object('app_key',NEW.app_key,'mode',NEW.mode),
    'app_device',NEW.id,'app_device:'||NEW.id,
    CASE WHEN NEW.status='disabled' THEN 'disabled' ELSE 'active' END,NEW.last_seen_at)
  ON CONFLICT (restaurant_id,source_key) DO UPDATE SET
    location_id=EXCLUDED.location_id,device_role=EXCLUDED.device_role,
    capabilities=EXCLUDED.capabilities,status=EXCLUDED.status,last_seen_at=EXCLUDED.last_seen_at,updated_at=NOW();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION restaurant_device_source_deleted() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE restaurant_devices SET status='disabled',updated_at=NOW()
    WHERE restaurant_id=OLD.restaurant_id
      AND source_key=(CASE TG_TABLE_NAME WHEN 'display_pairings' THEN 'display_pairing:' ELSE 'app_device:' END)||OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS restaurant_device_app_deleted ON restaurant_app_devices;
CREATE TRIGGER restaurant_device_app_deleted AFTER DELETE ON restaurant_app_devices
  FOR EACH ROW EXECUTE FUNCTION restaurant_device_source_deleted();
DROP TRIGGER IF EXISTS restaurant_device_display_deleted ON display_pairings;
CREATE TRIGGER restaurant_device_display_deleted AFTER DELETE ON display_pairings
  FOR EACH ROW EXECUTE FUNCTION restaurant_device_source_deleted();
UPDATE restaurant_devices d SET device_role='kiosk'
  FROM restaurant_app_devices a WHERE a.id=d.source_app_device_id AND a.app_key='credit_kiosk';
