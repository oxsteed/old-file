-- Migration 216: Fix business_services schema conflict & create booking tables
-- Migration 075 created business_services with a lightweight schema (SERIAL id, no booking columns).
-- Migration 182 silently no-op'd because the table already existed.
-- This migration adds all the booking-capable columns migration 182 assumed, then creates
-- the dependent tables (service_staff, availability, appointments, etc.) that 182/183
-- also tried to create but couldn't because they depended on the missing columns.
-- All FKs use INTEGER to match the existing SERIAL primary key on business_services.

-- ── 1. Add missing booking columns to business_services ──────────────────────
ALTER TABLE business_services
  ADD COLUMN IF NOT EXISTS duration_minutes          INTEGER  CHECK (duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS preparation_minutes       INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_price_cents          BIGINT   CHECK (base_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS max_capacity              INTEGER  DEFAULT 1 CHECK (max_capacity >= 1),
  ADD COLUMN IF NOT EXISTS min_notice_hours          INTEGER  DEFAULT 24 CHECK (min_notice_hours >= 0),
  ADD COLUMN IF NOT EXISTS cancellation_policy_hours INTEGER  DEFAULT 24 CHECK (cancellation_policy_hours >= 0),
  ADD COLUMN IF NOT EXISTS cancellation_fee_percent  INTEGER  DEFAULT 0 CHECK (cancellation_fee_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS requires_customer_info    BOOLEAN  DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_online_booking      BOOLEAN  DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_by_id             UUID     REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deleted_at                TIMESTAMP WITH TIME ZONE;

-- Back-fill base_price_cents from existing price column where possible
UPDATE business_services
SET base_price_cents = ROUND(price * 100)
WHERE base_price_cents IS NULL AND price IS NOT NULL;

-- Back-fill duration_minutes from existing duration text column where possible
-- (e.g. "60 min", "1h", "90") - convert best-effort, leave NULL if unparseable
UPDATE business_services
SET duration_minutes = CASE
  WHEN duration ~ '^\d+$'        THEN duration::INTEGER
  WHEN duration ~ '^\d+ ?min'    THEN SPLIT_PART(duration, ' ', 1)::INTEGER
  WHEN duration ~ '^\d+h$'       THEN SPLIT_PART(duration, 'h', 1)::INTEGER * 60
  ELSE NULL
END
WHERE duration_minutes IS NULL AND duration IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_services_deleted_at
  ON business_services(deleted_at) WHERE deleted_at IS NULL;

-- ── 2. Staff assignments per service ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_service_staff (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id                  INTEGER     NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  staff_id                    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_available                BOOLEAN     DEFAULT TRUE,
  service_price_override_cents BIGINT,
  display_order               INTEGER     DEFAULT 0,
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(service_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_business_service_staff_service_id ON business_service_staff(service_id);
CREATE INDEX IF NOT EXISTS idx_business_service_staff_staff_id   ON business_service_staff(staff_id);

-- ── 3. Weekly availability schedule per service ─────────────────────────────
CREATE TABLE IF NOT EXISTS business_service_availability (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   INTEGER NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  staff_id     UUID    REFERENCES users(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   TIME    NOT NULL,
  end_time     TIME    NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bsa_valid_time_range CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_bsa_service_id   ON business_service_availability(service_id);
CREATE INDEX IF NOT EXISTS idx_bsa_staff_id     ON business_service_availability(staff_id);
CREATE INDEX IF NOT EXISTS idx_bsa_day_of_week  ON business_service_availability(day_of_week);

-- ── 4. Blocked time slots ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_service_blocked_times (
  id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      INTEGER  REFERENCES business_services(id) ON DELETE CASCADE,
  staff_id        UUID     REFERENCES users(id) ON DELETE CASCADE,
  business_id     INTEGER  NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  start_time      TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time        TIMESTAMP WITH TIME ZONE NOT NULL,
  reason          VARCHAR(500),
  created_by_id   UUID     NOT NULL REFERENCES users(id),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bsbt_valid_range CHECK (start_time < end_time),
  CONSTRAINT bsbt_requires_service_or_staff CHECK (service_id IS NOT NULL OR staff_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_bsbt_service_id  ON business_service_blocked_times(service_id);
CREATE INDEX IF NOT EXISTS idx_bsbt_staff_id    ON business_service_blocked_times(staff_id);
CREATE INDEX IF NOT EXISTS idx_bsbt_business_id ON business_service_blocked_times(business_id);
CREATE INDEX IF NOT EXISTS idx_bsbt_time_range  ON business_service_blocked_times(start_time, end_time);

-- ── 5. Per-business booking rules ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_booking_rules (
  id                                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  min_advance_booking_hours         INTEGER DEFAULT 0  CHECK (min_advance_booking_hours >= 0),
  max_advance_booking_days          INTEGER DEFAULT 365 CHECK (max_advance_booking_days > 0),
  cancellation_allowed_hours_before INTEGER DEFAULT 24 CHECK (cancellation_allowed_hours_before >= 0),
  require_payment_upfront           BOOLEAN DEFAULT TRUE,
  allow_customer_reschedule         BOOLEAN DEFAULT TRUE,
  require_customer_confirmation     BOOLEAN DEFAULT FALSE,
  auto_cancel_no_show_hours         INTEGER DEFAULT 0,
  created_at                        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at                        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bbr_business_id ON business_booking_rules(business_id);

-- ── 6. Appointments (booked service slots) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS business_appointments (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id               INTEGER     NOT NULL REFERENCES business_services(id) ON DELETE RESTRICT,
  staff_id                 UUID        REFERENCES users(id) ON DELETE SET NULL,
  customer_id              UUID        REFERENCES users(id) ON DELETE SET NULL,
  customer_name            VARCHAR(255),
  customer_email           VARCHAR(255),
  customer_phone           VARCHAR(20),
  customer_notes           TEXT,
  start_time               TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time                 TIMESTAMP WITH TIME ZONE NOT NULL,
  status                   VARCHAR(50) NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled','no_show')),
  payment_status           VARCHAR(50) NOT NULL DEFAULT 'pending'
                             CHECK (payment_status IN ('pending','paid','refunded','partial_refund')),
  base_price_cents         BIGINT      NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0),
  final_price_cents        BIGINT      NOT NULL DEFAULT 0 CHECK (final_price_cents >= 0),
  stripe_payment_intent_id VARCHAR(500),
  cancellation_reason      VARCHAR(500),
  cancelled_by             VARCHAR(50) CHECK (cancelled_by IN ('customer','business','system')),
  cancelled_at             TIMESTAMP WITH TIME ZONE,
  completed_at             TIMESTAMP WITH TIME ZONE,
  feedback_rating          INTEGER     CHECK (feedback_rating BETWEEN 1 AND 5),
  feedback_notes           TEXT,
  reminder_sent_24h        BOOLEAN     DEFAULT FALSE,
  reminder_sent_2h         BOOLEAN     DEFAULT FALSE,
  no_show_marked_at        TIMESTAMP WITH TIME ZONE,
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ba_valid_time_range CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_ba_business_id     ON business_appointments(business_id);
CREATE INDEX IF NOT EXISTS idx_ba_service_id      ON business_appointments(service_id);
CREATE INDEX IF NOT EXISTS idx_ba_staff_id        ON business_appointments(staff_id);
CREATE INDEX IF NOT EXISTS idx_ba_customer_id     ON business_appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_ba_status          ON business_appointments(status);
CREATE INDEX IF NOT EXISTS idx_ba_start_time      ON business_appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_ba_payment_status  ON business_appointments(payment_status);

-- ── 7. Appointment notes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_appointment_notes (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID    NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  created_by_id  UUID    NOT NULL REFERENCES users(id),
  note_type      VARCHAR(50) NOT NULL DEFAULT 'internal'
                   CHECK (note_type IN ('internal','customer_visible')),
  content        TEXT    NOT NULL,
  is_pinned      BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ban_appointment_id ON business_appointment_notes(appointment_id);

-- ── 8. Appointment reminders ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_appointment_reminders (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID    NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  reminder_type   VARCHAR(50) NOT NULL CHECK (reminder_type IN ('sms','email')),
  scheduled_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  hours_before    INTEGER NOT NULL,
  sent_at         TIMESTAMP WITH TIME ZONE,
  delivery_status VARCHAR(50) DEFAULT 'pending'
                    CHECK (delivery_status IN ('pending','sent','failed','bounced')),
  failure_reason  VARCHAR(500),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bar_appointment_id  ON business_appointment_reminders(appointment_id);
CREATE INDEX IF NOT EXISTS idx_bar_scheduled_at    ON business_appointment_reminders(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_bar_delivery_status ON business_appointment_reminders(delivery_status);

-- ── 9. Reschedule history ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_appointment_reschedule_history (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id        UUID    NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  original_start_time   TIMESTAMP WITH TIME ZONE NOT NULL,
  original_end_time     TIMESTAMP WITH TIME ZONE NOT NULL,
  new_start_time        TIMESTAMP WITH TIME ZONE NOT NULL,
  new_end_time          TIMESTAMP WITH TIME ZONE NOT NULL,
  rescheduled_by_id     UUID    NOT NULL REFERENCES users(id),
  rescheduled_by_type   VARCHAR(50) NOT NULL CHECK (rescheduled_by_type IN ('customer','business')),
  reason                VARCHAR(500),
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_barh_appointment_id ON business_appointment_reschedule_history(appointment_id);
