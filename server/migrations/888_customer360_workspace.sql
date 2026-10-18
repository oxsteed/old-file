-- Customer 360 operational tasks and explicit, opt-in watch rules.
-- No financial tables, authorization rules, or existing migrations are changed.
CREATE TABLE IF NOT EXISTS admin_customer_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID NOT NULL REFERENCES users(id),
 title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
 status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
 assigned_to UUID NOT NULL REFERENCES users(id), created_by UUID NOT NULL REFERENCES users(id),
 due_at TIMESTAMPTZ, resolution TEXT, related_source TEXT, related_id TEXT,
 idempotency_key UUID NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
 UNIQUE(created_by,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_customer_tasks_customer ON admin_customer_tasks(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_tasks_due ON admin_customer_tasks(due_at) WHERE status IN ('open','in_progress');
CREATE TABLE IF NOT EXISTS admin_customer_alert_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id UUID NOT NULL REFERENCES users(id),
 customer_id UUID NOT NULL REFERENCES users(id), source TEXT NOT NULL, statuses TEXT[] NOT NULL,
 min_age_minutes INTEGER NOT NULL DEFAULT 0 CHECK(min_age_minutes BETWEEN 0 AND 43200),
 enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_evaluated_at TIMESTAMPTZ, UNIQUE(admin_id,customer_id,source)
);
CREATE INDEX IF NOT EXISTS idx_customer_alert_rules_due ON admin_customer_alert_rules(last_evaluated_at) WHERE enabled;
