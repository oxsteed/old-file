-- 707: Admin tab preferences
-- Lets each admin mark which admin panel tabs are essential to their
-- workflow. Non-essential tabs are hidden from their sidebar.

CREATE TABLE IF NOT EXISTS admin_tab_prefs (
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tab_key TEXT NOT NULL,
  is_essential BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (admin_id, tab_key)
);
