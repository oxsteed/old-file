-- Encrypt payment identifiers at rest for PCI compliance
-- Adds encrypted column alongside plaintext (for gradual migration)

ALTER TABLE owner_payment_methods
ADD COLUMN payment_identifier_encrypted VARCHAR(512);

-- Add index for efficient queries (if we filter by payment type + encrypted identifier)
CREATE INDEX idx_owner_payment_methods_encrypted ON owner_payment_methods(owner_id, payment_identifier_encrypted);

-- Constraint: at least one of the two columns must have data (initially plaintext, later encrypted)
ALTER TABLE owner_payment_methods
ADD CONSTRAINT payment_identifier_not_empty CHECK (
  (payment_identifier IS NOT NULL) OR (payment_identifier_encrypted IS NOT NULL)
);
