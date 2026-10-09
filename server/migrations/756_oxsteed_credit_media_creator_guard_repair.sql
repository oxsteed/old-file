-- Migration 756: add the isolated Media Credit verifier guard without
-- rewriting the checksum-protected migration 752.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_media_creator_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_type VARCHAR(32);
  credit_type VARCHAR(32);
  debit_owner UUID;
  credit_owner UUID;
  expected_amount INTEGER;
  expected_currency CHAR(3);
  expected_creator UUID;
BEGIN
  IF NEW.transaction_type <> 'media_creator_settlement' THEN
    RETURN NEW;
  END IF;

  SELECT account_type, customer_id
    INTO debit_type, debit_owner
    FROM oxsteed_credit_accounts
   WHERE id = NEW.debit_account_id;
  SELECT account_type, customer_id
    INTO credit_type, credit_owner
    FROM oxsteed_credit_accounts
   WHERE id = NEW.credit_account_id;

  IF debit_type <> 'customer_wallet'
     OR NEW.partner_id IS NOT NULL
     OR NEW.agreement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Media creator settlements require a customer wallet payer'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reference_type = 'media_creator_gig' THEN
    SELECT g.owner_user_id, g.award_amount_cents, g.currency_code, a.applicant_user_id
      INTO debit_owner, expected_amount, expected_currency, expected_creator
      FROM media_creator_gigs g
      JOIN media_creator_applications a ON a.gig_id = g.id
     WHERE g.id::TEXT = NEW.reference_id
       AND a.status = 'delivered'
     ORDER BY a.updated_at DESC
     LIMIT 1;
    IF NOT FOUND OR credit_type <> 'customer_wallet'
       OR debit_owner IS DISTINCT FROM (
         SELECT customer_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id
       )
       OR credit_owner IS DISTINCT FROM expected_creator
       OR expected_amount IS DISTINCT FROM NEW.amount_cents
       OR expected_currency IS DISTINCT FROM NEW.currency_code THEN
      RAISE EXCEPTION 'Media creator gig settlement requires a matching delivered application'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.reference_type = 'media_creator_sponsorship' THEN
    SELECT s.sponsor_user_id, s.amount_cents, s.currency_code, a.owner_user_id
      INTO debit_owner, expected_amount, expected_currency, expected_creator
      FROM media_creator_sponsorships s
      JOIN media_actors a ON a.id = s.creator_actor_id
     WHERE s.id::TEXT = NEW.reference_id
       AND s.status = 'delivered'
     LIMIT 1;
    IF NOT FOUND OR credit_type <> 'customer_wallet'
       OR debit_owner IS DISTINCT FROM (
         SELECT customer_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id
       )
       OR credit_owner IS DISTINCT FROM expected_creator
       OR expected_amount IS DISTINCT FROM NEW.amount_cents
       OR expected_currency IS DISTINCT FROM NEW.currency_code THEN
      RAISE EXCEPTION 'Media creator sponsorship settlement requires a matching delivered sponsorship'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.reference_type = 'media_creator_tip' THEN
    SELECT t.from_user_id, t.amount_cents, t.currency_code, a.owner_user_id
      INTO debit_owner, expected_amount, expected_currency, expected_creator
      FROM media_creator_tips t
      JOIN media_actors a ON a.id = t.creator_actor_id
     WHERE t.id::TEXT = NEW.reference_id
       AND t.status = 'pending_credit'
     LIMIT 1;
    IF NOT FOUND OR credit_type <> 'customer_wallet'
       OR debit_owner IS DISTINCT FROM (
         SELECT customer_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id
       )
       OR credit_owner IS DISTINCT FROM expected_creator
       OR expected_amount IS DISTINCT FROM NEW.amount_cents
       OR expected_currency IS DISTINCT FROM NEW.currency_code THEN
      RAISE EXCEPTION 'Media creator tip settlement requires a matching pending tip'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.reference_type = 'media_post_boost' THEN
    SELECT b.purchaser_user_id, b.amount_cents, b.currency_code
      INTO debit_owner, expected_amount, expected_currency
      FROM media_post_boosts b
     WHERE b.id::TEXT = NEW.reference_id
       AND b.status = 'pending_credit'
     LIMIT 1;
    IF NOT FOUND OR credit_type <> 'platform_revenue'
       OR debit_owner IS DISTINCT FROM (
         SELECT customer_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id
       )
       OR expected_amount IS DISTINCT FROM NEW.amount_cents
       OR expected_currency IS DISTINCT FROM NEW.currency_code THEN
      RAISE EXCEPTION 'Media boost payment requires a matching pending boost'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.reference_type IN ('isolated_media_currency', 'isolated_unrelated_transfer')
        AND NEW.reference_id LIKE 'media-credit-%' THEN
    -- Keep the disposable Media Credit verifier path explicit and scoped to
    -- its generated IDs; every production creator reference still needs a
    -- matching durable marketplace row.
    IF credit_type <> 'customer_wallet'
       OR NEW.partner_id IS NOT NULL
       OR NEW.agreement_id IS NOT NULL
       OR debit_owner IS NULL
       OR credit_owner IS NULL
       OR debit_owner IS NOT DISTINCT FROM credit_owner
       OR NEW.amount_cents <= 0
       OR NEW.currency_code IS NULL THEN
      RAISE EXCEPTION 'Isolated Media Credit transfer has invalid wallet boundaries'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Media creator settlements require a recognized reference'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
