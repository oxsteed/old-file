
-- >>> BEGIN: 146_legal_document_sections.sql <<<
-- Migration 146: Legal Document Sections
-- Break documents into searchable, versionable sections
-- Enables section-level edits, diffs, and change tracking

CREATE TABLE IF NOT EXISTS legal_document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Section metadata
  section_key VARCHAR(100) NOT NULL,  -- 'helper_liability', 'payment_terms', 'data_retention', etc.
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Content
  content TEXT NOT NULL,
  content_html TEXT,  -- For rich formatting (markdown converted to HTML)

  -- Organization
  section_order INT DEFAULT 0,  -- Order on /terms page
  is_collapsible BOOLEAN DEFAULT FALSE,  -- Can user collapse this section

  -- Configuration
  requires_explicit_acceptance BOOLEAN DEFAULT FALSE,  -- Force checkbox for this section
  is_critical BOOLEAN DEFAULT FALSE,  -- Changes trigger email notification
  affects_transactions BOOLEAN DEFAULT FALSE,  -- Affects existing transactions

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_section_per_doc UNIQUE(document_id, section_key)
);

CREATE INDEX idx_legal_document_sections_document_id ON legal_document_sections(document_id);
CREATE INDEX idx_legal_document_sections_section_key ON legal_document_sections(document_id, section_key);
CREATE INDEX idx_legal_document_sections_order ON legal_document_sections(document_id, section_order);

-- Track changes to individual sections
CREATE TABLE IF NOT EXISTS legal_section_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES legal_document_sections(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Version details
  version_number INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  content_html TEXT,

  -- What changed
  change_summary TEXT,
  diff_html TEXT,  -- HTML showing before/after with highlights

  -- Publication status
  status VARCHAR(20) NOT NULL,
  effective_date TIMESTAMP,

  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  CONSTRAINT unique_section_version UNIQUE(section_id, version_number),
  CONSTRAINT valid_section_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

CREATE INDEX idx_legal_section_versions_section_id ON legal_section_versions(section_id);
CREATE INDEX idx_legal_section_versions_document_id ON legal_section_versions(document_id);
CREATE INDEX idx_legal_section_versions_published_at ON legal_section_versions(published_at);

-- Approval workflow tracking
CREATE TABLE IF NOT EXISTS legal_document_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Who requested approval
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMP DEFAULT NOW(),

  -- What changed
  change_summary TEXT,
  changed_sections VARCHAR(100)[],

  -- Approval process
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected', 'revisions_requested'
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_comments TEXT,

  -- If approved, when should it go live
  scheduled_publish_date TIMESTAMP,

  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected', 'revisions_requested'))
);

CREATE INDEX idx_legal_document_approvals_document_id ON legal_document_approvals(document_id);
CREATE INDEX idx_legal_document_approvals_status ON legal_document_approvals(status);
CREATE INDEX idx_legal_document_approvals_requested_at ON legal_document_approvals(requested_at);

-- Track when documents were sent to users
CREATE TABLE IF NOT EXISTS legal_change_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Notification details
  notification_type VARCHAR(50) NOT NULL,  -- 'update_notification', 'reacceptance_required', 'critical_change'
  subject_line VARCHAR(255),
  email_body TEXT,

  -- Distribution
  sent_at TIMESTAMP,
  recipients_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,

  -- Configuration
  send_to_segment VARCHAR(50),  -- 'all_users', 'helpers_only', 'customers_only', 'new_users_after_date'
  requires_user_action BOOLEAN DEFAULT FALSE,

  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_notification_type CHECK (notification_type IN ('update_notification', 'reacceptance_required', 'critical_change'))
);

CREATE INDEX idx_legal_change_notifications_document_id ON legal_change_notifications(document_id);
CREATE INDEX idx_legal_change_notifications_sent_at ON legal_change_notifications(sent_at);

-- Track notification delivery (per-user)
CREATE TABLE IF NOT EXISTS legal_notification_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES legal_change_notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Delivery status
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  failed_reason TEXT,

  -- User action
  user_accepted_at TIMESTAMP,
  user_dismissed_at TIMESTAMP,

  CONSTRAINT unique_notification_per_user UNIQUE(notification_id, user_id)
);

