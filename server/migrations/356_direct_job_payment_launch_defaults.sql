-- Align job bid acceptance with the current launch payment model.
-- Platform-managed OxSteed job payments are not active yet; direct customer ↔ helper
-- settlement is the supported path until protected payments are enabled.

ALTER TABLE helper_cancellation_policies
  ALTER COLUMN oxsteed_enabled SET DEFAULT FALSE,
  ALTER COLUMN custom_enabled SET DEFAULT TRUE;

UPDATE helper_cancellation_policies
SET
  oxsteed_enabled = FALSE,
  custom_enabled = TRUE,
  custom_policy = CASE
    WHEN custom_policy IS NULL OR custom_policy = '{}'::jsonb THEN
      jsonb_build_object(
        'terms',
        'Customer and helper arrange payment directly. OxSteed does not collect or hold job payment yet.',
        'payment_mode',
        'direct'
      )
    ELSE custom_policy
  END,
  updated_at = NOW()
WHERE oxsteed_enabled IS DISTINCT FROM FALSE
   OR custom_enabled IS DISTINCT FROM TRUE;
