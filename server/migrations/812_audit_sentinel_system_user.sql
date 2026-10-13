-- Migration 812: sentinel system user for audit attribution.
--
-- P3-11-F03: migration 055 made admin_audit_log.admin_id NOT NULL (and
-- admin_user_action_log.admin_id / target_user_id were already NOT NULL),
-- so scheduledDeletionJob's nullify('admin_audit_log','admin_id') can never
-- succeed for a user with audit rows: the SET NULL hits a 23502 violation,
-- the transaction rolls back, and the user is retained forever.
--
-- The fix reassigns those audit FKs to a permanent sentinel "system" user
-- instead of NULL (mirroring migration 055's own zero-UUID sentinel for
-- system/migration actions). Both tables carry FOREIGN KEYs to users(id),
-- so the sentinel row must exist for the reassignment (and for future
-- system-attributed audit rows) to satisfy the FK.
--
-- The sentinel is an inactive, non-loginable row that the deletion job never
-- targets (it only deletes users with deletion_scheduled_at set). The
-- unusable password hash follows migration 624's M19c convention ('!'
-- prefix can never verify against bcrypt).

INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, email_verified)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system@oxsteed.internal',
  '!' || encode(gen_random_bytes(32), 'hex'),
  'System',
  'Sentinel',
  'admin',
  false,
  false
)
ON CONFLICT (id) DO NOTHING;
