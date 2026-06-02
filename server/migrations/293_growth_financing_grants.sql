-- Growth tab backend additions for iOS financing and grants buttons.

CREATE TABLE IF NOT EXISTS growth_financing_prequalifications (
  id                  SERIAL PRIMARY KEY,
  user_id             TEXT NOT NULL,
  loan_type           VARCHAR(60) NOT NULL,
  amount_needed       NUMERIC(12,2) NOT NULL,
  months_in_business  INT,
  annual_revenue      NUMERIC(14,2),
  credit_score_band   VARCHAR(40),
  business_type       VARCHAR(60),
  status              VARCHAR(40) NOT NULL DEFAULT 'submitted',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_financing_user_created
  ON growth_financing_prequalifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS growth_grants (
  id             VARCHAR(80) PRIMARY KEY,
  name           VARCHAR(240) NOT NULL,
  sponsor        VARCHAR(160) NOT NULL,
  amount         VARCHAR(120) NOT NULL,
  eligibility    TEXT NOT NULL,
  deadline       VARCHAR(80),
  apply_url      TEXT,
  category       VARCHAR(40) NOT NULL CHECK (category IN ('federal', 'state', 'nonprofit')),
  persona_filter TEXT[],
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_grants_active
  ON growth_grants(is_active, sort_order);

INSERT INTO growth_grants
  (id, name, sponsor, amount, eligibility, deadline, apply_url, category, persona_filter, sort_order)
VALUES
  ('wioa-training', 'Workforce Innovation & Opportunity Act (WIOA)', 'U.S. Dept. of Labor',
   'Up to $10,000', 'Unemployed or underemployed adults seeking vocational training',
   NULL, 'https://www.careeronestop.org/LocalHelp/find-american-job-centers.aspx', 'federal',
   NULL, 10),
  ('sbir', 'Small Business Innovation Research (SBIR)', 'SBA',
   'Up to $275,000', 'Small businesses with innovative product or service ideas',
   NULL, 'https://www.sbir.gov', 'federal',
   ARRAY['business', 'helper'], 20),
  ('mbda', 'Minority Business Development Agency Grants', 'MBDA',
   'Varies by program', 'Minority-owned businesses and entrepreneurs',
   NULL, 'https://www.mbda.gov/grants', 'federal',
   ARRAY['business', 'helper'], 30),
  ('apprenticeship-building-america', 'Apprenticeship Building America', 'U.S. Dept. of Labor',
   'Varies', 'Training programs and employers building apprenticeship pathways',
   NULL, 'https://www.dol.gov/agencies/eta/apprenticeship/grants', 'federal',
   ARRAY['helper', 'business'], 40),
  ('kiva-us', 'Kiva U.S. Microloans', 'Kiva',
   'Up to $15,000', 'Small businesses and entrepreneurs seeking zero-interest community-backed capital',
   NULL, 'https://www.kiva.org/borrow', 'nonprofit',
   NULL, 50),
  ('accion-opportunity-fund', 'Accion Opportunity Fund', 'Accion Opportunity Fund',
   'Loans and advising', 'Small businesses seeking capital, coaching, and financial support',
   NULL, 'https://aofund.org', 'nonprofit',
   NULL, 60)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      sponsor = EXCLUDED.sponsor,
      amount = EXCLUDED.amount,
      eligibility = EXCLUDED.eligibility,
      deadline = EXCLUDED.deadline,
      apply_url = EXCLUDED.apply_url,
      category = EXCLUDED.category,
      persona_filter = EXCLUDED.persona_filter,
      sort_order = EXCLUDED.sort_order,
      is_active = TRUE,
      updated_at = NOW();

