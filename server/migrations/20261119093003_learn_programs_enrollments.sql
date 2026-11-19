BEGIN;

-- PR #804 G-24: /learn was a content catalog with no program to join.
-- A program is a named bundle of one guide category; enrollment is the
-- program -> enrollment -> completion record the join_workforce intent
-- links to. Completion is derived, never self-declared: an enrollment
-- completes when the user completes every published guide in the
-- program's category (see recordCompletion in learnController.js).
-- Titles and descriptions are localized client-side by slug, so the seed
-- rows carry no user-visible copy.
CREATE TABLE IF NOT EXISTS learn_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learn_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES learn_programs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'completed')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT learn_enrollments_user_program_unique UNIQUE (user_id, program_id)
);
CREATE INDEX IF NOT EXISTS learn_enrollments_user_idx
  ON learn_enrollments (user_id, enrolled_at DESC);

INSERT INTO learn_programs (slug, category) VALUES
  ('helper-foundations', 'helper'),
  ('customer-service-essentials', 'customer'),
  ('workforce-management', 'management')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
