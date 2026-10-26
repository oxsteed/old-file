"use strict";
const crypto = require("crypto");
const { logAdminAction } = require("../services/auditService");
const { evaluate, isPersonalized } = require("./segments/compile");
const { scope } = require("./access");
const LOCALES = ["en", "es", "fr", "ht", "ar"];
// D21: a tracking tag identifies exactly one campaign in Amazon's reports.
async function assertAmazonTagFree(conn, tag, campaignId = null) {
  if (!tag) return;
  const { rows } = await conn.query(
    "SELECT id FROM offer_campaigns WHERE amazon_tracking_tag=$1 AND ($2::bigint IS NULL OR id<>$2) LIMIT 1",
    [tag, campaignId],
  );
  if (rows.length)
    throw Object.assign(new Error("amazon_tracking_tag_in_use"), { statusCode: 409, code: "amazon_tracking_tag_in_use" });
}

function validateCopy(copy, channels, { affiliate = false } = {}) {
  if (!copy || Object.keys(copy).some((k) => !LOCALES.includes(k)))
    throw new Error("invalid_campaign_copy");
  for (const locale of LOCALES) {
    const item = copy[locale];
    if (
      !item ||
      Object.keys(item).some(
        (k) =>
          ![
            "title",
            "body",
            "button",
            "push_title",
            "push_body",
            "disclosure",
          ].includes(k),
      )
    )
      throw new Error("invalid_campaign_copy");
    for (const [field, max] of [
      ["title", 120],
      ["body", 2000],
      ["button", 60],
      ...(channels.includes("push")
        ? [
            ["push_title", 50],
            ["push_body", 120],
          ]
        : []),
      ...(affiliate ? [["disclosure", 500]] : []),
    ]) {
      if (
        typeof item[field] !== "string" ||
        !item[field].trim() ||
        [...item[field]].length > max ||
        /<[^>]+>/.test(item[field])
      )
        throw new Error(`campaign_copy_required:${locale}:${field}`);
    }
  }
  return copy;
}
function holdout(id, campaign, pct) {
  return (
    (crypto
      .createHash("sha256")
      .update(`${campaign}:${id}`)
      .digest()
      .readUInt32BE(0) /
      2 ** 32) *
      100 <
    pct
  );
}
async function approve(conn, campaign, user, totp, checklist) {
  if (
    !checklist ||
    !["audience", "caps", "channels", "disclosures", "locales", "rtl"].every(
      (k) => checklist[k] === true,
    )
  )
    throw new Error("review_checklist_required");
  if (campaign.status !== "in_review")
    throw new Error("invalid_campaign_transition");
  validateCopy(campaign.copy, campaign.channels);
  // Fresh authenticator proof; one code can approve only one campaign.
  if (!/^\d{6}$/.test(totp || "")) throw new Error("growth_stepup_required");
  const {
    rows: [actor],
  } = await conn.query(
    "SELECT totp_enabled,totp_secret FROM users WHERE id=$1 FOR UPDATE",
    [user.id],
  );
  if (
    !actor?.totp_enabled ||
    !require("@otplib/v12-adapter").authenticator.verify({
      token: totp,
      secret: require("../utils/encryption").decrypt(actor.totp_secret),
    })
  )
    throw new Error("growth_stepup_invalid");
  const proof = require("./identity").key("approval", `${user.id}:${totp}`);
  await conn.query("DELETE FROM growth_approval_proofs WHERE expires_at<NOW()");
  const { rowCount } = await conn.query(
    `INSERT INTO growth_approval_proofs(proof_hash,expires_at) VALUES($1,NOW()+interval '2 minutes')
    ON CONFLICT DO NOTHING`,
    [proof],
  );
  if (!rowCount) throw new Error("growth_stepup_replayed");
  const boundary = await scope(user, "approve_growth_campaigns");
  const {
    rows: [version],
  } = await conn.query(
    "SELECT definition FROM growth_segment_versions WHERE id=$1",
    [campaign.segment_version_id],
  );
  const {
    rows: [offer],
  } = await conn.query("SELECT * FROM offers WHERE id=$1", [campaign.offer_id]);
  if (
    !offer ||
    offer.status !== "active" ||
    new Date(offer.expires_at) <= new Date()
  )
    throw new Error("offer_inactive");
  validateCopy(campaign.copy, campaign.channels, {
    affiliate: offer.type === "affiliate_product",
  });
  const audience = await evaluate(
    conn,
    version.definition,
    boundary,
    offer.type === "affiliate_product" ? "partner_offers" : "activity_offers",
    { personalized: campaign.is_personalized !== false },
  );
  // A regional approver must cover the FULL author's scoped audience, not
  // silently approve a smaller territorial intersection.
  const authorScope = await scope(
    { id: campaign.created_by, role: "admin" },
    "manage_marketing",
  );
  const full = await evaluate(
    conn,
    version.definition,
    authorScope,
    offer.type === "affiliate_product" ? "partner_offers" : "activity_offers",
    { personalized: campaign.is_personalized !== false },
  );
  if (full.some((r) => !audience.some((a) => a.id === r.id)))
    throw new Error("campaign_outside_approver_region");
  if (!audience.length) throw new Error("campaign_audience_empty");
  await conn.query(
    `UPDATE offer_campaigns SET status='approved',approved_by=$2,approved_at=NOW(),updated_at=NOW() WHERE id=$1`,
    [campaign.id, user.id],
  );
  await logAdminAction({
    adminId: user.id,
    action: "growth_campaign_approved",
    targetType: "offer_campaign",
    targetKey: campaign.id,
    after: { audience: audience.length, checklist },
    client: conn,
  });
  return { audience: audience.length };
}
async function queue(conn, campaign, user) {
  if (!["approved", "scheduled"].includes(campaign.status))
    throw new Error("invalid_campaign_transition");
  if (process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED !== "true")
    throw new Error("growth_delivery_disabled");
  const boundary = await scope(user, "approve_growth_campaigns");
  // Recheck the original approver's permission at execution too.
  await scope(
    { id: campaign.approved_by, role: "admin" },
    "approve_growth_campaigns",
  );
  const {
    rows: [version],
  } = await conn.query(
    "SELECT definition FROM growth_segment_versions WHERE id=$1",
    [campaign.segment_version_id],
  );
  const {
    rows: [offer],
  } = await conn.query("SELECT * FROM offers WHERE id=$1", [campaign.offer_id]);
  const rows = await evaluate(
    conn,
    version.definition,
    boundary,
    offer.type === "affiliate_product" ? "partner_offers" : "activity_offers",
    { personalized: campaign.is_personalized !== false },
  );
  // Small campaigns have no holdout. Stable hashes preserve assignment on retries.
  const pct =
    (rows.length * campaign.holdout_pct) / 100 >= 50 ? campaign.holdout_pct : 0;
  for (const row of rows) {
    const {
      rows: [recipient],
    } = await conn.query(
      `INSERT INTO offer_campaign_recipients(campaign_id,user_id,is_holdout) VALUES($1,$2,$3)
      ON CONFLICT(campaign_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`,
      [campaign.id, row.id, holdout(row.id, campaign.id, pct)],
    );
    if (!recipient.is_holdout)
      for (const channel of campaign.channels)
        await conn.query(
          `INSERT INTO offer_campaign_deliveries(campaign_id,recipient_id,channel)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [campaign.id, recipient.id, channel],
        );
  }
  await conn.query(
    "UPDATE offer_campaigns SET status='queued',updated_at=NOW() WHERE id=$1",
    [campaign.id],
  );
  await logAdminAction({
    adminId: user.id,
    action: "growth_campaign_queued",
    targetType: "offer_campaign",
    targetKey: campaign.id,
    after: { recipients: rows.length, holdout_pct: pct },
    client: conn,
  });
  return { recipients: rows.length, holdout_pct: pct };
}
// Offer opt-outs attributable to a campaign (spec 21.3): recipients who,
// after the campaign's first sent delivery, withdrew offer_push consent in
// the ledger or turned offer cards off in preferences.
async function optOutStats(conn, campaignId) {
  const {
    rows: [first],
  } = await conn.query(
    `SELECT MIN(sent_at) AS first_sent
     FROM offer_campaign_deliveries WHERE campaign_id=$1 AND status='sent'`,
    [campaignId],
  );
  if (!first?.first_sent) return { delivered: 0, optOuts: 0, rate: 0 };
  const { rows: recipients } = await conn.query(
    `SELECT DISTINCT r.user_id FROM offer_campaign_recipients r
     JOIN offer_campaign_deliveries d ON d.recipient_id=r.id
     WHERE d.campaign_id=$1 AND d.status='sent'`,
    [campaignId],
  );
  const userIds = recipients.map((r) => r.user_id);
  const keyByUser = new Map(
    userIds.map((id) => [require("./identity").key("subject", id), id]),
  );
  const { rows: pushOuts } = await conn.query(
    `SELECT DISTINCT subject_key FROM tracking_consents
     WHERE subject_key=ANY($1::char(64)[]) AND purpose='offer_push'
       AND granted=FALSE AND recorded_at>=$2`,
    [[...keyByUser.keys()], first.first_sent],
  );
  const { rows: appOuts } = await conn.query(
    `SELECT user_id FROM offer_preferences
     WHERE user_id=ANY($1::uuid[]) AND offer_in_app=FALSE AND updated_at>=$2`,
    [userIds, first.first_sent],
  );
  const optedOut = new Set([
    ...pushOuts.map((r) => keyByUser.get(r.subject_key)).filter(Boolean),
    ...appOuts.map((r) => r.user_id),
  ]);
  // Both sides of the rate count distinct people: the delivered side is
  // the distinct recipients with a sent delivery (a two-channel recipient
  // is one person), matching growth_offer_optout_rate_pct.
  return {
    delivered: userIds.length,
    optOuts: optedOut.size,
    rate: userIds.length ? optedOut.size / userIds.length : 0,
  };
}

// Holdout lift (spec 12.3): treated conversion rate minus control rate with
// a 90% interval (normal approximation on two proportions).
function holdoutLift({ treatedN, treatedC, controlN, controlC }) {
  if (!treatedN || !controlN)
    return { lift: null, low: null, high: null, label: "no_holdout" };
  const pt = treatedC / treatedN,
    pc = controlC / controlN;
  const se = Math.sqrt(
    (pt * (1 - pt)) / treatedN + (pc * (1 - pc)) / controlN,
  );
  const lift = pt - pc,
    margin = 1.645 * se;
  return {
    lift,
    low: lift - margin,
    high: lift + margin,
    treated_rate: pt,
    control_rate: pc,
    label: "measured",
  };
}

// N-01 / D10: a campaign may be labelled broad (not personalized) only when
// its segment uses broad clauses alone. Otherwise the request is refused so
// the admin sees why, and the database trigger from migration 99989 keeps
// the stored flag TRUE as a second line of defence.
function assertPersonalizationLabel(label, definition) {
  if (label === false && isPersonalized(definition))
    throw Object.assign(new Error("campaign_segment_personalized"), {
      status: 400,
    });
}

const EDITABLE_FIELDS = [
  "name",
  "offer_id",
  "segment_version_id",
  "channels",
  "copy",
  "holdout_pct",
  "is_personalized",
  "amazon_tracking_tag",
  "scheduled_at",
];
// Campaign editing (spec 15.2). Drafts and change-requested campaigns edit
// freely; changing an approved or scheduled campaign's audience, offer,
// channels, copy or holdout sends it back to draft and clears the approval,
// so it must be reviewed and approved again before it can queue. A bare
// schedule change on a scheduled campaign keeps its approval.
async function editCampaign(conn, campaign, user, patch, { affiliate = false } = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("invalid_campaign_edit");
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((k) => !EDITABLE_FIELDS.includes(k)))
    throw new Error("invalid_campaign_edit");
  if (["queued", "sending", "sent", "cancelled", "paused"].includes(campaign.status))
    throw new Error("invalid_campaign_transition");
  if (patch.channels !== undefined) {
    if (
      !Array.isArray(patch.channels) ||
      !patch.channels.length ||
      patch.channels.some((c) => !["in_app", "push"].includes(c))
    )
      throw new Error("invalid_campaign");
  }
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > 120)
      throw new Error("invalid_campaign");
  }
  if (patch.holdout_pct !== undefined) {
    if (!Number.isInteger(patch.holdout_pct) || patch.holdout_pct < 0 || patch.holdout_pct > 50)
      throw new Error("invalid_campaign");
  }
  if (
    patch.is_personalized !== undefined &&
    typeof patch.is_personalized !== "boolean"
  )
    throw new Error("invalid_campaign");
  if (
    patch.amazon_tracking_tag !== undefined &&
    patch.amazon_tracking_tag !== null &&
    !/^[A-Za-z0-9-]{1,64}$/.test(patch.amazon_tracking_tag)
  )
    throw new Error("invalid_campaign");
  if (patch.scheduled_at !== undefined && patch.scheduled_at !== null) {
    if (Number.isNaN(Date.parse(patch.scheduled_at)))
      throw new Error("invalid_campaign");
  }
  // N-01: re-derive personalization whenever the label or segment changes.
  if (patch.is_personalized !== undefined || patch.segment_version_id !== undefined) {
    const label = patch.is_personalized !== undefined ? patch.is_personalized : campaign.is_personalized;
    const {
      rows: [version],
    } = await conn.query(
      "SELECT definition FROM growth_segment_versions WHERE id=$1",
      [patch.segment_version_id ?? campaign.segment_version_id],
    );
    if (!version) throw new Error("invalid_campaign");
    assertPersonalizationLabel(label, version.definition);
  }
  const channels = patch.channels || campaign.channels;
  if (patch.copy !== undefined)
    validateCopy(patch.copy, channels, { affiliate });
  const contentChanged = [
    "offer_id",
    "segment_version_id",
    "channels",
    "copy",
    "holdout_pct",
    "is_personalized",
    "amazon_tracking_tag",
  ].some(
    (k) =>
      patch[k] !== undefined &&
      JSON.stringify(patch[k]) !== JSON.stringify(campaign[k]),
  );
  const forcesReapproval =
    contentChanged && ["approved", "scheduled"].includes(campaign.status);
  const next = { ...campaign, ...patch };
  if (patch.amazon_tracking_tag)
    await assertAmazonTagFree(conn, patch.amazon_tracking_tag, campaign.id);
  await conn.query(
    `UPDATE offer_campaigns SET name=$2, offer_id=$3, segment_version_id=$4,
       channels=$5, copy=$6, holdout_pct=$7, is_personalized=$8,
       amazon_tracking_tag=$9, scheduled_at=$10,
       status=$11, approved_by=$12, approved_at=$13, updated_at=NOW()
     WHERE id=$1`,
    [
      campaign.id,
      next.name,
      next.offer_id,
      next.segment_version_id,
      next.channels,
      JSON.stringify(next.copy),
      next.holdout_pct,
      next.is_personalized !== false,
      next.amazon_tracking_tag || null,
      next.scheduled_at,
      forcesReapproval ? "draft" : campaign.status,
      forcesReapproval ? null : campaign.approved_by,
      forcesReapproval ? null : campaign.approved_at,
    ],
  );
  await logAdminAction({
    adminId: user.id,
    action: forcesReapproval
      ? "growth_campaign_edited_reapproval"
      : "growth_campaign_edited",
    targetType: "offer_campaign",
    targetKey: campaign.id,
    after: { fields: keys, reapproval: forcesReapproval },
    client: conn,
  });
  return { status: forcesReapproval ? "draft" : campaign.status, reapproval: forcesReapproval };
}

// Review-time preview (spec 15.2/17.2): audience size, how many recipients
// the caps would skip per channel, how many pushes quiet hours would hold,
// how many have no push device, and overlap with other live campaigns.
async function reviewPreview(conn, campaign, user) {
  const boundary = await scope(user, "approve_growth_campaigns");
  const {
    rows: [version],
  } = await conn.query(
    "SELECT definition FROM growth_segment_versions WHERE id=$1",
    [campaign.segment_version_id],
  );
  const {
    rows: [offer],
  } = await conn.query("SELECT * FROM offers WHERE id=$1", [campaign.offer_id]);
  if (!version || !offer) throw new Error("campaign_preview_target_missing");
  const audience = await evaluate(
    conn,
    version.definition,
    boundary,
    offer.type === "affiliate_product" ? "partner_offers" : "activity_offers",
    { personalized: campaign.is_personalized !== false },
  );
  const userIds = audience.map((r) => r.id);
  // k-suppression, same rule as POST /segments/preview: an exact sub-k
  // total is never published, and neither is any count derived from a
  // sub-k audience (a nonzero derived count would bound the audience).
  const preview = {
    audience: userIds.length >= 5 ? userIds.length : null,
    below_k: userIds.length < 5,
    caps_skipped: {},
    quiet_hours_held: 0,
    no_push_device: 0,
    overlap: [],
  };
  if (userIds.length < 5) {
    preview.quiet_hours_held = null;
    preview.no_push_device = null;
    return preview;
  }
  const { rows: settings } = await conn.query(
    "SELECT key,value FROM platform_settings WHERE key IN ('growth.offer_push_weekly_cap','growth.offer_push_monthly_cap','growth.offer_in_app_weekly_cap')",
  );
  const caps = Object.fromEntries(settings.map((s) => [s.key, Number(s.value)]));
  for (const channel of campaign.channels) {
    const weeklyCap =
      channel === "push"
        ? (caps["growth.offer_push_weekly_cap"] ?? 1)
        : (caps["growth.offer_in_app_weekly_cap"] ?? 3);
    const monthlyCap = caps["growth.offer_push_monthly_cap"] ?? 3;
    const { rows } = await conn.query(
      `SELECT user_id,
         COUNT(*) FILTER(WHERE contacted_at>NOW()-interval '7 days')::int AS weekly,
         COUNT(*) FILTER(WHERE contacted_at>NOW()-interval '30 days')::int AS monthly
       FROM marketing_contact_log
       WHERE user_id=ANY($1::uuid[]) AND channel=$2 AND source='growth_offer'
       GROUP BY user_id`,
      [userIds, channel],
    );
    const skipped = rows.filter(
      (r) => r.weekly >= weeklyCap || (channel === "push" && r.monthly >= monthlyCap),
    ).length;
    preview.caps_skipped[channel] = skipped >= 5 ? skipped : null;
  }
  if (campaign.channels.includes("push")) {
    const core = require("../services/delivery/core");
    const { rows: people } = await conn.query(
      `SELECT u.id, u.country, p.timezone,
         EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id) AS web,
         EXISTS(SELECT 1 FROM mobile_push_tokens m WHERE m.user_id=u.id AND m.enabled=TRUE) AS mobile
       FROM users u LEFT JOIN offer_preferences p ON p.user_id=u.id
       WHERE u.id=ANY($1::uuid[])`,
      [userIds],
    );
    const now = new Date();
    let noDevice = 0,
      quietHeld = 0;
    for (const person of people) {
      if (!person.web && !person.mobile) noDevice++;
      const tz = core.resolveTimezone({
        timezone: person.timezone,
        country: person.country,
      });
      if (core.quietWindow(tz, now, 0).quiet) quietHeld++;
    }
    preview.no_push_device = noDevice >= 5 ? noDevice : null;
    preview.quiet_hours_held = quietHeld >= 5 ? quietHeld : null;
  }
  const { rows: others } = await conn.query(
    `SELECT c.id, c.name, c.status,
       (SELECT COUNT(*)::int FROM offer_campaign_recipients r
        WHERE r.campaign_id=c.id AND r.user_id=ANY($1::uuid[])) AS shared_recipients,
       (c.segment_version_id=$2) AS same_segment
     FROM offer_campaigns c
     WHERE c.id<>$3 AND c.status IN ('approved','scheduled','queued','sending')`,
    [userIds, campaign.segment_version_id, campaign.id],
  );
  preview.overlap = others
    .filter((o) => o.shared_recipients > 0 || o.same_segment)
    .map((o) => ({
      campaign_id: o.id,
      name: o.name,
      status: o.status,
      shared_recipients: o.shared_recipients >= 5 ? o.shared_recipients : null,
      below_k: o.shared_recipients < 5,
      same_segment: o.same_segment,
    }));
  return preview;
}

// Campaign results (spec 15.2): per channel sent/delivered/opened/clicked,
// converted gross and net (assisted conversions excluded, spec 13.1),
// revenue per currency for finance only, opt-outs, and holdout lift.
// "Delivered" for push means the delivery was accepted by at least one
// device (status sent); native push opens are partial until the companion
// app update ships, and are labelled as such.
async function campaignResults(conn, campaign, { finance = false } = {}) {
  const { rows: channels } = await conn.query(
    `SELECT channel,
       COUNT(*)::int AS attempted,
       COUNT(*) FILTER(WHERE status='sent')::int AS sent,
       COUNT(*) FILTER(WHERE opened_at IS NOT NULL)::int AS opened,
       COUNT(*) FILTER(WHERE clicked_at IS NOT NULL)::int AS clicked,
       COUNT(*) FILTER(WHERE status='skipped')::int AS skipped,
       COUNT(*) FILTER(WHERE status='failed')::int AS failed
     FROM offer_campaign_deliveries WHERE campaign_id=$1 GROUP BY channel`,
    [campaign.id],
  );
  const { rows: conversions } = await conn.query(
    `SELECT cv.currency, cv.status, COUNT(*)::int AS n,
       SUM(cv.sale_minor)::bigint AS sale_minor,
       SUM(cv.commission_minor)::bigint AS commission_minor
     FROM affiliate_conversions cv
     JOIN offer_clicks oc ON oc.click_id=cv.click_id
     JOIN offer_campaign_deliveries d ON d.id=oc.delivery_id
     WHERE d.campaign_id=$1 AND NOT cv.assisted
     GROUP BY cv.currency, cv.status`,
    [campaign.id],
  );
  const gross = conversions
    .filter((c) => ["pending", "approved", "paid"].includes(c.status))
    .reduce((n, c) => n + c.n, 0);
  const net = conversions
    .filter((c) => ["approved", "paid"].includes(c.status))
    .reduce((n, c) => n + c.n, 0);
  const reversed = conversions
    .filter((c) => c.status === "reversed")
    .reduce((n, c) => n + c.n, 0);
  const { rows: groups } = await conn.query(
    `SELECT r.is_holdout, COUNT(*)::int AS recipients,
       COUNT(DISTINCT oc.click_id)::int AS clicks
     FROM offer_campaign_recipients r
     LEFT JOIN offer_campaign_deliveries d ON d.recipient_id=r.id
     LEFT JOIN offer_clicks oc ON oc.delivery_id=d.id
     WHERE r.campaign_id=$1 GROUP BY r.is_holdout`,
    [campaign.id],
  );
  const treated = groups.find((g) => !g.is_holdout) || { recipients: 0 };
  const control = groups.find((g) => g.is_holdout) || { recipients: 0 };
  // Control-group conversions can only be observed through the campaign's
  // own promo code: holdout members never receive a tracked link.
  const { rows: redemptionRows } = await conn.query(
    `SELECT r.is_holdout, COUNT(*)::int AS n
     FROM promo_redemptions pr
     JOIN discount_codes dc ON dc.id=pr.discount_code_id
     JOIN offer_campaign_recipients r ON r.user_id=pr.user_id AND r.campaign_id=$1
     WHERE dc.offer_campaign_id=$1 AND pr.status='redeemed'
     GROUP BY r.is_holdout`,
    [campaign.id],
  );
  const treatedRedemptions =
    redemptionRows.find((g) => !g.is_holdout)?.n || 0;
  const controlRedemptions = redemptionRows.find((g) => g.is_holdout)?.n || 0;
  // Lift counts distinct converting people per group: a treated recipient
  // who both clicked through to a conversion and redeemed the campaign
  // code is one converter, not two (the funnel counts above stay per-row).
  const { rows: converterRows } = await conn.query(
    `SELECT DISTINCT grp, user_id FROM (
       SELECT FALSE AS grp, r.user_id AS user_id
         FROM affiliate_conversions cv
         JOIN offer_clicks oc ON oc.click_id=cv.click_id
         JOIN offer_campaign_deliveries d ON d.id=oc.delivery_id
         JOIN offer_campaign_recipients r ON r.id=d.recipient_id
        WHERE d.campaign_id=$1 AND NOT cv.assisted
          AND cv.status IN ('pending','approved','paid')
       UNION
       SELECT r.is_holdout AS grp, pr.user_id AS user_id
         FROM promo_redemptions pr
         JOIN discount_codes dc ON dc.id=pr.discount_code_id
         JOIN offer_campaign_recipients r ON r.user_id=pr.user_id AND r.campaign_id=$1
        WHERE dc.offer_campaign_id=$1 AND pr.status='redeemed'
     ) converters`,
    [campaign.id],
  );
  const treatedConverters = new Set(
    converterRows.filter((r) => !r.grp).map((r) => r.user_id),
  ).size;
  const controlConverters = new Set(
    converterRows.filter((r) => r.grp).map((r) => r.user_id),
  ).size;
  const lift = holdoutLift({
    treatedN: treated.recipients,
    treatedC: treatedConverters,
    controlN: control.recipients,
    controlC: controlConverters,
  });
  const optOuts = await optOutStats(conn, campaign.id);
  return {
    channels: channels.map((c) => ({
      ...c,
      delivered: c.sent,
      native_push_opens_partial:
        c.channel === "push"
          ? "Native push opens are partial until the app update ships"
          : undefined,
    })),
    conversions: {
      gross,
      net,
      reversed,
      by_currency: finance
        ? conversions
        : conversions.map(({ currency, status, n }) => ({ currency, status, n })),
    },
    holdout: {
      treated_recipients: treated.recipients,
      control_recipients: control.recipients,
      ...lift,
    },
    opt_outs: optOuts,
  };
}

module.exports = {
  assertAmazonTagFree,
  assertPersonalizationLabel,
  validateCopy,
  holdout,
  approve,
  queue,
  editCampaign,
  reviewPreview,
  campaignResults,
  optOutStats,
  holdoutLift,
  LOCALES,
};
