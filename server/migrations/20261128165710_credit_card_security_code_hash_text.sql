-- Credit redesign checkpoint 3 follow-up: the security-code hash uses
-- the same `$scrypt$` format as the PIN hash, which is ~170 characters —
-- too long for the CHAR(64) the closed-loop migration declared. Widen
-- it to TEXT, matching the pin_hash column.
ALTER TABLE oxsteed_credit_cards ALTER COLUMN security_code_hash TYPE TEXT;
