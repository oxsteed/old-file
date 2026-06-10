-- Migration 304: Country packs (pack architecture, docs/oxsteed-pack-architecture.md §5).
-- A country is a registered pack, never a condition check. This table is the
-- registry. `status` controls availability in the country picker:
--   active      -> selectable, full experience served from `config`
--   coming_soon -> listed in the picker as "coming soon", not selectable
--   disabled    -> hidden everywhere
-- `config` is the serialized country pack (currencies, locales, personas,
-- payment rails, etc.). Updating a country = updating its row. No code change.

CREATE TABLE IF NOT EXISTS country_packs (
  code            CHAR(2) PRIMARY KEY,            -- ISO 3166-1 alpha-2
  name            VARCHAR(80) NOT NULL,
  flag_emoji      VARCHAR(8) NOT NULL DEFAULT '',
  status          VARCHAR(16) NOT NULL DEFAULT 'coming_soon'
                    CHECK (status IN ('active', 'coming_soon', 'disabled')),
  sort_order      INTEGER NOT NULL DEFAULT 100,
  default_locale  VARCHAR(8) NOT NULL DEFAULT 'en',
  currency_code   CHAR(3) NOT NULL DEFAULT 'USD',
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_country_packs_status ON country_packs(status, sort_order);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_country_packs_updated_at') THEN
    CREATE TRIGGER trg_country_packs_updated_at
      BEFORE UPDATE ON country_packs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── Seeds ────────────────────────────────────────────────────────────────────
-- US is pack #1, not the base: every US-specific assumption lives here.
INSERT INTO country_packs (code, name, flag_emoji, status, sort_order, default_locale, currency_code, config)
VALUES (
  'US', 'United States', '🇺🇸', 'active', 1, 'en', 'USD',
  '{
    "locales": ["en", "es"],
    "units": "imperial",
    "enabled_personas": ["customer", "helper", "business", "consultant", "toolOwner", "franchise", "investor"],
    "payment_methods": ["stripe_card", "stripe_escrow"],
    "verification_provider": "didit",
    "address_scheme": "street_zip",
    "notification_channels": ["push", "email", "sms"],
    "connectivity_profile": "online_first",
    "trust_model": "escrow_background_checks",
    "feature_flags": {}
  }'::jsonb
)
ON CONFLICT (code) DO NOTHING;

-- Coming soon. Config holds the *planned* pack so product work can start
-- before the flip; nothing here is served to users until status = active.
INSERT INTO country_packs (code, name, flag_emoji, status, sort_order, default_locale, currency_code, config)
VALUES
  ('HT', 'Haiti', '🇭🇹', 'coming_soon', 10, 'ht', 'HTG',
   '{
     "locales": ["ht", "fr", "en"],
     "units": "metric",
     "enabled_personas": ["customer", "helper", "toolOwner"],
     "payment_methods": ["moncash", "cash_on_completion"],
     "verification_provider": "national_id",
     "address_scheme": "landmark",
     "notification_channels": ["sms", "push"],
     "connectivity_profile": "offline_first",
     "trust_model": "community_vouching",
     "feature_flags": {}
   }'::jsonb),
  ('DO', 'Dominican Republic', '🇩🇴', 'coming_soon', 20, 'es', 'DOP',
   '{
     "locales": ["es", "en"],
     "units": "metric",
     "enabled_personas": ["customer", "helper", "business", "toolOwner"],
     "payment_methods": ["card", "cash_on_completion"],
     "verification_provider": "national_id",
     "address_scheme": "street",
     "notification_channels": ["push", "sms"],
     "connectivity_profile": "online_first",
     "trust_model": "escrow_light",
     "feature_flags": {}
   }'::jsonb),
  ('RW', 'Rwanda', '🇷🇼', 'coming_soon', 30, 'en', 'RWF',
   '{
     "locales": ["rw", "en", "fr"],
     "units": "metric",
     "enabled_personas": ["customer", "helper", "toolOwner"],
     "payment_methods": ["mtn_momo", "airtel_money", "cash_on_completion"],
     "verification_provider": "national_id",
     "address_scheme": "landmark",
     "notification_channels": ["sms", "push"],
     "connectivity_profile": "offline_first",
     "trust_model": "community_vouching",
     "feature_flags": {}
   }'::jsonb),
  ('BR', 'Brazil', '🇧🇷', 'coming_soon', 40, 'pt', 'BRL',
   '{
     "locales": ["pt", "en"],
     "units": "metric",
     "enabled_personas": ["customer", "helper", "business", "consultant", "toolOwner"],
     "payment_methods": ["pix", "card"],
     "verification_provider": "cpf",
     "address_scheme": "street_cep",
     "notification_channels": ["push", "email"],
     "connectivity_profile": "online_first",
     "trust_model": "escrow_light",
     "feature_flags": {}
   }'::jsonb)
ON CONFLICT (code) DO NOTHING;