CREATE INDEX idx_legal_notification_tracking_notification_id ON legal_notification_tracking(notification_id);
CREATE INDEX idx_legal_notification_tracking_user_id ON legal_notification_tracking(user_id);
CREATE INDEX idx_legal_notification_tracking_delivered_at ON legal_notification_tracking(delivered_at);

-- >>> END: 146_legal_document_sections.sql <<<

-- >>> BEGIN: 147_legal_multilingual.sql <<<
-- Migration 147: Multilingual Legal Documents
-- Support for international expansion with language-specific versioning

CREATE TABLE IF NOT EXISTS legal_document_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Language details
  language_code VARCHAR(10) NOT NULL,  -- 'en', 'es', 'fr', 'ht', etc.
  language_name VARCHAR(50) NOT NULL,  -- 'English', 'Spanish', etc.

  -- Translated content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,

  -- Version tracking per language
  version_number INT NOT NULL,
  effective_date TIMESTAMP,

  -- Status per language
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- 'draft', 'pending_review', 'scheduled', 'live', 'archived'
  needs_review BOOLEAN DEFAULT FALSE,  -- Flagged as needing translation review

  -- Audit
  translated_by UUID REFERENCES users(id),
  translated_at TIMESTAMP DEFAULT NOW(),

  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  CONSTRAINT unique_doc_language_version UNIQUE(document_id, language_code, version_number),
  CONSTRAINT valid_translation_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

CREATE INDEX idx_legal_document_translations_document_id ON legal_document_translations(document_id);
CREATE INDEX idx_legal_document_translations_language ON legal_document_translations(document_id, language_code);
CREATE INDEX idx_legal_document_translations_status ON legal_document_translations(document_id, language_code, status);

-- Section translations
CREATE TABLE IF NOT EXISTS legal_section_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES legal_document_sections(id) ON DELETE CASCADE,

  -- Language details
  language_code VARCHAR(10) NOT NULL,
  language_name VARCHAR(50) NOT NULL,

  -- Translated content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  content_html TEXT,

  -- Version tracking
  version_number INT NOT NULL,
  effective_date TIMESTAMP,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  needs_review BOOLEAN DEFAULT FALSE,

  -- Audit
  translated_by UUID REFERENCES users(id),
  translated_at TIMESTAMP DEFAULT NOW(),

  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,

  CONSTRAINT unique_section_language_version UNIQUE(section_id, language_code, version_number),
  CONSTRAINT valid_section_translation_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

CREATE INDEX idx_legal_section_translations_section_id ON legal_section_translations(section_id);
CREATE INDEX idx_legal_section_translations_language ON legal_section_translations(section_id, language_code);

-- Track translation completion
CREATE TABLE IF NOT EXISTS legal_translation_status (
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  language_code VARCHAR(10) NOT NULL,

  -- Completion
  is_complete BOOLEAN DEFAULT FALSE,
  percent_complete INT DEFAULT 0,

  -- Deadline
  due_date TIMESTAMP,

  -- Assigned translator
  assigned_to UUID REFERENCES users(id),

  PRIMARY KEY (document_id, language_code)
);

CREATE INDEX idx_legal_translation_status_document ON legal_translation_status(document_id);

-- >>> END: 147_legal_multilingual.sql <<<

-- >>> BEGIN: 148_legal_audit_log.sql <<<
-- Migration 148: Legal Document Audit Log
-- Complete audit trail for compliance and dispute resolution

