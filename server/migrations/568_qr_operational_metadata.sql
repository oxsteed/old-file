-- Operational QR label metadata for warehouse and restaurant teams.
-- The QR payload remains authoritative on the generated image; these fields
-- make saved codes searchable and reusable in the visual management studio.

BEGIN;

ALTER TABLE qr_codes
  ADD COLUMN IF NOT EXISTS workspace VARCHAR(32) NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS template_key VARCHAR(64) NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS label_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_qr_codes_user_workspace
  ON qr_codes(user_id, workspace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_codes_user_template
  ON qr_codes(user_id, template_key, created_at DESC);

COMMIT;
