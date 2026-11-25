-- Group 12 Slice 3b (609): territory launch plan (D-309).
-- A launch plan surface on top of the readiness status: plan steps with
-- dates and owners, derived from the readiness state. The five default
-- steps are seeded at creation; HQ adds/edits/removes steps, the operator
-- updates step status. `milestone_id` is reserved for the 611 location
-- launch milestones, which do not exist yet in this wave — no FK until
-- 611 lands, so the plan surface works standalone and milestones plug in
-- later. Additive only; safe to run twice (IF NOT EXISTS / NOT EXISTS
-- guard on the backfill).

CREATE TABLE IF NOT EXISTS franchise_launch_plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  code VARCHAR(80),
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  owner_role VARCHAR(80) NOT NULL DEFAULT 'operator'
    CHECK (owner_role IN ('operator', 'hq', 'shared')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
  milestone_id UUID,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_launch_plan_application
  ON franchise_launch_plan_steps(application_id, sort_order, id);

-- Backfill the five default steps for applications created before this
-- slice. Applications that already have steps are left alone.
INSERT INTO franchise_launch_plan_steps (application_id, code, title, description, owner_role, sort_order)
SELECT fa.id, step.code, step.title, step.description, step.owner_role, step.sort_order
  FROM franchise_applications fa
  CROSS JOIN (VALUES
    ('confirm_boundary', 'Confirm territory boundary and exclusivity', 'Review the boundary summary and exclusivity with HQ.', 'operator', 10),
    ('complete_training', 'Complete operator training', 'Finish the training programme for your territory.', 'operator', 20),
    ('secure_location', 'Secure the first location', 'Sign the first location inside your territory.', 'operator', 30),
    ('recruit_team', 'Recruit the opening team', 'Hire the opening team for the first location.', 'operator', 40),
    ('confirm_opening_date', 'Confirm the opening date with HQ', 'Agree the launch date and readiness review with HQ.', 'shared', 50)
  ) AS step(code, title, description, owner_role, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM franchise_launch_plan_steps existing
    WHERE existing.application_id = fa.id
 );
