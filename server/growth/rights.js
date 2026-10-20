"use strict";
const { key, consentLock } = require("./identity");
async function erase(conn, userId, reason = "account_erasure") {
  const subject = key("subject", userId);
  await conn.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    consentLock(subject),
  ]);
  await conn.query(
    `INSERT INTO growth_erasure_queue(subject_key,device_keys,reason)
    SELECT $1,COALESCE(array_agg(device_key::text),'{}'),$2 FROM growth_device_links WHERE subject_key=$1`,
    [subject, reason],
  );
  for (const table of [
    "user_interest_profiles",
    "propensity_scores",
    "growth_intent_dismissals",
    "demand_subject_daily",
    "supply_subject_daily",
  ]) {
    await conn.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
  }
  await conn.query(
    `UPDATE offer_campaign_deliveries SET status='skipped',skip_reason='privacy_erasure',lease_token=NULL,lease_expires_at=NULL
    WHERE recipient_id IN (SELECT id FROM offer_campaign_recipients WHERE user_id=$1) AND status IN ('pending','sending')`,
    [userId],
  );
  await conn.query("DELETE FROM activity_outbox WHERE user_id=$1", [userId]);
  // Preserve current denials: deleting a withdrawal would re-enable notice-basis collection.
  // The append-only ledger and current objection remain evidence of that choice.
}
async function exportData(conn, userId) {
  if (!process.env.GROWTH_SUBJECT_PEPPER) {
    const { rows } = await conn.query(
      "SELECT EXISTS(SELECT 1 FROM activity_tracking_rollout WHERE first_notice_sent_at IS NOT NULL) AS started",
    );
    if (rows[0]?.started) throw new Error("growth_export_identity_unavailable");
    return {
      tracking_consents: [],
      interests: [],
      offers: [],
      activity_events: [],
      segments: [],
      propensity_scores: [],
    };
  }
  const subject = key("subject", userId);
  const result = {};
  result.tracking_consents = (
    await conn.query(
      `SELECT purpose,granted,jurisdiction,source,consent_text_version,recorded_at
    FROM tracking_consents WHERE subject_key=$1 ORDER BY id`,
      [subject],
    )
  ).rows;
  result.interests = (
    await conn.query(
      `SELECT n.labels,p.score,p.last_seen FROM user_interest_profiles p
    JOIN demand_taxonomy_nodes n ON n.id=p.node_id WHERE p.user_id=$1`,
      [userId],
    )
  ).rows;
  result.offers = (
    await conn.query(
      `SELECT c.name,o.title,d.channel,d.status,d.sent_at,d.opened_at,d.clicked_at
    FROM offer_campaign_recipients r JOIN offer_campaigns c ON c.id=r.campaign_id
    JOIN offers o ON o.id=c.offer_id JOIN offer_campaign_deliveries d ON d.recipient_id=r.id WHERE r.user_id=$1`,
      [userId],
    )
  ).rows;
  const links = (
    await conn.query(
      "SELECT device_key FROM growth_device_links WHERE subject_key=$1",
      [subject],
    )
  ).rows.map((r) => r.device_key);
  if (process.env.GROWTH_CLICKHOUSE_URL) {
    const client = require("./clickhouse").getClient("rights");
    const rows = await client.query({
      query: `SELECT event_name,occurred_at,route,props FROM growth.activity_events FINAL
      WHERE (subject_key={subject:String} OR device_key IN {devices:Array(String)}) AND day>=today()-90
      ORDER BY occurred_at`,
      query_params: { subject, devices: links },
      format: "JSONEachRow",
    });
    result.activity_events = await rows.json();
  } else {
    const { rows } = await conn.query(
      "SELECT EXISTS(SELECT 1 FROM activity_tracking_rollout WHERE id=1 AND first_notice_sent_at IS NOT NULL) AS started",
    );
    if (rows[0]?.started) throw new Error("growth_export_store_unavailable");
    result.activity_events = [];
  }
  result.propensity_scores = (
    await conn.query(
      `SELECT model,score,reasons,model_version,computed_at FROM propensity_scores WHERE user_id=$1`,
      [userId],
    )
  ).rows;
  const definitions = (
    await conn.query(`SELECT s.name,v.definition FROM growth_segments s JOIN LATERAL
    (SELECT definition FROM growth_segment_versions WHERE segment_id=s.id ORDER BY version DESC LIMIT 1)v ON TRUE ORDER BY s.id`)
  ).rows;
  result.segments = [];
  // Evaluate only this account, with the same eligibility/consent gates as campaign selection.
  const { evaluate } = require("./segments/compile");
  for (const def of definitions)
    if (
      (
        await evaluate(
          conn,
          def.definition,
          { global: true, regions: [] },
          "activity_offers",
          { userId },
        )
      ).length
    )
      result.segments.push({ name: def.name });
  return result;
}
module.exports = { erase, exportData };
