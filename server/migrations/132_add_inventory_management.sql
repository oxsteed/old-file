-- Add inventory management to marketplace products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'quantity_available'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN quantity_available INTEGER DEFAULT 999999;
    ALTER TABLE marketplace_products ADD CONSTRAINT chk_quantity_available CHECK (quantity_available >= 0);
    CREATE INDEX idx_marketplace_products_quantity ON marketplace_products(quantity_available);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'quantity_sold'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN quantity_sold INTEGER DEFAULT 0;
  END IF;
END $$;
