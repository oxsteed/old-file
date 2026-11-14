"use strict";
function entries(env = process.env) {
  const rows = [];
  if (env.GROWTH_TRACKING_HARD_OFF === "false")
    rows.push(
      [
        "growthActivityRelay",
        () => require("../jobs/activityOutboxRelay").run(),
        60 * 1000,
        { notifyChannel: "oxsteed_activity_outbox" },
      ],
      [
        "growthActivityWriter",
        () => require("./ingest/writer").run(),
        60 * 1000,
        // Cost audit 2026-11-13 item 11: wake on the stream insert
        // (queue.enqueue notifies oxsteed_activity_ingest); the 60s
        // interval is the safety sweep, matching the relay.
        { notifyChannel: "oxsteed_activity_ingest" },
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
      [
        "growthConsentAudit",
        () => require("../jobs/growthConsentAudit").run(),
        6 * 60 * 60 * 1000,
        {},
      ],
      [
        "growthClickhouseOps",
        () => require("../jobs/growthClickhouseOps").run(),
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
  if (env.GROWTH_PARTNER_OFFERS_ENABLED === "true")
    rows.push(
      [
        "growthPartnerFeeds",
        () => require("../jobs/partnerFeedImport").run(),
        60 * 60 * 1000,
        {},
      ],
      // D21: keep Amazon item data under Amazon's 24h freshness limit.
      [
        "growthAmazonItemRefresh",
        () => require("../jobs/amazonItemRefresh").run(),
        60 * 60 * 1000,
        {},
      ],
    );
  if (env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED === "true")
    rows.push(
      [
        "growthPolicyNotice",
        () => require("../jobs/policyNoticeDelivery").run(),
        60 * 1000,
        // Cost audit 2026-11-13 item 11: wake when a campaign starts
        // sending (policy_notice_campaigns_notify trigger); the 60s
        // interval is the safety sweep.
        { notifyChannel: "oxsteed_policy_notice" },
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
