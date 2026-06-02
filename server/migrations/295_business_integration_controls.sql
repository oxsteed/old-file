-- Migration 295: Business integration controls
-- Adds first-class rows for developer API access and business SMS settings.

ALTER TABLE business_integrations
  DROP CONSTRAINT IF EXISTS business_integrations_integration_type_check;

ALTER TABLE business_integrations
  ADD CONSTRAINT business_integrations_integration_type_check
  CHECK (integration_type IN (
    'stripe',
    'api_access',
    'sms_notifications',
    'google_calendar',
    'outlook_calendar',
    'apple_calendar',
    'square',
    'zoom',
    'zapier',
    'slack',
    'custom_webhook'
  ));
