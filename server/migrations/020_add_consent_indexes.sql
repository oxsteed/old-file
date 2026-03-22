-- Phase 7: Add indexes and ensure user_consents table exists for re-accept gate
-- This migration ensures the consent system is optimized for version checking.
-- Also adds deleted_at column to users table for soft-delete (CCPA compliance).

-- Add deleted_at column to users table for soft-delete support
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Ensure user_consents table exists (idempotent)
CREATE TABLE IF NOT EXISTS user_consents (
    id              SERIAL PRIMARY KEY,
    user_id         VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type    VARCHAR(50) NOT NULL,
    version         VARCHAR(20) NOT NULL,
    ip_hash         VARCHAR(64),
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast consent status lookups (used by middleware & routes)
CREATE INDEX IF NOT EXISTS idx_user_consents_user_type
    ON user_consents (user_id, consent_type, created_at DESC);

-- Index for admin audit queries
CREATE INDEX IF NOT EXISTS idx_user_consents_type_version
    ON user_consents (consent_type, version);
