-- OxSteed Credit licence readiness, part 7: consumer protection (§7).
--
-- 1. Business-day calendar (weekends + per-country holidays) and
--    credit_add_business_days(), used by the dispute clocks.
-- 2. Dispute clocks aligned with the published error-resolution policy:
--    the clock starts when the customer notified us; provisional credit is
--    due after 10 business days (20 for accounts opened in the last 30
--    days); final resolution after 45 calendar days (90 for new accounts);
--    written results notice; provisional-credit reversal only after a
--    notice and 5 business days. A BEFORE INSERT trigger fills the clocks
--    so every opening path (customer, system/chargeback) gets them.
-- 3. Dispute types for wage holders: unauthorized_transfer (P2P) and
--    cashout_not_received.
-- 4. Helper cash-out disputes (cash-out not received) on helper wage
--    balances, with the same clocks; a reissue is a bank instruction that
--    two administrators must approve and two must confirm.
-- 5. Pre-acquisition disclosures (short form, long form, fee schedule,
--    not-insured notice, safeguarding statement, wage terms, error
--    resolution), versioned per language; publishing needs two
--    administrators; acceptances are recorded per user and version.
-- 6. Written consent to receive wages in OxSteed Credit (append-only
--    history; withdrawal at any time).

-- ── 1. Business-day calendar ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_business_holidays (
  country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  holiday_date DATE NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (country_code, holiday_date)
);

-- US Federal Reserve holidays (Regulation E business days) and Haiti
-- public holidays for 2026-2027. Further years and countries are added by
-- administrators (two-person oversight action credit_business_holiday_set).
INSERT INTO credit_business_holidays (country_code, holiday_date, name) VALUES
  ('US', '2026-01-01', 'New Year''s Day'), ('US', '2026-01-19', 'Martin Luther King Jr. Day'),
  ('US', '2026-02-16', 'Washington''s Birthday'), ('US', '2026-05-25', 'Memorial Day'),
  ('US', '2026-06-19', 'Juneteenth'), ('US', '2026-07-03', 'Independence Day (observed)'),
  ('US', '2026-09-07', 'Labor Day'), ('US', '2026-10-12', 'Columbus Day'),
  ('US', '2026-11-11', 'Veterans Day'), ('US', '2026-11-26', 'Thanksgiving Day'),
  ('US', '2026-12-25', 'Christmas Day'),
  ('US', '2027-01-01', 'New Year''s Day'), ('US', '2027-01-18', 'Martin Luther King Jr. Day'),
  ('US', '2027-02-15', 'Washington''s Birthday'), ('US', '2027-05-31', 'Memorial Day'),
  ('US', '2027-06-18', 'Juneteenth (observed)'), ('US', '2027-07-05', 'Independence Day (observed)'),
  ('US', '2027-09-06', 'Labor Day'), ('US', '2027-10-11', 'Columbus Day'),
  ('US', '2027-11-11', 'Veterans Day'), ('US', '2027-11-25', 'Thanksgiving Day'),
  ('US', '2027-12-24', 'Christmas Day (observed)'),
  ('HT', '2026-01-01', 'Independence Day'), ('HT', '2026-01-02', 'Ancestors'' Day'),
  ('HT', '2026-02-16', 'Carnival Monday'), ('HT', '2026-02-17', 'Carnival Tuesday'),
  ('HT', '2026-04-03', 'Good Friday'), ('HT', '2026-05-01', 'Labour Day'),
  ('HT', '2026-05-18', 'Flag Day'), ('HT', '2026-06-04', 'Corpus Christi'),
  ('HT', '2026-08-15', 'Assumption'), ('HT', '2026-10-17', 'Dessalines Day'),
  ('HT', '2026-11-01', 'All Saints'' Day'), ('HT', '2026-11-02', 'Day of the Dead'),
  ('HT', '2026-11-18', 'Battle of Vertières'), ('HT', '2026-12-25', 'Christmas Day'),
  ('HT', '2027-01-01', 'Independence Day'), ('HT', '2027-01-02', 'Ancestors'' Day'),
  ('HT', '2027-02-08', 'Carnival Monday'), ('HT', '2027-02-09', 'Carnival Tuesday'),
  ('HT', '2027-03-26', 'Good Friday'), ('HT', '2027-05-01', 'Labour Day'),
  ('HT', '2027-05-18', 'Flag Day'), ('HT', '2027-05-27', 'Corpus Christi'),
  ('HT', '2027-08-15', 'Assumption'), ('HT', '2027-10-17', 'Dessalines Day'),
  ('HT', '2027-11-01', 'All Saints'' Day'), ('HT', '2027-11-02', 'Day of the Dead'),
  ('HT', '2027-11-18', 'Battle of Vertières'), ('HT', '2027-12-25', 'Christmas Day')
ON CONFLICT DO NOTHING;

