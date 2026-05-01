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
