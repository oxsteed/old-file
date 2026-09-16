-- Migration 528: fill missing catalog coverage metadata without changing
-- operator-managed values. Exact location eligibility remains authoritative
-- through direct_service_areas and the quote request flow.

UPDATE direct_catalog_services
SET service_area = 'Active Direct coverage areas; exact location confirmed before quote.'
WHERE slug LIKE 'direct-%'
  AND NULLIF(BTRIM(service_area), '') IS NULL;

UPDATE direct_catalog_tools
SET service_area = 'Active Direct coverage areas; exact location confirmed before quote.'
WHERE NULLIF(BTRIM(service_area), '') IS NULL
  AND is_published = TRUE;
