-- Migration 147: Multilingual Legal Documents
-- Support for international expansion with language-specific versioning

CREATE TABLE IF NOT EXISTS legal_document_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,

  -- Language details
  language_code VARCHAR(10) NOT NULL,  -- 'en', 'es', 'fr', 'ht', etc.
  language_name VARCHAR(50) NOT NULL,  -- 'English', 'Spanish', etc.

  -- Translated content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,

  -- Version tracking per language
  version_number INT NOT NULL,
  effective_date TIMESTAMP,

  -- Status per language
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- 'draft', 'pending_review', 'scheduled', 'live', 'archived'
  needs_review BOOLEAN DEFAULT FALSE,  -- Flagged as needing translation review

  -- Audit
  translated_by UUID REFERENCES users(id),
  translated_at TIMESTAMP DEFAULT NOW(),

  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,

  published_by UUID REFERENCES users(id),
  published_at TIMESTAMP,

  CONSTRAINT unique_doc_language_version UNIQUE(document_id, language_code, version_number),
  CONSTRAINT valid_translation_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

CREATE INDEX idx_legal_document_translations_document_id ON legal_document_translations(document_id);
CREATE INDEX idx_legal_document_translations_language ON legal_document_translations(document_id, language_code);
CREATE INDEX idx_legal_document_translations_status ON legal_document_translations(document_id, language_code, status);

-- Section translations
CREATE TABLE IF NOT EXISTS legal_section_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES legal_document_sections(id) ON DELETE CASCADE,

  -- Language details
  language_code VARCHAR(10) NOT NULL,
  language_name VARCHAR(50) NOT NULL,

  -- Translated content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  content_html TEXT,

  -- Version tracking
  version_number INT NOT NULL,
  effective_date TIMESTAMP,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  needs_review BOOLEAN DEFAULT FALSE,

  -- Audit
  translated_by UUID REFERENCES users(id),
  translated_at TIMESTAMP DEFAULT NOW(),

  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,

  CONSTRAINT unique_section_language_version UNIQUE(section_id, language_code, version_number),
  CONSTRAINT valid_section_translation_status CHECK (status IN ('draft', 'pending_review', 'scheduled', 'live', 'archived'))
);

CREATE INDEX idx_legal_section_translations_section_id ON legal_section_translations(section_id);
CREATE INDEX idx_legal_section_translations_language ON legal_section_translations(section_id, language_code);

-- Track translation completion
CREATE TABLE IF NOT EXISTS legal_translation_status (
  document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  language_code VARCHAR(10) NOT NULL,

  -- Completion
  is_complete BOOLEAN DEFAULT FALSE,
  percent_complete INT DEFAULT 0,

  -- Deadline
  due_date TIMESTAMP,

  -- Assigned translator
  assigned_to UUID REFERENCES users(id),

  PRIMARY KEY (document_id, language_code)
);

CREATE INDEX idx_legal_translation_status_document ON legal_translation_status(document_id);
