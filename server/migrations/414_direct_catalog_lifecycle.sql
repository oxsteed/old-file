-- Migration 414: separate catalog lifecycle from day-to-day fulfillment state.
-- Legacy is_active/is_published and availability_days remain for compatibility;
-- lifecycle_status and available_days are the canonical catalog fields.

ALTER TABLE direct_catalog_categories
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE direct_catalog_services
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS is_operationally_available BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_bookable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS available_days TEXT[],
  ADD COLUMN IF NOT EXISTS service_area TEXT,
  ADD COLUMN IF NOT EXISTS paused_reason TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE direct_catalog_tools
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS is_operationally_available BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_bookable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS available_days TEXT[],
  ADD COLUMN IF NOT EXISTS service_area TEXT,
  ADD COLUMN IF NOT EXISTS paused_reason TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_catalog_categories_lifecycle_status_check') THEN
    ALTER TABLE direct_catalog_categories
      ADD CONSTRAINT direct_catalog_categories_lifecycle_status_check
      CHECK (lifecycle_status IN ('planned', 'coming_soon', 'live', 'paused', 'retired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_catalog_services_lifecycle_status_check') THEN
    ALTER TABLE direct_catalog_services
      ADD CONSTRAINT direct_catalog_services_lifecycle_status_check
      CHECK (lifecycle_status IN ('planned', 'coming_soon', 'live', 'paused', 'retired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'direct_catalog_tools_lifecycle_status_check') THEN
    ALTER TABLE direct_catalog_tools
      ADD CONSTRAINT direct_catalog_tools_lifecycle_status_check
      CHECK (lifecycle_status IN ('planned', 'coming_soon', 'live', 'paused', 'retired'));
  END IF;
END $$;

-- Backfill the new state from the old public toggle without deleting inventory.
UPDATE direct_catalog_categories
SET lifecycle_status = CASE
      WHEN is_active AND is_published THEN 'live'
      WHEN is_active THEN 'coming_soon'
      ELSE 'planned'
    END,
    display_order = sort_order
WHERE lifecycle_status = 'planned';

UPDATE direct_catalog_services
SET lifecycle_status = CASE
      WHEN is_active AND is_published THEN 'live'
      WHEN is_active THEN 'coming_soon'
      ELSE 'planned'
    END,
    is_operationally_available = (is_active AND is_published),
    available_days = CASE
      WHEN jsonb_typeof(availability_days) = 'array' THEN ARRAY(
        SELECT jsonb_array_elements_text(availability_days)
      )
      ELSE ARRAY[]::TEXT[]
    END,
    published_at = CASE WHEN is_active AND is_published THEN CURRENT_TIMESTAMP ELSE NULL END,
    display_order = sort_order
WHERE lifecycle_status = 'planned';

UPDATE direct_catalog_tools
SET lifecycle_status = CASE
      WHEN is_active AND is_published THEN 'live'
      WHEN is_active THEN 'coming_soon'
      ELSE 'planned'
    END,
    is_operationally_available = (is_active AND is_published),
    available_days = CASE
      WHEN jsonb_typeof(availability_days) = 'array' THEN ARRAY(
        SELECT jsonb_array_elements_text(availability_days)
      )
      ELSE ARRAY[]::TEXT[]
    END,
    published_at = CASE WHEN is_active AND is_published THEN CURRENT_TIMESTAMP ELSE NULL END,
    display_order = sort_order
WHERE lifecycle_status = 'planned';

CREATE TABLE IF NOT EXISTS catalog_status_history (
  id BIGSERIAL PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('category', 'service', 'tool')),
  item_id UUID NOT NULL,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('planned', 'coming_soon', 'live', 'paused', 'retired')),
  to_status TEXT NOT NULL CHECK (to_status IN ('planned', 'coming_soon', 'live', 'paused', 'retired')),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_direct_catalog_categories_lifecycle
  ON direct_catalog_categories (lifecycle_status, display_order, sort_order);
CREATE INDEX IF NOT EXISTS idx_direct_catalog_services_lifecycle
  ON direct_catalog_services (category_id, lifecycle_status, is_operationally_available, display_order, sort_order);
CREATE INDEX IF NOT EXISTS idx_direct_catalog_tools_lifecycle
  ON direct_catalog_tools (lifecycle_status, is_operationally_available, display_order, sort_order);
CREATE INDEX IF NOT EXISTS idx_catalog_status_history_item
  ON catalog_status_history (item_type, item_id, changed_at DESC);

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'category', id, NULL, lifecycle_status, NULL, 'Backfilled from legacy catalog visibility'
FROM direct_catalog_categories
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_status_history h WHERE h.item_type = 'category' AND h.item_id = direct_catalog_categories.id
);

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'service', id, NULL, lifecycle_status, NULL, 'Backfilled from legacy catalog visibility'
FROM direct_catalog_services
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_status_history h WHERE h.item_type = 'service' AND h.item_id = direct_catalog_services.id
);

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'tool', id, NULL, lifecycle_status, NULL, 'Backfilled from legacy catalog visibility'
FROM direct_catalog_tools
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_status_history h WHERE h.item_type = 'tool' AND h.item_id = direct_catalog_tools.id
);
