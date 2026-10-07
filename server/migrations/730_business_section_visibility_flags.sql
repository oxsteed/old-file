-- Section visibility flags for business public profiles (parity with the
-- helper_profiles show_* toggles from migration 077). The canonical business
-- public page renders each section only when its flag is true; all default to
-- visible so existing businesses keep their current sections.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS show_services BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_faqs BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_policies BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_gallery BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_hours BOOLEAN NOT NULL DEFAULT true;
