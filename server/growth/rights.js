"use strict";
const { key, consentLock } = require("./identity");
// A subject export that exceeds the row cap fails explicitly instead of
// shipping a silently truncated archive (spec 18.1: 90 days of events).
const ACTIVITY_EXPORT_ROW_CAP = 100000;
async function erase(conn, userId, reason = "account_erasure") {
  const subject = key("subject", userId);
  const summary = {};
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
    const result = await conn.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    summary[table] = result.rowCount || 0;
  }
  const skipped = await conn.query(
    `UPDATE offer_campaign_deliveries SET status='skipped',skip_reason='privacy_erasure',lease_token=NULL,lease_expires_at=NULL
    WHERE recipient_id IN (SELECT id FROM offer_campaign_recipients WHERE user_id=$1) AND status IN ('pending','sending')`,
    [userId],
  );
  summary.offer_deliveries_skipped = skipped.rowCount || 0;
  // Recipients with no delivered/opened/clicked record are still pending
  // targeting data and are removed. Delivered history remains exportable and
  // auditable, while ON DELETE CASCADE removes its pending deliveries.
  const recipients = await conn.query(
    `DELETE FROM offer_campaign_recipients r
     WHERE r.user_id=$1
       AND NOT EXISTS (
         SELECT 1 FROM offer_campaign_deliveries d
         WHERE d.recipient_id=r.id
           AND (d.sent_at IS NOT NULL OR d.opened_at IS NOT NULL OR d.clicked_at IS NOT NULL)
       )`,
    [userId],
  );
  summary.offer_recipients_removed = recipients.rowCount || 0;
  const outbox = await conn.query("DELETE FROM activity_outbox WHERE user_id=$1", [userId]);
  summary.activity_outbox = outbox.rowCount || 0;
  // Account erasure removes the denormalized current pointer. Consent history
  // remains append-only; withdrawal paths retain the current denial so a
  // notice-basis gate cannot accidentally re-enable collection.
  if (reason === "account_erasure") {
    const current = await conn.query(
      "DELETE FROM tracking_consent_current WHERE subject_key=$1",
      [subject],
    );
    summary.tracking_consent_current = current.rowCount || 0;
  }
  return summary;
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
      query: `SELECT event_name,occurred_at,route FROM growth.activity_events FINAL
      WHERE (subject_key={subject:String} OR device_key IN {devices:Array(String)}) AND day>=today()-90
      ORDER BY occurred_at LIMIT ${ACTIVITY_EXPORT_ROW_CAP + 1}`,
      query_params: { subject, devices: links },
      format: "JSONEachRow",
    });
    result.activity_events = await rows.json();
    if (result.activity_events.length > ACTIVITY_EXPORT_ROW_CAP)
      throw Object.assign(new Error("growth_export_result_limit_exceeded"), {
        code: "EXPORT_RESULT_LIMIT_EXCEEDED",
      });
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
module.exports = { erase, exportData, ACTIVITY_EXPORT_ROW_CAP };
