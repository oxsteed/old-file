-- Restaurant screen synchronization. Additive, default-off rollout; no money policy changes.
ALTER TABLE food_restaurants ADD COLUMN IF NOT EXISTS screens_v2_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS screen_revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id);
ALTER TABLE food_order_items ADD COLUMN IF NOT EXISTS screen_revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE restaurant_app_devices ADD COLUMN IF NOT EXISTS applied_config_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE restaurant_app_devices ADD COLUMN IF NOT EXISTS screen_cursor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE restaurant_app_devices ADD COLUMN IF NOT EXISTS pending_operations INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS restaurant_screen_streams (
 restaurant_id BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
 revision BIGINT NOT NULL DEFAULT 0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS restaurant_screen_events (
 restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
 revision BIGINT NOT NULL,
 location_id BIGINT,
 kind TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 published_at TIMESTAMPTZ,
 PRIMARY KEY (restaurant_id, revision)
);
CREATE INDEX IF NOT EXISTS restaurant_screen_outbox_pending ON restaurant_screen_events(created_at) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS restaurant_screen_tickets (
 id UUID PRIMARY KEY,
 restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id),
 location_id BIGINT REFERENCES restaurant_locations(id),
 device_id BIGINT REFERENCES restaurant_app_devices(id),
 created_by UUID REFERENCES users(id),
 payload JSONB NOT NULL,
 request_hash TEXT NOT NULL,
 expected_total_cents BIGINT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','conflict','dismissed')),
 order_id BIGINT REFERENCES food_orders(id),
 conflict_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS restaurant_screen_ticket_review ON restaurant_screen_tickets(restaurant_id, status, created_at);

CREATE OR REPLACE FUNCTION restaurant_screen_record_change(rid BIGINT, lid BIGINT, change_kind TEXT, eid TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE rev BIGINT;
BEGIN
 IF rid IS NULL OR NOT EXISTS(SELECT 1 FROM food_restaurants WHERE id=rid AND (screens_v2_enabled OR change_kind='screen_rollout_disabled')) THEN RETURN; END IF;
 -- The row lock is retained until the underlying mutation commits. A higher
 -- cursor cannot become visible before a lower committed cursor.
 INSERT INTO restaurant_screen_streams(restaurant_id,revision) VALUES(rid,1)
 ON CONFLICT(restaurant_id) DO UPDATE SET revision=restaurant_screen_streams.revision+1,updated_at=NOW()
 RETURNING revision INTO rev;
 INSERT INTO restaurant_screen_events(restaurant_id,revision,location_id,kind,entity_id) VALUES(rid,rev,lid,change_kind,eid);
END $$;

CREATE OR REPLACE FUNCTION restaurant_screen_revision_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 NEW.screen_revision := OLD.screen_revision + 1;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS restaurant_screen_order_revision ON food_orders;
CREATE TRIGGER restaurant_screen_order_revision BEFORE UPDATE ON food_orders FOR EACH ROW EXECUTE FUNCTION restaurant_screen_revision_guard();
DROP TRIGGER IF EXISTS restaurant_screen_item_revision ON food_order_items;
CREATE TRIGGER restaurant_screen_item_revision BEFORE UPDATE ON food_order_items FOR EACH ROW EXECUTE FUNCTION restaurant_screen_revision_guard();

CREATE OR REPLACE FUNCTION restaurant_screen_change_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_data JSONB; rid BIGINT; lid BIGINT; oid BIGINT; eid TEXT;
BEGIN
 row_data := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 eid := row_data->>'id';
 IF TG_TABLE_NAME='food_restaurants' THEN
  rid := eid::bigint;
  IF TG_OP='UPDATE' THEN
   IF OLD.screens_v2_enabled AND NOT NEW.screens_v2_enabled THEN PERFORM restaurant_screen_record_change(rid,NULL,'screen_rollout_disabled',eid);RETURN NEW;END IF;
  END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updated_at')=(to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='food_order_items' THEN
  SELECT restaurant_id,location_id INTO rid,lid FROM food_orders WHERE id=(row_data->>'order_id')::bigint;
 ELSIF TG_TABLE_NAME='food_order_item_modifiers' THEN
  SELECT o.restaurant_id,o.location_id INTO rid,lid FROM food_orders o JOIN food_order_items i ON i.order_id=o.id WHERE i.id=(row_data->>'order_item_id')::bigint;
 ELSIF TG_TABLE_NAME='food_modifiers' THEN
  SELECT restaurant_id INTO rid FROM food_modifier_groups WHERE id=(row_data->>'modifier_group_id')::bigint;
 ELSE
  rid := (row_data->>'restaurant_id')::bigint;
  lid := (row_data->>'location_id')::bigint;
 END IF;
 -- Heartbeat telemetry must not generate an endless feedback loop.
 IF TG_TABLE_NAME='restaurant_app_devices' AND TG_OP='UPDATE' THEN
  IF (NEW.config_version,NEW.status,NEW.location_id,NEW.mode) IS NOT DISTINCT FROM (OLD.config_version,OLD.status,OLD.location_id,OLD.mode) THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('food_orders','restaurant_app_devices') THEN
  IF (to_jsonb(OLD)->>'location_id') IS DISTINCT FROM (row_data->>'location_id') THEN PERFORM restaurant_screen_record_change(rid,(to_jsonb(OLD)->>'location_id')::bigint,TG_TABLE_NAME,eid); END IF;
 END IF;
 PERFORM restaurant_screen_record_change(rid,lid,TG_TABLE_NAME,eid);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE tab TEXT; BEGIN
 FOREACH tab IN ARRAY ARRAY['food_restaurants','food_orders','food_order_items','food_order_item_modifiers','food_menu_items','food_menu_categories','food_modifier_groups','food_modifiers','restaurant_app_devices','restaurant_kitchen_stations','restaurant_screen_tickets','restaurant_locations','restaurant_inventory_items','restaurant_inventory_item_mappings','restaurant_inventory_availability_events','restaurant_runner_tasks'] LOOP
  IF to_regclass(tab) IS NOT NULL THEN
   EXECUTE format('DROP TRIGGER IF EXISTS restaurant_screen_change ON %I',tab);
   EXECUTE format('CREATE TRIGGER restaurant_screen_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION restaurant_screen_change_trigger()',tab);
  END IF;
 END LOOP;
END $$;
