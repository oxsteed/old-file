-- Auth audit item 11: distinguish a first in-window refresh-token replay
-- (possible double-submit after a dropped response) from a confirmed
-- rotation replay. The first in-window replay stamps this column; a
-- second replay with the marker set revokes the token family regardless
-- of grace age. Rows created before this migration have NULL (treated as
-- "not noted", i.e. the next in-window replay is treated as the first).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS refresh_replay_noted_at TIMESTAMPTZ;
