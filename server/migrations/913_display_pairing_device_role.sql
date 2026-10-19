-- Migration 913: display device roles (round-2 review fixes).
--
-- A pairing token must only authorize the surface its physical display
-- belongs to. The kitchen ticket feed and ticket actions require the
-- 'kitchen' role; queue-board and kiosk tokens must never reach them.
-- Existing rows (paired before roles existed) default to 'kiosk', which is
-- the fail-closed choice for the kitchen surface: those displays keep
-- working for public boards but cannot touch kitchen tickets until an
-- owner re-claims them with the kitchen role.

ALTER TABLE display_pairings
  ADD COLUMN IF NOT EXISTS device_role TEXT NOT NULL DEFAULT 'kiosk'
    CONSTRAINT display_pairings_device_role_check
    CHECK (device_role IN ('kitchen', 'kiosk', 'queue_board'));
