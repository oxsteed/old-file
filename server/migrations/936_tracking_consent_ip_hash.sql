-- Spec 4.6: the consent ledger keeps HMAC evidence of the request IP so a
-- recorded choice can be corroborated without storing the address itself.
-- The hash uses GROWTH_SUBJECT_PEPPER via server/growth/identity.js (kind
-- 'ip'); the raw IP is never persisted. Nullable: rows recorded before this
-- migration and non-HTTP writers have no request IP.
ALTER TABLE tracking_consents ADD COLUMN ip_hash CHAR(64);
