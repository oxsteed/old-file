-- 964: Restaurant hosting primitives.  These records are deliberately
-- location-scoped so a reservation or table can never bleed between stores
-- in the same franchise.

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0 AND capacity <= 1000),
  section VARCHAR(120),
  position JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (restaurant_id, location_id)
    REFERENCES restaurant_locations(restaurant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_location_name
  ON restaurant_tables(restaurant_id, location_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_restaurant_id_id
  ON restaurant_tables(restaurant_id, id);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_location
  ON restaurant_tables(restaurant_id, location_id, status, name);

CREATE TABLE IF NOT EXISTS restaurant_reservations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  table_id BIGINT REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  guest_name VARCHAR(160) NOT NULL,
  guest_phone VARCHAR(40),
  guest_email VARCHAR(320),
  party_size INTEGER NOT NULL CHECK (party_size > 0 AND party_size <= 1000),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  source VARCHAR(32) NOT NULL DEFAULT 'host',
  notes TEXT,
  idempotency_key VARCHAR(180),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (restaurant_id, location_id)
    REFERENCES restaurant_locations(restaurant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (restaurant_id, table_id)
    REFERENCES restaurant_tables(restaurant_id, id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_reservation_idempotency
  ON restaurant_reservations(restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_window
  ON restaurant_reservations(restaurant_id, location_id, starts_at, status);
CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_guest
  ON restaurant_reservations(restaurant_id, location_id, guest_phone, starts_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_waitlist_entries (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  guest_name VARCHAR(160) NOT NULL,
  guest_phone VARCHAR(40),
  guest_email VARCHAR(320),
  party_size INTEGER NOT NULL CHECK (party_size > 0 AND party_size <= 1000),
  quoted_wait_min INTEGER CHECK (quoted_wait_min IS NULL OR quoted_wait_min >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'notified', 'seated', 'cancelled', 'expired')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  seated_at TIMESTAMPTZ,
  table_id BIGINT REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (restaurant_id, location_id)
    REFERENCES restaurant_locations(restaurant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (restaurant_id, table_id)
    REFERENCES restaurant_tables(restaurant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_restaurant_waitlist_queue
  ON restaurant_waitlist_entries(restaurant_id, location_id, status, joined_at);

DO $$
BEGIN
  IF to_regprocedure('set_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_restaurant_tables_updated_at ON restaurant_tables;
    CREATE TRIGGER trg_restaurant_tables_updated_at
      BEFORE UPDATE ON restaurant_tables FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    DROP TRIGGER IF EXISTS trg_restaurant_reservations_updated_at ON restaurant_reservations;
    CREATE TRIGGER trg_restaurant_reservations_updated_at
      BEFORE UPDATE ON restaurant_reservations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    DROP TRIGGER IF EXISTS trg_restaurant_waitlist_updated_at ON restaurant_waitlist_entries;
    CREATE TRIGGER trg_restaurant_waitlist_updated_at
      BEFORE UPDATE ON restaurant_waitlist_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
