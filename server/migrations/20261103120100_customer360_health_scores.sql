-- Customer 360 upgrade 2: transparent, advisory account health and risk
-- scores. Each score stores the per-factor inputs, weights and contributions
-- that produced it, plus the model version, so staff can see exactly why a
-- customer scored as they did. Scores never trigger an action by themselves.

CREATE TABLE IF NOT EXISTS customer_health_scores (
  customer_id     UUID PRIMARY KEY,
  model_version   VARCHAR(40)  NOT NULL,
  churn_score     SMALLINT     NOT NULL CHECK (churn_score BETWEEN 0 AND 100),
  payment_score   SMALLINT     NOT NULL CHECK (payment_score BETWEEN 0 AND 100),
  support_score   SMALLINT     NOT NULL CHECK (support_score BETWEEN 0 AND 100),
  churn_band      VARCHAR(10)  NOT NULL CHECK (churn_band IN ('low', 'medium', 'high')),
  payment_band    VARCHAR(10)  NOT NULL CHECK (payment_band IN ('low', 'medium', 'high')),
  support_band    VARCHAR(10)  NOT NULL CHECK (support_band IN ('low', 'medium', 'high')),
  factors         JSONB        NOT NULL,
  computed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_health_scores_factors_object CHECK (jsonb_typeof(factors) = 'object')
);
CREATE INDEX IF NOT EXISTS customer_health_scores_risk_idx
  ON customer_health_scores (payment_band, churn_band, computed_at DESC);

-- Consumers of customer_events (health, summaries, anomalies…) keep their own
-- high-water mark so each can lag or replay independently.
CREATE TABLE IF NOT EXISTS customer360_event_consumers (
  consumer       VARCHAR(60) PRIMARY KEY,
  last_event_id  BIGINT      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
