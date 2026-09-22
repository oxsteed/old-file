-- Synthetic-only fixture for docker-compose.credit-test.yml.
-- Every identifier is deliberately namespaced by the disposable database.

BEGIN;

INSERT INTO users (
  id, email, password_hash, first_name, last_name, role, email_verified,
  is_active, totp_enabled, preferred_language, terms_accepted,
  onboarding_status, onboarding_completed, contact_completed, profile_completed,
  tier_selected, w9_completed,
  didit_status, didit_verified_at
)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'credit-admin@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Credit', 'Administrator', 'admin', TRUE, TRUE, TRUE, 'en', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'verified', NOW()),
  ('22222222-2222-4222-8222-222222222222', 'credit-approver@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Credit', 'Approver', 'super_admin', TRUE, TRUE, TRUE, 'en', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'verified', NOW()),
  ('33333333-3333-4333-8333-333333333333', 'restaurant-one@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Restaurant', 'Owner One', 'helper', TRUE, TRUE, FALSE, 'en', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'verified', NOW()),
  ('44444444-4444-4444-8444-444444444444', 'restaurant-two@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Restaurant', 'Owner Two', 'helper', TRUE, TRUE, FALSE, 'en', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'verified', NOW()),
  ('55555555-5555-4555-8555-555555555555', 'restaurant-staff@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Restaurant', 'Staff', 'helper', TRUE, TRUE, FALSE, 'en', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'pending', NULL),
  ('66666666-6666-4666-8666-666666666666', 'credit-customer-one@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Credit', 'Customer One', 'customer', TRUE, TRUE, FALSE, 'en', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'verified', NOW()),
  ('77777777-7777-4777-8777-777777777777', 'credit-customer-two@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Credit', 'Customer Two', 'customer', TRUE, TRUE, FALSE, 'es', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'verified', NOW()),
  ('88888888-8888-4888-8888-888888888888', 'credit-unauthorized@example.test', '$2b$10$uB97AVtkmn2LRvMcp6RHjehWMIbNtpoDBNsw6Q/TaihFjBaeXsHha', 'Credit', 'Unauthorized', 'customer', TRUE, TRUE, FALSE, 'fr', TRUE, 'onboarding_complete', TRUE, TRUE, TRUE, TRUE, TRUE, 'pending', NULL)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  is_active = TRUE,
  onboarding_status = EXCLUDED.onboarding_status,
  onboarding_completed = EXCLUDED.onboarding_completed,
  contact_completed = EXCLUDED.contact_completed,
  profile_completed = EXCLUDED.profile_completed,
  tier_selected = EXCLUDED.tier_selected,
  w9_completed = EXCLUDED.w9_completed,
  totp_enabled = EXCLUDED.totp_enabled,
  didit_status = EXCLUDED.didit_status,
  didit_verified_at = EXCLUDED.didit_verified_at;

