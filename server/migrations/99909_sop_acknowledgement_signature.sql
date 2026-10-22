-- S-14: drawn e-signature for SOP acknowledgements.
-- Adds a nullable reference to the stored drawn-signature image on each
-- acknowledgement. NULL means the acknowledgement predates signature
-- capture (legacy click-to-sign rows stay valid; the client now requires
-- a drawn signature for new sign-offs).
ALTER TABLE restaurant_sop_acknowledgements
  ADD COLUMN IF NOT EXISTS signature_storage_key TEXT;
