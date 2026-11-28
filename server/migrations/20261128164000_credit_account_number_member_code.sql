-- Credit redesign (D-795/D-796): bank-like account identity for the
-- customer wallet.
--
-- One account number per OxSteed Credit account (one per currency), plus
-- an OxSteed member code per customer in place of a routing number. The
-- member code is never 9 digits and is never called a routing number, so
-- it cannot be confused with a real bank routing number. Both values are
-- minted lazily on first read (get-or-create in oxsteedCreditService.js);
-- this migration only adds the columns, so no backfill runs at deploy
-- time and no existing row changes.
BEGIN;

ALTER TABLE oxsteed_credit_accounts
  ADD COLUMN IF NOT EXISTS account_number VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_account_number
  ON oxsteed_credit_accounts (account_number) WHERE account_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS oxsteed_credit_member_codes (
  customer_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  member_code VARCHAR(8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_member_code
  ON oxsteed_credit_member_codes (member_code);

COMMIT;
