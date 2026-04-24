-- QR Code Generator enhancements: Templates, Text Overlays, and Batch Generation
-- Adds preset template support, text overlay capabilities, and batch generation tracking

BEGIN;

-- Add columns for preset templates
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS template_type VARCHAR(50);
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add text overlay columns
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS overlay_text VARCHAR(255);
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS overlay_position VARCHAR(20) DEFAULT 'bottom'; -- top, bottom, inside
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS overlay_text_color VARCHAR(7) DEFAULT '#000000';
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS overlay_text_size INTEGER DEFAULT 14;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS overlay_background_color VARCHAR(7);

-- Add constraint for template types
ALTER TABLE qr_codes ADD CONSTRAINT valid_template_type
  CHECK (template_type IS NULL OR template_type IN ('profile', 'service', 'job', 'contact', 'custom'));

-- Add constraint for overlay position
ALTER TABLE qr_codes ADD CONSTRAINT valid_overlay_position
  CHECK (overlay_position IN ('top', 'bottom', 'inside'));

-- Create table for batch generation tracking
CREATE TABLE IF NOT EXISTS qr_code_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_name VARCHAR(255) NOT NULL,
  batch_type VARCHAR(50) NOT NULL, -- 'services', 'jobs', 'skills', 'manual'
  config JSONB NOT NULL DEFAULT '{}', -- Stores common config (colors, logo, etc)
  qr_code_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qr_code_batches_user_id
  ON qr_code_batches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_codes_batch_id
  ON qr_codes(batch_id);

-- Create presets table
CREATE TABLE IF NOT EXISTS qr_code_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preset_name VARCHAR(255) NOT NULL,
  dot_color VARCHAR(7) DEFAULT '#000000',
  background_color VARCHAR(7) DEFAULT '#ffffff',
  dot_style VARCHAR(50) DEFAULT 'square',
  logo_url TEXT,
  overlay_text_color VARCHAR(7) DEFAULT '#000000',
  overlay_text_size INTEGER DEFAULT 14,
  overlay_position VARCHAR(20) DEFAULT 'bottom',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_dot_style_preset CHECK (dot_style IN ('square', 'rounded', 'dots', 'classy', 'classy-rounded')),
  CONSTRAINT valid_overlay_position_preset CHECK (overlay_position IN ('top', 'bottom', 'inside'))
);

CREATE INDEX IF NOT EXISTS idx_qr_code_presets_user_id
  ON qr_code_presets(user_id);

CREATE INDEX IF NOT EXISTS idx_qr_code_presets_user_default
  ON qr_code_presets(user_id, is_default);

COMMIT;
