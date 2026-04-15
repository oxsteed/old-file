-- 066_pulse_score_settings.sql
-- Per-user toggle table controlling which data sources feed the Life Pulse score.
-- All flags default TRUE so the score is fully inclusive out of the box.
-- A missing row is treated identically to all-TRUE (no row = full defaults).

CREATE TABLE IF NOT EXISTS pulse_score_settings (
  user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Manual ledger entries (expenses table)
  include_manual_income      BOOLEAN NOT NULL DEFAULT TRUE,
  include_manual_expenses    BOOLEAN NOT NULL DEFAULT TRUE,
  include_recurring_income   BOOLEAN NOT NULL DEFAULT TRUE,
  include_recurring_expenses BOOLEAN NOT NULL DEFAULT TRUE,

  -- OxSteed platform income
  include_oxsteed_income     BOOLEAN NOT NULL DEFAULT TRUE,  -- settled job payouts
  include_predicted_jobs     BOOLEAN NOT NULL DEFAULT TRUE,  -- authorized escrow (in-progress jobs)

  -- Business hub
  include_business_pl        BOOLEAN NOT NULL DEFAULT TRUE,  -- paid invoice income
  include_pending_invoices   BOOLEAN NOT NULL DEFAULT TRUE,  -- outstanding invoices (80% confidence)
  include_tax_obligations    BOOLEAN NOT NULL DEFAULT TRUE,  -- upcoming tax estimates

  -- Life plans (home_tasks with estimated_cost + is_recurring)
  include_home_maintenance   BOOLEAN NOT NULL DEFAULT TRUE,
  include_car_care           BOOLEAN NOT NULL DEFAULT TRUE,
  include_personal_care      BOOLEAN NOT NULL DEFAULT TRUE,

  -- Tool rental income (expenses.type='income' in tool/rental categories)
  include_tool_rentals       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Planned needs sinking fund obligations
  include_planned_needs      BOOLEAN NOT NULL DEFAULT TRUE,

  -- Debt obligations (recurring expenses in debt/loan/mortgage/credit categories)
  include_debt_obligations   BOOLEAN NOT NULL DEFAULT TRUE,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pulse_score_settings_user ON pulse_score_settings(user_id);