-- Adds n business days (Mon-Fri, not a holiday in the calendar) to the
-- start instant, keeping its UTC time of day. A country without its own
-- holidays uses weekends only.
CREATE OR REPLACE FUNCTION credit_add_business_days(start_at TIMESTAMPTZ, days INTEGER, calendar CHAR(2))
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  d DATE := (start_at AT TIME ZONE 'UTC')::date;
  added INTEGER := 0;
BEGIN
  IF start_at IS NULL THEN RETURN NULL; END IF;
  IF days IS NULL OR days <= 0 THEN RETURN start_at; END IF;
  WHILE added < days LOOP
    d := d + 1;
    IF EXTRACT(ISODOW FROM d) < 6
       AND NOT EXISTS (SELECT 1 FROM credit_business_holidays h WHERE h.country_code = calendar AND h.holiday_date = d) THEN
      added := added + 1;
    END IF;
  END LOOP;
  RETURN (d + ((start_at AT TIME ZONE 'UTC')::time)) AT TIME ZONE 'UTC';
END;
$$;

-- ── 2/3. Dispute clocks and types ──────────────────────────────────────
ALTER TABLE oxsteed_credit_disputes
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS business_calendar CHAR(2),
  ADD COLUMN IF NOT EXISTS extended_window BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provisional_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisional_overdue_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisional_auto_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_deadline_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS results_notice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS results_notice_result JSONB,
  ADD COLUMN IF NOT EXISTS provisional_reversal_notice_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisional_reversal_effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisional_reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisional_reversal_flagged_at TIMESTAMPTZ;

ALTER TABLE oxsteed_credit_disputes DROP CONSTRAINT IF EXISTS oxsteed_credit_disputes_dispute_type_check;
ALTER TABLE oxsteed_credit_disputes ADD CONSTRAINT oxsteed_credit_disputes_dispute_type_check
  CHECK (dispute_type IS NULL OR dispute_type IN (
    'unauthorized_topup', 'failed_payout', 'duplicate_charge', 'incorrect_amount', 'chargeback',
    'unauthorized_transfer', 'cashout_not_received'
  ));

CREATE OR REPLACE FUNCTION credit_dispute_window(customer UUID, notified TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  -- Regulation E style extended window: the account was opened within the
  -- 30 days before the customer notified us.
  SELECT COALESCE(MIN(a.created_at) > notified - INTERVAL '30 days', FALSE)
    FROM oxsteed_credit_accounts a
   WHERE a.customer_id = customer AND a.account_type = 'customer_wallet';
$$;

CREATE OR REPLACE FUNCTION credit_dispute_calendar(customer UUID)
RETURNS CHAR(2)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN u.country ~ '^[A-Za-z]{2}$' THEN UPPER(u.country) END FROM users u WHERE u.id = customer),
    'US')::CHAR(2);
$$;

CREATE OR REPLACE FUNCTION set_credit_dispute_clocks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.notified_at := COALESCE(NEW.notified_at, NEW.opened_at, NOW());
  NEW.business_calendar := COALESCE(NEW.business_calendar, credit_dispute_calendar(NEW.customer_id));
  NEW.extended_window := credit_dispute_window(NEW.customer_id, NEW.notified_at);
  NEW.provisional_due_at := COALESCE(NEW.provisional_due_at,
    credit_add_business_days(NEW.notified_at, CASE WHEN NEW.extended_window THEN 20 ELSE 10 END, NEW.business_calendar));
  NEW.resolution_due_at := COALESCE(NEW.resolution_due_at,
    NEW.notified_at + CASE WHEN NEW.extended_window THEN INTERVAL '90 days' ELSE INTERVAL '45 days' END);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_dispute_clocks ON oxsteed_credit_disputes;
CREATE TRIGGER credit_dispute_clocks
  BEFORE INSERT ON oxsteed_credit_disputes
  FOR EACH ROW EXECUTE FUNCTION set_credit_dispute_clocks();

-- Backfill open disputes (the integrity trigger re-validates the row on
-- UPDATE; only clock columns change).
UPDATE oxsteed_credit_disputes d
   SET notified_at = d.opened_at,
       business_calendar = credit_dispute_calendar(d.customer_id),
       extended_window = credit_dispute_window(d.customer_id, d.opened_at),
       provisional_due_at = credit_add_business_days(d.opened_at,
         CASE WHEN credit_dispute_window(d.customer_id, d.opened_at) THEN 20 ELSE 10 END,
         credit_dispute_calendar(d.customer_id)),
       resolution_due_at = d.opened_at + CASE WHEN credit_dispute_window(d.customer_id, d.opened_at) THEN INTERVAL '90 days' ELSE INTERVAL '45 days' END
 WHERE d.notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_credit_disputes_clock_open
  ON oxsteed_credit_disputes (provisional_due_at, resolution_due_at)
  WHERE status IN ('open', 'in_review');
CREATE INDEX IF NOT EXISTS idx_credit_disputes_notice_pending
  ON oxsteed_credit_disputes (resolved_at)
  WHERE results_notice_sent_at IS NULL AND resolved_at IS NOT NULL;

