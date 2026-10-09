-- Migration 752: isolate Media creator payouts from restaurant settlements.
--
-- Restaurant settlement rows are snapshots in oxsteed_credit_settlements and
-- remain guarded by the historical settlement triggers. Media creator payouts
-- use the shared append-only journal but have their own durable marketplace
-- records, so they need a distinct transaction type and reference guard.

ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;

ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'media_creator_settlement', 'settlement_reversal', 'fee', 'expiration',
    'chargeback', 'funding', 'reserve_release', 'conversion_debit',
    'conversion_fee', 'conversion_credit', 'cash_out', 'sub_bank_load',
    'sub_bank_redemption', 'sub_bank_refund', 'sub_bank_opening_balance',
    'withdrawal_fee', 'transfer_fee', 'sub_bank_conversion', 'sub_bank_payout',
    'sub_bank_payout_reversal'
  ));

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
  ELSE
    RAISE EXCEPTION 'Media creator settlements require a recognized reference'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_media_creator_settlement_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_media_creator_settlement_guard
  BEFORE INSERT OR UPDATE OF transaction_type, status, debit_account_id,
    credit_account_id, amount_cents, currency_code, partner_id, agreement_id,
    reference_type, reference_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_media_creator_settlement();
