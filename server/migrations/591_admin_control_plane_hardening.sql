-- Migration 591: harden admin control-plane contracts.
-- Additive only: preserve existing settings and audit rows while giving new
-- writes enough metadata to validate and reliably identify non-UUID targets.

ALTER TABLE IF EXISTS admin_audit_log
  ADD COLUMN IF NOT EXISTS target_key VARCHAR(160);

ALTER TABLE IF EXISTS platform_settings
  ADD COLUMN IF NOT EXISTS min_numeric_value NUMERIC,
  ADD COLUMN IF NOT EXISTS max_numeric_value NUMERIC,
  ADD COLUMN IF NOT EXISTS validation_pattern TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_admin_audit_target_key
      ON admin_audit_log(target_type, target_key);
  END IF;

  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    -- Migration 023 stored fee settings as whole percentages while the
    -- active fee service uses decimal multipliers. Normalize only numeric
    -- legacy values in the unambiguous 1..100 range before enforcing the
    -- decimal contract. Values outside that range remain visible for an
    -- operator to correct rather than being silently guessed.
    UPDATE platform_settings
    SET value = (value::numeric / 100)::text
    WHERE key IN (
      'platform_fee_starter', 'platform_fee_pro', 'platform_fee_elite',
      'platform_fee_broker', 'broker_cut_rate'
    )
      AND (CASE WHEN value ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$' THEN value::numeric END) > 1
      AND (CASE WHEN value ~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$' THEN value::numeric END) <= 100;

    -- Conservative bounds for the existing platform controls. The
    -- controller also validates value_type and rejects unknown formats
    -- before this metadata is used, so old rows remain readable while
    -- unsafe values are rejected. A zero escrow delay is valid and is kept
    -- compatible with the original admin seed.
    UPDATE platform_settings
    SET min_numeric_value = CASE
      WHEN key IN ('platform_fee_starter', 'platform_fee_pro', 'platform_fee_elite', 'platform_fee_broker', 'broker_cut_rate') THEN 0
      WHEN key = 'max_job_budget' THEN 0.01
      WHEN key IN ('bid_expiry_hours', 'escrow_release_delay_hrs') THEN CASE WHEN key = 'escrow_release_delay_hrs' THEN 0 ELSE 1 END
      WHEN key = 'min_helper_rating' THEN 0
      ELSE min_numeric_value
    END,
    max_numeric_value = CASE
      WHEN key IN ('platform_fee_starter', 'platform_fee_pro', 'platform_fee_elite', 'platform_fee_broker', 'broker_cut_rate') THEN 1
      WHEN key = 'max_job_budget' THEN 1000000
      WHEN key IN ('bid_expiry_hours', 'escrow_release_delay_hrs') THEN 720
      WHEN key = 'min_helper_rating' THEN 5
      ELSE max_numeric_value
    END,
    validation_pattern = CASE
      WHEN key = 'support_email' THEN '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
      ELSE validation_pattern
    END
    WHERE key IN (
      'platform_fee_starter', 'platform_fee_pro', 'platform_fee_elite',
      'platform_fee_broker', 'broker_cut_rate', 'max_job_budget',
      'bid_expiry_hours', 'escrow_release_delay_hrs', 'min_helper_rating',
      'support_email'
    );
  END IF;
END $$;
