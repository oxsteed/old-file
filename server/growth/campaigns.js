"use strict";
const crypto = require("crypto");
const { logAdminAction } = require("../services/auditService");
const { evaluate } = require("./segments/compile");
const { scope } = require("./access");
const LOCALES = ["en", "es", "fr", "ht", "ar"];
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
module.exports = { validateCopy, holdout, approve, queue, LOCALES };
