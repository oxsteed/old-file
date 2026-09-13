-- Migration 477: bind Credit transaction actor labels to real users.
--
-- System and integration actors may remain unlinked. Human actor labels must
-- resolve to an active user with the role implied by the label.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_actor_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_is_valid BOOLEAN;
BEGIN
  IF NEW.actor_type = 'admin' THEN
    SELECT EXISTS (
      SELECT 1
        FROM users
       WHERE id = NEW.actor_user_id
         AND is_active = TRUE
         AND role IN ('admin', 'super_admin')
    ) INTO actor_is_valid;
  ELSIF NEW.actor_type IN ('user', 'customer') THEN
    SELECT EXISTS (
      SELECT 1
        FROM users
       WHERE id = NEW.actor_user_id
         AND is_active = TRUE
         AND role = 'customer'
    ) INTO actor_is_valid;
  ELSE
    RETURN NEW;
  END IF;

  IF NOT actor_is_valid THEN
    RAISE EXCEPTION 'OxSteed Credit transaction actor does not match an active user role'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_actor_identity_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_actor_identity_guard
  BEFORE INSERT OR UPDATE OF actor_type, actor_user_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_actor_identity();
