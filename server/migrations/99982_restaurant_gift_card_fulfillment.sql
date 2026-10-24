-- Durable fulfillment and external statement evidence. No balance is changed.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_gift_cards_tenant_id
  ON restaurant_gift_cards(id, restaurant_id);
CREATE TABLE IF NOT EXISTS restaurant_gift_card_fulfillments (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id),
  gift_card_id BIGINT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('e_gift','physical')),
  status TEXT NOT NULL CHECK (status IN ('pending','sending','accepted','delivered','failed','needs_review','ready','handed_out')),
  payload_ciphertext TEXT,
  payload_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  request_hash CHAR(64) NOT NULL,
  resolution_hash CHAR(64),
  provider_key UUID NOT NULL DEFAULT gen_random_uuid(),
  provider_id TEXT,
  provider_event TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  handoff_reference VARCHAR(160),
  handed_out_by UUID REFERENCES users(id),
  handed_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gift_card_id, restaurant_id) REFERENCES restaurant_gift_cards(id, restaurant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_gift_card_provider_id
  ON restaurant_gift_card_fulfillments(provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS restaurant_gift_card_delivery_pending
  ON restaurant_gift_card_fulfillments(next_attempt_at, id) WHERE status IN ('pending','sending','accepted');
CREATE TABLE IF NOT EXISTS restaurant_gift_card_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id),
  gift_card_id BIGINT NOT NULL,
  source VARCHAR(80) NOT NULL,
  external_reference VARCHAR(160) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  external_balance_cents BIGINT NOT NULL CHECK (external_balance_cents >= 0),
  internal_balance_cents BIGINT NOT NULL CHECK (internal_balance_cents >= 0),
  ledger_balance_cents BIGINT NOT NULL,
  ledger_through_id BIGINT,
  variance_cents BIGINT NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  actor_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gift_card_id, restaurant_id) REFERENCES restaurant_gift_cards(id, restaurant_id),
  UNIQUE (restaurant_id, source, external_reference, gift_card_id)
);
CREATE OR REPLACE FUNCTION restaurant_gift_card_evidence_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Gift card ledger and reconciliation evidence are append-only'; END $$;
DROP TRIGGER IF EXISTS restaurant_gift_card_ledger_immutable ON restaurant_gift_card_ledger;
CREATE TRIGGER restaurant_gift_card_ledger_immutable BEFORE UPDATE OR DELETE ON restaurant_gift_card_ledger
  FOR EACH ROW EXECUTE FUNCTION restaurant_gift_card_evidence_immutable();
DROP TRIGGER IF EXISTS restaurant_gift_card_reconciliation_immutable ON restaurant_gift_card_reconciliations;
CREATE TRIGGER restaurant_gift_card_reconciliation_immutable BEFORE UPDATE OR DELETE ON restaurant_gift_card_reconciliations
  FOR EACH ROW EXECUTE FUNCTION restaurant_gift_card_evidence_immutable();
