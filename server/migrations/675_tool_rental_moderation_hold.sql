-- Migration 675: independent admin moderation hold for tool rentals.
--
-- Admin hide (businessModerationController.toggleToolRental) previously flipped
-- the same is_available flag the owner PUT route accepts, so a routine owner
-- edit could re-surface a tool an admin hid for a safety recall. moderation_hold
-- is an admin-only predicate: set on admin hide, cleared only on admin release.
-- Owner updates can neither set nor clear it, and while a hold is set the tool
-- is excluded from public listing and cannot be booked even if is_available is
-- flipped back on.

ALTER TABLE tool_rentals
  ADD COLUMN IF NOT EXISTS moderation_hold BOOLEAN NOT NULL DEFAULT FALSE;
