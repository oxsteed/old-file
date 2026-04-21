-- 085_add_search_rank_boost.sql
-- Adds the search_rank_boost column to helper_profiles.
-- This column allows admins/platform to manually boost a helper's ranking
-- in the directory. Defaults to 0 (no boost).

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS search_rank_boost INTEGER NOT NULL DEFAULT 0;

