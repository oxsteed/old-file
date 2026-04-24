-- QR Code Generator feature for Pro users
-- Stores user-generated QR codes with styling and metadata

BEGIN;

CREATE TABLE IF NOT EXISTS qr_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  logo_url TEXT,                    -- URL to embedded logo image
  dot_color VARCHAR(7) DEFAULT '#000000',     -- Hex color for QR dots
  background_color VARCHAR(7) DEFAULT '#ffffff', -- Hex color for background
  dot_style VARCHAR(50) DEFAULT 'square',     -- square, rounded, dots, classy, classy-rounded
  size INTEGER DEFAULT 300,         -- Size in pixels (100-1000)
  image_url TEXT,                   -- URL to generated QR code image (PNG/SVG)
  image_format VARCHAR(10) DEFAULT 'png', -- png or svg
  download_count INTEGER DEFAULT 0, -- Track downloads
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_dot_style CHECK (dot_style IN ('square', 'rounded', 'dots', 'classy', 'classy-rounded')),
  CONSTRAINT valid_size CHECK (size >= 100 AND size <= 1000),
  CONSTRAINT valid_format CHECK (image_format IN ('png', 'svg'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_qr_codes_user_id
  ON qr_codes(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_codes_user_title
  ON qr_codes(user_id, title);

-- Track QR code downloads for analytics
CREATE TABLE IF NOT EXISTS qr_code_downloads (
  id BIGSERIAL PRIMARY KEY,
  qr_code_id BIGINT NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  download_format VARCHAR(10) NOT NULL, -- png or svg
  ip_hash VARCHAR(64),
  user_agent_hash VARCHAR(64),
  downloaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_download_format CHECK (download_format IN ('png', 'svg'))
);

CREATE INDEX IF NOT EXISTS idx_qr_code_downloads_qr_code_id
  ON qr_code_downloads(qr_code_id, downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_code_downloads_user_id
  ON qr_code_downloads(user_id, downloaded_at DESC);

COMMIT;
