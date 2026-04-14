-- Business Hub: store cover image on businesses (public profile + editor).
-- Previously only helper_profiles had cover_photo_url; business uploads need a column here.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS cover_photo_url TEXT;
