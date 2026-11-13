-- Domain 8 #2: correction-hours carry-forwards have NULL input_id, so the
-- UNIQUE (input_type, input_id) backstop never fires for them (Postgres
-- treats NULLs as distinct in unique indexes) and two runs built
-- concurrently over overlapping periods can both claim the same
-- per-employee delta. A correction-hours delta is aggregated per
-- employee per source run, so (source_pay_run_id, staff_user_id) is the
-- exact-once key. applyCarryForward already uses bare ON CONFLICT DO
-- NOTHING, so the new index is picked up with no service change.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_run_carry_forward_correction_hours
  ON restaurant_pay_run_carry_forwards (source_pay_run_id, staff_user_id)
  WHERE input_type = 'correction_hours';
