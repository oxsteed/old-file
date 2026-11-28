-- Credit redesign (D-797/D-803): the account-letter download proves a
-- fresh 'account_letter' step-up challenge. The step-up challenges table
-- carries a CHECK enumerating the allowed action types; extend it with
-- the new type. The full pre-existing list is preserved verbatim.
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
    'credit_card_issue', 'helper_cashout', 'account_letter'
  ));
