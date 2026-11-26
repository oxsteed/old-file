-- Groups 5-6 item 282 (G5-19): job-linked material lines on the helper
-- work record. The work record itself (helper_job_work) holds one row per
-- job+helper, so materials live in their own lines table: one row per
-- material used on site, with the cost the customer can be shown when the
-- final price is disputed. Additive and idempotent.
CREATE TABLE IF NOT EXISTS helper_job_work_materials (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit VARCHAR(20),
  cost_cents INTEGER CHECK (cost_cents IS NULL OR (cost_cents >= 0 AND cost_cents <= 1000000000)),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hjwm_job ON helper_job_work_materials(job_id, created_at);