CREATE TABLE IF NOT EXISTS legal_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What changed
  action_type VARCHAR(50) NOT NULL,  -- 'document_created', 'section_edited', 'version_published', 'user_accepted', 'approval_requested', etc.
  resource_type VARCHAR(50) NOT NULL,  -- 'document', 'section', 'version', 'acceptance', 'approval'
  resource_id UUID,

  -- Details
  document_id UUID REFERENCES legal_documents(id),
  section_id UUID REFERENCES legal_document_sections(id),
  user_id UUID REFERENCES users(id),

  -- What changed
  old_values JSONB,  -- Previous values
  new_values JSONB,  -- New values
  change_description TEXT,

  -- Context
  ip_address VARCHAR(45),
  user_agent TEXT,
  session_id VARCHAR(255),

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_action_type CHECK (action_type IN (
    'document_created',
    'document_updated',
    'document_published',
    'document_archived',
    'section_created',
    'section_updated',
    'section_deleted',
    'version_created',
    'version_published',
    'version_archived',
    'user_accepted',
    'user_reaccepted',
    'approval_requested',
    'approval_approved',
    'approval_rejected',
    'approval_revisions_requested',
    'translation_created',
    'translation_reviewed',
    'translation_published',
    'notification_sent',
    'notification_opened',
    'notification_clicked',
    'rollback_performed',
    'diff_viewed'
  )),

  CONSTRAINT valid_resource_type CHECK (resource_type IN (
    'document',
    'section',
    'version',
    'acceptance',
    'approval',
    'translation',
    'notification'
  ))
);

CREATE INDEX idx_legal_audit_log_document_id ON legal_audit_log(document_id);
CREATE INDEX idx_legal_audit_log_user_id ON legal_audit_log(user_id);
CREATE INDEX idx_legal_audit_log_action_type ON legal_audit_log(action_type);
CREATE INDEX idx_legal_audit_log_created_at ON legal_audit_log(created_at);
CREATE INDEX idx_legal_audit_log_resource ON legal_audit_log(resource_type, resource_id);

-- Search index for compliance queries
CREATE INDEX idx_legal_audit_log_search ON legal_audit_log USING GIN(new_values);

-- Jurisdiction-specific legal holds (for disputes)
CREATE TABLE IF NOT EXISTS legal_compliance_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Hold details
  hold_reason VARCHAR(100) NOT NULL,  -- 'litigation', 'regulatory_review', 'dispute_resolution', 'policy_review'
  held_until TIMESTAMP NOT NULL,
  description TEXT,

  -- Who placed the hold
  placed_by UUID NOT NULL REFERENCES users(id),
  placed_at TIMESTAMP DEFAULT NOW(),

  -- Notification
  notify_admins BOOLEAN DEFAULT TRUE,

  CONSTRAINT valid_hold_reason CHECK (hold_reason IN (
    'litigation',
    'regulatory_review',
    'dispute_resolution',
    'policy_review'
  ))
);

CREATE INDEX idx_legal_compliance_holds_document_id ON legal_compliance_holds(document_id);
CREATE INDEX idx_legal_compliance_holds_held_until ON legal_compliance_holds(held_until);

-- Dispute resolution tracking
CREATE TABLE IF NOT EXISTS legal_dispute_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document version in dispute
  document_id UUID NOT NULL REFERENCES legal_documents(id),
  version_number INT NOT NULL,

  -- Dispute details
  dispute_id UUID NOT NULL,  -- Reference to dispute table
  dispute_reason VARCHAR(255),

  -- Resolution
  resolved_at TIMESTAMP,
  resolution_notes TEXT,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_by UUID REFERENCES users(id)
);

CREATE INDEX idx_legal_dispute_references_document_id ON legal_dispute_references(document_id);
CREATE INDEX idx_legal_dispute_references_dispute_id ON legal_dispute_references(dispute_id);

-- Data retention & archival policy
CREATE TABLE IF NOT EXISTS legal_data_retention (
  document_id UUID PRIMARY KEY REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Retention policy
  retain_until TIMESTAMP,  -- When to archive
  archive_method VARCHAR(50) NOT NULL DEFAULT 'cold_storage',  -- 'cold_storage', 'delete', 'anonymize'

  -- Backup
  backup_location VARCHAR(255),  -- S3 path, etc.
  backup_created_at TIMESTAMP,

  -- Audit
  archived_at TIMESTAMP,
  archived_by UUID REFERENCES users(id),

  CONSTRAINT valid_archive_method CHECK (archive_method IN ('cold_storage', 'delete', 'anonymize'))
);

