'use strict';

// Group 12 Slice 3e (625, D-326): policy change reminders. When a
// franchise standard's version changes, the members who have not yet
// acknowledged the new version are reminded — immediately (the publish
// handler calls the sender with force: true) and then at most once per
// person per version per day by the daily sweeper, until they
// acknowledge or the version is superseded. Only the current version
// is ever reminded: the sender reads the standard's live version and
// skips anyone who already acknowledged it, so a superseded version
// can never be reminded. The reminder ledger
// (franchise_standard_reminders) records the last reminder per
// (standard, member, version); the notification itself carries an
// explicit per-day idempotency key as a second guard.
//
// The territory membership query is inlined here (not imported from
// the franchise controller) so the job does not create a controller
// cycle: the owner, every accepted invitee (matched by email), and
// every opening-team helper — the same membership 622 uses.
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { sendNotification } = require('../services/notificationService');

const JOB_NAME = 'franchise-standard-reminders';
const CRON_EXPRESSION = '0 30 8 * * *'; // daily at 08:30 server time
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

async function fetchTerritoryMemberIdsForJob(db, applicationId) {
  const { rows } = await db.query(
    `SELECT owner_user_id AS user_id FROM franchise_applications
      WHERE id = $1 AND owner_user_id IS NOT NULL
     UNION
     SELECT iu.id FROM franchise_territory_invitations i
       JOIN users iu ON lower(iu.email) = lower(i.email)
      WHERE i.application_id = $1 AND i.status = 'accepted'
     UNION
     SELECT helper_user_id FROM franchise_opening_team_members
      WHERE application_id = $1`,
    [applicationId]
  );
  return rows.map((row) => row.user_id);
}

async function sendFranchiseStandardReminders({ db: dbClient, force = false, standardId = null } = {}) {
  const db = dbClient || pool;
  const { rows: standards } = await db.query(
    `SELECT fs.id, fs.application_id, fs.version,
            COALESCE(lg.title, fs.guide_id) AS standard_title
       FROM franchise_standards fs
       LEFT JOIN learn_guides lg ON lg.id = fs.guide_id
      WHERE ($1::uuid IS NULL OR fs.id = $1)`,
    [standardId]
  );
  const reminded = [];
  let skipped = 0;
  const sentThisRun = new Set();
  for (const standard of standards) {
    // G12-A14 (D-659): a rejected or archived application is a dead
    // territory — its ex-members must not be reminded about standards
    // for an assignment they no longer hold. The franchise-wide sweep
    // (application_id NULL) used to iterate every application with no
    // status filter at all.
    const { rows: applications } = await db.query(
      standard.application_id
        ? `SELECT id FROM franchise_applications WHERE id = $1 AND status NOT IN ('rejected', 'archived')`
        : `SELECT id FROM franchise_applications WHERE status NOT IN ('rejected', 'archived')`,
      standard.application_id ? [standard.application_id] : []
    );
    for (const application of applications) {
      const memberIds = await fetchTerritoryMemberIdsForJob(db, application.id);
      for (const userId of memberIds) {
        const runKey = `${standard.id}:${userId}`;
        if (sentThisRun.has(runKey)) continue;
        // Acknowledged the current version: nothing to remind about.
        const { rows: ackRows } = await db.query(
          `SELECT 1 FROM franchise_standard_acknowledgments
            WHERE standard_id = $1 AND user_id = $2 AND version = $3`,
          [standard.id, userId, standard.version]
        );
        if (ackRows.length) { skipped += 1; continue; }
        // Daily sweeper: at most once per person per version per day.
        // The publish trigger and the HQ manual remind pass force: true
        // and bypass this window — both are explicit new events.
        if (!force) {
          const { rows: reminderRows } = await db.query(
            `SELECT reminded_at FROM franchise_standard_reminders
              WHERE standard_id = $1 AND user_id = $2 AND version = $3`,
            [standard.id, userId, standard.version]
          );
          const last = reminderRows[0]?.reminded_at;
          if (last && Date.now() - new Date(last).getTime() < REMINDER_WINDOW_MS) {
            skipped += 1;
            continue;
          }
        }
        const day = new Date().toISOString().slice(0, 10);
        try {
          await sendNotification({
            userId,
            type: 'franchise_standard_updated',
            title: 'A franchise standard changed',
            body: `"${standard.standard_title}" was updated to version ${standard.version}. Please review and acknowledge it.`,
            data: {
              params: { standardTitle: standard.standard_title, version: standard.version },
              application_id: application.id,
              standard_id: standard.id,
            },
            action_url: '/franchise/territory',
            idempotencyKey: `franchise-standard-reminder:${standard.id}:${userId}:v${standard.version}:${day}`,
          });
        } catch (err) {
          logger.warn('Franchise standard reminder failed', {
            standardId: standard.id, userId, error: err.message,
          });
          continue;
        }
        await db.query(
          `INSERT INTO franchise_standard_reminders (standard_id, user_id, version, reminded_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (standard_id, user_id, version)
             DO UPDATE SET reminded_at = NOW()`,
          [standard.id, userId, standard.version]
        );
        sentThisRun.add(runKey);
        reminded.push(userId);
      }
    }
  }
  return { reminded, skipped };
}

async function runFranchiseStandardRemindersJob(db = pool) {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await sendFranchiseStandardReminders({ db: fence.db })) };
  }, 300, { throwOnError: true });
  logger.info('Franchise standard reminders finished', result);
  return result;
}

function startFranchiseStandardReminderJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runFranchiseStandardRemindersJob();
    } catch (err) {
      logger.error('Franchise standard reminders cron error', { error: err.message });
    }
  });
  logger.info('Franchise standard reminders job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  sendFranchiseStandardReminders,
  runFranchiseStandardRemindersJob,
  startFranchiseStandardReminderJob,
  cronExpression: CRON_EXPRESSION,
};
