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
    (c.is_personalized IS NOT FALSE OR COALESCE(sv.is_personalized,TRUE)) AS is_personalized,
    o.type,o.status AS offer_status,o.expires_at,o.partner_id,o.countries,o.channels AS allowed_channels,
    p.offer_push,p.offer_in_app,p.timezone,u.preferred_language,u.created_at,
    np.push_notifications,np.web_push_enabled
    FROM offer_campaign_recipients r JOIN offer_campaigns c ON c.id=r.campaign_id JOIN offers o ON o.id=c.offer_id
    LEFT JOIN growth_segment_versions sv ON sv.id=c.segment_version_id
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
    { personalized: ctx.is_personalized !== false },
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
      "SELECT status,network,allowed_channels,countries_allowed FROM affiliate_partners WHERE id=$1",
      [ctx.partner_id],
    );
    if (
      !partner ||
      partner.status !== "active" ||
      !partner.allowed_channels.includes(d.channel) ||
      !partner.countries_allowed.includes(permission.context.user.country)
    )
      return skip("partner_channel_or_country");
    const amazonWiring = require("../growth/partners/amazonWiring");
    if (amazonWiring.isAmazon(partner.network)) {
      // D21: never promote an Amazon item that is gone or >24h old.
      const {
        rows: [item],
      } = await conn.query(
        "SELECT i.available,i.last_refreshed_at FROM amazon_offer_items i JOIN offer_campaigns c ON c.offer_id=i.offer_id WHERE c.id=$1",
        [d.campaign_id],
      );
      if (!amazonWiring.itemFresh(item)) return skip("amazon_item_unavailable_or_stale");
    }
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
    FROM marketing_contact_log
    WHERE user_id=$1 AND channel=$3 AND source='growth_offer'`,
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
    const push = await gate.allow(permission.context, "offer_push", {
      personalized: ctx.is_personalized !== false,
    });
    if (
      !push.allowed ||
      ctx.offer_push !== true ||
      ctx.push_notifications === false ||
      ctx.web_push_enabled === false
    )
      return skip("push_opted_out");
    // Precise quiet hours (spec 16.2): a held push is rescheduled to 08:00
    // recipient-local plus 0-30 minutes of jitter, and dropped when the
    // offer expires before that next attempt.
    const quiet = core.quietWindow(
      core.resolveTimezone({
        timezone: ctx.timezone,
        country: permission.context.user.country,
      }),
      new Date(),
      Math.floor(Math.random() * 31),
    );
    if (quiet.quiet) {
      if (new Date(ctx.expires_at) <= quiet.nextAttemptAt)
        return skip("quiet_hours_offer_expired");
      return core.finishOffer(conn, d, {
        status: "pending",
        deferSeconds: Math.max(
          60,
          Math.ceil((quiet.nextAttemptAt.getTime() - Date.now()) / 1000),
        ),
      });
    }
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
async function promoteScheduled(fence) {
  const { rows } = await fence.db.query(
    `SELECT * FROM offer_campaigns WHERE status='scheduled' AND scheduled_at IS NOT NULL
     AND scheduled_at<=NOW() ORDER BY scheduled_at LIMIT 20`,
  );
  const campaigns = require("../growth/campaigns");
  for (const campaign of rows) {
    try {
      await fence.fencedTransaction((conn) =>
        campaigns.queue(conn, campaign, { id: campaign.approved_by }),
      );
    } catch (error) {
      // A campaign that can no longer queue (offer expired, approver grant
      // revoked) stays scheduled and is retried next tick; the failure is
      // visible in logs instead of silently dropping the campaign.
      require("../utils/logger").warn("growth scheduled campaign not queued", {
        campaignId: campaign.id,
        error: error.message,
      });
    }
  }
  return rows.length;
}
async function autoPause(fence) {
  const campaigns = require("../growth/campaigns");
  const { logAdminAction } = require("../services/auditService");
  const { rows } = await fence.db.query(
    `SELECT DISTINCT c.id, c.approved_by FROM offer_campaigns c
     JOIN offer_campaign_deliveries d ON d.campaign_id=c.id AND d.status='sent'
     WHERE c.status IN ('queued','sending')`,
  );
  let paused = 0;
  for (const row of rows) {
    const stats = await campaigns.optOutStats(fence.db, row.id);
    // Spec 21.3: auto-pause above 1% offer opt-outs. The 100-delivered
    // floor keeps a single opt-out in a tiny send from pausing a campaign
    // on noise (the spec names no floor; the floor was ratified by the
    // owner on 2026-10-20 and recorded in design-spec.md 21.1).
    if (stats.delivered >= 100 && stats.rate > 0.01) {
      const { rowCount } = await fence.db.query(
        `UPDATE offer_campaigns SET status='paused', updated_at=NOW()
         WHERE id=$1 AND status IN ('queued','sending')`,
        [row.id],
      );
      if (rowCount) {
        paused++;
        await logAdminAction({
          adminId: row.approved_by,
          action: "growth_campaign_auto_paused",
          targetType: "offer_campaign",
          targetKey: row.id,
          after: {
            system_rule: "offer_optout_rate_above_1pct",
            delivered: stats.delivered,
            opt_outs: stats.optOuts,
            rate: stats.rate,
          },
        });
      }
    }
  }
  return paused;
}
async function run() {
  if (process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED !== "true")
    return { skipped: true };
  return withFencedJobLock(
    "growth-campaign-delivery",
    async (fence) => {
      await promoteScheduled(fence);
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
      // Terminal state for exhausted retries: claimOffers only takes rows
      // with attempts<5, so without this sweep a pending row at the attempt
      // ceiling would sit forever and its campaign could never complete.
      await fence.db
        .query(`UPDATE offer_campaign_deliveries SET status='failed',skip_reason='attempts_exhausted'
      WHERE status='pending' AND attempts>=5`);
      const paused = await autoPause(fence);
      await fence.db
        .query(`UPDATE offer_campaigns c SET status='sent',updated_at=NOW() WHERE status IN ('queued','sending')
      AND NOT EXISTS(SELECT 1 FROM offer_campaign_deliveries d WHERE d.campaign_id=c.id AND d.status IN ('pending','sending'))`);
      return { processed: batch.length, paused };
    },
    300,
  );
}
module.exports = { run, deliver, promoteScheduled, autoPause };