CREATE INDEX idx_legal_data_retention_retain_until ON legal_data_retention(retain_until);

-- >>> END: 148_legal_audit_log.sql <<<

-- >>> BEGIN: 149_support_employers.sql <<<
-- Migration 149: Support employers (multi-tenant hiring)
-- Each support employer is a distinct org that can employ agents (business, helper-as-org, or platform).
-- support_agents.employer_id references support_employers; business_id remains the conversation/customer context (OxSteed style).
--
-- NOTE: businesses.id is SERIAL (INTEGER). Some support migrations declared business_id as UUID; align before FKs.

ALTER TABLE support_agents DROP CONSTRAINT IF EXISTS support_agents_business_id_fkey;
ALTER TABLE agent_applications DROP CONSTRAINT IF EXISTS agent_applications_business_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_agents'
      AND column_name = 'business_id' AND udt_name = 'uuid'
  ) THEN
    UPDATE support_agents SET business_id = NULL WHERE business_id IS NOT NULL;
    ALTER TABLE support_agents ALTER COLUMN business_id TYPE INTEGER USING (NULL::integer);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_applications'
      AND column_name = 'business_id' AND udt_name = 'uuid'
  ) THEN
    UPDATE agent_applications SET business_id = NULL WHERE business_id IS NOT NULL;
    ALTER TABLE agent_applications ALTER COLUMN business_id TYPE INTEGER USING (NULL::integer);
  END IF;
END $$;

-- Restore FK to businesses(id) after type alignment (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_agents_business_id_fkey'
  ) THEN
    ALTER TABLE support_agents
      ADD CONSTRAINT support_agents_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_applications_business_id_fkey'
  ) THEN
    ALTER TABLE agent_applications
      ADD CONSTRAINT agent_applications_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS support_employers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('business', 'helper', 'platform')),
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  helper_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_employers_kind_shape CHECK (
    (kind = 'business' AND business_id IS NOT NULL AND helper_user_id IS NULL)
    OR (kind = 'helper' AND helper_user_id IS NOT NULL AND business_id IS NULL)
    OR (kind = 'platform' AND business_id IS NULL AND helper_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_employers_unique_business
  ON support_employers (business_id) WHERE kind = 'business';

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_employers_unique_helper
  ON support_employers (helper_user_id) WHERE kind = 'helper';

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_employers_unique_platform
  ON support_employers (kind) WHERE kind = 'platform';

CREATE INDEX IF NOT EXISTS idx_support_employers_kind ON support_employers (kind);

-- Platform employer (singleton)
INSERT INTO support_employers (kind, display_name)
SELECT 'platform', 'OxSteed Platform'
WHERE NOT EXISTS (SELECT 1 FROM support_employers WHERE kind = 'platform');

-- Per-business employers for existing agent/application data
INSERT INTO support_employers (kind, business_id)
SELECT DISTINCT 'business', x.business_id
FROM (
  SELECT business_id FROM support_agents WHERE business_id IS NOT NULL
  UNION
  SELECT business_id FROM agent_applications WHERE business_id IS NOT NULL
) x
WHERE NOT EXISTS (
  SELECT 1 FROM support_employers e
  WHERE e.kind = 'business' AND e.business_id = x.business_id
);

-- Link agents to employer
ALTER TABLE support_agents ADD COLUMN IF NOT EXISTS employer_id UUID REFERENCES support_employers(id) ON DELETE CASCADE;

-- Context org (conversations/queue) may differ from employer for platform/helper-only staff
ALTER TABLE support_agents ALTER COLUMN business_id DROP NOT NULL;

UPDATE support_agents sa
SET employer_id = e.id
FROM support_employers e
WHERE sa.employer_id IS NULL
  AND e.kind = 'business'
  AND e.business_id = sa.business_id;

-- Fail loudly if any row could not be mapped (data integrity)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM support_agents WHERE employer_id IS NULL) THEN
    RAISE EXCEPTION 'migration 149: support_agents rows without resolvable employer_id';
  END IF;
END $$;

ALTER TABLE support_agents ALTER COLUMN employer_id SET NOT NULL;

-- Replace uniqueness: one employment per employer per user
ALTER TABLE support_agents DROP CONSTRAINT IF EXISTS support_agents_business_id_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_agents_employer_user ON support_agents (employer_id, user_id);

CREATE INDEX IF NOT EXISTS idx_support_agents_employer_id ON support_agents (employer_id);

-- Applications reference employer (hiring scope)
ALTER TABLE agent_applications ADD COLUMN IF NOT EXISTS employer_id UUID REFERENCES support_employers(id) ON DELETE CASCADE;

ALTER TABLE agent_applications ALTER COLUMN business_id DROP NOT NULL;

UPDATE agent_applications aa
SET employer_id = e.id
FROM support_employers e
WHERE aa.employer_id IS NULL
  AND e.kind = 'business'
  AND e.business_id = aa.business_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_applications WHERE employer_id IS NULL) THEN
    RAISE EXCEPTION 'migration 149: agent_applications rows without resolvable employer_id';
  END IF;
