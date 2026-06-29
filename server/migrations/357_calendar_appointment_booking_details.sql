-- Migration 357: Structured booking details for main-app calendar appointments.
--
-- The OxSteed Main calendar flow now books a specific helper/service. Keep the
-- legacy free-text fields, but add durable queryable fields so booking details
-- do not have to be packed into customer_notes forever.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS service_package_id INTEGER,
  ADD COLUMN IF NOT EXISTS service_package_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS service_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS service_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS booking_urgency VARCHAR(24) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS recurrence_rule VARCHAR(64) NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS preferred_communication_channel VARCHAR(24) NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS phone_contact_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS address_unit VARCHAR(120),
  ADD COLUMN IF NOT EXISTS access_instructions TEXT,
  ADD COLUMN IF NOT EXISTS parking_notes TEXT,
  ADD COLUMN IF NOT EXISTS promo_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS payment_expectation VARCHAR(40) NOT NULL DEFAULT 'direct_to_helper',
  ADD COLUMN IF NOT EXISTS attachment_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE appointments
   SET currency_code = COALESCE(NULLIF(currency_code, ''), 'USD'),
       booking_urgency = COALESCE(NULLIF(booking_urgency, ''), 'normal'),
       recurrence_rule = COALESCE(NULLIF(recurrence_rule, ''), 'one_time'),
       preferred_communication_channel = COALESCE(NULLIF(preferred_communication_channel, ''), 'in_app'),
       payment_expectation = COALESCE(NULLIF(payment_expectation, ''), 'direct_to_helper'),
       attachment_count = COALESCE(attachment_count, 0),
       booking_metadata = COALESCE(booking_metadata, '{}'::jsonb);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_currency_code_iso4217') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_currency_code_iso4217
      CHECK (currency_code ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_service_price_nonnegative') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_service_price_nonnegative
      CHECK (service_price_cents IS NULL OR service_price_cents >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_attachment_count_nonnegative') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_attachment_count_nonnegative
      CHECK (attachment_count >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_booking_urgency_check') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_booking_urgency_check
      CHECK (booking_urgency IN ('normal','soon','urgent'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_recurrence_rule_check') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_recurrence_rule_check
      CHECK (recurrence_rule IN ('one_time','weekly','biweekly','monthly'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_preferred_communication_check') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_preferred_communication_check
      CHECK (preferred_communication_channel IN ('in_app','phone','sms','email'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_payment_expectation_check') THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_payment_expectation_check
      CHECK (payment_expectation IN ('direct_to_helper','restaurant_credit','platform_checkout_pending','paid_off_platform'));
  END IF;

  -- business_services has legacy schema drift in older environments. Some
  -- drafts used UUID ids while the current production contract uses INTEGER
  -- ids. Add the FK only when the live table type can support it; otherwise
  -- keep the durable service_package_id value without blocking deploy boot.
  IF to_regclass('public.business_services') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM pg_attribute a
        WHERE a.attrelid = 'public.business_services'::regclass
          AND a.attname = 'id'
          AND a.atttypid = 'integer'::regtype
     )
     AND EXISTS (
       SELECT 1
         FROM pg_attribute a
        WHERE a.attrelid = 'public.appointments'::regclass
          AND a.attname = 'service_package_id'
          AND a.atttypid = 'integer'::regtype
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname = 'appointments_service_package_id_fkey'
     ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_service_package_id_fkey
      FOREIGN KEY (service_package_id)
      REFERENCES business_services(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_service_package
  ON appointments(service_package_id)
  WHERE service_package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_booking_urgency
  ON appointments(booking_urgency, scheduled_start_time DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_recurrence
  ON appointments(recurrence_rule, scheduled_start_time DESC)
  WHERE recurrence_rule <> 'one_time';

CREATE INDEX IF NOT EXISTS idx_appointments_payment_expectation
  ON appointments(payment_expectation, scheduled_start_time DESC);

CREATE TABLE IF NOT EXISTS appointment_attachments (
  id                  BIGSERIAL PRIMARY KEY,
  appointment_id      BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  storage_key         TEXT,
  file_url            TEXT,
  file_name           VARCHAR(255),
  mime_type           VARCHAR(120),
  file_size_bytes     BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  width               INTEGER CHECK (width IS NULL OR width >= 0),
  height              INTEGER CHECK (height IS NULL OR height >= 0),
  status              VARCHAR(24) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','uploaded','failed','deleted')),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_attachments_appointment
  ON appointment_attachments(appointment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointment_attachments_status
  ON appointment_attachments(status, created_at DESC);

CREATE TABLE IF NOT EXISTS appointment_recurrence_rules (
  id                 BIGSERIAL PRIMARY KEY,
  appointment_id     BIGINT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  recurrence_rule    VARCHAR(64) NOT NULL DEFAULT 'one_time'
                       CHECK (recurrence_rule IN ('one_time','weekly','biweekly','monthly')),
  interval_count     INTEGER NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 52),
  timezone           VARCHAR(80) NOT NULL DEFAULT 'UTC',
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ,
  next_occurrence_at TIMESTAMPTZ,
  status             VARCHAR(24) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','paused','completed','cancelled')),
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_recurrence_next
  ON appointment_recurrence_rules(status, next_occurrence_at)
  WHERE status = 'active' AND next_occurrence_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS appointment_payment_agreements (
  id                  BIGSERIAL PRIMARY KEY,
  appointment_id      BIGINT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  payer_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  payee_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  payment_expectation VARCHAR(40) NOT NULL DEFAULT 'direct_to_helper'
                        CHECK (payment_expectation IN ('direct_to_helper','restaurant_credit','platform_checkout_pending','paid_off_platform')),
  quoted_amount_cents INTEGER CHECK (quoted_amount_cents IS NULL OR quoted_amount_cents >= 0),
  currency_code       CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  status              VARCHAR(24) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','agreed','paid','cancelled','disputed')),
  payment_method_label VARCHAR(80),
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_payment_agreements_payer
  ON appointment_payment_agreements(payer_user_id, status, created_at DESC)
  WHERE payer_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointment_payment_agreements_payee
  ON appointment_payment_agreements(payee_user_id, status, created_at DESC)
  WHERE payee_user_id IS NOT NULL;
