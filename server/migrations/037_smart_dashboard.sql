-- Vehicle health tracking (per user)
CREATE TABLE IF NOT EXISTS user_vehicles (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      VARCHAR(80),
  make          VARCHAR(60),
  model         VARCHAR(60),
  year          SMALLINT,
  mileage       INTEGER,
  last_oil_change_miles INTEGER,
  last_oil_change_date  DATE,
  oil_change_interval_miles INTEGER DEFAULT 5000,
  next_service_date     DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_vehicles_user ON user_vehicles(user_id);

-- Dashboard alerts (generated server-side, not user-created)
CREATE TABLE IF NOT EXISTS dashboard_alerts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(40) NOT NULL, -- 'overdue_task','budget_exceeded','goal_stalled','job_expiring','vehicle_service','unread_message'
  severity    VARCHAR(10) NOT NULL DEFAULT 'info', -- 'info','warning','critical'
  title       VARCHAR(160) NOT NULL,
  body        VARCHAR(320),
  action_url  VARCHAR(255),
  dismissed   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dashboard_alerts_user_active
  ON dashboard_alerts(user_id, dismissed, expires_at);

-- User weather preference (zip stored on users already; just a toggle)
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_weather BOOLEAN DEFAULT TRUE;
