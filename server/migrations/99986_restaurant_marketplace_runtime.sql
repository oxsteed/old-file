ALTER TABLE restaurant_delivery_marketplace_integrations ADD COLUMN IF NOT EXISTS location_id BIGINT;
UPDATE restaurant_delivery_marketplace_integrations i SET location_id=l.id,status='disabled'
  FROM restaurant_locations l WHERE i.location_id IS NULL AND l.restaurant_id=i.restaurant_id AND l.is_primary=TRUE;
ALTER TABLE restaurant_delivery_marketplace_integrations ALTER COLUMN location_id SET NOT NULL;
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='restaurant_delivery_marketplace_integrations'::regclass
    AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (restaurant_id, provider)'
  LOOP EXECUTE format('ALTER TABLE restaurant_delivery_marketplace_integrations DROP CONSTRAINT %I',c.conname); END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='restaurant_marketplace_store_fk') THEN
    ALTER TABLE restaurant_delivery_marketplace_integrations ADD CONSTRAINT restaurant_marketplace_store_fk
      FOREIGN KEY(restaurant_id,location_id) REFERENCES restaurant_locations(restaurant_id,id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_marketplace_provider_store ON restaurant_delivery_marketplace_integrations(restaurant_id,provider,location_id);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_marketplace_external_store ON restaurant_delivery_marketplace_integrations(provider,external_location_id)
  WHERE provider='uber_eats' AND status='enabled';
ALTER TABLE restaurant_delivery_marketplace_orders ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id);
CREATE TABLE IF NOT EXISTS restaurant_marketplace_webhook_receipts (
  integration_id BIGINT NOT NULL REFERENCES restaurant_delivery_marketplace_integrations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requires_provider_mapping',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(integration_id,event_id)
);
