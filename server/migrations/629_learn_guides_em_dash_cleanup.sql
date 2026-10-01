-- Migration 629: Learn guide copy — em dash cleanup
--
-- Migration 627 seeded the learn_guides catalog with em dashes (U+2014) in
-- user-visible copy. Em dashes are banned from user-visible prose, so this
-- forward data migration normalizes every spaced em dash to a comma in all
-- user-visible guide fields. It is idempotent: rows without em dashes are
-- untouched and re-running changes nothing.

UPDATE learn_guides
SET
  title = replace(title, ' — ', ', '),
  intro = replace(intro, ' — ', ', '),
  steps = CASE
    WHEN jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) > 0 THEN (
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(step) = 'string'
             THEN to_jsonb(replace(step #>> '{}', ' — ', ', '))
             ELSE step END
        ORDER BY ord
      )
      FROM jsonb_array_elements(steps) WITH ORDINALITY AS s(step, ord)
    )
    ELSE steps
  END,
  skills = CASE
    WHEN coalesce(cardinality(skills), 0) > 0 THEN (
      SELECT array_agg(replace(skill, ' — ', ', ') ORDER BY ord)
      FROM unnest(skills) WITH ORDINALITY AS s(skill, ord)
    )
    ELSE skills
  END,
  tools = CASE
    WHEN jsonb_typeof(tools) = 'array' AND jsonb_array_length(tools) > 0 THEN (
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(tool) = 'object' THEN (
               SELECT jsonb_object_agg(
                 key,
                 CASE WHEN jsonb_typeof(value) = 'string'
                      THEN to_jsonb(replace(value #>> '{}', ' — ', ', '))
                      ELSE value END
               )
               FROM jsonb_each(tool)
             )
             ELSE tool END
        ORDER BY ord
      )
      FROM jsonb_array_elements(tools) WITH ORDINALITY AS t(tool, ord)
    )
    ELSE tools
  END
WHERE title LIKE '% — %'
   OR intro LIKE '% — %'
   OR steps::text LIKE '% — %'
   OR array_to_string(skills, ' ') LIKE '% — %'
   OR tools::text LIKE '% — %';
