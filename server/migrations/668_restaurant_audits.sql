-- Migration 668: OxSteed Restaurants — Quality audits (franchise system).
-- Additive only. Audit templates with scored items, audit runs, findings,
-- and corrective actions per restaurant. Nothing existing is modified.
--
-- FK note: food_restaurants.id is BIGINT (BIGSERIAL); users.id is UUID.

-- Audit templates a restaurant defines (kitchen inspection, food safety, etc.).
CREATE TABLE IF NOT EXISTS restaurant_audit_templates (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'safety')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_audit_templates_restaurant
  ON restaurant_audit_templates(restaurant_id, is_active, sort_order);

-- Scored line items inside a template. Weights let critical items count more.
CREATE TABLE IF NOT EXISTS restaurant_audit_items (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES restaurant_audit_templates(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  instructions TEXT,
  max_score INTEGER NOT NULL DEFAULT 5 CHECK (max_score > 0),
  weight NUMERIC NOT NULL DEFAULT 1 CHECK (weight > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_audit_items_template
  ON restaurant_audit_items(template_id, sort_order);

-- A single execution of an audit.
CREATE TABLE IF NOT EXISTS restaurant_audits (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES restaurant_audit_templates(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  business_day DATE NOT NULL DEFAULT CURRENT_DATE,
  auditor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  total_score NUMERIC NOT NULL DEFAULT 0,
  max_score NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_restaurant_audits_restaurant
  ON restaurant_audits(restaurant_id, business_day DESC, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_audits_template
  ON restaurant_audits(template_id, status);

-- Per-item scores inside a run. `label` is snapshotted so historical audits
-- stay accurate even if the template changes.
CREATE TABLE IF NOT EXISTS restaurant_audit_scores (
  id BIGSERIAL PRIMARY KEY,
  audit_id BIGINT NOT NULL REFERENCES restaurant_audits(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES restaurant_audit_items(id) ON DELETE SET NULL,
  label VARCHAR(255) NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  max_score INTEGER NOT NULL DEFAULT 5 CHECK (max_score > 0),
  weight NUMERIC NOT NULL DEFAULT 1 CHECK (weight > 0),
  note TEXT,
  UNIQUE (audit_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_audit_scores_audit
  ON restaurant_audit_scores(audit_id);

-- Findings logged during an audit (the "what's wrong" list).
CREATE TABLE IF NOT EXISTS restaurant_audit_findings (
  id BIGSERIAL PRIMARY KEY,
  audit_id BIGINT NOT NULL REFERENCES restaurant_audits(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES restaurant_audit_items(id) ON DELETE SET NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  note TEXT NOT NULL,
  photo_url TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_audit_findings_audit
  ON restaurant_audit_findings(audit_id, severity);

-- Corrective actions: who fixes a finding, by when, and the verification loop.
CREATE TABLE IF NOT EXISTS restaurant_corrective_actions (
  id BIGSERIAL PRIMARY KEY,
  finding_id BIGINT NOT NULL REFERENCES restaurant_audit_findings(id) ON DELETE CASCADE,
  audit_id BIGINT NOT NULL REFERENCES restaurant_audits(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'verified')),
  resolved_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_corrective_actions_audit
  ON restaurant_corrective_actions(audit_id, status);
CREATE INDEX IF NOT EXISTS idx_restaurant_corrective_actions_assignee
  ON restaurant_corrective_actions(assignee_id, status);
