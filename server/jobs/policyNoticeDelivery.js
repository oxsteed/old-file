"use strict";
const crypto = require("crypto");
const { withFencedJobLock } = require("./jobLockingService");
const { renderNotice } = require("../growth/policyNotice");
const { logAdminAction } = require("../services/auditService");
async function run() {
  if (process.env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED !== "true")
    return { skipped: true };
  return withFencedJobLock(
    "growth-policy-notice",
    async (fence) => {
      const batch = await fence.fencedTransaction(async (conn) => {
        const {
          rows: [campaign],
        } = await conn.query(
          "SELECT * FROM policy_notice_campaigns WHERE status='sending' ORDER BY id LIMIT 1 FOR UPDATE",
        );
        if (!campaign) return null;
        if (
          campaign.content_digest !==
          require("../growth/policyNotice").contentDigest()
        )
          throw new Error("policy_content_changed_after_review");
        // Unbatched recipients must not keep a failed plan open indefinitely.
        await conn.query(
          `UPDATE policy_notice_deliveries SET status='failed' WHERE campaign_id=$1
          AND status='pending' AND batch_id IS NULL AND NOW()>$2::timestamptz+interval '24 hours'`,
          [campaign.id, campaign.planned_last_send_at],
        );
        // Never retry after the provider's 24h idempotency window.
        const { rows: failed } = await conn.query(
          `UPDATE policy_notice_batches SET status='failed',lease_token=NULL,payload='[]'::jsonb WHERE campaign_id=$1 AND status IN ('pending','sending')
        AND created_at<NOW()-interval '23 hours' RETURNING delivery_ids`,
          [campaign.id],
        );
        for (const row of failed)
          await conn.query(
            "UPDATE policy_notice_deliveries SET status='failed' WHERE id=ANY($1::bigint[]) AND status<>'sent'",
            [row.delivery_ids],
          );
        if (failed.length)
          await logAdminAction({
            adminId: campaign.created_by,
            action: "growth_notice_batches_failed",
            targetType: "policy_notice",
            targetKey: campaign.id,
            after: { batches: failed.length },
            client: conn,
          });
        let {
          rows: [pending],
        } = await conn.query(
          `SELECT * FROM policy_notice_batches WHERE campaign_id=$1 AND
        ((status='pending' AND next_attempt_at<=NOW()) OR (status='sending' AND lease_expires_at<NOW())) ORDER BY created_at LIMIT 1 FOR UPDATE`,
          [campaign.id],
        );
        if (!pending) {
          const {
            rows: [used],
          } = await conn.query(
            `SELECT COALESCE((SELECT attempts FROM policy_notice_daily_budget WHERE day=CURRENT_DATE),0)::int AS n`,
            [],
          );
          const remaining = Math.min(100, campaign.daily_cap - used.n);
          if (remaining <= 0) return null;
          const { rows: recipients } = await conn.query(
            `SELECT d.id,d.language,u.email FROM policy_notice_deliveries d JOIN users u ON u.id=d.user_id
          WHERE d.campaign_id=$1 AND d.status='pending' AND d.batch_id IS NULL AND u.deleted_at IS NULL AND NOT u.is_banned
          ORDER BY d.id LIMIT $2 FOR UPDATE OF d SKIP LOCKED`,
            [campaign.id, remaining],
          );
          if (recipients.length) {
            const payload = recipients.map((r) =>
              renderNotice({
                email: r.email,
                language: r.language,
                plannedDate: new Date(
                  new Date(campaign.planned_last_send_at).getTime() +
                    14 * 86400000,
                ),
              }),
            );
            const {
              rows: [created],
            } = await conn.query(
              "INSERT INTO policy_notice_batches(campaign_id,delivery_ids,payload) VALUES($1,$2,$3) RETURNING *",
              [
                campaign.id,
                recipients.map((r) => r.id),
                JSON.stringify(payload),
              ],
            );
            pending = created;
            await conn.query(
              "UPDATE policy_notice_deliveries SET batch_id=$2,status='sending' WHERE id=ANY($1::bigint[])",
              [recipients.map((r) => r.id), pending.id],
            );
          } else {
            await conn.query(
              `UPDATE policy_notice_deliveries d SET status='suppressed' WHERE campaign_id=$1 AND status='pending' AND batch_id IS NULL
            AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=d.user_id AND u.deleted_at IS NULL AND NOT u.is_banned)`,
              [campaign.id],
            );
          }
        }
        if (!pending) {
          await require("../growth/rollout").advance(conn, {
            adminId: campaign.created_by,
          });
          return null;
        }
        // Reserve quota for every attempt, including a retry after midnight. The
        // provider may have accepted an ambiguous request; account for it anyway.
        const reserved = await conn.query(
          `INSERT INTO policy_notice_daily_budget(day,attempts) VALUES(CURRENT_DATE,$1)
          ON CONFLICT(day) DO UPDATE SET attempts=policy_notice_daily_budget.attempts+EXCLUDED.attempts
          WHERE policy_notice_daily_budget.attempts+EXCLUDED.attempts<=$2 RETURNING day`,
          [pending.delivery_ids.length, campaign.daily_cap],
        );
        if (!reserved.rowCount) return null;
        const token = crypto.randomUUID();
        const {
          rows: [claimed],
        } = await conn.query(
          `UPDATE policy_notice_batches SET status='sending',attempts=attempts+1,lease_token=$2,
        lease_expires_at=NOW()+interval '5 minutes' WHERE id=$1 RETURNING *`,
          [pending.id, token],
        );
        return claimed;
      });
      if (!batch) return { processed: 0 };
      let result;
      try {
        result = await require("../utils/email").sendEmailBatch(batch.payload, {
          idempotencyKey: `growth-policy:${batch.id}`,
        });
      } catch {
        await fence.db.query(
          "UPDATE policy_notice_batches SET status='pending',lease_token=NULL,next_attempt_at=NOW()+interval '5 minutes' WHERE id=$1 AND lease_token=$2",
          [batch.id, batch.lease_token],
        );
        return { retrying: true };
      }
      await fence.fencedTransaction(async (conn) => {
        const { rowCount } = await conn.query(
          `UPDATE policy_notice_batches SET status='sent',sent_at=NOW(),lease_token=NULL,payload='[]'::jsonb
        WHERE id=$1 AND lease_token=$2 AND lease_expires_at>NOW()`,
          [batch.id, batch.lease_token],
        );
        if (!rowCount) throw new Error("policy_notice_lease_lost");
        for (let i = 0; i < batch.delivery_ids.length; i++)
          await conn.query(
            "UPDATE policy_notice_deliveries SET status='sent',sent_at=NOW(),provider_message_id=$2 WHERE id=$1",
            [batch.delivery_ids[i], result[i].id],
          );
        await conn.query(`UPDATE activity_tracking_rollout SET state='notice_sending',first_notice_sent_at=COALESCE(first_notice_sent_at,NOW()),
        last_notice_sent_at=NOW() WHERE id=1 AND state='notice_sending'`);
        await require("../growth/rollout").advance(conn);
      });
      return { processed: batch.delivery_ids.length };
    },
    120,
  );
}
module.exports = { run };
