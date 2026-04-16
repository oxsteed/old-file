-- Migration 067: Fix otp_code column types to accommodate SHA-256 hashes
-- The security hardening in migration 037+ changed OTP storage to use SHA-256
-- hashes (64-char hex) instead of raw 6-digit codes. The original CHAR(6) /
-- VARCHAR(10) column definitions cause PostgreSQL 22001 errors when the hash
-- is written. Expand both columns to TEXT.

-- pending_registrations.otp_code: CHAR(6) → TEXT
-- (helper startRegistration and customer acceptTerms both write a 64-char hash)
ALTER TABLE pending_registrations
  ALTER COLUMN otp_code TYPE TEXT;

-- users.otp_code: VARCHAR(10) → TEXT
-- (requestOTP and resendVerification write a 64-char hash)
ALTER TABLE users
  ALTER COLUMN otp_code TYPE TEXT;
