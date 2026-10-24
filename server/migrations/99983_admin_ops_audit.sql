-- Admin/operations audit: durable delivery, bounded worker progress, privacy queue,
-- SOS acknowledgement and recoverable runbook history. No live rail is enabled.
ALTER TABLE restaurant_gift_card_fulfillments ADD COLUMN IF NOT EXISTS status_poll_count integer NOT NULL DEFAULT 0;
ALTER TABLE discover_search_alerts ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS discover_alerts_checked ON discover_search_alerts(last_checked_at, id);
ALTER TABLE incident_log ADD COLUMN IF NOT EXISTS notification_claimed_at timestamptz;
ALTER TABLE incident_log ADD COLUMN IF NOT EXISTS dispatch_lease_token uuid;
ALTER TABLE incident_log ADD COLUMN IF NOT EXISTS dispatch_lease_until timestamptz;
-- Prior counters represented claims, not delivery. Requeue open incidents once.
UPDATE incident_log SET notification_claimed_at=NOW(), last_notified_at=NULL, notification_count=0 WHERE resolved_at IS NULL;
ALTER TABLE admin_notification_prefs ADD COLUMN IF NOT EXISTS incident_types text[] NOT NULL DEFAULT ARRAY['*'];
ALTER TABLE admin_notification_prefs ADD COLUMN IF NOT EXISTS safety_on_call boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS safety_sos_events (
 id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 lat double precision, lng double precision, contact_name text, contact_phone text,
 job_id uuid REFERENCES jobs(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT NOW(),
 acknowledged_at timestamptz, acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
 last_escalated_at timestamptz, escalation_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS safety_sos_unacknowledged ON safety_sos_events(created_at) WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS ccpa_erasure_jobs (
 request_id bigint PRIMARY KEY REFERENCES ccpa_data_requests(id) ON DELETE RESTRICT,
 subject_id uuid NOT NULL, requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','needs_review')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
 lease_token uuid, lease_until timestamptz, last_error text, completed_at timestamptz, notification_sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ccpa_erasure_pending ON ccpa_erasure_jobs(next_attempt_at) WHERE status IN ('pending','processing');

CREATE TABLE IF NOT EXISTS ops_runbook_versions (
 id bigserial PRIMARY KEY, runbook_id bigint NOT NULL REFERENCES ops_runbooks(id) ON DELETE RESTRICT,
 version integer NOT NULL, snapshot jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT NOW(),
 UNIQUE(runbook_id, version)
);
INSERT INTO ops_runbook_versions(runbook_id,version,snapshot)
 SELECT id,version,to_jsonb(r) FROM ops_runbooks r ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION record_ops_runbook_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO ops_runbook_versions(runbook_id,version,snapshot) VALUES(NEW.id,NEW.version,to_jsonb(NEW));
 INSERT INTO admin_audit_log(admin_id,action,target_type,target_key,before_state,after_state)
 VALUES(NEW.updated_by,'ops_runbook_' || lower(TG_OP),'ops_runbook',NEW.id::text,
        CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ops_runbook_history ON ops_runbooks;
CREATE TRIGGER ops_runbook_history AFTER INSERT OR UPDATE ON ops_runbooks FOR EACH ROW EXECUTE FUNCTION record_ops_runbook_version();
CREATE OR REPLACE FUNCTION protect_ops_runbook_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Runbook history is append-only'; END $$;
CREATE TRIGGER ops_runbook_versions_immutable BEFORE UPDATE OR DELETE ON ops_runbook_versions FOR EACH ROW EXECUTE FUNCTION protect_ops_runbook_history();

DO $$ DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint
  WHERE conrelid='oxsteed_credit_stepup_challenges'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%action_type%'
 LOOP EXECUTE format('ALTER TABLE oxsteed_credit_stepup_challenges DROP CONSTRAINT %I', constraint_name); END LOOP;
END $$;
ALTER TABLE oxsteed_credit_stepup_challenges ADD CONSTRAINT oxsteed_credit_stepup_challenges_action_type_check
 CHECK (action_type IN ('topup', 'restaurant_topup', 'settlement_payout', 'withdrawal', 'instant_payout', 'agent_job_cancel', 'customer_transfer', 'restaurant_conversion', 'pending_action_approve', 'pending_action_request', 'agent_credit_adjustment_approve', 'compliance_verification_decision', 'compliance_sanction_decision', 'compliance_case_transition', 'credit_account_status_update', 'credit_agreement_create', 'credit_agreement_transition', 'credit_entitlement_upsert', 'restaurant_payout_approve', 'manual_refund', 'food_refund', 'restaurant_topup_approve', 'fee_config_update', 'money_movement_approve', 'settings_change_approve', 'affiliate_payout_process', 'credit_rail_unfreeze', 'credit_card_issue'));

CREATE OR REPLACE FUNCTION revoke_disabled_admin_delegations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.is_active AND NOT NEW.is_active THEN
   UPDATE delegation_grants SET status='revoked',revoked_at=NOW(),revoke_reason='Grantor account disabled'
     WHERE grantor_admin_id=NEW.id AND status='active';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER users_revoke_disabled_delegations AFTER UPDATE OF is_active ON users
 FOR EACH ROW EXECUTE FUNCTION revoke_disabled_admin_delegations();
