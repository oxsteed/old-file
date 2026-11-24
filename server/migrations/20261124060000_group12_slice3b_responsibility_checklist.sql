-- Group 12 Slice 3b (608): operator responsibility checklist (D-306).
-- The fixed responsibility set an operator accepts for their territory.
-- This is NOT the HQ intake checklist (603): those 8 items are HQ process
-- steps. These 8 are operator responsibilities, each acknowledged by the
-- operator; completion is tracked on the application and shown on the
-- operator dashboard and in HQ. Additive only; safe to run twice
-- (IF NOT EXISTS / ON CONFLICT throughout).

CREATE TABLE IF NOT EXISTS franchise_responsibility_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged')),
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, code)
);

CREATE INDEX IF NOT EXISTS idx_franchise_responsibility_application
  ON franchise_responsibility_items(application_id, sort_order, id);

-- Backfill the fixed set for applications created before this slice.
INSERT INTO franchise_responsibility_items (application_id, code, label, sort_order)
SELECT fa.id, item.code, item.label, item.sort_order
  FROM franchise_applications fa
  CROSS JOIN (VALUES
    ('operate_territory', 'Operate the territory to OxSteed standards', 10),
    ('brand_standards', 'Uphold brand standards and customer experience', 20),
    ('recruit_train_team', 'Recruit and train the opening team', 30),
    ('comply_local_law', 'Comply with local laws and licensing', 40),
    ('report_performance', 'Report performance and keep records current', 50),
    ('honor_agreement_fees', 'Honor the agreement fee and royalty terms', 60),
    ('protect_brand_assets', 'Protect brand assets and confidential information', 70),
    ('resolve_customer_issues', 'Resolve customer issues in the territory promptly', 80)
  ) AS item(code, label, sort_order)
ON CONFLICT (application_id, code) DO NOTHING;
