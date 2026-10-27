-- OxSteed Credit licence readiness, part 4: shared compliance foundations.
--
-- 1. Compliance case types for the new monitoring rules (payout destination
--    review, cash-out review, helper balance, cross-border, device/account
--    linkage, shared destination, large payout, KYC re-verification,
--    safeguarding shortfall, SAR candidate, dispute pattern).
-- 3. Step-up action type 'helper_cashout' (large helper cash-outs).
-- 2. credit_notice_overrides: counsel-approved wording for customer notices
--    (dormancy, wind-down, dispute rights, destination verification) per
--    language, editable without a deploy. Code ships placeholder wording.

ALTER TABLE oxsteed_credit_compliance_cases
  DROP CONSTRAINT IF EXISTS oxsteed_credit_compliance_cases_case_type_check;
ALTER TABLE oxsteed_credit_compliance_cases
  ADD CONSTRAINT oxsteed_credit_compliance_cases_case_type_check
  CHECK (case_type IN (
    'structuring', 'velocity_spike', 'rapid_fund_out', 'new_destination_payout',
    'sanctions_hit', 'manual',
    'payout_destination_review', 'cashout_review', 'helper_balance_anomaly',
    'cross_border_pattern', 'device_linkage', 'shared_destination', 'large_payout',
    'kyc_reverification', 'safeguarding_shortfall', 'sar_candidate', 'dispute_pattern'
  ));

CREATE TABLE IF NOT EXISTS credit_notice_overrides (
  id BIGSERIAL PRIMARY KEY,
  notice_key VARCHAR(60) NOT NULL,
  language VARCHAR(5) NOT NULL CHECK (language IN ('en', 'es', 'fr', 'ht', 'ar')),
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  approved_reference VARCHAR(160),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notice_overrides_active
  ON credit_notice_overrides (notice_key, language) WHERE active = TRUE;

-- ── Step-up: helper cash-out ────────────────────────────────────────────
ALTER TABLE oxsteed_credit_stepup_challenges
  DROP CONSTRAINT IF EXISTS oxsteed_credit_stepup_challenges_action_type_check;
ALTER TABLE oxsteed_credit_stepup_challenges
  ADD CONSTRAINT oxsteed_credit_stepup_challenges_action_type_check
  CHECK (action_type IN (
    'topup', 'restaurant_topup', 'settlement_payout', 'withdrawal', 'instant_payout',
    'agent_job_cancel', 'customer_transfer', 'restaurant_conversion',
    'pending_action_approve', 'pending_action_request', 'agent_credit_adjustment_approve',
    'compliance_verification_decision', 'compliance_sanction_decision', 'compliance_case_transition',
    'credit_account_status_update', 'credit_agreement_create', 'credit_agreement_transition',
    'credit_entitlement_upsert', 'restaurant_payout_approve', 'manual_refund', 'food_refund',
    'restaurant_topup_approve', 'fee_config_update', 'money_movement_approve',
    'settings_change_approve', 'affiliate_payout_process', 'credit_rail_unfreeze',
    'credit_card_issue', 'helper_cashout'
  ));
