"use strict";
const crypto = require("crypto");
const copy = require("./policyCopy.json");
const escape = require("../utils/escapeHtml");
const { logAdminAction } = require("../services/auditService");
function renderNotice({ email, language, plannedDate }) {
  const locale = Object.hasOwn(copy, language) ? language : "en";
  const [title, ...paragraphs] = copy[locale];
  const date = new Date(plannedDate).toLocaleDateString(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const url = `https://oxsteed.com/privacy/upcoming?lang=${locale}`;
  const subject = require("./policyNoticeSubjects.json")[locale].replace(
    "{{date}}",
    date,
  );
  const text = `${subject}\n\n${paragraphs.map((p) => `• ${p}`).join("\n\n")}\n\n${url}\nhttps://oxsteed.com/settings/privacy\nprivacy@oxsteed.com`;
  const html = `<html lang="${locale}" dir="${["ar", "ur"].includes(locale) ? "rtl" : "ltr"}"><body><h1>${escape(subject)}</h1><ul>${paragraphs.map((p) => `<li>${escape(p)}</li>`).join("")}</ul><p><a href="${url}">${escape(title)}</a></p><p><a href="https://oxsteed.com/settings/privacy">OxSteed</a></p><p><a href="mailto:privacy@oxsteed.com">privacy@oxsteed.com</a></p></body></html>`;
  return { to: [email], subject, text, html };
}
function contentDigest() {
  const hash = crypto.createHash("sha256");
  const manifest = require("./policyManifest.json");
  for (const lang of Object.keys(copy).sort()) {
    const checksum = manifest[lang];
    if (!/^[a-f0-9]{64}$/.test(checksum || ""))
      throw new Error("policy_translation_incomplete");
    hash.update(lang).update(checksum);
  }
  hash.update(JSON.stringify(copy));
  hash.update(JSON.stringify(require("./policyNoticeSubjects.json")));
  return hash.digest("hex");
}
async function schedule(
  conn,
  {
    user,
    plannedLastSendAt,
    dailyCap = 750000,
    legalReviewRef,
    translationReviewRef,
    rightsReviewRef,
  },
) {
  if (
    ![legalReviewRef, translationReviewRef, rightsReviewRef].every(
      (s) => typeof s === "string" && s.trim().length >= 5 && s.length <= 500,
    )
  )
    throw new Error("growth_launch_review_required");
  if (
    !Number.isInteger(dailyCap) ||
    dailyCap < 1 ||
    dailyCap > 750000 ||
    !Number.isFinite(Date.parse(plannedLastSendAt))
  )
    throw new Error("invalid_notice_plan");
  const digest = contentDigest();
  const {
    rows: [r],
  } = await conn.query(
    "SELECT * FROM activity_tracking_rollout WHERE id=1 FOR UPDATE",
  );
  if (r.state !== "draft") throw new Error("notice_plan_frozen");
  const {
    rows: [count],
  } = await conn.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL AND NOT is_banned AND email LIKE '%@%'`,
  );
  if (
    new Date(plannedLastSendAt).getTime() <
    Date.now() + Math.max(0, Math.ceil(count.n / dailyCap) - 1) * 86400000
  )
    throw new Error("notice_plan_too_short");
  const {
    rows: [campaign],
  } = await conn.query(
    `INSERT INTO policy_notice_campaigns(policy_version,status,planned_last_send_at,daily_cap,created_by,content_digest)
    VALUES($1,'scheduled',$2,$3,$4,$5) RETURNING *`,
    [r.policy_version, plannedLastSendAt, dailyCap, user.id, digest],
  );
  await conn.query(
    `INSERT INTO policy_notice_deliveries(campaign_id,user_id,language,status)
    SELECT $1,u.id,COALESCE(u.preferred_language,'en'),CASE WHEN EXISTS(
      SELECT 1 FROM business_broadcast_suppressions s WHERE lower(s.email)=lower(u.email) AND s.source IN ('hard_bounce','complaint')) THEN 'suppressed' ELSE 'pending' END
    FROM users u WHERE u.deleted_at IS NULL AND NOT u.is_banned AND u.email LIKE '%@%'`,
    [campaign.id],
  );
  const effective = new Date(
    new Date(plannedLastSendAt).getTime() + 14 * 86400000,
  );
  await conn.query(
    `UPDATE activity_tracking_rollout SET state='notice_scheduled',planned_effective_at=$1,
    legal_review_ref=$2,translations_reviewed=TRUE,rights_verified=TRUE,updated_at=NOW() WHERE id=1`,
    [effective, legalReviewRef],
  );
  await logAdminAction({
    adminId: user.id,
    action: "growth_notice_scheduled",
    targetType: "policy_notice",
    targetKey: campaign.id,
    after: {
      planned_effective_at: effective,
      daily_cap: dailyCap,
      content_digest: digest,
      legalReviewRef,
      translationReviewRef,
      rightsReviewRef,
    },
    client: conn,
  });
  return campaign;
}
async function applyProviderEvent(conn, event) {
  const field = {
    "email.delivered": "delivered_at",
    "email.bounced": "bounced_at",
    "email.complained": "complained_at",
  }[event.type];
  if (!field) return null;
  const { rows } = await conn.query(
    `UPDATE policy_notice_deliveries SET ${field}=COALESCE(${field},NOW())
    WHERE provider_message_id=$1 RETURNING id`,
    [event.data?.email_id || event.data?.id],
  );
  return rows.length ? { outcome: "applied", deliveryId: rows[0].id } : null;
}
module.exports = { renderNotice, schedule, contentDigest, applyProviderEvent };
