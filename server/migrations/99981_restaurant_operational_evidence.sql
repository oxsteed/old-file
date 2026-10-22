-- Preserve operational evidence and bind retries to the original operation.
ALTER TABLE restaurant_checklists ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE restaurant_sops ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE restaurant_checklist_run_items ADD COLUMN IF NOT EXISTS instructions text;
ALTER TABLE restaurant_checklist_runs ADD COLUMN IF NOT EXISTS idempotency_key varchar(180);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_checklist_run_retry
  ON restaurant_checklist_runs(restaurant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS restaurant_sop_versions (
  sop_id bigint NOT NULL REFERENCES restaurant_sops(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  title text NOT NULL,
  body text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(sop_id,version)
);
INSERT INTO restaurant_sop_versions(sop_id,version,title,body)
  SELECT id,version,title,body FROM restaurant_sops ON CONFLICT DO NOTHING;
ALTER TABLE restaurant_staff_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE restaurant_staff_documents ADD COLUMN IF NOT EXISTS idempotency_key varchar(180);
ALTER TABLE restaurant_staff_documents ADD COLUMN IF NOT EXISTS request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_staff_document_retry
  ON restaurant_staff_documents(restaurant_id,uploaded_by,idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE restaurant_training_assignments ADD COLUMN IF NOT EXISTS started_version integer;
ALTER TABLE restaurant_waitlist_entries ADD COLUMN IF NOT EXISTS idempotency_key varchar(180);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_waitlist_retry
  ON restaurant_waitlist_entries(restaurant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS restaurant_table_seatings (
  id bigserial PRIMARY KEY,
  restaurant_id bigint NOT NULL REFERENCES food_restaurants(id),
  table_id bigint NOT NULL,
  order_id bigint REFERENCES food_orders(id),
  waitlist_id bigint REFERENCES restaurant_waitlist_entries(id),
  reservation_id bigint REFERENCES restaurant_reservations(id),
  party_size integer NOT NULL CHECK(party_size > 0),
  seated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  FOREIGN KEY(restaurant_id,table_id) REFERENCES restaurant_tables(restaurant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_table_active_seating
  ON restaurant_table_seatings(table_id) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_ticket_active_seating
  ON restaurant_table_seatings(order_id) WHERE closed_at IS NULL AND order_id IS NOT NULL;
