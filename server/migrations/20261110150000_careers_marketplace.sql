-- OxSteed Careers marketplace upgrade (docs/careers/marketplace.md).
-- Adds what job seekers and employers get on hireonthespot.com and Indeed
-- that Careers lacked: saved jobs, follows, job alerts, reports, search
-- facets, application messaging, self-booked interviews with availability,
-- calendar free/busy, video rooms, screener questions, a structured
-- self-reported profile, AI match scores (gated), employer plans,
-- referrals, agencies, candidate alerts, shortlists, company reviews,
-- Q&A, salary reports and opening analytics.
--
-- Everything here is additive. Vendor-backed features stay behind flags
-- that default to off (server/services/careers/providers/config.js).

-- ── Openings: search facets and badges ──────────────────────────────────────
ALTER TABLE career_openings
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS experience_level TEXT,
  ADD COLUMN IF NOT EXISTS same_day_hire BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS urgently_hiring BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS screener_auto_reject BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS posted_by_agency_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_industry_check CHECK (industry IS NULL OR industry IN (
    'food_service','hospitality','retail','healthcare','construction','skilled_trades','transportation',
    'warehouse_logistics','cleaning_facilities','manufacturing','education','technology','finance',
    'professional_services','beauty_wellness','security','agriculture','nonprofit','government','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_experience_level_check CHECK (experience_level IS NULL OR experience_level IN (
    'no_experience','entry','mid','senior','manager','executive','internship'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_career_openings_published
  ON career_openings (published_at DESC, id DESC) WHERE status = 'open' AND moderation_status = 'ok';
CREATE INDEX IF NOT EXISTS idx_career_openings_facets
  ON career_openings (industry, experience_level) WHERE status = 'open';

-- ── Applications: screener answers, first employer view ─────────────────────
ALTER TABLE career_applications
  ADD COLUMN IF NOT EXISTS screener_answers JSONB,
  ADD COLUMN IF NOT EXISTS screener_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS employer_viewed_at TIMESTAMPTZ;

-- ── AI audit purposes ───────────────────────────────────────────────────────
ALTER TABLE career_ai_runs DROP CONSTRAINT IF EXISTS career_ai_runs_purpose_check;
ALTER TABLE career_ai_runs ADD CONSTRAINT career_ai_runs_purpose_check CHECK (purpose IN (
  'extract_opening_requirements','extract_profile_skills','explain_match','rank_applicants','translate_draft',
  'parse_resume','match_resume'));

-- ── Profile: availability, presence opt-in, SMS opt-in ──────────────────────
ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS available_now_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS show_online_status BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_opt_in_at TIMESTAMPTZ;

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_careers BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Saved jobs (My jobs tracker) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_saved_jobs (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opening_id BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, opening_id)
);
CREATE INDEX IF NOT EXISTS idx_career_saved_jobs_opening ON career_saved_jobs (opening_id);

-- ── Follow employers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_employer_follows (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  is_platform BOOLEAN NOT NULL DEFAULT FALSE,
  notify BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((is_platform AND business_id IS NULL) OR (NOT is_platform AND business_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_employer_follows
  ON career_employer_follows (user_id, COALESCE(business_id, 0), is_platform);
CREATE INDEX IF NOT EXISTS idx_career_employer_follows_business ON career_employer_follows (business_id) WHERE business_id IS NOT NULL;

-- ── Job alerts (saved Careers searches) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_job_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('instant','daily','weekly')),
  channels TEXT[] NOT NULL DEFAULT ARRAY['email','in_app']::text[],
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (channels <@ ARRAY['email','in_app','push','sms']::text[])
);
CREATE INDEX IF NOT EXISTS idx_career_job_alerts_due ON career_job_alerts (frequency, last_checked_at) WHERE NOT paused;
CREATE INDEX IF NOT EXISTS idx_career_job_alerts_user ON career_job_alerts (user_id);

CREATE TABLE IF NOT EXISTS career_job_alert_deliveries (
  alert_id BIGINT NOT NULL REFERENCES career_job_alerts(id) ON DELETE CASCADE,
  opening_id BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, opening_id)
);

-- ── Report a job ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_opening_reports (
  id BIGSERIAL PRIMARY KEY,
  opening_id BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  reporter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_ip_hash TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('scam','asks_for_payment','discriminatory','misleading_pay','fake_employer','offensive','not_a_job','other')),
  details VARCHAR(1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  resolution_note VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_opening_reports_user
  ON career_opening_reports (opening_id, reporter_user_id) WHERE reporter_user_id IS NOT NULL AND status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_opening_reports_ip
  ON career_opening_reports (opening_id, reporter_ip_hash) WHERE reporter_user_id IS NULL AND reporter_ip_hash IS NOT NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_career_opening_reports_open ON career_opening_reports (status, created_at DESC);

-- ── Opening analytics ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_opening_metrics_daily (
  opening_id BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  apply_starts INTEGER NOT NULL DEFAULT 0,
  applications INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (opening_id, day)
);
-- Per-day de-duplication of views/apply starts by a keyed hash of the
-- viewer; never the raw IP or user id. Pruned after 2 days.
CREATE TABLE IF NOT EXISTS career_opening_metric_marks (
  opening_id BIGINT NOT NULL,
  day DATE NOT NULL,
  metric TEXT NOT NULL,
  viewer_hash TEXT NOT NULL,
  PRIMARY KEY (opening_id, day, metric, viewer_hash)
);

-- ── Application messaging ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_message_threads (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL UNIQUE REFERENCES career_applications(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  candidate_last_read_at TIMESTAMPTZ,
  team_last_read_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS career_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES career_message_threads(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_side TEXT NOT NULL CHECK (sender_side IN ('candidate','employer')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  contact_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id BIGINT,
  hidden_at TIMESTAMPTZ,
  hidden_by UUID REFERENCES users(id) ON DELETE SET NULL,
  hidden_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_messages_thread ON career_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_career_messages_sender ON career_messages (sender_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS career_message_templates (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  is_platform BOOLEAN NOT NULL DEFAULT FALSE,
  name VARCHAR(80) NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK ((is_platform AND business_id IS NULL) OR (NOT is_platform AND business_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_career_message_templates_biz ON career_message_templates (business_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS career_message_reports (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES career_messages(id) ON DELETE CASCADE,
  reporter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('harassment','scam','discrimination','spam','asks_for_payment','other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_message_reports ON career_message_reports (message_id, reporter_user_id) WHERE reporter_user_id IS NOT NULL;

-- ── Interview scheduling ────────────────────────────────────────────────────
ALTER TABLE career_interviews
  ADD COLUMN IF NOT EXISTS interviewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposal_id BIGINT,
  ADD COLUMN IF NOT EXISTS candidate_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_reason TEXT,
  ADD COLUMN IF NOT EXISTS rescheduled_from_id BIGINT REFERENCES career_interviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ics_sequence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_room_key TEXT,
  ADD COLUMN IF NOT EXISTS sms_reminder BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_interviews_room ON career_interviews (video_room_key) WHERE video_room_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_career_interviews_upcoming ON career_interviews (scheduled_at) WHERE cancelled_at IS NULL AND status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_career_interviews_interviewer ON career_interviews (interviewer_user_id, scheduled_at) WHERE cancelled_at IS NULL;

-- Weekly availability an interviewer publishes for a business (or OxSteed HR).
CREATE TABLE IF NOT EXISTS career_interview_availability (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  is_platform BOOLEAN NOT NULL DEFAULT FALSE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  timezone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_minute > start_minute),
  CHECK ((is_platform AND business_id IS NULL) OR (NOT is_platform AND business_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_career_interview_availability_user ON career_interview_availability (user_id, business_id);

-- An employer offers times; the candidate books one, or asks for others.
CREATE TABLE IF NOT EXISTS career_interview_proposals (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
  interviewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('video','phone','onsite')),
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 10 AND 240),
  timezone TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  use_video_room BOOLEAN NOT NULL DEFAULT FALSE,
  sms_reminder BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled','expired','declined')),
  candidate_message VARCHAR(500),
  expires_at TIMESTAMPTZ NOT NULL,
  booked_interview_id BIGINT REFERENCES career_interviews(id) ON DELETE SET NULL,
  reschedule_of_interview_id BIGINT REFERENCES career_interviews(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_interview_proposals_app ON career_interview_proposals (application_id, status);
CREATE TABLE IF NOT EXISTS career_interview_proposal_slots (
  id BIGSERIAL PRIMARY KEY,
  proposal_id BIGINT NOT NULL REFERENCES career_interview_proposals(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  UNIQUE (proposal_id, starts_at)
);

-- Private interviewer notes and ratings (never shown to the candidate).
CREATE TABLE IF NOT EXISTS career_interview_notes (
  id BIGSERIAL PRIMARY KEY,
  interview_id BIGINT NOT NULL REFERENCES career_interviews(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  recommendation TEXT CHECK (recommendation IS NULL OR recommendation IN ('advance','hold','decline')),
  note VARCHAR(4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_interview_notes_interview ON career_interview_notes (interview_id);

-- Calendar free/busy (Google, Microsoft). Tokens are encrypted at rest
-- (utils/encryption); only the free/busy scope is requested.
CREATE TABLE IF NOT EXISTS career_calendar_connections (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at TIMESTAMPTZ,
  scope TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS career_calendar_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  code_verifier_enc TEXT NOT NULL,
  return_to TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Screener questions and deal-breakers ───────────────────────────────────
CREATE TABLE IF NOT EXISTS career_screener_questions (
  id BIGSERIAL PRIMARY KEY,
  opening_id BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('preset','custom')),
  preset_code TEXT,
  prompt VARCHAR(300) NOT NULL,
  answer_type TEXT NOT NULL CHECK (answer_type IN ('yes_no','number','choice','text')),
  choices JSONB NOT NULL DEFAULT '[]'::jsonb,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  dealbreaker BOOLEAN NOT NULL DEFAULT FALSE,
  expected JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT dealbreaker OR (kind = 'preset' AND expected IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_career_screener_questions_opening ON career_screener_questions (opening_id, position);

-- Saved answers to preset questions so "easy apply" can prefill them.
CREATE TABLE IF NOT EXISTS career_profile_screener_defaults (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preset_code TEXT NOT NULL,
  answer JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, preset_code)
);

-- ── Self-reported structured profile (never "verified") ────────────────────
CREATE TABLE IF NOT EXISTS career_profile_work_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employer_name VARCHAR(160) NOT NULL,
  title VARCHAR(160) NOT NULL,
  city VARCHAR(120),
  start_month DATE NOT NULL,
  end_month DATE,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  description VARCHAR(2000),
  position SMALLINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self','resume_parse')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_month IS NULL OR end_month >= start_month)
);
CREATE INDEX IF NOT EXISTS idx_career_profile_work_history_user ON career_profile_work_history (user_id, position);
CREATE TABLE IF NOT EXISTS career_profile_education (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school VARCHAR(160) NOT NULL,
  credential VARCHAR(160),
  field_of_study VARCHAR(160),
  start_year SMALLINT CHECK (start_year IS NULL OR start_year BETWEEN 1940 AND 2100),
  end_year SMALLINT CHECK (end_year IS NULL OR end_year BETWEEN 1940 AND 2100),
  position SMALLINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self','resume_parse')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_profile_education_user ON career_profile_education (user_id, position);
-- Licence and certificate claims. No licence numbers are stored.
CREATE TABLE IF NOT EXISTS career_profile_licenses (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  issuer VARCHAR(160),
  region VARCHAR(80),
  issued_on DATE,
  expires_on DATE,
  position SMALLINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self','resume_parse')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_profile_licenses_user ON career_profile_licenses (user_id, position);

-- ── AI résumé-to-job match (behind the ranking fairness gate) ──────────────
CREATE TABLE IF NOT EXISTS career_ai_match_scores (
  application_id BIGINT PRIMARY KEY REFERENCES career_applications(id) ON DELETE CASCADE,
  run_id BIGINT REFERENCES career_ai_runs(id) ON DELETE SET NULL,
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  met TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  gaps TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Employer plans (Stripe subscriptions, flag-off) ────────────────────────
CREATE TABLE IF NOT EXISTS career_employer_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('starter','growth','pro')),
  status TEXT NOT NULL CHECK (status IN ('checkout_pending','trialing','active','past_due','canceled','incomplete','unpaid')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  checkout_session_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  referral_code_id BIGINT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS career_stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Employer referral program (flag-off) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS career_referral_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{8}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS career_referral_attributions (
  id BIGSERIAL PRIMARY KEY,
  code_id BIGINT NOT NULL REFERENCES career_referral_codes(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  attributed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  commission_ends_at TIMESTAMPTZ NOT NULL,
  voided_at TIMESTAMPTZ,
  void_reason TEXT
);
CREATE TABLE IF NOT EXISTS career_referral_commissions (
  id BIGSERIAL PRIMARY KEY,
  attribution_id BIGINT NOT NULL REFERENCES career_referral_attributions(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  invoice_amount_cents BIGINT NOT NULL CHECK (invoice_amount_cents >= 0),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL,
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 5000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','void')),
  first_approver UUID REFERENCES users(id) ON DELETE SET NULL,
  first_approved_at TIMESTAMPTZ,
  second_approver UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (second_approver IS NULL OR second_approver <> first_approver)
);
CREATE INDEX IF NOT EXISTS idx_career_referral_commissions_status ON career_referral_commissions (status, created_at);

-- ── Staffing agencies and recruiters ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_agency_links (
  id BIGSERIAL PRIMARY KEY,
  agency_business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  permissions TEXT[] NOT NULL DEFAULT ARRAY['post_openings','manage_pipeline']::text[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','declined','revoked')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (agency_business_id <> client_business_id),
  CHECK (permissions <@ ARRAY['post_openings','manage_pipeline','source_talent']::text[])
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_agency_links_live
  ON career_agency_links (agency_business_id, client_business_id) WHERE status IN ('pending','active');

-- ── Candidate alerts and shortlists ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_candidate_alerts (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  opening_id BIGINT REFERENCES career_openings(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(80) NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_candidate_alerts_business ON career_candidate_alerts (business_id) WHERE NOT paused;
CREATE TABLE IF NOT EXISTS career_candidate_alert_hits (
  alert_id BIGINT NOT NULL REFERENCES career_candidate_alerts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, user_id)
);
CREATE TABLE IF NOT EXISTS career_talent_shortlists (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS career_talent_shortlist_members (
  shortlist_id BIGINT NOT NULL REFERENCES career_talent_shortlists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note VARCHAR(500),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shortlist_id, user_id)
);

-- ── Public employer pages, reviews, Q&A and salaries ───────────────────────
CREATE TABLE IF NOT EXISTS career_employer_profiles (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  about VARCHAR(4000),
  why_join VARCHAR(4000),
  show_phone BOOLEAN NOT NULL DEFAULT FALSE,
  show_map BOOLEAN NOT NULL DEFAULT FALSE,
  same_day_hiring BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS career_company_reviews (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('current','former')),
  job_title VARCHAR(120),
  overall SMALLINT NOT NULL CHECK (overall BETWEEN 1 AND 5),
  work_life SMALLINT CHECK (work_life IS NULL OR work_life BETWEEN 1 AND 5),
  pay_benefits SMALLINT CHECK (pay_benefits IS NULL OR pay_benefits BETWEEN 1 AND 5),
  security_advancement SMALLINT CHECK (security_advancement IS NULL OR security_advancement BETWEEN 1 AND 5),
  management SMALLINT CHECK (management IS NULL OR management BETWEEN 1 AND 5),
  culture SMALLINT CHECK (culture IS NULL OR culture BETWEEN 1 AND 5),
  headline VARCHAR(140) NOT NULL,
  pros VARCHAR(2000),
  cons VARCHAR(2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','removed')),
  moderation_reason TEXT,
  moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  employer_response VARCHAR(2000),
  employer_response_by UUID REFERENCES users(id) ON DELETE SET NULL,
  employer_response_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_company_reviews_author
  ON career_company_reviews (business_id, author_user_id) WHERE author_user_id IS NOT NULL AND status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_career_company_reviews_public ON career_company_reviews (business_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS career_company_review_reports (
  review_id BIGINT NOT NULL REFERENCES career_company_reviews(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('false_information','discriminatory','harassment','private_information','spam','conflict_of_interest','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, reporter_user_id)
);

CREATE TABLE IF NOT EXISTS career_company_questions (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body VARCHAR(500) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','removed')),
  moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_company_questions_public ON career_company_questions (business_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS career_company_answers (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES career_company_questions(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  as_employer BOOLEAN NOT NULL DEFAULT FALSE,
  body VARCHAR(1500) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','removed')),
  moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_company_answers_question ON career_company_answers (question_id, status);

CREATE TABLE IF NOT EXISTS career_salary_reports (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  job_title VARCHAR(120) NOT NULL,
  job_title_norm VARCHAR(120) NOT NULL,
  pay_amount NUMERIC(12,2) NOT NULL CHECK (pay_amount > 0),
  pay_period TEXT NOT NULL CHECK (pay_period IN ('hourly','daily','per_shift','monthly','yearly')),
  currency_code CHAR(3) NOT NULL,
  country_code CHAR(2),
  region VARCHAR(80),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_salary_reports_author
  ON career_salary_reports (business_id, author_user_id, job_title_norm) WHERE author_user_id IS NOT NULL AND status = 'published';
CREATE INDEX IF NOT EXISTS idx_career_salary_reports_title ON career_salary_reports (job_title_norm, country_code) WHERE status = 'published';
