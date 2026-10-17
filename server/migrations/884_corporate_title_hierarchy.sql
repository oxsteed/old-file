-- Migration 884: position hierarchy for the org chart tree view.
--
-- Adds reports_to_title_id to corporate_titles so the org chart can render a
-- true reporting tree from positions (not just assigned people). A title tree
-- is useful before anyone is hired: vacant positions still appear, overlaid
-- with the assigned person when one exists.
--
-- The CEO title is the root (reports_to_title_id IS NULL).

BEGIN;

ALTER TABLE corporate_titles
  ADD COLUMN IF NOT EXISTS reports_to_title_id INTEGER
    REFERENCES corporate_titles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_corp_titles_reports_to
  ON corporate_titles (reports_to_title_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_corp_titles_no_self_report'
  ) THEN
    ALTER TABLE corporate_titles
      ADD CONSTRAINT chk_corp_titles_no_self_report
      CHECK (reports_to_title_id IS NULL OR reports_to_title_id <> id);
  END IF;
END $$;

-- Seed the reporting lines, grouped by parent title.
-- Executive
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'ceo'
   AND child.code IN ('coo','cfo','cto','cmo','cpo','general_counsel',
                      'vp_people','data_science_manager','innovation_lead','ea_to_ceo');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'coo'
   AND child.code IN ('vp_strategy_bizdev','vp_operations','director_operations');

-- Technology
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'cto'
   AND child.code IN ('vp_engineering','director_platform_arch');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'vp_engineering'
   AND child.code IN ('engineering_manager','ai_ml_engineer','technical_program_manager');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'director_platform_arch'
   AND child.code IN ('devops_sre','database_administrator','security_engineer');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'engineering_manager'
   AND child.code IN ('senior_fullstack_developer','backend_engineer','frontend_engineer',
                      'mobile_app_developer','qa_engineer','it_support_specialist');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'cpo'
   AND child.code IN ('product_manager_platform');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'product_manager_platform'
   AND child.code IN ('ux_ui_designer');

-- Operations
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'director_operations'
   AND child.code IN ('operations_manager','customer_success_manager',
                      'verification_compliance');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'operations_manager'
   AND child.code IN ('marketplace_ops_associate','helper_onboarding',
                      'escrow_payments_coordinator','logistics_coordinator');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'customer_success_manager'
   AND child.code IN ('customer_support_lead');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'customer_support_lead'
   AND child.code IN ('support_rep_tier1','support_rep_tier2');

-- Marketing
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'cmo'
   AND child.code IN ('director_marketing');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'director_marketing'
   AND child.code IN ('growth_marketing_manager','content_marketing_manager',
                      'brand_creative_director','partnerships_manager');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'growth_marketing_manager'
   AND child.code IN ('performance_marketing_spec','seo_sem_specialist');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'content_marketing_manager'
   AND child.code IN ('social_media_manager');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'social_media_manager'
   AND child.code IN ('community_manager');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'brand_creative_director'
   AND child.code IN ('copywriter');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'partnerships_manager'
   AND child.code IN ('sales_dev_representative');

-- Finance, Legal & Compliance
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'cfo'
   AND child.code IN ('controller','treasury_manager','risk_manager');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'controller'
   AND child.code IN ('accounting_manager','financial_analyst');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'accounting_manager'
   AND child.code IN ('payroll_specialist');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'general_counsel'
   AND child.code IN ('compliance_officer','contract_administrator');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'compliance_officer'
   AND child.code IN ('kyc_aml_analyst','insurance_licensing_coord');

-- People
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'vp_people'
   AND child.code IN ('talent_acquisition','hr_generalist','office_facilities_manager');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'office_facilities_manager'
   AND child.code IN ('admin_coordinator');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'admin_coordinator'
   AND child.code IN ('data_entry_clerk');

-- Data
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'data_science_manager'
   AND child.code IN ('bi_analyst','data_engineer','user_researcher');

-- Legal track (migration 279)
UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'ceo'
   AND child.code IN ('chief_legal_officer');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'chief_legal_officer'
   AND child.code IN ('legal_counsel');

UPDATE corporate_titles AS child SET reports_to_title_id = parent.id
  FROM corporate_titles AS parent
 WHERE parent.code = 'legal_counsel'
   AND child.code IN ('contracts_manager','privacy_regulatory_manager',
                      'legal_operations_manager');

COMMIT;
