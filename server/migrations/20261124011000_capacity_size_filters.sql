-- Group 11 item 563: capacity / size / weight on tool rentals.
-- Additive only; safe to run twice.
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS capacity_value NUMERIC(12,2);
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS capacity_unit VARCHAR(20);
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10,2);
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS size_length_cm NUMERIC(10,2);
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS size_width_cm NUMERIC(10,2);
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS size_height_cm NUMERIC(10,2);

-- Capacity is a value+unit pair: kg/lb (load), L/gal (volume), W/kW/hp (power).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_capacity_unit_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_capacity_unit_check
      CHECK (capacity_unit IS NULL OR capacity_unit IN ('kg','lb','L','gal','W','kW','hp'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_capacity_pair_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_capacity_pair_check
      CHECK ((capacity_value IS NULL) = (capacity_unit IS NULL));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_capacity_nonneg_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_capacity_nonneg_check
      CHECK (capacity_value IS NULL OR capacity_value >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_size_nonneg_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_size_nonneg_check
      CHECK ((weight_kg IS NULL OR weight_kg >= 0)
        AND (size_length_cm IS NULL OR size_length_cm >= 0)
        AND (size_width_cm IS NULL OR size_width_cm >= 0)
        AND (size_height_cm IS NULL OR size_height_cm >= 0));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tool_rentals_capacity ON tool_rentals(capacity_value);
CREATE INDEX IF NOT EXISTS idx_tool_rentals_weight ON tool_rentals(weight_kg);
