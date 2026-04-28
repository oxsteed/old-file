-- Platform config key-value store for admin-editable settings
CREATE TABLE IF NOT EXISTS platform_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default tier pricing
INSERT INTO platform_config (key, value) VALUES
  ('tier1_price', '0'),
  ('tier1_label', 'Free'),
  ('tier2_price', '19.99'),
  ('tier2_label', '/month'),
  ('tier3_price', 'up to 17%'),
  ('tier3_label', 'per transaction')
ON CONFLICT (key) DO NOTHING;
