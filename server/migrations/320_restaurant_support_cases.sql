-- Migration 320: OxSteed Restaurants issue-resolution case management.
-- Dedicated case system for customer order issues with restaurant-managed
-- resolution, OxSteed oversight, audit history, SLA routing, and safe
-- refund/credit/replacement placeholders. This is additive and preserves
-- existing food_* tables and /api/food compatibility.

CREATE TABLE IF NOT EXISTS restaurant_support_cases (
  id BIGSERIAL PRIMARY KEY,
  public_case_number VARCHAR(32) UNIQUE NOT NULL,
  order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  customer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  issue_type VARCHAR(48) NOT NULL CHECK (issue_type IN (
    'missing_item',
    'wrong_item',
    'food_quality',
    'late_order',
    'payment_problem',
    'restaurant_closed',
    'delivery_issue',
    'other'
  )),
  issue_subtype VARCHAR(120),
  title VARCHAR(240) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',
    'awaiting_restaurant',
    'awaiting_customer',
    'awaiting_oxsteed',
    'awaiting_runner',
    'investigating',
    'resolution_offered',
    'resolved',
    'closed',
    'reopened',
    'escalated',
    'canceled'
  )),
  priority VARCHAR(16) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  severity VARCHAR(32) NOT NULL DEFAULT 'moderate' CHECK (severity IN (
    'minor',
    'moderate',
    'serious',
    'safety_sensitive',
    'payment_sensitive',
    'fraud_sensitive'
  )),
  owner_type VARCHAR(24) NOT NULL DEFAULT 'restaurant' CHECK (owner_type IN ('restaurant','oxsteed','runner','shared')),
  owner_restaurant_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_oxsteed_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'customer_app',
  language VARCHAR(12) NOT NULL DEFAULT 'en',
  customer_locale VARCHAR(32),
  country_code CHAR(2) NOT NULL DEFAULT 'US',
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  requested_resolution VARCHAR(48) CHECK (requested_resolution IN (
    'refund',
    'partial_refund',
    'store_credit',
    'replacement_item',
    'remake_order',
    'discount_code',
    'apology_only',
    'no_action',
    'escalate_to_oxsteed'
  )),
  final_resolution VARCHAR(48),
  resolution_amount_cents INTEGER CHECK (resolution_amount_cents IS NULL OR resolution_amount_cents >= 0),
  requested_refund_amount_cents INTEGER CHECK (requested_refund_amount_cents IS NULL OR requested_refund_amount_cents >= 0),
  approved_refund_amount_cents INTEGER CHECK (approved_refund_amount_cents IS NULL OR approved_refund_amount_cents >= 0),
  refund_status VARCHAR(32) CHECK (refund_status IS NULL OR refund_status IN ('not_requested','requested','pending_approval','approved','denied','processed','failed')),
  refund_reason TEXT,
  refund_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  refund_approved_at TIMESTAMPTZ,
  credit_status VARCHAR(32) CHECK (credit_status IS NULL OR credit_status IN ('not_requested','offered','accepted','issued','declined')),
  store_credit_amount_cents INTEGER CHECK (store_credit_amount_cents IS NULL OR store_credit_amount_cents >= 0),
  replacement_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  payment_transaction_id VARCHAR(255),
  order_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  involved_order_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_runner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_escalated BOOLEAN NOT NULL DEFAULT FALSE,
  escalated_at TIMESTAMPTZ,
  escalation_reason TEXT,
  due_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_support_cases_restaurant_status
  ON restaurant_support_cases (restaurant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_support_cases_customer
  ON restaurant_support_cases (customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_support_cases_order
  ON restaurant_support_cases (order_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_support_cases_owner_due
  ON restaurant_support_cases (owner_type, due_at)
  WHERE status NOT IN ('resolved','closed','canceled');
CREATE INDEX IF NOT EXISTS idx_restaurant_support_cases_escalated
  ON restaurant_support_cases (is_escalated, created_at DESC)
  WHERE is_escalated = TRUE;

CREATE TABLE IF NOT EXISTS restaurant_support_case_messages (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES restaurant_support_cases(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_type VARCHAR(24) NOT NULL CHECK (sender_type IN ('customer','restaurant','oxsteed','runner','system')),
  message TEXT NOT NULL,
  internal_note BOOLEAN NOT NULL DEFAULT FALSE,
  language VARCHAR(12) NOT NULL DEFAULT 'en',
  translated_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_support_case_messages_case
  ON restaurant_support_case_messages (case_id, created_at ASC);

CREATE TABLE IF NOT EXISTS restaurant_support_case_events (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES restaurant_support_cases(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(24) NOT NULL DEFAULT 'system',
  event_type VARCHAR(64) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_support_case_events_case
  ON restaurant_support_case_events (case_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_restaurant_support_case_events_type
  ON restaurant_support_case_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_support_case_attachments (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES restaurant_support_cases(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(120),
  file_name VARCHAR(255),
  file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
  attachment_type VARCHAR(32) NOT NULL DEFAULT 'photo'
    CHECK (attachment_type IN ('photo','receipt','document','proof')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_support_case_attachments_case
  ON restaurant_support_case_attachments (case_id, created_at ASC);

CREATE TABLE IF NOT EXISTS restaurant_support_policies (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE CASCADE,
  issue_type VARCHAR(48) NOT NULL,
  restaurant_can_resolve BOOLEAN NOT NULL DEFAULT TRUE,
  max_refund_amount_cents INTEGER CHECK (max_refund_amount_cents IS NULL OR max_refund_amount_cents >= 0),
  requires_oxsteed_approval BOOLEAN NOT NULL DEFAULT FALSE,
  auto_escalate_after_minutes INTEGER NOT NULL DEFAULT 30 CHECK (auto_escalate_after_minutes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, issue_type)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_support_policies_issue
  ON restaurant_support_policies (restaurant_id, issue_type);

CREATE TABLE IF NOT EXISTS restaurant_support_case_assignments (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES restaurant_support_cases(id) ON DELETE CASCADE,
  assigned_to_type VARCHAR(24) NOT NULL CHECK (assigned_to_type IN ('restaurant','oxsteed','runner','shared')),
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE SET NULL,
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_support_case_assignments_case
  ON restaurant_support_case_assignments (case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_support_notification_events (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES restaurant_support_cases(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_type VARCHAR(24) NOT NULL CHECK (recipient_type IN ('customer','restaurant','oxsteed','runner')),
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','skipped','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_restaurant_support_notification_events_case
  ON restaurant_support_notification_events (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_support_notification_events_pending
  ON restaurant_support_notification_events (delivery_status, created_at)
  WHERE delivery_status = 'pending';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_support_cases_updated_at') THEN
    CREATE TRIGGER trg_restaurant_support_cases_updated_at
      BEFORE UPDATE ON restaurant_support_cases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_support_policies_updated_at') THEN
    CREATE TRIGGER trg_restaurant_support_policies_updated_at
      BEFORE UPDATE ON restaurant_support_policies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
