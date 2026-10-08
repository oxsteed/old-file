-- 734: Seed the first real OxSteed Media Spaces so the Spaces branch has
-- useful local channels on a fresh deployment. Slugs make this idempotent.

INSERT INTO media_communities (slug, title, geo_scope, category)
VALUES
  ('springfield-oh-food', 'Springfield · Food & dining', 'Springfield, OH', 'food'),
  ('clark-county-help', 'Clark County · Local help', 'Clark County, OH', 'helpers'),
  ('springfield-oh-jobs', 'Springfield · Jobs & opportunities', 'Springfield, OH', 'jobs')
ON CONFLICT (slug) DO NOTHING;
