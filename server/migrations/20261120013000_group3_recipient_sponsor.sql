-- Group 3 (Recipient and sponsor, roadmap items 101-150), built on the
-- G-6/G-7 foundation (recipient/site-contact columns, tokens, consent).
--
-- booking_site_actions is one row per on-site act by the recipient or the
-- site contact (106-110, 141): acknowledge arrival instructions, request a
-- callback, suggest an access window, report an entry problem, confirm a
-- handoff (144: the row is the handoff evidence receipt), acknowledge
-- completion. Every row notifies the booker; money never appears here.
-- booking_link_renewals are renewal requests for the 7-day status links
-- (114): the linked party asks, the booker re-mints.
-- booking_link_deliveries record where the booker sent a status link
-- (115): an account gets the link by notification, a named alternate gets
-- it from the booker by hand.
-- booking_link_update_emails are token parties who asked for visit updates
-- by email (118): reminder, arrival, completion. Account parties use the
-- existing per-type notification toggles instead.
-- booking_notification_opt_outs end notifications for one party on one
-- booking (146). booking_visit_archives hide a visit from one party's
-- list without deleting it (148).
-- booking_contact_corrections are a linked party correcting their own
-- name or phone (149): auto-applied, recorded, booker notified.
-- booking_sponsorships are one-booking payment invitations (121-125,
-- 128-129, D-40): the booker invites a sponsor by email, the sponsor
-- accepts or declines, then pays with their own Stripe card through a
-- per-sponsorship PaymentIntent. The booker's own intent is reduced by
-- paid sponsorships; a fully sponsored booking needs no booker intent.
-- Refunds return each payer's money to their own intent.
-- booking_sponsorship_charges are additional-charge requests on a live
-- sponsorship (126-127): helper or booker asks, sponsor accepts (then
-- pays through a per-charge intent) or declines.
-- booking_callbacks are callback requests (107, 140): from the site
-- contact or recipient to the booker, helper, or support.
-- booking_recipient_feedback is the optional recipient/site-contact
-- feedback after the visit (145).
-- booking_site_photos are site photos contributed by the recipient or
-- the site contact (142), stored under booking-site-photos/.
-- booking_visit_reminders are the once-per-party visit reminders (102),
-- sent by the booking maintenance sweep when the visit is tomorrow.
-- booking_requests gains care_instructions (143: helper/booker leaves
-- them, recipient/site contact receives them) and
-- receipt_shared_with_recipient_at (150: the booker enables the
-- recipient's authorized receipt; the receipt itself never carries
-- amounts, D-49).
CREATE TABLE IF NOT EXISTS booking_site_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  actor_type VARCHAR(20) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type VARCHAR(40) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_site_actions_booking
  ON booking_site_actions (booking_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_site_actions_actor_check'
      AND conrelid = 'booking_site_actions'::regclass
  ) THEN
    ALTER TABLE booking_site_actions
      ADD CONSTRAINT booking_site_actions_actor_check
      CHECK (actor_type IN ('recipient', 'site_contact'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_site_actions_type_check'
      AND conrelid = 'booking_site_actions'::regclass
  ) THEN
    ALTER TABLE booking_site_actions
      ADD CONSTRAINT booking_site_actions_type_check
      CHECK (action_type IN (
        'acknowledge_instructions', 'request_callback', 'suggest_window',
        'report_entry_problem', 'confirm_handoff', 'acknowledge_completion'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_link_renewals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  requested_by_type VARCHAR(20) NOT NULL,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_link_renewals_booking
  ON booking_link_renewals (booking_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_link_renewals_status_check'
      AND conrelid = 'booking_link_renewals'::regclass
  ) THEN
    ALTER TABLE booking_link_renewals
      ADD CONSTRAINT booking_link_renewals_status_check
      CHECK (status IN ('requested', 'renewed', 'declined'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_link_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  link_kind VARCHAR(20) NOT NULL,
  delivered_to_email VARCHAR(320),
  delivered_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  delivered_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_link_deliveries_booking
  ON booking_link_deliveries (booking_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_link_deliveries_kind_check'
      AND conrelid = 'booking_link_deliveries'::regclass
  ) THEN
    ALTER TABLE booking_link_deliveries
      ADD CONSTRAINT booking_link_deliveries_kind_check
      CHECK (link_kind IN ('recipient', 'site_contact'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_link_update_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  link_kind VARCHAR(20) NOT NULL,
  email VARCHAR(320) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, link_kind, email)
);

CREATE INDEX IF NOT EXISTS idx_booking_link_update_emails_booking
  ON booking_link_update_emails (booking_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_link_update_emails_kind_check'
      AND conrelid = 'booking_link_update_emails'::regclass
  ) THEN
    ALTER TABLE booking_link_update_emails
      ADD CONSTRAINT booking_link_update_emails_kind_check
      CHECK (link_kind IN ('recipient', 'site_contact'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_notification_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, user_id),
  UNIQUE (booking_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_booking_notification_opt_outs_booking
  ON booking_notification_opt_outs (booking_id);

CREATE TABLE IF NOT EXISTS booking_visit_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64),
  role VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, user_id),
  UNIQUE (booking_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_booking_visit_archives_booking
  ON booking_visit_archives (booking_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_visit_archives_role_check'
      AND conrelid = 'booking_visit_archives'::regclass
  ) THEN
    ALTER TABLE booking_visit_archives
      ADD CONSTRAINT booking_visit_archives_role_check
      CHECK (role IN ('recipient', 'site_contact'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_contact_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  party_type VARCHAR(20) NOT NULL,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  field_name VARCHAR(20) NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_contact_corrections_booking
  ON booking_contact_corrections (booking_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_contact_corrections_field_check'
      AND conrelid = 'booking_contact_corrections'::regclass
  ) THEN
    ALTER TABLE booking_contact_corrections
      ADD CONSTRAINT booking_contact_corrections_field_check
      CHECK (field_name IN ('name', 'phone'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_sponsorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  sponsor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sponsor_name VARCHAR(200),
  sponsor_email VARCHAR(320),
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'invited',
  invite_token VARCHAR(64) NOT NULL,
  payment_deadline_at TIMESTAMPTZ,
  stripe_payment_intent_id VARCHAR(255),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  stripe_refund_id VARCHAR(255),
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invite_token)
);

CREATE INDEX IF NOT EXISTS idx_booking_sponsorships_booking
  ON booking_sponsorships (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_sponsorships_sponsor
  ON booking_sponsorships (sponsor_user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_sponsorships_amount_check'
      AND conrelid = 'booking_sponsorships'::regclass
  ) THEN
    ALTER TABLE booking_sponsorships
      ADD CONSTRAINT booking_sponsorships_amount_check
      CHECK (amount_cents >= 50 AND amount_cents <= 5000000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_sponsorships_status_check'
      AND conrelid = 'booking_sponsorships'::regclass
  ) THEN
    ALTER TABLE booking_sponsorships
      ADD CONSTRAINT booking_sponsorships_status_check
      CHECK (status IN ('invited', 'accepted', 'declined', 'paid', 'expired', 'refunded', 'voided'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_sponsorship_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsorship_id UUID NOT NULL REFERENCES booking_sponsorships(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_intent_id VARCHAR(255),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  stripe_refund_id VARCHAR(255),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_sponsorship_charges_sponsorship
  ON booking_sponsorship_charges (sponsorship_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_sponsorship_charges_amount_check'
      AND conrelid = 'booking_sponsorship_charges'::regclass
  ) THEN
    ALTER TABLE booking_sponsorship_charges
      ADD CONSTRAINT booking_sponsorship_charges_amount_check
      CHECK (amount_cents >= 50 AND amount_cents <= 5000000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_sponsorship_charges_status_check'
      AND conrelid = 'booking_sponsorship_charges'::regclass
  ) THEN
    ALTER TABLE booking_sponsorship_charges
      ADD CONSTRAINT booking_sponsorship_charges_status_check
      CHECK (status IN ('requested', 'accepted', 'declined', 'paid', 'refunded', 'voided'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  requested_by_type VARCHAR(20) NOT NULL,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target VARCHAR(20) NOT NULL,
  preferred_window TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_callbacks_booking
  ON booking_callbacks (booking_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_callbacks_target_check'
      AND conrelid = 'booking_callbacks'::regclass
  ) THEN
    ALTER TABLE booking_callbacks
      ADD CONSTRAINT booking_callbacks_target_check
      CHECK (target IN ('booker', 'helper', 'support'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_callbacks_status_check'
      AND conrelid = 'booking_callbacks'::regclass
  ) THEN
    ALTER TABLE booking_callbacks
      ADD CONSTRAINT booking_callbacks_status_check
      CHECK (status IN ('requested', 'scheduled', 'done'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_recipient_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  author_type VARCHAR(20) NOT NULL,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER,
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_recipient_feedback_booking
  ON booking_recipient_feedback (booking_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_recipient_feedback_rating_check'
      AND conrelid = 'booking_recipient_feedback'::regclass
  ) THEN
    ALTER TABLE booking_recipient_feedback
      ADD CONSTRAINT booking_recipient_feedback_rating_check
      CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS booking_site_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  contributor_type VARCHAR(20) NOT NULL,
  contributor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL,
  mime_type VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_site_photos_booking
  ON booking_site_photos (booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_visit_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  party_role VARCHAR(20) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, party_role)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_visit_reminders_role_check'
      AND conrelid = 'booking_visit_reminders'::regclass
  ) THEN
    ALTER TABLE booking_visit_reminders
      ADD CONSTRAINT booking_visit_reminders_role_check
      CHECK (party_role IN ('recipient', 'site_contact'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_requests' AND column_name = 'care_instructions'
  ) THEN
    ALTER TABLE booking_requests ADD COLUMN care_instructions TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_requests' AND column_name = 'receipt_shared_with_recipient_at'
  ) THEN
    ALTER TABLE booking_requests ADD COLUMN receipt_shared_with_recipient_at TIMESTAMPTZ;
  END IF;
END $$;
