-- QR Code Generator - saved templates and configurations

BEGIN;

CREATE TABLE saved_qr_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  logo_url TEXT,
  overlay_text VARCHAR(255),
  text_position VARCHAR(20) DEFAULT 'bottom', -- 'top', 'bottom', 'none'
  text_color VARCHAR(7) DEFAULT '#000000',
  text_font_size INTEGER DEFAULT 14,
  square_color VARCHAR(7) DEFAULT '#000000',
  background_color VARCHAR(7) DEFAULT '#ffffff',
  error_correction_level VARCHAR(1) DEFAULT 'M', -- 'L', 'M', 'Q', 'H'
  template_type VARCHAR(50), -- 'profile', 'service', 'job', 'contact', 'custom'
  is_template BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_saved_qr_codes_user_id ON saved_qr_codes(user_id, created_at DESC);
CREATE INDEX idx_saved_qr_codes_template ON saved_qr_codes(user_id, is_template) WHERE is_template = TRUE;

-- Audit log for QR code generation
CREATE TABLE qr_code_scans (
  id BIGSERIAL PRIMARY KEY,
  qr_code_id BIGINT REFERENCES saved_qr_codes(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  user_agent TEXT,
  ip_hash VARCHAR(64)
);

CREATE INDEX idx_qr_code_scans_qr_id ON qr_code_scans(qr_code_id, scanned_at DESC);

COMMIT;
