// server/jobs/restaurantTrainingOverdueJob.js
// S-12/S-14 nightly sweep for restaurant staff training + documents:
//   1. Assignments past their due date flip to 'overdue' (the status
//      existed in the 667 CHECK but nothing ever wrote it).
//   2. Passing completions whose valid_for_days window has elapsed
//      re-open their assignment for recertification and notify the
//      staff member.
//   3. On-hire auto-assign rules are re-applied so members who joined
//      since the rule was created pick up their modules (rules are
//      also applied immediately when created/updated in the API).
//   4. Managers are alerted about staff documents/certificates
//      expiring within 30 days (once per expiry date).
// Each step is isolated: one failing step does not block the others.

const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const {
  markOverdueAssignments,
  expireCompletionsForRecertification,
  applyAutoAssignRules,
  notifyTrainingAssigned,
  sendCertificateExpiryAlerts,
} = require('../services/restaurantTrainingLifecycle');

const JOB_NAME = 'restaurant-training-overdue';
const CRON_EXPRESSION = '0 30 2 * * *'; // nightly, 02:30 server time

async function sweep(db) {
  const result = {
    overdue: 0,
    recertifications: 0,
    autoAssigned: 0,
    certificateAlerts: 0,
    stepErrors: 0,
  };

  try {
    const overdue = await markOverdueAssignments(db);
    result.overdue = overdue.length;
  } catch (err) {
    result.stepErrors += 1;
    logger.error('Training overdue step failed', { error: err.message });
  }

  try {
    const reopened = await expireCompletionsForRecertification(db);
    result.recertifications = reopened.length;
    for (const row of reopened) {
      await notifyTrainingAssigned(row.user_id, {
        assignmentId: row.id,
        moduleId: row.module_id,
        moduleTitle: row.module_title,
        restaurantId: row.restaurant_id,
        dueAt: row.due_at,
        recertification: true,
        completionId: row.completion_id,
      });
    }
  } catch (err) {
    result.stepErrors += 1;
    logger.error('Training recertification step failed', { error: err.message });
  }

  try {
    const { rows: scopes } = await db.query(
      `SELECT DISTINCT r.restaurant_id, fr.business_id
         FROM restaurant_training_auto_assign_rules r
         JOIN food_restaurants fr ON fr.id = r.restaurant_id
        WHERE r.is_active = TRUE AND r.on_hire = TRUE`
    );
    for (const scope of scopes) {
      const created = await applyAutoAssignRules(db, {
        restaurantId: scope.restaurant_id,
        businessId: scope.business_id,
        onlyOnHire: true,
      });
      result.autoAssigned += created.length;
      for (const item of created) {
        await notifyTrainingAssigned(item.userId, item);
      }
    }
  } catch (err) {
    result.stepErrors += 1;
    logger.error('Training auto-assign step failed', { error: err.message });
  }

  try {
    result.certificateAlerts = await sendCertificateExpiryAlerts(db, { withinDays: 30 });
  } catch (err) {
    result.stepErrors += 1;
    logger.error('Certificate expiry alert step failed', { error: err.message });
  }

  return result;
}

async function runRestaurantTrainingOverdueJob() {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    // Background-jobs audit (finding T2): the sweep's writes must go
    // through fence.db, not the raw pool. The fence contract is explicit:
    // every query through the fenced handle re-checks the lease, so a
    // mid-run lease loss stops this node's writes instead of letting a
    // second node run the same sweep concurrently (duplicate recert and
    // certificate alerts).
    result = { locked: true, ...(await sweep(fence.db)) };
  }, 900, { throwOnError: true });
  logger.info('Restaurant training overdue run finished', result);
  return result;
}

function startRestaurantTrainingOverdueJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runRestaurantTrainingOverdueJob();
    } catch (err) {
      logger.error('Restaurant training overdue cron error', { error: err.message });
    }
  });
  logger.info('Restaurant training overdue job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startRestaurantTrainingOverdueJob,
  runRestaurantTrainingOverdueJob,
  sweep,
  cronExpression: CRON_EXPRESSION,
};
