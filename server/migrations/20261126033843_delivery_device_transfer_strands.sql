-- Group 9 partials Wave 2 Batch Q (499, G9-B7, D-562): the server-side
-- record of queued offline work stranded on a device the driver leaves
-- behind. The outbox (queued status/proof/issue/stop actions) and the
-- buffered GPS points live only in the old browser's localStorage, so a
-- device transfer or a lost phone can strand them with no server trace.
-- The driver client counts what is stranded per job (see
-- driverOfflineOutbox.countStrandedOutbox) and sends the counts with the
-- transfer (or with the lost-device report); the server stores one row
-- per job so ops can reconcile each stranded job explicitly. Rows are a
-- record, never auto-deleted: a reconcile only flips the status and
-- records who reconciled it and how.
CREATE TABLE IF NOT EXISTS delivery_device_transfer_strands (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_user_id UUID NOT NULL,
  old_device_id BIGINT NOT NULL,
  new_device_id BIGINT,
  delivery_job_id BIGINT NOT NULL,
  job_reference TEXT,
  queued_actions INTEGER NOT NULL DEFAULT 0 CHECK (queued_actions >= 0),
  unsynced_points INTEGER NOT NULL DEFAULT 0 CHECK (unsynced_points >= 0),
  source TEXT NOT NULL CHECK (source IN ('transfer', 'lost')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled')),
  reconcile_note TEXT,
  reconciled_by_user_id UUID,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS delivery_device_transfer_strands_driver_idx
  ON delivery_device_transfer_strands (driver_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_device_transfer_strands_status_idx
  ON delivery_device_transfer_strands (status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_device_transfer_strands_job_idx
  ON delivery_device_transfer_strands (delivery_job_id);
