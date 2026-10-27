-- OxSteed Credit licence readiness, part 5: official FX reference rates
-- (readiness review bug 7). The ECB-based provider (Frankfurter) has no
-- Haitian gourde, so HTG quotes failed closed. HTG now uses the Banque de
-- la République d'Haïti (BRH) "taux de référence", fetched from the BRH
-- public page by an in-house adapter, stored here with its publication
-- date, and used only while fresh (fail closed when stale or missing).
-- When BRH is unreachable an operator may enter the published rate by
-- hand; that entry needs two administrators (oversight action).

CREATE TABLE IF NOT EXISTS credit_fx_reference_rates (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR(20) NOT NULL CHECK (source IN ('brh', 'manual')),
  base_currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency CHAR(3) NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  -- Units of quote currency for 1 unit of base (e.g. 130.6474 HTG per USD).
  units_per_base NUMERIC(20, 8) NOT NULL CHECK (units_per_base > 0),
  rate_date DATE NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url TEXT,
  evidence_sha256 CHAR(64),
  entered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  CONSTRAINT credit_fx_reference_manual_two_person
    CHECK (source <> 'manual' OR (entered_by IS NOT NULL AND approved_by IS NOT NULL AND entered_by <> approved_by))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_fx_reference_rate_day
  ON credit_fx_reference_rates (source, base_currency, quote_currency, rate_date);
CREATE INDEX IF NOT EXISTS idx_credit_fx_reference_latest
  ON credit_fx_reference_rates (quote_currency, base_currency, rate_date DESC, fetched_at DESC);