END $$;

ALTER TABLE agent_applications ALTER COLUMN employer_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_applications_employer ON agent_applications (employer_id);

-- >>> END: 149_support_employers.sql <<<

-- >>> BEGIN: 150_support_business_id_integer_align.sql <<<
-- Migration 150: Align support_agents / agent_applications business_id with businesses.id (INTEGER)
-- Use when migration 149 failed earlier due to UUID vs SERIAL mismatch, or as a no-op safety net.

ALTER TABLE support_agents DROP CONSTRAINT IF EXISTS support_agents_business_id_fkey;
ALTER TABLE agent_applications DROP CONSTRAINT IF EXISTS agent_applications_business_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_agents'
      AND column_name = 'business_id' AND udt_name = 'uuid'
  ) THEN
    UPDATE support_agents SET business_id = NULL WHERE business_id IS NOT NULL;
    ALTER TABLE support_agents ALTER COLUMN business_id TYPE INTEGER USING (NULL::integer);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_applications'
      AND column_name = 'business_id' AND udt_name = 'uuid'
  ) THEN
    UPDATE agent_applications SET business_id = NULL WHERE business_id IS NOT NULL;
    ALTER TABLE agent_applications ALTER COLUMN business_id TYPE INTEGER USING (NULL::integer);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_agents_business_id_fkey') THEN
    ALTER TABLE support_agents
      ADD CONSTRAINT support_agents_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_applications_business_id_fkey') THEN
    ALTER TABLE agent_applications
      ADD CONSTRAINT agent_applications_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
  END IF;
END $$;

-- >>> END: 150_support_business_id_integer_align.sql <<<

-- >>> BEGIN: 151_jobs_post_wizard_columns.sql <<<
-- Migration 151: Ensure jobs columns used by POST /api/jobs (createJob) exist.
-- Fresh installs that only ran 001_initial_schema.sql have a minimal jobs table;
-- later wizard columns live in 036, 044, 080, etc. This migration is idempotent
-- so createJob never hits "column does not exist" (500) on partial migration order.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS budget_type VARCHAR(20) DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS urgency VARCHAR(20) DEFAULT 'flexible',
  ADD COLUMN IF NOT EXISTS site_access VARCHAR(30) DEFAULT 'easy',
  ADD COLUMN IF NOT EXISTS job_type_label VARCHAR(30) DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS location_approx_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS location_approx_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS requirements JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence VARCHAR(50),
  ADD COLUMN IF NOT EXISTS preferred_helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_helper_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS private_notes TEXT,
  ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS skill_ids INT[] DEFAULT '{}'::integer[];

-- media_urls: 001 uses TEXT[] NOT NULL DEFAULT '{}'
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] NOT NULL DEFAULT '{}'::text[];

-- location_point may exist as GEOGRAPHY(POINT,4326) in 001; 036 also adds it — keep one form
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'location_point'
  ) THEN
    ALTER TABLE jobs ADD COLUMN location_point GEOGRAPHY(Point, 4326);
  END IF;
END $$;

-- >>> END: 151_jobs_post_wizard_columns.sql <<<
