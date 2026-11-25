-- Group 12 Slice 3e (623): brand asset access (D-324).
-- HQ uploads brand assets (logos, templates, guidelines files) for a
-- territory or franchise-wide (application_id NULL); operators browse
-- and download them from the territory ops page. Storage reuses the
-- staff-document vault pattern: a private `franchise-brand-assets/`
-- prefix via uploadFile, downloads only through signed URLs minted at
-- read time (600s), never a public path. The storage key never leaves
-- the server in a payload.
-- Additive only; safe to run twice (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS franchise_brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES franchise_applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  file_size_bytes INT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_brand_assets_application
  ON franchise_brand_assets(application_id, created_at DESC);
