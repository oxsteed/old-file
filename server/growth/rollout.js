"use strict";
const { logAdminAction } = require("../services/auditService");
function effectiveDate(lastSent, planned) {
  const last = new Date(lastSent).getTime(),
    quoted = new Date(planned).getTime();
  if (!Number.isFinite(last) || !Number.isFinite(quoted))
    throw new Error("notice_date_missing");
  return new Date(Math.max(last + 14 * 86400000, quoted));
}
async function advance(conn, { adminId = null } = {}) {
  const { rows } = await conn.query(
    "SELECT * FROM activity_tracking_rollout WHERE id=1 FOR UPDATE",
  );
  const r = rows[0];
  if (!adminId && r) {
    const {
      rows: [campaign],
    } = await conn.query(
      "SELECT created_by FROM policy_notice_campaigns WHERE policy_version=$1",
      [r.policy_version],
    );
    adminId = campaign?.created_by;
  }
  if (!adminId) return;
  if (r?.state === "notice_sending") {
    const {
      rows: [stats],
    } = await conn.query(
      `SELECT COUNT(*) FILTER(WHERE status IN ('pending','sending'))::int AS remaining,
      MAX(sent_at) AS last_sent FROM policy_notice_deliveries d JOIN policy_notice_campaigns c ON c.id=d.campaign_id WHERE c.policy_version=$1`,
      [r.policy_version],
    );
    if (stats.remaining === 0 && !stats.last_sent) {
      await conn.query(
        "UPDATE policy_notice_campaigns SET status='paused' WHERE policy_version=$1",
        [r.policy_version],
      );
      await conn.query(
        "UPDATE activity_tracking_rollout SET state='paused',updated_at=NOW() WHERE id=1",
      );
      await logAdminAction({
        adminId,
        action: "growth_notice_no_accepted_delivery",
        targetType: "growth_rollout",
        targetKey: r.policy_version,
        client: conn,
      });
    }
    if (stats.remaining === 0 && stats.last_sent) {
      const effective = effectiveDate(stats.last_sent, r.planned_effective_at);
      await conn.query(
        `UPDATE activity_tracking_rollout SET state='notice_complete',last_notice_sent_at=$1,effective_at=$2,updated_at=NOW() WHERE id=1`,
        [stats.last_sent, effective],
      );
      await conn.query(
        "UPDATE policy_notice_campaigns SET status='complete' WHERE policy_version=$1",
        [r.policy_version],
      );
      await logAdminAction({
        adminId,
        action: "growth_notice_complete",
        targetType: "growth_rollout",
        targetKey: r.policy_version,
        after: { effective_at: effective },
        client: conn,
      });
    }
  }
  const result =
    await conn.query(`UPDATE activity_tracking_rollout SET state='effective',updated_at=NOW()
    WHERE id=1 AND state='notice_complete' AND effective_at<=NOW() AND legal_review_ref IS NOT NULL
    AND translations_reviewed AND rights_verified RETURNING policy_version`);
  if (result.rows.length)
    await logAdminAction({
      adminId,
      action: "growth_rollout_effective",
      targetType: "growth_rollout",
      targetKey: result.rows[0].policy_version,
      client: conn,
    });
}
module.exports = { effectiveDate, advance };
