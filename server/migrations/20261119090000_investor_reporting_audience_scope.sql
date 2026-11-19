-- PR #804 ecosystem gap G-45: investor reporting is platform-wide, not
-- position-scoped. The audience row carried only a free-text audience_key
-- and a dataset list; no report handler could tell which entities,
-- opportunities, or positions the audience covers. These columns record
-- the explicit scope on the audience row:
--   entity_ids: businesses (investment_opportunities.business_id) the
--     audience covers, derived from the investor's live positions,
--     commitments, and participation applications at approval time.
--   opportunity_ids: the investment opportunities behind those positions.
-- Both are arrays because one reporting grant can cover several positions.
-- The franchise dataset is filtered by entity_ids; the KPI, revenue,
-- supply/demand, and evidence datasets have no per-entity attribution in
-- the underlying tables (platform_ledger / jobs), so they stay platform
-- totals and are labeled platform-wide in the response instead of being
-- presented as position reporting. Scope is a snapshot at approval: a
-- reviewer re-approval refreshes it; positions gained after approval do
-- not appear until then.
BEGIN;

ALTER TABLE investor_reporting_audiences
  ADD COLUMN IF NOT EXISTS entity_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS opportunity_ids UUID[] NOT NULL DEFAULT '{}';

COMMIT;
