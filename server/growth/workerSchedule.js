"use strict";
function entries(env = process.env) {
  const rows = [];
  if (env.GROWTH_TRACKING_HARD_OFF === "false")
    rows.push(
      [
        "growthActivityRelay",
        () => require("../jobs/activityOutboxRelay").run(),
        5000,
        {},
      ],
      [
        "growthActivityWriter",
        () => require("./ingest/writer").run(),
        2000,
        {},
      ],
      [
        "growthRollups",
        () => require("../jobs/growthNightlyRollups").run(),
        60 * 60 * 1000,
        {},
      ],
      [
        "growthSuggestions",
        () => require("../jobs/growthSuggestionProducer").run(),
        60 * 60 * 1000,
        {},
      ],
    );
  if (env.GROWTH_CAMPAIGN_DELIVERY_ENABLED === "true")
    rows.push([
      "growthOfferDelivery",
      () => require("../jobs/offerCampaignDelivery").run(),
      30000,
      {},
    ]);
  if (env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED === "true")
    rows.push(
      [
        "growthPolicyNotice",
        () => require("../jobs/policyNoticeDelivery").run(),
        1000,
        {},
      ],
      [
        "growthRollout",
        () =>
          require("../utils/transaction").withTransaction(
            require("../db"),
            (conn) => require("./rollout").advance(conn),
            "growth_rollout",
          ),
        60000,
        {},
      ],
    );
  // Erasure continues while collection and campaign sending are off.
  if (env.GROWTH_CLICKHOUSE_URL || env.GROWTH_REDIS_URL)
    rows.push([
      "growthErasure",
      () => require("../jobs/growthErasure").run(),
      60 * 60 * 1000,
      {},
    ]);
  return rows;
}
async function close() {
  await require("./queue").close();
  await require("./clickhouse").close();
}
module.exports = { entries, close };
