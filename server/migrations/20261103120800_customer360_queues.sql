-- Customer 360 upgrade 10: shared team queues with SLA tracking and saved
-- views of the queue board.
CREATE TABLE IF NOT EXISTS customer360_queues (
  id BIGSERIAL PRIMARY KEY,
  queue_key VARCHAR(40) NOT NULL UNIQUE CHECK (queue_key ~ '^[a-z0-9_]{2,40}$'),
  name VARCHAR(80) NOT NULL,
  description VARCHAR(300),
  sla_minutes INTEGER NOT NULL CHECK (sla_minutes BETWEEN 5 AND 43200),
  -- Automatic feeds: open anomalies or link reviews waiting for a second admin.
  feed VARCHAR(20) CHECK (feed IS NULL OR feed IN ('anomalies', 'link_reviews')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer360_queues_feed ON customer360_queues (feed) WHERE feed IS NOT NULL;

INSERT INTO customer360_queues (queue_key, name, description, sla_minutes, feed) VALUES
  ('anomalies', 'Anomaly alerts', 'Open anomaly alerts, fed automatically.', 240, 'anomalies'),
  ('link_reviews', 'Duplicate reviews', 'Duplicate findings waiting for a second admin.', 1440, 'link_reviews'),
  ('general', 'General follow-up', 'Customers added by staff for follow-up.', 1440, NULL)
ON CONFLICT (queue_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer360_queue_items (
  id BIGSERIAL PRIMARY KEY,
  queue_id BIGINT NOT NULL REFERENCES customer360_queues(id),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Visibility topic: an anomaly kind, 'link_review' or 'general'.
  topic VARCHAR(40) NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('manual', 'anomaly', 'link_review')),
  source_ref VARCHAR(80),
  reason VARCHAR(300),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'resolved')),
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  first_claimed_at TIMESTAMPTZ,
  sla_breached_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution VARCHAR(30) CHECK (resolution IS NULL OR resolution IN ('handled', 'no_action', 'source_closed')),
  resolution_note VARCHAR(1000),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer360_queue_items_claim_shape CHECK (status <> 'claimed' OR assigned_to IS NOT NULL),
  CONSTRAINT customer360_queue_items_resolved_shape CHECK (status <> 'resolved' OR (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
-- One live item per queue and source (or per queue and customer for manual items).
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer360_queue_items_live_source
  ON customer360_queue_items (queue_id, source, source_ref) WHERE status <> 'resolved' AND source_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer360_queue_items_live_manual
  ON customer360_queue_items (queue_id, customer_id) WHERE status <> 'resolved' AND source = 'manual';
CREATE INDEX IF NOT EXISTS idx_customer360_queue_items_board
  ON customer360_queue_items (queue_id, status, due_at, id) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_customer360_queue_items_customer ON customer360_queue_items (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer360_queue_items_resolved ON customer360_queue_items (queue_id, resolved_at) WHERE status = 'resolved';

CREATE TABLE IF NOT EXISTS customer360_saved_views (
  id BIGSERIAL PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) > 0),
  scope VARCHAR(10) NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'team')),
  filters JSONB NOT NULL CHECK (jsonb_typeof(filters) = 'object' AND pg_column_size(filters) <= 2048),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer360_saved_views_name ON customer360_saved_views (owner_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_customer360_saved_views_team ON customer360_saved_views (scope) WHERE scope = 'team';
