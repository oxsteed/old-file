-- Migration 638: OxSteed Credit compliance perimeter (Phase 5, gap 8).
--
-- The fiat boundaries (top-ups in, settlement payouts out) were verified
-- against Stripe in Phases 2 and 4, but anyone could fund any amount with no
-- identity proofing, no sanctions screening, and no transaction monitoring.
-- This migration adds the evidence tables for the code-buildable part of the
-- compliance perimeter:
--
--   oxsteed_credit_identity_verifications
--     One active row per customer (partial unique index on
--     pending/verified). Tiers: 0 = unverified (no fiat funding at all),
--     1 = basic (fiat funding up to OXSTEED_CREDIT_TIER1_TOPUP_MAX_CENTS),
--     2 = verified (up to the rail transaction ceiling). Only provider
--     references are stored here: never raw ID document images, document
--     numbers, or biometric data. A vendor (e.g. Stripe Identity) plugs in
--     behind the provider interface in identityVerificationService.js; the
--     shipped implementation is a manual admin review queue.
--
--   oxsteed_credit_sanctions_screenings
--     One row per screening of a subject (customer or payout beneficiary).
--     result is clear | hit | error. A hit blocks the transaction until an
--     admin explicitly clears it with a recorded reason; a provider error
--     blocks with an incident and never silently passes. Screened before
--     every fiat top-up and every settlement payout beneficiary payment.
--
--   oxsteed_credit_compliance_cases
--     Transaction-monitoring rule hits become cases here. Statuses:
--     open -> investigating -> resolved | escalated. Cases never
--     auto-resolve; only an admin transitions them, with audit events.
--     sla_due_at drives the SLA breach incident in the monitoring job.
--
--   oxsteed_credit_stepup_challenges
--     Short-lived single-use step-up challenges for high-risk money
--     actions (large top-ups, settlement payout initiation). Only the
--     HMAC of the code is stored, never the code itself.
--
-- Corrections policy: append-only evidence. Admin decisions are new rows /
-- column updates with actor + reason + timestamp, never deletes.

CREATE TABLE IF NOT EXISTS oxsteed_credit_identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_tier SMALLINT NOT NULL CHECK (requested_tier IN (1, 2)),
  tier SMALLINT NOT NULL DEFAULT 0 CHECK (tier IN (0, 1, 2)),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
  provider VARCHAR(64) NOT NULL DEFAULT 'manual_review',
  provider_reference VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- At most one in-flight/current verification per customer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_identity_verification_active
  ON oxsteed_credit_identity_verifications (customer_id)
  WHERE status IN ('pending', 'verified');
CREATE INDEX IF NOT EXISTS idx_credit_identity_verification_status
  ON oxsteed_credit_identity_verifications (status, created_at DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_sanctions_screenings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('customer', 'partner')),
  -- TEXT because customers are UUIDs and partners are BIGINTs.
  subject_id TEXT NOT NULL,
  provider VARCHAR(64) NOT NULL DEFAULT 'manual_review',
  result VARCHAR(20) NOT NULL CHECK (result IN ('clear', 'hit', 'error')),
  hit_context TEXT,
  payload_hash VARCHAR(128),
  screened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ,
  cleared_by UUID REFERENCES users(id) ON DELETE SET NULL,
  clear_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_screening_subject
  ON oxsteed_credit_sanctions_screenings (subject_type, subject_id, screened_at DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_compliance_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type VARCHAR(40) NOT NULL
    CHECK (case_type IN ('structuring', 'velocity_spike', 'rapid_fund_out', 'new_destination_payout', 'sanctions_hit', 'manual')),
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('customer', 'partner')),
  -- TEXT because customers are UUIDs and partners are BIGINTs.
  subject_id TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved', 'escalated')),
  evidence JSONB NOT NULL DEFAULT '{}',
  sla_due_at TIMESTAMPTZ NOT NULL,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  dedupe_key VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_compliance_cases_status
  ON oxsteed_credit_compliance_cases (status, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_credit_compliance_cases_subject
  ON oxsteed_credit_compliance_cases (subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_stepup_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action_type VARCHAR(40) NOT NULL
    CHECK (action_type IN ('topup', 'settlement_payout')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  code_hash VARCHAR(128) NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_stepup_challenges_actor
  ON oxsteed_credit_stepup_challenges (actor_user_id, created_at DESC);
