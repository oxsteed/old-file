-- D10: campaigns must declare whether their audience and offer are
-- personalized. Existing campaigns retain the safe personalized default.
ALTER TABLE offer_campaigns
  ADD COLUMN IF NOT EXISTS is_personalized BOOLEAN NOT NULL DEFAULT TRUE;
