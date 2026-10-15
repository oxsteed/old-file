-- 878_logistics_buyer_quotes.sql
-- Phase 3 (logistics refactor): versioned buyer quotes.
--
-- Every buyer payment is collected against an accepted, current quote.
-- Quotes are versioned per subject (a purchase order OR a pooled-order
-- participant, never both); a new version supersedes the previous one and
-- a buyer must accept before money is collected against a new or
-- increased quote. Amounts are INTEGER minor units (cents); USD only.
-- This table only records the quote; acceptance is captured by
-- accepted_by_user_id / accepted_at (the acceptance action itself is
-- owned by the parallel checkout workstream).

CREATE TABLE IF NOT EXISTS logistics_buyer_quotes (
  id                  SERIAL PRIMARY KEY,
  reference           TEXT UNIQUE NOT NULL,
  subject_type        TEXT NOT NULL
                      CHECK (subject_type IN ('purchase_order', 'pooled_participant')),
  purchase_order_id   INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
  participant_id      INTEGER REFERENCES pooled_order_participants(id) ON DELETE CASCADE,
  version             INTEGER NOT NULL CHECK (version > 0),
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'accepted', 'rejected',
                                       'superseded', 'expired')),
  currency            CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  line_items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_cents      INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  fees_cents          INTEGER NOT NULL DEFAULT 0 CHECK (fees_cents >= 0),
  tax_cents           INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents         INTEGER NOT NULL CHECK (total_cents > 0),
  deposit_cents       INTEGER NOT NULL CHECK (deposit_cents >= 0),
  final_cents         INTEGER NOT NULL CHECK (final_cents >= 0),
  deposit_pct         NUMERIC(5,4),
  deposit_due_at      TIMESTAMPTZ,
  final_due_at        TIMESTAMPTZ,
  cancellation_terms  TEXT,
  valid_until         TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at         TIMESTAMPTZ,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT logistics_quote_single_subject CHECK (
    (purchase_order_id IS NOT NULL AND participant_id IS NULL)
    OR (purchase_order_id IS NULL AND participant_id IS NOT NULL)
  ),
  CONSTRAINT logistics_quote_installments_sum CHECK (deposit_cents + final_cents = total_cents)
);

-- One version number per subject; IDs are positive SERIALs so the
-- COALESCE(..., 0) discriminator can never collide with a real row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_logistics_buyer_quotes_subject_version
  ON logistics_buyer_quotes (subject_type,
                             COALESCE(purchase_order_id, 0),
                             COALESCE(participant_id, 0),
                             version);

CREATE INDEX IF NOT EXISTS idx_logistics_buyer_quotes_po
  ON logistics_buyer_quotes(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_buyer_quotes_participant
  ON logistics_buyer_quotes(participant_id);
CREATE INDEX IF NOT EXISTS idx_logistics_buyer_quotes_status
  ON logistics_buyer_quotes(status);
CREATE INDEX IF NOT EXISTS idx_logistics_buyer_quotes_reference
  ON logistics_buyer_quotes(reference);
