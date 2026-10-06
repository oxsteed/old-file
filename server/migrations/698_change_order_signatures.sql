-- Change order decisions require drawn signatures, per the records-room rule:
-- drawn signatures on everything (agreements, versions, and change orders).

ALTER TABLE work_agreement_change_orders
  ADD COLUMN IF NOT EXISTS decider_signature_data TEXT NULL,
  ADD COLUMN IF NOT EXISTS proposer_signature_data TEXT NULL;

-- The proposer signs at proposal time; the decider signs at decision time.
-- Existing rows (if any) predate the rule and are left NULL.
