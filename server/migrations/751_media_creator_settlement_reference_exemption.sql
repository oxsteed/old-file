-- Migration 751: exempt Media creator settlements from the settlement-snapshot guard.
--
-- Migration 490 requires every 'settlement' journal transaction to carry
-- reference_type = 'credit_settlement' plus a matching approved/paid row in
-- oxsteed_credit_settlements. That guard was built for partner payouts.
--
-- The Media creator marketplace (migrations 740-749) posts 'settlement'
-- journal transactions with reference types 'media_creator_gig',
-- 'media_creator_sponsorship', 'media_creator_tip', and 'media_post_boost'.
-- Those flows never create oxsteed_credit_settlements rows, so on a fully
-- migrated database every creator settlement, tip, and boost payment fails
-- at INSERT with 'OxSteed Credit settlement transactions require a
-- settlement reference'. The marketplace money flow is dead on arrival.
--
-- Creator settlements already carry equivalent protections without a
-- settlement snapshot:
--   - idempotency keys are UNIQUE and replay-checked (postJournalTransaction
--     uses ON CONFLICT DO NOTHING plus a re-read of the winner);
--   - per-sender/recipient advisory locks serialize concurrent settlements;
--   - migration 750's deferred guard keeps reserved_cents equal to active
--     holds plus active reservations.
-- This migration exempts exactly the four Media creator reference types from
-- the snapshot requirement. Partner-payout settlements keep the full guard.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement RECORD;
BEGIN
  IF NEW.transaction_type <> 'settlement' THEN
    RETURN NEW;
  END IF;

  -- Media creator marketplace settlements carry their own idempotency and
  -- concurrency guards; they are not partner payouts and never reference
  -- oxsteed_credit_settlements.
  IF NEW.reference_type IN (
    'media_creator_gig',
    'media_creator_sponsorship',
    'media_creator_tip',
    'media_post_boost'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.reference_type IS DISTINCT FROM 'credit_settlement'
     OR NULLIF(BTRIM(NEW.reference_id), '') IS NULL THEN
    RAISE EXCEPTION 'OxSteed Credit settlement transactions require a settlement reference'
      USING ERRCODE = '23514';
  END IF;

  SELECT s.id, s.status, s.partner_id, s.agreement_id, s.net_cents, s.currency_code
    INTO settlement
    FROM oxsteed_credit_settlements s
   WHERE s.id::TEXT = NEW.reference_id
   LIMIT 1;

  IF NOT FOUND
     OR settlement.status NOT IN ('approved', 'paid')
     OR settlement.partner_id IS DISTINCT FROM NEW.partner_id
     OR settlement.agreement_id IS DISTINCT FROM NEW.agreement_id
     OR settlement.net_cents IS DISTINCT FROM NEW.amount_cents
     OR settlement.currency_code IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit settlement transactions require a matching approved settlement snapshot'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(CONCAT('oxsteed-credit-settlement-reference:', NEW.reference_id), 0)
  );

  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_transactions existing
     WHERE existing.transaction_type = 'settlement'
       AND existing.status = 'posted'
       AND existing.reference_type = NEW.reference_type
       AND existing.reference_id = NEW.reference_id
       AND existing.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'An OxSteed Credit settlement snapshot already has a posted journal payment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
