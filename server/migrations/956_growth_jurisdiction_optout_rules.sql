-- D9: keep the jurisdiction table as the runtime policy source. The broad US
-- row is notice-only; only the state rows below carry the sale/share control.
-- State rows intentionally remain unreviewed until Legal supplies the current
-- state list and review reference. The gate fails closed for unreviewed rows.
UPDATE jurisdiction_rules
SET sale_share_control=FALSE, updated_at=NOW()
WHERE code='US';

INSERT INTO jurisdiction_rules(code,activity_basis,offers_basis,sale_share_control)
VALUES
  ('US-CO','notice','notice',TRUE),
  ('US-CT','notice','notice',TRUE),
  ('US-DE','notice','notice',TRUE),
  ('US-IA','notice','notice',TRUE),
  ('US-IN','notice','notice',TRUE),
  ('US-KY','notice','notice',TRUE),
  ('US-MD','notice','notice',TRUE),
  ('US-MN','notice','notice',TRUE),
  ('US-MT','notice','notice',TRUE),
  ('US-NE','notice','notice',TRUE),
  ('US-NH','notice','notice',TRUE),
  ('US-NJ','notice','notice',TRUE),
  ('US-OR','notice','notice',TRUE),
  ('US-RI','notice','notice',TRUE),
  ('US-TN','notice','notice',TRUE),
  ('US-TX','notice','notice',TRUE),
  ('US-UT','notice','notice',TRUE),
  ('US-VA','notice','notice',TRUE)
ON CONFLICT (code) DO UPDATE
SET activity_basis=EXCLUDED.activity_basis,
    offers_basis=EXCLUDED.offers_basis,
    sale_share_control=EXCLUDED.sale_share_control,
    updated_at=NOW();

-- California already exists in the original additive migration. Keep its
-- explicit rule visible alongside the other state rows.
UPDATE jurisdiction_rules
SET activity_basis='notice', offers_basis='notice', sale_share_control=TRUE,
    updated_at=NOW()
WHERE code='US-CA';

-- D9 requires notice treatment for Canada, Québec, and Switzerland. These
-- rows are still subject to the normal reviewed_at rollout gate.
UPDATE jurisdiction_rules
SET activity_basis='notice', offers_basis='notice', updated_at=NOW()
WHERE code IN ('CA','CA-QC','CH');
