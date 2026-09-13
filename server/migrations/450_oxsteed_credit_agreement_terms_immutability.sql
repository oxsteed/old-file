-- Migration 450: freeze the terms that define an OxSteed Credit agreement
-- after customers or financial records have relied on it.
--
-- Lifecycle status and approval metadata remain mutable through the normal
-- transition flow. A revised scope must be a new agreement version so old
-- purchases and settlements remain explainable.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_agreement_terms()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_history BOOLEAN;
BEGIN
  IF NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.customer_terms IS DISTINCT FROM OLD.customer_terms
     OR NEW.allowed_order_types IS DISTINCT FROM OLD.allowed_order_types
     OR NEW.allowed_categories IS DISTINCT FROM OLD.allowed_categories
     OR NEW.allowed_menu_item_ids IS DISTINCT FROM OLD.allowed_menu_item_ids
     OR NEW.geography IS DISTINCT FROM OLD.geography
     OR NEW.max_transaction_cents IS DISTINCT FROM OLD.max_transaction_cents
     OR NEW.daily_customer_limit_cents IS DISTINCT FROM OLD.daily_customer_limit_cents
     OR NEW.lifetime_customer_limit_cents IS DISTINCT FROM OLD.lifetime_customer_limit_cents
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.requires_customer_entitlement IS DISTINCT FROM OLD.requires_customer_entitlement
     OR NEW.creation_idempotency_key IS DISTINCT FROM OLD.creation_idempotency_key
     OR NEW.creation_request_hash IS DISTINCT FROM OLD.creation_request_hash
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    SELECT EXISTS (
      SELECT 1 FROM oxsteed_credit_customer_entitlements e
       WHERE e.agreement_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_transactions t
       WHERE t.agreement_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_holds h
       WHERE h.agreement_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_settlements s
       WHERE s.agreement_id = OLD.id
    )
    INTO has_history;

    IF has_history THEN
      RAISE EXCEPTION 'OxSteed Credit agreement terms cannot change after financial activity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_agreement_terms_guard ON oxsteed_credit_partner_agreements;

CREATE TRIGGER oxsteed_credit_agreement_terms_guard
  BEFORE UPDATE OF partner_id, version, starts_at, ends_at, customer_terms,
    allowed_order_types, allowed_categories, allowed_menu_item_ids, geography,
    max_transaction_cents, daily_customer_limit_cents,
    lifetime_customer_limit_cents, metadata, requires_customer_entitlement,
    creation_idempotency_key, creation_request_hash, created_by
  ON oxsteed_credit_partner_agreements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_agreement_terms();
