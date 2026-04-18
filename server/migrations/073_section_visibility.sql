-- Add section visibility toggles to helper_profiles
-- Allows helpers to hide sections they haven't completed or that don't apply to them

ALTER TABLE helper_profiles
  ADD COLUMN show_services BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN show_faqs BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN show_policies BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN show_gallery BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN show_hours BOOLEAN NOT NULL DEFAULT true;

-- Create an index for filtering visible sections
CREATE INDEX idx_helper_profiles_visible_sections
  ON helper_profiles(user_id)
  WHERE show_services OR show_faqs OR show_policies OR show_gallery OR show_hours;
