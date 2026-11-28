-- S-C1 (D-767): consulting invoice numbers were `CONS-${Date.now()}`,
-- so two invoices created in the same millisecond collided on the UNIQUE
-- invoice_number and failed with a 23505 (a 500 to the caller, and a
-- failed change-request approval in the draft-invoice path). Numbers now
-- come from a dedicated sequence: provably unique, monotonic, and
-- gap-tolerant (a rolled-back nextval is a skipped number, never a
-- duplicate). START WITH 1001, following the support-ticket and
-- business-lead number sequences.
CREATE SEQUENCE IF NOT EXISTS consulting_invoice_number_seq START WITH 1001;
