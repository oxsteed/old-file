-- Credit redesign checkpoint 3 (D-800): the card-security step-up covers
-- three new actions — reveal, security-code reset, and limits. The
-- challenges table carries a CHECK enumerating the allowed actions;
-- extend it with the new ones. The pre-existing list is preserved verbatim.
ALTER TABLE oxsteed_credit_card_security_challenges
  DROP CONSTRAINT IF EXISTS oxsteed_credit_card_security_challenges_action_check;
ALTER TABLE oxsteed_credit_card_security_challenges
  ADD CONSTRAINT oxsteed_credit_card_security_challenges_action_check
  CHECK (action IN ('unfreeze', 'activate', 'pin_set', 'reveal', 'security_code_reset', 'limits_set'));
