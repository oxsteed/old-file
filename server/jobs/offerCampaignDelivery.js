"use strict";
const db = require("../db");
const { withTransaction } = require("../utils/transaction");
const { withFencedJobLock } = require("./jobLockingService");
const core = require("../services/delivery/core");
const gate = require("../growth/gate");
const access = require("../growth/access");
const { key } = require("../growth/identity");
async function deliver(conn, d, deps = {}) {
  await conn.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `growth-recipient:${d.recipient_id}`,
  ]);
  const {
    rows: [ctx],
  } = await conn.query(
    `SELECT r.user_id,c.status AS campaign_status,c.approved_by,c.copy,c.channels,
    o.type,o.status AS offer_status,o.expires_at,o.partner_id,o.countries,o.channels AS allowed_channels,
    p.offer_push,p.offer_in_app,p.timezone,u.preferred_language,u.created_at,
    np.push_notifications,np.web_push_enabled
    FROM offer_campaign_recipients r JOIN offer_campaigns c ON c.id=r.campaign_id JOIN offers o ON o.id=c.offer_id
    JOIN users u ON u.id=r.user_id LEFT JOIN offer_preferences p ON p.user_id=r.user_id
    LEFT JOIN notification_preferences np ON np.user_id=r.user_id WHERE r.id=$1 FOR UPDATE OF c`,
    [d.recipient_id],
  );
  const skip = (reason) =>
    core.finishOffer(conn, d, { status: "skipped", reason });
  if (!ctx || !["queued", "sending"].includes(ctx.campaign_status))
    return skip("campaign_not_sending");
  await conn.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `growth-user:${ctx.user_id}`,
  ]);
  await conn.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
    [require("../growth/identity").consentLock(key("subject", ctx.user_id))],
  );
  if (process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED !== "true")
    return core.finishOffer(conn, d, { status: "pending", deferSeconds: 3600 });
  const permission = await gate.allow(
    { userId: ctx.user_id, db: conn },
    ctx.type === "affiliate_product" ? "partner_offers" : "activity_offers",
  );
  if (!permission.allowed) return skip(permission.reason);
  if (ctx.offer_status !== "active" || new Date(ctx.expires_at) <= new Date())
    return skip("offer_expired");
  if (new Date(ctx.created_at) > new Date(Date.now() - 14 * 86400000))
    return skip("new_account");
  if (
    !ctx.countries.includes(permission.context.user.country) ||
    !ctx.allowed_channels.includes(d.channel)
  )
    return skip("offer_channel_or_country");
  const boundary = await access.scope(
    { id: ctx.approved_by, role: "admin" },
    "approve_growth_campaigns",
  );
  if (!boundary.global) {
    const params = [ctx.user_id],
      where = access.predicate(boundary, "g", params);
    const { rows } = await conn.query(
      `SELECT u.id FROM users u JOIN geo_postal_centroids g ON g.country=u.country AND g.postal_code=u.zip_code
      WHERE u.id=$1 AND u.country_confirmed AND ${where} LIMIT 1`,
      params,
    );
    if (!rows.length) return skip("approver_region_changed");
  }
  if (ctx.type === "affiliate_product") {
    if (process.env.GROWTH_PARTNER_OFFERS_ENABLED !== "true")
      return skip("partner_offers_disabled");
    const {
      rows: [partner],
    } = await conn.query(
      "SELECT status,allowed_channels,countries_allowed FROM affiliate_partners WHERE id=$1",
      [ctx.partner_id],
    );
    if (
      !partner ||
      partner.status !== "active" ||
      !partner.allowed_channels.includes(d.channel) ||
      !partner.countries_allowed.includes(permission.context.user.country)
    )
      return skip("partner_channel_or_country");
  }
  const {
    rows: [suppression],
  } = await conn.query(
    "SELECT subject_key FROM marketing_suppressions WHERE subject_key=$1",
    [key("subject", ctx.user_id)],
  );
  if (suppression) return skip("suppressed");
  const {
    rows: [counts],
  } = await conn.query(
    `SELECT COUNT(*) FILTER(WHERE contacted_at>NOW()-interval '7 days')::int AS weekly,
    COUNT(*) FILTER(WHERE contacted_at>NOW()-interval '30 days')::int AS monthly,
    COUNT(*) FILTER(WHERE campaign_id=$2 AND channel='in_app' AND contacted_at>NOW()-interval '24 hours')::int AS seen
    FROM marketing_contact_log WHERE user_id=$1 AND channel=$3`,
    [ctx.user_id, d.campaign_id, d.channel],
  );
  const { rows: settings } = await conn.query(
    "SELECT key,value FROM platform_settings WHERE key IN ('growth.offer_push_weekly_cap','growth.offer_push_monthly_cap','growth.offer_in_app_weekly_cap')",
  );
  const caps = Object.fromEntries(
    settings.map((s) => [s.key, Number(s.value)]),
  );
  const weekly =
    d.channel === "push"
      ? (caps["growth.offer_push_weekly_cap"] ?? 1)
      : (caps["growth.offer_in_app_weekly_cap"] ?? 3);
  const monthly = caps["growth.offer_push_monthly_cap"] ?? 3;
  if (
    counts.weekly >= weekly ||
    (d.channel === "push" && counts.monthly >= monthly)
  )
    return skip("frequency_cap");
  const locale = ["en", "es", "fr", "ht", "ar"].includes(ctx.preferred_language)
    ? ctx.preferred_language
    : "en";
  const copy = ctx.copy[locale];
  const url = `/offers/${d.id}`;
  if (d.channel === "in_app") {
    if (ctx.offer_in_app === false) return skip("in_app_disabled");
    const notificationId = await core.sendInApp(conn, {
      userId: ctx.user_id,
      type: "growth_offer",
      title: copy.title,
      body: copy.body,
      data: {
        type: "growth_offer",
        delivery_id: String(d.id),
        campaign_id: String(d.campaign_id),
      },
      url,
      deliveryKey: `growth-offer:${d.id}`,
    });
    await core.finishOffer(conn, d, { status: "sent", notificationId });
  } else {
    const push = await gate.allow(permission.context, "offer_push");
    if (
      !push.allowed ||
      ctx.offer_push !== true ||
      ctx.push_notifications === false ||
      ctx.web_push_enabled === false
    )
      return skip("push_opted_out");
    if (core.quietHours(ctx.timezone))
      return core.finishOffer(conn, d, {
        status: "pending",
        deferSeconds: 3601,
      });
    // A displayed in-app card for this campaign suppresses the follow-up push.
    const {
      rows: [seen],
    } = await conn.query(
      `SELECT EXISTS(SELECT 1 FROM offer_campaign_deliveries WHERE campaign_id=$1 AND recipient_id=$2
      AND channel='in_app' AND opened_at>NOW()-interval '24 hours') AS yes`,
      [d.campaign_id, d.recipient_id],
    );
    if (seen.yes) return skip("already_seen");
    const payload = {
      title: copy.push_title,
      body: copy.push_body,
      type: "growth_offer",
      data: {
        type: "growth_offer",
        delivery_id: String(d.id),
        action_url: url,
        channel: "offers",
        track_url: `/api/broadcast-tracking/p/growth.${require("../growth/partners/tokens").sign({ delivery_id: String(d.id), exp: Date.now() + 30 * 86400000 })}`,
      },
    };
    const web = deps.webPush || require("../services/webPushService"),
      mobile = deps.mobilePush || require("../services/mobilePushService");
    const results = await Promise.allSettled([
      web.sendToUser(ctx.user_id, payload),
      mobile.sendToUser(ctx.user_id, payload),
    ]);
    const accepted = results.reduce(
      (n, r) => n + (r.status === "fulfilled" ? Number(r.value?.sent || 0) : 0),
      0,
    );
    if (!accepted) {
      const failed = results.some(
        (r) => r.status === "rejected" || r.value?.failed > 0,
      );
      return core.finishOffer(conn, d, {
        status:
          failed && d.attempts < 5 ? "pending" : failed ? "failed" : "skipped",
        reason: failed ? "push_provider_failure" : "no_push_device",
        deferSeconds: core.retrySeconds(d.attempts),
      });
    }
    await core.finishOffer(conn, d, { status: "sent" });
  }
  await conn.query(
    `INSERT INTO marketing_contact_log(user_id,campaign_id,source,channel) VALUES($1,$2,'growth_offer',$3) ON CONFLICT DO NOTHING`,
    [ctx.user_id, d.campaign_id, d.channel],
  );
}
async function run() {
  if (process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED !== "true")
    return { skipped: true };
  return withFencedJobLock(
    "growth-campaign-delivery",
    async (fence) => {
      const batch = await core.claimOffers(fence.db, 100);
      for (const d of batch) {
        fence.assertActive();
        try {
          await fence.fencedTransaction((conn) => deliver(conn, d));
        } catch {
          await core.finishOffer(fence.db, d, {
            status: d.attempts < 5 ? "pending" : "failed",
            reason: "delivery_unavailable",
            deferSeconds: core.retrySeconds(d.attempts),
          });
        }
      }
      await fence.db
        .query(`UPDATE offer_campaign_deliveries SET status='failed',lease_token=NULL,lease_expires_at=NULL,skip_reason='attempts_exhausted'
      WHERE status='sending' AND lease_expires_at<NOW() AND attempts>=5`);
      await fence.db
        .query(`UPDATE offer_campaigns c SET status='sent',updated_at=NOW() WHERE status IN ('queued','sending')
      AND NOT EXISTS(SELECT 1 FROM offer_campaign_deliveries d WHERE d.campaign_id=c.id AND d.status IN ('pending','sending'))`);
      return { processed: batch.length };
    },
    300,
  );
}
module.exports = { run, deliver };
