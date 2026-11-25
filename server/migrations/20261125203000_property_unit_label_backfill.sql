-- Batch F (301-310, G6-4): backfill property_portfolio_units.property_id
-- from the free-text property_label. Migration 20261123200000 added the
-- column but backfilled nothing, so every unit created before the console
-- keeps property_id NULL and the two hierarchies still cannot join.
-- The backfill links a unit to the earliest-created property of the same
-- business whose label matches the unit's label after trimming whitespace.
-- Case must match exactly: a differently-cased label is not assumed to be
-- the same building, so those rows stay NULL for a manager to link by hand
-- (console attach, or the ops-tab property picker). Additive and
-- idempotent: re-running only touches rows that are still unlinked.
UPDATE property_portfolio_units u
SET property_id = (
  SELECT p.id
  FROM properties p
  WHERE p.business_id = u.business_id
    AND BTRIM(p.label) = BTRIM(u.property_label)
  ORDER BY p.created_at ASC, p.id ASC
  LIMIT 1
)
WHERE u.property_id IS NULL
  AND u.property_label IS NOT NULL
  AND BTRIM(u.property_label) <> '';
