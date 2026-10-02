-- Migration 647: treasury workspace (M2).
--
-- Entity accounting: entities, chart of accounts, accounting periods,
-- double-entry journal, and tax-export scaffolding. This is separate from
-- the OxSteed credit rail (migrations 632-642); no money movement here,
-- only bookkeeping. Balances are computed views over journal entries; no
-- automatic adjusting entries are posted by these tables.

CREATE TABLE IF NOT EXISTS treasury_entities (
  id           BIGSERIAL    PRIMARY KEY,
  code         TEXT         NOT NULL UNIQUE,
  name         TEXT         NOT NULL,
  country_code CHAR(2),
  base_currency CHAR(3)     NOT NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treasury_accounts (
  id          BIGSERIAL PRIMARY KEY,
  entity_id   BIGINT    NOT NULL REFERENCES treasury_entities(id) ON DELETE CASCADE,
  code        TEXT      NOT NULL,
  name        TEXT      NOT NULL,
  currency    CHAR(3)   NOT NULL,
  account_type TEXT     NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, code)
);

CREATE TABLE IF NOT EXISTS treasury_periods (
  id          BIGSERIAL    PRIMARY KEY,
  entity_id   BIGINT       NOT NULL REFERENCES treasury_entities(id) ON DELETE CASCADE,
  period_start DATE        NOT NULL,
  period_end   DATE        NOT NULL,
  status      TEXT         NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'closed')),
  closed_at   TIMESTAMPTZ,
  closed_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, period_start),
  CONSTRAINT treasury_periods_valid_range CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS treasury_journal_entries (
  id                BIGSERIAL    PRIMARY KEY,
  entity_id         BIGINT       NOT NULL REFERENCES treasury_entities(id) ON DELETE CASCADE,
  period_id         BIGINT       NOT NULL REFERENCES treasury_periods(id) ON DELETE RESTRICT,
  debit_account_id  BIGINT       NOT NULL REFERENCES treasury_accounts(id) ON DELETE RESTRICT,
  credit_account_id BIGINT       NOT NULL REFERENCES treasury_accounts(id) ON DELETE RESTRICT,
  amount_minor      BIGINT       NOT NULL CHECK (amount_minor > 0),
  currency          CHAR(3)      NOT NULL,
  description       TEXT         NOT NULL,
  reference         TEXT,
  created_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT treasury_journal_distinct_accounts CHECK (debit_account_id <> credit_account_id)
);

CREATE INDEX IF NOT EXISTS idx_treasury_accounts_entity
  ON treasury_accounts (entity_id);

CREATE INDEX IF NOT EXISTS idx_treasury_periods_entity_status
  ON treasury_periods (entity_id, status);

CREATE INDEX IF NOT EXISTS idx_treasury_journal_entity
  ON treasury_journal_entries (entity_id);

CREATE INDEX IF NOT EXISTS idx_treasury_journal_period
  ON treasury_journal_entries (period_id);

CREATE INDEX IF NOT EXISTS idx_treasury_journal_accounts
  ON treasury_journal_entries (debit_account_id, credit_account_id);
