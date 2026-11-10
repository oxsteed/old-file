-- Security review 2026-11-10 F-06: retire the single-super-admin break-glass.
--
-- Migration 809 added credit_single_admin_self_approval, which let a lone
-- super admin approve their own OxSteed Credit money movement whenever fewer
-- than 2 active super admins existed. A super admin who could toggle flags and
-- demote or deactivate the other super admin(s), or a single compromised
-- account, could therefore self-approve cash-outs, manual credits and
-- settlement mark-paid. Credit approval, settlement and oversight must always
-- be decided by two distinct administrators, so the service no longer reads
-- the flag and the row is removed so it cannot be mistaken for a live control.

BEGIN;

DELETE FROM feature_flags WHERE key = 'credit_single_admin_self_approval';

COMMIT;
