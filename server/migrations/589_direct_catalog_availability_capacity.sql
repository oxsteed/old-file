-- Migration 589: Direct catalog availability + capacity (long-term design).
-- 1) Live inventory ⇒ operationally available by default (backfill)
-- 2) booking_slot_minutes / required_crew_size on services
-- 3) Per-service assignee pool (roles + users)
-- 4) Optional brief slot holds
-- 5) Legacy tools JSON → planned catalog tools (best-effort)
-- 6) Report unmatched legacy service_areas (no geocode invent)

-- ---------------------------------------------------------------------------
-- 1. Capacity / slot shape columns
-- ---------------------------------------------------------------------------
ALTER TABLE direct_catalog_services
  ADD COLUMN IF NOT EXISTS booking_slot_minutes INTEGER NOT NULL DEFAULT 120
    CHECK (booking_slot_minutes >= 15 AND booking_slot_minutes <= 480),
  ADD COLUMN IF NOT EXISTS required_crew_size INTEGER NOT NULL DEFAULT 1
    CHECK (required_crew_size >= 1 AND required_crew_size <= 20);

ALTER TABLE direct_catalog_tools
  ADD COLUMN IF NOT EXISTS booking_slot_minutes INTEGER NOT NULL DEFAULT 120
    CHECK (booking_slot_minutes >= 15 AND booking_slot_minutes <= 480),
  ADD COLUMN IF NOT EXISTS required_crew_size INTEGER NOT NULL DEFAULT 1
    CHECK (required_crew_size >= 1 AND required_crew_size <= 20);

-- ---------------------------------------------------------------------------
-- 2. Operational backfill: Live ⇒ requestable by default
-- ---------------------------------------------------------------------------
UPDATE direct_catalog_services
   SET is_operationally_available = TRUE,
       updated_at = CURRENT_TIMESTAMP
 WHERE lifecycle_status = 'live'
   AND is_operationally_available = FALSE;

UPDATE direct_catalog_tools
   SET is_operationally_available = TRUE,
       updated_at = CURRENT_TIMESTAMP
 WHERE lifecycle_status = 'live'
   AND is_operationally_available = FALSE;

-- ---------------------------------------------------------------------------
-- 3. Per-service assignee pool
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direct_service_assignee_roles (
  service_id UUID NOT NULL REFERENCES direct_catalog_services(id) ON DELETE CASCADE,
  role VARCHAR(40) NOT NULL
    CHECK (role IN ('helper', 'helper_pro', 'broker', 'admin', 'super_admin')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, role)
);

CREATE TABLE IF NOT EXISTS direct_service_assignees (
  service_id UUID NOT NULL REFERENCES direct_catalog_services(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_direct_service_assignee_roles_service
  ON direct_service_assignee_roles (service_id);
CREATE INDEX IF NOT EXISTS idx_direct_service_assignees_service
  ON direct_service_assignees (service_id);
CREATE INDEX IF NOT EXISTS idx_direct_service_assignees_user
  ON direct_service_assignees (user_id);

-- ---------------------------------------------------------------------------
-- 4. Brief slot holds (optional race guard)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direct_slot_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES direct_catalog_services(id) ON DELETE CASCADE,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  reserved_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  hold_token VARCHAR(64) NOT NULL UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_direct_slot_holds_service_range
  ON direct_slot_holds (service_id, starts_at, ends_at)
  WHERE expires_at > CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_direct_slot_holds_expires
  ON direct_slot_holds (expires_at);
CREATE INDEX IF NOT EXISTS idx_direct_slot_holds_reserved
  ON direct_slot_holds (reserved_user_id, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- 5. Legacy tools JSON → planned catalog tools (do not auto-Live)
-- ---------------------------------------------------------------------------
INSERT INTO direct_catalog_tools (
  slug, name_i18n, description_i18n, icon_key,
  availability_days, available_days, sort_order, display_order,
  is_active, is_published, lifecycle_status,
  is_operationally_available, is_bookable
)
SELECT
  left(regexp_replace(lower(trim(tool_name)), '[^a-z0-9]+', '-', 'g'), 140),
  jsonb_build_object('en', left(trim(tool_name), 255)),
  jsonb_build_object('en', left('Imported from legacy Direct settings: ' || trim(tool_name), 1000)),
  'wrench',
  '[]'::jsonb,
  ARRAY[]::text[],
  9000,
  9000,
  TRUE,
  FALSE,
  'planned',
  FALSE,
  FALSE
FROM (
  SELECT DISTINCT trim(elem #>> '{}') AS tool_name
    FROM direct_service_profiles p
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(p.tools) = 'array' THEN p.tools ELSE '[]'::jsonb END
   ) AS elem
) legacy
WHERE length(trim(tool_name)) >= 2
  AND left(regexp_replace(lower(trim(tool_name)), '[^a-z0-9]+', '-', 'g'), 140) <> ''
  AND NOT EXISTS (
    SELECT 1
      FROM direct_catalog_tools t
     WHERE lower(COALESCE(t.name_i18n->>'en', '')) = lower(trim(tool_name))
        OR t.slug = left(regexp_replace(lower(trim(tool_name)), '[^a-z0-9]+', '-', 'g'), 140)
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Parent/child + inventory review helpers (views)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW direct_catalog_orphans_report AS
SELECT
  'live_child_nonlive_parent'::text AS issue,
  s.id AS service_id,
  s.slug AS service_slug,
  s.lifecycle_status AS service_lifecycle,
  c.id AS category_id,
  c.slug AS category_slug,
  c.lifecycle_status AS category_lifecycle
FROM direct_catalog_services s
JOIN direct_catalog_categories c ON c.id = s.category_id
WHERE s.lifecycle_status = 'live'
  AND c.lifecycle_status <> 'live';

UNION ALL

SELECT
  'tool_missing_category',
  t.id, t.slug, t.lifecycle_status,
  NULL, NULL, NULL
FROM direct_catalog_tools t
WHERE t.category_slug IS NULL
  AND t.lifecycle_status IN ('coming_soon', 'live', 'paused')

UNION ALL

SELECT
  'bookable_not_operational',
  s.id, s.slug, s.lifecycle_status,
  s.category_id, NULL, NULL
FROM direct_catalog_services s
WHERE s.is_bookable = TRUE
  AND s.is_operationally_available = FALSE

UNION ALL

SELECT
  'live_not_operational',
  s.id, s.slug, s.lifecycle_status,
  s.category_id, NULL, NULL
FROM direct_catalog_services s
WHERE s.lifecycle_status = 'live'
  AND s.is_operationally_available = FALSE;
