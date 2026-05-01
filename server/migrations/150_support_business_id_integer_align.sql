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
