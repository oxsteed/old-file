-- Migration 725: credit_participants (Credit Everywhere Phase 1).
--
-- OxSteed Credit partners were restaurant-only
-- (oxsteed_credit_partners.restaurant_id NOT NULL UNIQUE). The Credit
-- Everywhere design requires a separate participant table with polymorphic
-- subject types, so non-restaurant payees (helpers, businesses, QR
-- merchants, subscription sellers, ...) can be onboarded as admin-approved
-- participants linked to a partner.
--
-- LOCKED design decisions applied here:
--   - Separate participant table linking to partners (not nullable
--     restaurant_id on the partner row).
--   - Participant lifecycle: pending -> active -> suspended -> revoked,
--     mirroring the partner lifecycle (terminated maps to revoked).
--   - Didit mandatory before a participant is active. The backfill below
--     derives didit_verified from the subject owner's actual Didit status;
--     participants whose owners are not Didit-verified will NOT pass
--     assertParticipantActive until they complete verification. This is an
--     intentional breaking change per the locked design.
--
-- Backfill: one participant per existing partner (type=restaurant, since
-- restaurant_id is NOT NULL on every partner row). Default surfaces for
-- restaurants: food_online, food_pos, chat.

CREATE TABLE IF NOT EXISTS credit_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id BIGINT NOT NULL REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  participant_type TEXT NOT NULL CHECK (participant_type IN (
    'restaurant', 'business', 'helper', 'subscription_merchant', 'qr_merchant',
    'delivery_merchant', 'consulting_seller', 'invoice_seller',
    'product_seller', 'rental_seller'
  )),
  -- Polymorphic subject linkage. Exactly one subject column must be set,
  -- enforced per participant_type by the CHECK below.
  restaurant_id BIGINT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  business_id INTEGER NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  -- LOCKED: Didit mandatory before active. A verified flag without a
  -- timestamp is a data bug.
  didit_verified BOOLEAN NOT NULL DEFAULT FALSE,
  didit_verified_at TIMESTAMPTZ,
  allowed_surfaces TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    CHECK (allowed_surfaces <@ ARRAY[
      'food_online', 'food_pos', 'chat', 'jobs', 'direct', 'qr',
      'subscriptions', 'delivery', 'consulting', 'invoices',
      'products', 'rentals'
    ]::TEXT[]),
  max_ticket_cents BIGINT CHECK (max_ticket_cents IS NULL OR max_ticket_cents > 0),
  daily_cap_cents BIGINT CHECK (daily_cap_cents IS NULL OR daily_cap_cents > 0),
  lifetime_cap_cents BIGINT CHECK (lifetime_cap_cents IS NULL OR lifetime_cap_cents > 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (participant_type = 'restaurant'
      AND restaurant_id IS NOT NULL AND business_id IS NULL AND user_id IS NULL)
    OR (participant_type IN ('business', 'delivery_merchant')
      AND business_id IS NOT NULL AND restaurant_id IS NULL AND user_id IS NULL)
    OR (participant_type IN ('helper', 'consulting_seller')
      AND user_id IS NOT NULL AND restaurant_id IS NULL AND business_id IS NULL)
    OR (participant_type IN ('subscription_merchant', 'qr_merchant', 'invoice_seller', 'product_seller', 'rental_seller')
      AND (
        (business_id IS NOT NULL AND restaurant_id IS NULL AND user_id IS NULL)
        OR (user_id IS NOT NULL AND restaurant_id IS NULL AND business_id IS NULL)
      ))
  ),
  CHECK (didit_verified = FALSE OR didit_verified_at IS NOT NULL),
  UNIQUE (partner_id, participant_type)
);

-- One participant per subject per type (prevents duplicate onboarding).
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_participants_restaurant
  ON credit_participants (participant_type, restaurant_id)
  WHERE restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_participants_business
  ON credit_participants (participant_type, business_id)
  WHERE business_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_participants_user
  ON credit_participants (participant_type, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_participants_partner
  ON credit_participants (partner_id);
CREATE INDEX IF NOT EXISTS idx_credit_participants_type_status
  ON credit_participants (participant_type, status);

-- Backfill: one restaurant participant per existing partner. Status maps
-- from the partner lifecycle (terminated -> revoked). Didit is derived
-- from the restaurant owner's actual verification status; unverified
-- owners get didit_verified = FALSE and the participant will not pass
-- the active gate until they verify (locked design).
INSERT INTO credit_participants (
  partner_id, participant_type, restaurant_id,
  status, didit_verified, didit_verified_at, allowed_surfaces
)
SELECT
  p.id,
  'restaurant',
  p.restaurant_id,
  CASE p.status WHEN 'terminated' THEN 'revoked' ELSE p.status END,
  COALESCE(owner.didit_status = 'verified', FALSE),
  CASE WHEN owner.didit_status = 'verified' THEN owner.didit_verified_at ELSE NULL END,
  ARRAY['food_online', 'food_pos', 'chat']::TEXT[]
FROM oxsteed_credit_partners p
LEFT JOIN food_restaurants fr ON fr.id = p.restaurant_id
LEFT JOIN users owner ON owner.id = fr.owner_user_id
ON CONFLICT (partner_id, participant_type) DO NOTHING;
