// server/jobs/staffInviteExpiryJob.js
// S-10: pending team invites carry expires_at (14 days, migration 946).
// This nightly sweep flips lapsed pending invites to 'expired'
// (migration 1201) so they stop being acceptable, re-sendable, or
// listed as actionable. Expired rows are kept for audit instead of
// being deleted.
//
// Each invite is handled independently: one bad row never blocks the
// rest of the sweep.

const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');

const JOB_NAME = 'staff-invite-expiry';
const CRON_EXPRESSION = '0 45 2 * * *'; // nightly, 02:45 server time

async function sweep(db) {
  const { rows } = await db.query(
    `UPDATE business_members
        SET status = 'expired'
      WHERE status = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at <= NOW()
      RETURNING id, business_id, member_id, invite_email, role`
  );

  let notified = 0;
  let notifyErrors = 0;
  for (const invite of rows) {
    // The invitee hears that the invite lapsed; the inviter sees it as
    // expired in the team list and can resend (which restarts the
    // window) or revoke it.
    if (!invite.member_id) continue;
    try {
      const { rows: [biz] } = await db.query(
        'SELECT business_name FROM businesses WHERE id = $1',
        [invite.business_id]
      );
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES ($1, 'business_invite_expired', $2, $3, $4)`,
        [
          invite.member_id,
          'Invitation expired',
          `Your invitation to join "${biz?.business_name || 'the business'}" as a ${invite.role} has expired. Ask them to send a new one.`,
          JSON.stringify({ business_id: invite.business_id, invite_id: invite.id, role: invite.role }),
        ]
      );
      notified += 1;
    } catch (err) {
      notifyErrors += 1;
      logger.warn('Invite expiry notification failed', { inviteId: invite.id, error: err.message });
    }
  }

  return { expired: rows.length, notified, notifyErrors };
}

async function runStaffInviteExpiryJob(db = pool) {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await sweep(db)) };
  }, 900, { throwOnError: true });
  logger.info('Staff invite expiry run finished', result);
  return result;
}

function startStaffInviteExpiryJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runStaffInviteExpiryJob();
    } catch (err) {
      logger.error('Staff invite expiry cron error', { error: err.message });
    }
  });
  logger.info('Staff invite expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startStaffInviteExpiryJob,
  runStaffInviteExpiryJob,
  sweep,
  cronExpression: CRON_EXPRESSION,
};
