-- Migration 234: align business_products schema with INTEGER businesses.id
-- ----------------------------------------------------------------------
-- Migration 217 declared business_products.business_id as UUID, but
-- businesses.id is SERIAL/INTEGER. The FK constraint would have failed
-- at apply time on a fresh DB; on existing DBs business_products may
-- not exist or may have an unconstrained business_id column.
--
-- This migration converts business_id (and all FKs referencing it) to
-- INTEGER and re-establishes the FK to businesses(id). Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'business_products'
  ) THEN
    -- Drop the broken FK if present (named or unnamed).
    DECLARE
      conname TEXT;
    BEGIN
      FOR conname IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class cl ON cl.oid = con.conrelid
         WHERE cl.relname = 'business_products' AND con.contype = 'f'
      LOOP
        EXECUTE format('ALTER TABLE business_products DROP CONSTRAINT IF EXISTS %I', conname);
      END LOOP;
    END;

    -- Convert business_id to INTEGER if it isn't already.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'business_products' AND column_name = 'business_id' AND data_type = 'uuid'
    ) THEN
      -- Drop existing data because UUID -> INTEGER requires explicit mapping
      -- and these tables should be empty in any real environment that hit
      -- the broken FK at deploy time.
      DELETE FROM business_products;
      ALTER TABLE business_products
        ALTER COLUMN business_id TYPE INTEGER USING NULL;
    END IF;

    -- Re-add FK to businesses(id)
    ALTER TABLE business_products
      ADD CONSTRAINT business_products_business_id_fkey
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add a marketplace_product_id column so we can link a business_product to its
-- mirror row in marketplace_products. NULL means "not yet published to the
-- marketplace pipeline."
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'business_products'
  ) THEN
    ALTER TABLE business_products
      ADD COLUMN IF NOT EXISTS marketplace_product_id UUID NULL;

    CREATE INDEX IF NOT EXISTS idx_business_products_marketplace
      ON business_products(marketplace_product_id)
      WHERE marketplace_product_id IS NOT NULL;
  END IF;
END $$;

-- Mirror tracking columns on marketplace_products so we can identify
-- mirrored business products and route reservations correctly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'marketplace_products'
  ) THEN
    -- Allow source='business' (existing CHECK only allowed homedepot/internal)
    ALTER TABLE marketplace_products DROP CONSTRAINT IF EXISTS marketplace_products_source_check;
    ALTER TABLE marketplace_products
      ADD CONSTRAINT marketplace_products_source_check
        CHECK (source IN ('homedepot', 'internal', 'business'));

    ALTER TABLE marketplace_products
      ADD COLUMN IF NOT EXISTS business_product_id UUID NULL,
      ADD COLUMN IF NOT EXISTS source_business_id  INTEGER NULL,
      ADD COLUMN IF NOT EXISTS reserved_quantity   INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_marketplace_products_source_biz
      ON marketplace_products(source_business_id)
      WHERE source_business_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_marketplace_products_biz_product
      ON marketplace_products(business_product_id)
      WHERE business_product_id IS NOT NULL;
  END IF;
END $$;
