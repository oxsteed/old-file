-- Migration 366: Align active country packs with the launch payment model.
--
-- Stripe remains available as dormant backend infrastructure, but public
-- country configuration must not tell launch clients to render Stripe or
-- escrow flows. Restaurant credit is the native rail; direct settlement and
-- pay-at-restaurant remain available with proof/receipt history.

UPDATE country_packs
   SET config = jsonb_set(
                  jsonb_set(
                    COALESCE(config, '{}'::jsonb),
                    '{payment_methods}',
                    '["restaurant_credit", "direct_payment", "pay_at_restaurant"]'::jsonb,
                    TRUE
                  ),
                  '{trust_model}',
                  '"verified_identity_payment_evidence"'::jsonb,
                  TRUE
                ),
       updated_at = NOW()
 WHERE status = 'active';
