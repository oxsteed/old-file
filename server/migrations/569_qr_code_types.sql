-- Allow the label studio to save QR codes and standard 1D barcode formats.
BEGIN;

ALTER TABLE qr_codes
  ADD COLUMN IF NOT EXISTS code_type VARCHAR(16) NOT NULL DEFAULT 'qr';

CREATE INDEX IF NOT EXISTS idx_qr_codes_user_code_type
  ON qr_codes(user_id, code_type, created_at DESC);

COMMIT;
