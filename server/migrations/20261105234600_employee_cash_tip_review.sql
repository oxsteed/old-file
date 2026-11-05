-- Phase 3 Track B: manager-review state for declared cash tips.
--
-- A cash-tip declaration now carries a review status. Manager-entered
-- declarations (the pre-existing declareCashTip path) are confirmed at
-- entry, so every row written before this migration keeps flowing into
-- tip allocations exactly as before (DEFAULT 'confirmed').
--
-- Employee self-declarations (POST .../tips/cash-declarations/mine)
-- are inserted as 'pending' and stay out of pay until a manager
-- confirms them: getDeclaredCashTips only sums status = 'confirmed'.
-- A rejected declaration never flows into pay either. reviewed_by /
-- reviewed_at record who decided and when; the declaration row itself
-- is never deleted, so the review decision stays auditable.
ALTER TABLE restaurant_declared_cash_tips
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_declared_cash_tips_review
  ON restaurant_declared_cash_tips (restaurant_id, status, business_date);
