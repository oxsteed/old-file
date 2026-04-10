-- 051_hardening_miscellany.sql
-- Batch 7: Standardize timestamps and misc hardening (M-41, L-02)

-- 1. Ensure created_at always defaults to NOW() to prevent NULLs and logic errors.
DO $$ 
DECLARE
    row record;
BEGIN
    FOR row IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'created_at' 
          AND table_schema = 'public' 
          AND column_default IS NULL
    LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at SET DEFAULT NOW()', row.table_name);
    END LOOP;
END $$;

-- 2. Ensure updated_at exists and is managed for core tables if missing.
DO $$ 
DECLARE
    row record;
    core_tables text[] := ARRAY['users', 'jobs', 'bids', 'reviews', 'payments', 'subscriptions', 'notifications', 'messages', 'helper_profiles', 'connect_accounts'];
    t_name text;
BEGIN
    FOREACH t_name IN ARRAY core_tables LOOP
        -- Check if table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t_name AND table_schema = 'public') THEN
            -- Check if updated_at exists
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t_name AND column_name = 'updated_at') THEN
                EXECUTE format('ALTER TABLE %I ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()', t_name);
            ELSE
                -- Just ensure default
                EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at SET DEFAULT NOW()', t_name);
            END IF;
        END IF;
    END LOOP;
END $$;

-- 3. Standardize platform_settings constraints (M-57 refinement)
ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_key_key;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_key_unique UNIQUE (key);

-- 4. Secure admin_audit_log (M-62 refinement)
ALTER TABLE admin_audit_log ALTER COLUMN action SET NOT NULL;
ALTER TABLE admin_audit_log ALTER COLUMN created_at SET DEFAULT NOW();