INSERT INTO businesses (id, user_id, business_name, business_type, is_primary, is_active)
VALUES
  (901, '33333333-3333-4333-8333-333333333333', 'Credit Test Restaurant One LLC', 'llc', TRUE, TRUE),
  (902, '44444444-4444-4444-8444-444444444444', 'Credit Test Restaurant Two LLC', 'llc', TRUE, TRUE),
  (903, '33333333-3333-4333-8333-333333333333', 'Credit Test Restaurant Japan LLC', 'llc', FALSE, TRUE),
  (904, '44444444-4444-4444-8444-444444444444', 'Credit Test Restaurant Kuwait LLC', 'llc', FALSE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  business_name = EXCLUDED.business_name,
  is_active = TRUE;

INSERT INTO food_restaurants (
  id, business_id, owner_user_id, slug, display_name, address_city,
  address_state, address_country, timezone, currency_code, status
)
VALUES
  (901, 901, '33333333-3333-4333-8333-333333333333', 'credit-test-one', 'Credit Test Restaurant One', 'Springfield', 'OH', 'US', 'America/New_York', 'USD', 'active'),
  (902, 902, '44444444-4444-4444-8444-444444444444', 'credit-test-two', 'Credit Test Restaurant Two', 'Springfield', 'OH', 'US', 'America/New_York', 'USD', 'active'),
  (903, 903, '33333333-3333-4333-8333-333333333333', 'credit-test-japan', 'Credit Test Japan', 'Tokyo', '13', 'JP', 'Asia/Tokyo', 'JPY', 'active'),
  (904, 904, '44444444-4444-4444-8444-444444444444', 'credit-test-kuwait', 'Credit Test Kuwait', 'Kuwait City', 'KU', 'KW', 'Asia/Kuwait', 'KWD', 'paused')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  currency_code = EXCLUDED.currency_code;

INSERT INTO oxsteed_credit_partners (
  id, restaurant_id, business_id, status, settlement_currency_code, created_by
)
VALUES
  (901, 901, 901, 'active', 'USD', '22222222-2222-4222-8222-222222222222'),
  (902, 902, 902, 'active', 'USD', '22222222-2222-4222-8222-222222222222'),
  (903, 903, 903, 'active', 'JPY', '22222222-2222-4222-8222-222222222222'),
  (904, 904, 904, 'suspended', 'KWD', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  settlement_currency_code = EXCLUDED.settlement_currency_code;

INSERT INTO oxsteed_credit_partner_agreements (
  id, partner_id, version, status, starts_at, ends_at, customer_terms,
  requires_customer_entitlement, approved_by, created_by
)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 901, 1, 'active', '2026-01-01T00:00:00Z', NULL, 'USD active test agreement', TRUE, '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 902, 1, 'active', '2026-01-01T00:00:00Z', NULL, 'USD second restaurant agreement', TRUE, '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 903, 1, 'active', '2026-01-01T00:00:00Z', NULL, 'JPY active test agreement', TRUE, '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 904, 1, 'suspended', '2026-01-01T00:00:00Z', NULL, 'KWD suspended test agreement', TRUE, NULL, '11111111-1111-4111-8111-111111111111'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 901, 2, 'expired', '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z', 'Expired test agreement', TRUE, NULL, '11111111-1111-4111-8111-111111111111')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  requires_customer_entitlement = EXCLUDED.requires_customer_entitlement,
  approved_by = EXCLUDED.approved_by;

INSERT INTO oxsteed_credit_customer_entitlements (
  customer_id, agreement_id, status, starts_at, ends_at, reason, created_by
)
VALUES
  ('66666666-6666-4666-8666-666666666666', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', '2026-01-01T00:00:00Z', NULL, 'Synthetic active USD access', '11111111-1111-4111-8111-111111111111'),
  ('66666666-6666-4666-8666-666666666666', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'active', '2026-01-01T00:00:00Z', NULL, 'Synthetic active JPY access', '11111111-1111-4111-8111-111111111111'),
  ('77777777-7777-4777-8777-777777777777', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'active', '2026-01-01T00:00:00Z', NULL, 'Synthetic second-customer access', '11111111-1111-4111-8111-111111111111')
ON CONFLICT (customer_id, agreement_id) DO UPDATE SET
  status = EXCLUDED.status,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  reason = EXCLUDED.reason;

INSERT INTO oxsteed_credit_accounts (id, account_type, customer_id, currency_code, balance_cents, status)
VALUES
  (12001, 'customer_wallet', '66666666-6666-4666-8666-666666666666', 'USD', 0, 'active'),
  (12002, 'customer_wallet', '66666666-6666-4666-8666-666666666666', 'JPY', 0, 'active'),
  (12003, 'customer_wallet', '77777777-7777-4777-8777-777777777777', 'USD', 0, 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active';

INSERT INTO food_customer_wallet_accounts (id, restaurant_id, customer_id, currency_code, balance_cents, status)
VALUES (13001, 901, '66666666-6666-4666-8666-666666666666', 'USD', 5000, 'active')
ON CONFLICT (id) DO UPDATE SET balance_cents = 5000, status = 'active';

INSERT INTO food_customer_wallet_ledger (
  id, account_id, restaurant_id, customer_id, entry_type, amount_cents,
  balance_after_cents, currency_code, description, reference_type,
  reference_id, idempotency_key, created_by_user_id
)
SELECT
  13001, 13001, 901, '66666666-6666-4666-8666-666666666666', 'credit', 5000,
  5000, 'USD', 'Synthetic legacy restaurant wallet seed', 'isolated_fixture',
  'credit-test-wallet-1', 'credit-test-wallet-ledger-1', '11111111-1111-4111-8111-111111111111'
WHERE NOT EXISTS (
  SELECT 1 FROM food_customer_wallet_ledger WHERE id = 13001
);

UPDATE feature_flags
   SET is_enabled = FALSE,
       updated_by = NULL,
       updated_at = NOW()
 WHERE key = 'oxsteed_credit_enabled';

SELECT setval(pg_get_serial_sequence('businesses', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM businesses), 1), TRUE);
SELECT setval(pg_get_serial_sequence('food_restaurants', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM food_restaurants), 1), TRUE);
SELECT setval(pg_get_serial_sequence('oxsteed_credit_partners', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM oxsteed_credit_partners), 1), TRUE);
SELECT setval(pg_get_serial_sequence('oxsteed_credit_accounts', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM oxsteed_credit_accounts), 1), TRUE);
SELECT setval(pg_get_serial_sequence('food_customer_wallet_accounts', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM food_customer_wallet_accounts), 1), TRUE);
SELECT setval(pg_get_serial_sequence('food_customer_wallet_ledger', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM food_customer_wallet_ledger), 1), TRUE);

COMMIT;
