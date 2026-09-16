-- Migration 527: enforce category relationships for Direct supporting tools.
-- Existing NULL category values remain valid for legacy inventory, but any
-- assigned category must resolve to an existing Direct category.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM direct_catalog_tools t
    WHERE t.category_slug IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM direct_catalog_categories c
        WHERE c.slug = t.category_slug
      )
  ) THEN
    RAISE EXCEPTION 'direct catalog contains tool rows with unknown category slugs';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'direct_catalog_tools_category_slug_fkey'
  ) THEN
    ALTER TABLE direct_catalog_tools
      ADD CONSTRAINT direct_catalog_tools_category_slug_fkey
      FOREIGN KEY (category_slug)
      REFERENCES direct_catalog_categories (slug)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;
