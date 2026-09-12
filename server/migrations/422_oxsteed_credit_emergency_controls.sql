-- Migration 422: OxSteed Credit emergency controls.
--
-- Keep the rail disabled until legal/compliance review, custody, partner
-- agreements, and operational checks are complete. Super Admin can enable or
-- suspend it from the existing Platform Settings > Feature Flags surface.

INSERT INTO feature_flags (key, is_enabled, description)
VALUES (
  'oxsteed_credit_enabled',
  FALSE,
  'Allow new OxSteed Credit loads, holds, purchases, and transfers'
)
ON CONFLICT (key) DO NOTHING;
