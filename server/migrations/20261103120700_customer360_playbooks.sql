-- Customer 360 upgrade 9: playbook runs. Playbook definitions live in code
-- (server/services/customer360Playbooks.js, versioned); this records each
-- run and step result. Only safe, non-money steps ever execute
-- automatically; money-moving steps are hand-offs to the existing approval
-- flows (two distinct admins) and never execute here.
CREATE TABLE IF NOT EXISTS customer_playbook_runs (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playbook_key VARCHAR(60) NOT NULL,
  playbook_version INTEGER NOT NULL CHECK (playbook_version > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  started_by UUID NOT NULL REFERENCES users(id),
  client_request_id UUID NOT NULL,
  closed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  UNIQUE (started_by, client_request_id)
);
-- One open run per customer and playbook, so two admins cannot run the same
-- automation twice in parallel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_playbook_runs_open
  ON customer_playbook_runs (customer_id, playbook_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_customer_playbook_runs_customer
  ON customer_playbook_runs (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_playbook_run_steps (
  run_id BIGINT NOT NULL REFERENCES customer_playbook_runs(id) ON DELETE CASCADE,
  step_key VARCHAR(60) NOT NULL,
  position SMALLINT NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('check', 'safe_action', 'manual', 'money_handoff')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed', 'skipped', 'handed_off')),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  actor_id UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, step_key)
);
-- The money hand-off can only be marked handed_off, never done.
ALTER TABLE customer_playbook_run_steps DROP CONSTRAINT IF EXISTS customer_playbook_money_never_done;
ALTER TABLE customer_playbook_run_steps ADD CONSTRAINT customer_playbook_money_never_done
  CHECK (kind <> 'money_handoff' OR status IN ('pending', 'handed_off', 'skipped'));
