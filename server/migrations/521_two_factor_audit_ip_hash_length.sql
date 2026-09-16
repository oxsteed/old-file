-- Migration 521: allow privacy-preserving 256-bit IP hashes in 2FA audit rows.
-- Migration 022 declared this column for raw IPv4/IPv6 text, but the current
-- controllers store a SHA-256 hash so the audit record never stores the IP.

ALTER TABLE two_factor_audit_log
  ALTER COLUMN ip_address TYPE VARCHAR(128);
