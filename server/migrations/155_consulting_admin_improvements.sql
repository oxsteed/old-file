-- Migration 155: Consulting admin improvements
-- Extends consulting_sessions status constraint and adds missing columns

-- Drop old status constraint and replace with expanded set
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consulting_sessions') THEN
    ALTER TABLE consulting_sessions
      DROP CONSTRAINT IF EXISTS consulting_sessions_status_check;
    ALTER TABLE consulting_sessions
      ADD CONSTRAINT consulting_sessions_status_check
      CHECK (status IN ('pending', 'contacted', 'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show', 'archived'));
  END IF;
END;
$$;

-- Add meeting_url column if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consulting_sessions' AND column_name = 'meeting_url'
  ) THEN
    ALTER TABLE consulting_sessions ADD COLUMN meeting_url TEXT;
  END IF;
END;
$$;

-- Add consultant_id alias column if missing (some controllers use consultant_id vs consultant_assigned_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consulting_sessions' AND column_name = 'consultant_id'
  ) THEN
    ALTER TABLE consulting_sessions ADD COLUMN consultant_id UUID;
  END IF;
END;
$$;

-- Add reminder_sent tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consulting_sessions' AND column_name = 'reminder_sent'
  ) THEN
    ALTER TABLE consulting_sessions ADD COLUMN reminder_sent BOOLEAN DEFAULT FALSE;
  END IF;
END;
$$;

-- Add business launch intake status for archived
-- The table was created as consulting_requests in migration 104; handle both names defensively.
DO $$
BEGIN
  -- consulting_requests (actual table name from migration 104)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consulting_requests') THEN
    ALTER TABLE consulting_requests DROP CONSTRAINT IF EXISTS consulting_requests_status_check;
    ALTER TABLE consulting_requests
      ADD CONSTRAINT consulting_requests_status_check
      CHECK (status IN ('pending', 'contacted', 'kickoff_scheduled', 'in_progress', 'completed', 'cancelled', 'archived'));
  END IF;

  -- business_launch_requests (alternate name used in some environments)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_launch_requests') THEN
    ALTER TABLE business_launch_requests DROP CONSTRAINT IF EXISTS business_launch_requests_status_check;
    ALTER TABLE business_launch_requests
      ADD CONSTRAINT business_launch_requests_status_check
      CHECK (status IN ('pending', 'contacted', 'kickoff_scheduled', 'in_progress', 'completed', 'cancelled', 'archived'));
  END IF;
END;
$$;

-- Make consulting_packages.is_active column exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consulting_packages' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE consulting_packages ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
  END IF;
END;
$$;

-- Add notes column to consulting_packages if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consulting_packages' AND column_name = 'description'
  ) THEN
    ALTER TABLE consulting_packages ADD COLUMN description TEXT;
  END IF;
END;
$$;

-- Add notes column to consulting_invoices if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consulting_invoices' AND column_name = 'notes'
  ) THEN
    ALTER TABLE consulting_invoices ADD COLUMN notes TEXT;
  END IF;
END;
$$;

-- Index for search by name/email
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consulting_sessions') THEN
    CREATE INDEX IF NOT EXISTS idx_consulting_sessions_name ON consulting_sessions(first_name, last_name);
  END IF;
END;
$$;
