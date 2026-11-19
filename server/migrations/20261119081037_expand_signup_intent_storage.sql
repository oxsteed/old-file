BEGIN;

-- The signup policy registry validates supported intent values. Storage
-- keeps their identifier format while allowing the catalog to evolve.
ALTER TABLE access_signup_intents
  DROP CONSTRAINT IF EXISTS access_signup_intents_intent_check,
  ADD CONSTRAINT access_signup_intents_intent_check
    CHECK (intent ~ '^[a-z][a-z0-9_]*$');

COMMIT;
