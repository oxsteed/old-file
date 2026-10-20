-- Migration 949: restaurant team communication (staff review S-17).
--
-- Why: restaurants had no announcements, no read receipts, and no manager
-- log book. Crew shift notes were manager-only free text on the shift row
-- itself, invisible to the next shift. This adds:
--   restaurant_announcements        one post per restaurant, authored by a
--                                   manager, shown to every team member.
--   restaurant_announcement_acks    per-staff acknowledgement (read receipt):
--                                   one row per (announcement, user).
--   restaurant_logbook_entries      the manager log book: short shift notes,
--                                   optionally tied to a crew shift, readable
--                                   by the whole team.

CREATE TABLE IF NOT EXISTS restaurant_announcements (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_announcements_restaurant_created
  ON restaurant_announcements (restaurant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_announcement_acks (
  announcement_id BIGINT NOT NULL REFERENCES restaurant_announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS restaurant_logbook_entries (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id BIGINT REFERENCES restaurant_crew_shifts(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_logbook_restaurant_created
  ON restaurant_logbook_entries (restaurant_id, created_at DESC);
