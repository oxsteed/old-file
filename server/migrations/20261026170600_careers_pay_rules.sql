-- OxSteed Careers: pay-transparency rules by jurisdiction (careers spec §12.3, Q12, Q15).
--
-- Pay is required on every opening everywhere (enforced in the app and by
-- career_openings_require_pay). This table adds what each jurisdiction
-- needs on top: a benefits description, an application close date, a ban
-- on pay-history questions, gender-neutral titles. It is kept beside
-- jurisdiction_rules (which the growth engine reads) rather than adding
-- rows there, so careers codes such as EU member states or Canadian
-- provinces never change growth behaviour. A lawyer reviews it every
-- quarter; reviewed_at stays NULL until that happens (⚖).
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS career_pay_rules (
  code                    TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  pay_range_required      BOOLEAN NOT NULL DEFAULT TRUE,
  benefits_required       BOOLEAN NOT NULL DEFAULT FALSE,
  close_date_required     BOOLEAN NOT NULL DEFAULT FALSE,
  pay_history_banned      BOOLEAN NOT NULL DEFAULT TRUE,
  gender_neutral_titles   BOOLEAN NOT NULL DEFAULT FALSE,
  internal_promotion_notice BOOLEAN NOT NULL DEFAULT FALSE,
  min_employees           SMALLINT,
  in_force_from           DATE,
  legal_ref               TEXT NOT NULL,
  reviewed_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  updated_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO career_pay_rules (code, benefits_required, close_date_required, internal_promotion_notice, min_employees, in_force_from, legal_ref) VALUES
  ('US-CO', TRUE,  TRUE,  TRUE,  1,  '2021-01-01', 'Colorado Equal Pay for Equal Work Act (C.R.S. 8-5-201), as amended 2024'),
  ('US-NY', FALSE, FALSE, FALSE, 4,  '2023-09-17', 'NY Labor Law 194-b; NYC Admin Code 8-107(32)'),
  ('US-CA', FALSE, FALSE, FALSE, 15, '2023-01-01', 'Cal. Labor Code 432.3 (SB 1162)'),
  ('US-WA', TRUE,  FALSE, FALSE, 15, '2023-01-01', 'RCW 49.58.110'),
  ('US-DC', FALSE, FALSE, FALSE, 1,  '2024-06-30', 'DC Wage Transparency Omnibus Amendment Act 2023'),
  ('US-HI', FALSE, FALSE, FALSE, 50, '2024-01-01', 'HRS 378-2.4'),
  ('US-IL', TRUE,  FALSE, FALSE, 15, '2025-01-01', 'Illinois Equal Pay Act 820 ILCS 112/10(b-25)'),
  ('US-MD', TRUE,  FALSE, FALSE, 1,  '2024-10-01', 'Md. Lab. & Empl. 3-304.2'),
  ('US-MA', FALSE, FALSE, FALSE, 25, '2025-10-29', 'M.G.L. c.149 s.105E'),
  ('US-MN', TRUE,  FALSE, FALSE, 30, '2025-01-01', 'Minn. Stat. 181.173'),
  ('US-NJ', TRUE,  FALSE, TRUE,  10, '2025-06-01', 'N.J.S.A. 34:11-56a46'),
  ('US-VT', FALSE, FALSE, FALSE, 5,  '2025-07-01', '21 V.S.A. 495o'),
  ('US-VA', FALSE, FALSE, FALSE, 1,  '2026-07-01', 'Virginia pay transparency act (2026)'),
  ('US-ME', FALSE, FALSE, FALSE, 10, '2026-07-29', 'Maine pay transparency act (2026)'),
  ('US-CT', FALSE, FALSE, FALSE, 1,  '2026-10-01', 'Connecticut pay transparency amendments (2026)'),
  ('CA-BC', FALSE, FALSE, FALSE, 1,  '2023-11-01', 'BC Pay Transparency Act'),
  ('CA-ON', FALSE, FALSE, FALSE, 25, '2026-01-01', 'Ontario Working for Workers Five Act (range width limits)'),
  ('GB',    FALSE, FALSE, FALSE, NULL, NULL,     'No posting-pay law; OxSteed rule (Q12). Equality Act 2010')
ON CONFLICT (code) DO NOTHING;

-- EU Pay Transparency Directive (EU) 2023/970: starting pay or range before
-- the interview, no pay-history questions, gender-neutral titles.
INSERT INTO career_pay_rules (code, gender_neutral_titles, in_force_from, legal_ref)
SELECT c, TRUE, '2026-06-07', 'Directive (EU) 2023/970; national transposition tracked per country'
  FROM unnest(ARRAY['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']) AS c
ON CONFLICT (code) DO NOTHING;

COMMIT;
