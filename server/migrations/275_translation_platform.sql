-- Translation platform foundation
-- Separates app locale metadata, runtime glossaries, translation records,
-- and async translation jobs.

CREATE TABLE IF NOT EXISTS languages (
  code VARCHAR(16) PRIMARY KEY,
  display_name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_ui_locale BOOLEAN NOT NULL DEFAULT FALSE,
  is_runtime_locale BOOLEAN NOT NULL DEFAULT TRUE,
  fallback_language_code VARCHAR(16) NULL REFERENCES languages(code) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO languages (
  code,
  display_name,
  native_name,
  enabled,
  is_ui_locale,
  is_runtime_locale,
  fallback_language_code
) VALUES
  ('en', 'English', 'English', TRUE, TRUE, TRUE, NULL),
  ('es', 'Spanish', 'Español', TRUE, TRUE, TRUE, 'en'),
  ('fr', 'French', 'Français', TRUE, TRUE, TRUE, 'en'),
  ('ht', 'Haitian Creole', 'Kreyòl Ayisyen', TRUE, TRUE, TRUE, 'en'),
  ('de', 'German', 'Deutsch', TRUE, FALSE, TRUE, 'en'),
  ('pt', 'Portuguese', 'Português', TRUE, FALSE, TRUE, 'en'),
  ('it', 'Italian', 'Italiano', TRUE, FALSE, TRUE, 'en'),
  ('nl', 'Dutch', 'Nederlands', TRUE, FALSE, TRUE, 'en'),
  ('pl', 'Polish', 'Polski', TRUE, FALSE, TRUE, 'en'),
  ('ar', 'Arabic', 'العربية', TRUE, FALSE, TRUE, 'en'),
  ('zh', 'Chinese', '中文', TRUE, FALSE, TRUE, 'en')
ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  native_name = EXCLUDED.native_name,
  enabled = EXCLUDED.enabled,
  is_ui_locale = EXCLUDED.is_ui_locale,
  is_runtime_locale = EXCLUDED.is_runtime_locale,
  fallback_language_code = EXCLUDED.fallback_language_code,
  updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS glossaries (
  id UUID PRIMARY KEY,
  owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  domain TEXT NULL,
  source_language_code VARCHAR(16) NULL REFERENCES languages(code) ON DELETE SET NULL,
  target_language_code VARCHAR(16) NULL REFERENCES languages(code) ON DELETE SET NULL,
  description TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_glossaries_owner_user_id
  ON glossaries(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS glossary_terms (
  id UUID PRIMARY KEY,
  glossary_id UUID NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
  source_term TEXT NOT NULL,
  target_term TEXT NOT NULL,
  locale_pair VARCHAR(40) NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_glossary_terms_unique_source_pair
  ON glossary_terms(glossary_id, locale_pair, source_term);

CREATE INDEX IF NOT EXISTS idx_glossary_terms_glossary_pair
  ON glossary_terms(glossary_id, locale_pair);

CREATE TABLE IF NOT EXISTS translation_requests (
  id UUID PRIMARY KEY,
  requester_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  request_type VARCHAR(16) NOT NULL DEFAULT 'sync'
    CHECK (request_type IN ('sync', 'batch', 'detect', 'legacy_batch')),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cached', 'completed', 'failed')),
  source_text TEXT NULL,
  normalized_source_text TEXT NULL,
  source_language_code VARCHAR(16) NULL REFERENCES languages(code) ON DELETE SET NULL,
  target_language_code VARCHAR(16) NULL REFERENCES languages(code) ON DELETE SET NULL,
  tone VARCHAR(40) NULL,
  glossary_id UUID NULL REFERENCES glossaries(id) ON DELETE SET NULL,
  glossary_version INTEGER NULL,
  provider VARCHAR(64) NULL,
  model VARCHAR(128) NULL,
  latency_ms INTEGER NULL,
  token_cost_estimate NUMERIC(12, 6) NULL,
  cache_key TEXT NULL,
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  confidence NUMERIC(5, 4) NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_translation_requests_requester_created
  ON translation_requests(requester_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_requests_cache_key
  ON translation_requests(cache_key);

CREATE TABLE IF NOT EXISTS translations (
  id UUID PRIMARY KEY,
  translation_request_id UUID NULL REFERENCES translation_requests(id) ON DELETE SET NULL,
  normalized_source_text TEXT NOT NULL,
  source_language_code VARCHAR(16) NOT NULL REFERENCES languages(code) ON DELETE RESTRICT,
  target_language_code VARCHAR(16) NOT NULL REFERENCES languages(code) ON DELETE RESTRICT,
  translated_text TEXT NOT NULL,
  tone VARCHAR(40) NULL,
  quality_score NUMERIC(5, 4) NULL,
  cache_key TEXT NOT NULL,
  glossary_id UUID NULL REFERENCES glossaries(id) ON DELETE SET NULL,
  glossary_version INTEGER NULL,
  provider VARCHAR(64) NULL,
  model VARCHAR(128) NULL,
  review_status VARCHAR(16) NOT NULL DEFAULT 'approved'
    CHECK (review_status IN ('approved', 'needs_review', 'rejected')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_translations_cache_key
  ON translations(cache_key);

CREATE INDEX IF NOT EXISTS idx_translations_lookup
  ON translations(source_language_code, target_language_code, created_at DESC);

CREATE TABLE IF NOT EXISTS translation_jobs (
  id UUID PRIMARY KEY,
  requester_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'partial')),
  source_language_code VARCHAR(16) NULL REFERENCES languages(code) ON DELETE SET NULL,
  target_language_code VARCHAR(16) NOT NULL REFERENCES languages(code) ON DELETE RESTRICT,
  tone VARCHAR(40) NULL,
  glossary_id UUID NULL REFERENCES glossaries(id) ON DELETE SET NULL,
  glossary_version INTEGER NULL,
  provider VARCHAR(64) NULL,
  model VARCHAR(128) NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  progress NUMERIC(5, 2) NOT NULL DEFAULT 0,
  input_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT NULL,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_requester_created
  ON translation_jobs(requester_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_status_created
  ON translation_jobs(status, created_at ASC);

CREATE TABLE IF NOT EXISTS ui_locale_keys (
  id BIGSERIAL PRIMARY KEY,
  namespace VARCHAR(80) NOT NULL,
  key_path TEXT NOT NULL,
  source_copy TEXT NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ui_locale_keys_namespace_key_unique UNIQUE (namespace, key_path)
);
