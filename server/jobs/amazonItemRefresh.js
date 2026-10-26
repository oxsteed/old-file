"use strict";
// D21: hourly GetItems refresh for Amazon offers. Items not refreshed in
// 20h are re-read; Amazon's 24h limit is enforced at delivery/redirect time
// (amazonWiring.itemFresh), so a failing API simply makes items stop
// showing instead of showing stale prices.
const { withFencedJobLock } = require("./jobLockingService");
const { refreshDue } = require("../growth/partners/amazonWiring");

async function run(deps = {}) {
  if (process.env.GROWTH_PARTNER_OFFERS_ENABLED !== "true" || process.env.GROWTH_AMAZON_ENABLED !== "true")
    return { skipped: true };
  return withFencedJobLock(
    "growth-amazon-item-refresh",
    async (fence) => refreshDue({ query: fence.db.query }, { deps }),
    900,
  );
}
module.exports = { run };
