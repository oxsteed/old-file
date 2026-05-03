-- 161_business_moderation_enhancements.sql
-- Add admin_notes and deleted_at columns to businesses table for enhanced admin moderation

DO $$
BEGIN
  -- Add admin_notes column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'admin_notes'
  ) THEN
    ALTER TABLE businesses ADD COLUMN admin_notes VARCHAR(2000);
  END IF;

  -- Add deleted_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE businesses ADD COLUMN deleted_at TIMESTAMP;
  END IF;
END $$;

-- Create index on deleted_at for faster filtering of active businesses
CREATE INDEX IF NOT EXISTS idx_businesses_deleted_at ON businesses(deleted_at);

-- Create index on admin_notes search (optional, for full-text search later)
CREATE INDEX IF NOT EXISTS idx_businesses_admin_notes ON businesses(id) WHERE admin_notes IS NOT NULL;