-- ── 4. Helper cash-out disputes ────────────────────────────────────────
ALTER TABLE credit_bank_payout_instructions DROP CONSTRAINT IF EXISTS credit_bank_payout_instructions_purpose_check;
ALTER TABLE credit_bank_payout_instructions ADD CONSTRAINT credit_bank_payout_instructions_purpose_check
  CHECK (purpose IN ('cashout', 'micro_deposit', 'verification_code', 'redemption', 'cashout_reissue'));
ALTER TABLE credit_bank_payout_instructions DROP CONSTRAINT IF EXISTS credit_bank_payout_purpose_link;
ALTER TABLE credit_bank_payout_instructions ADD CONSTRAINT credit_bank_payout_purpose_link
  CHECK (purpose NOT IN ('cashout', 'cashout_reissue') OR cashout_id IS NOT NULL);

CREATE TABLE IF NOT EXISTS credit_cashout_disputes (
  id BIGSERIAL PRIMARY KEY,
  cashout_id BIGINT NOT NULL REFERENCES credit_cashout_requests(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved_paid_confirmed', 'resolved_reissued', 'rejected')),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_calendar CHAR(2) NOT NULL DEFAULT 'US',
  acknowledge_due_at TIMESTAMPTZ NOT NULL,
  resolution_due_at TIMESTAMPTZ NOT NULL,
  final_deadline_flagged_at TIMESTAMPTZ,
  resolution TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  reissue_instruction_id BIGINT REFERENCES credit_bank_payout_instructions(id) ON DELETE RESTRICT,
  results_notice_sent_at TIMESTAMPTZ,
  results_notice_result JSONB,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_cashout_dispute_resolution_evidence CHECK (
    status IN ('open', 'investigating')
    OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND NULLIF(btrim(resolution), '') IS NOT NULL)
  ),
  CONSTRAINT credit_cashout_dispute_reissue_link CHECK (status <> 'resolved_reissued' OR reissue_instruction_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_cashout_dispute_active
  ON credit_cashout_disputes (cashout_id) WHERE status IN ('open', 'investigating');
CREATE INDEX IF NOT EXISTS idx_credit_cashout_disputes_user ON credit_cashout_disputes (user_id, created_at DESC);

-- ── 5. Disclosures ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_disclosure_versions (
  id BIGSERIAL PRIMARY KEY,
  disclosure_kind VARCHAR(40) NOT NULL CHECK (disclosure_kind IN (
    'short_form', 'long_form', 'fee_schedule', 'not_insured', 'safeguarding', 'wage_payment_terms', 'error_resolution'
  )),
  language VARCHAR(5) NOT NULL CHECK (language IN ('en', 'es', 'fr', 'ht', 'ar')),
  version INTEGER NOT NULL CHECK (version > 0),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'retired')),
  approved_reference VARCHAR(160) NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  UNIQUE (disclosure_kind, language, version),
  CONSTRAINT credit_disclosure_two_person CHECK (requested_by <> published_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_disclosure_current
  ON credit_disclosure_versions (disclosure_kind, language) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS credit_disclosure_acceptances (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disclosure_kind VARCHAR(40) NOT NULL,
  language VARCHAR(5) NOT NULL,
  -- NULL when the user accepted the built-in placeholder text (recorded by
  -- its content hash) before counsel published a version.
  disclosure_version_id BIGINT REFERENCES credit_disclosure_versions(id) ON DELETE RESTRICT,
  content_sha256 CHAR(64) NOT NULL,
  context VARCHAR(40) NOT NULL DEFAULT 'pre_acquisition'
    CHECK (context IN ('pre_acquisition', 'wage_consent', 'update', 'cashout')),
  request_ip VARCHAR(64),
  user_agent VARCHAR(300),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, disclosure_kind, content_sha256)
);
CREATE INDEX IF NOT EXISTS idx_credit_disclosure_acceptances_user ON credit_disclosure_acceptances (user_id, accepted_at DESC);

-- ── 6. Wage-payment consent ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_wage_payment_consents (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('granted', 'withdrawn')),
  -- What the worker chose instead of Credit when withdrawing (recorded for
  -- the payroll file; OxSteed does not run payroll itself).
  alternative_method VARCHAR(40) CHECK (alternative_method IS NULL OR alternative_method IN ('bank_transfer', 'cash', 'check', 'other')),
  terms_content_sha256 CHAR(64) NOT NULL,
  terms_version_id BIGINT REFERENCES credit_disclosure_versions(id) ON DELETE RESTRICT,
  language VARCHAR(5) NOT NULL,
  request_ip VARCHAR(64),
  user_agent VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_wage_consent_user ON credit_wage_payment_consents (user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION credit_wage_consent_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Rows go only with their user (ON DELETE CASCADE after account
  -- deletion): by then the parent row is no longer visible.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Wage-payment consent history is append-only' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS credit_wage_consent_append_only ON credit_wage_payment_consents;
CREATE TRIGGER credit_wage_consent_append_only
  BEFORE UPDATE OR DELETE ON credit_wage_payment_consents
  FOR EACH ROW EXECUTE FUNCTION credit_wage_consent_append_only();
