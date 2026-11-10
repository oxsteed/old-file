const logger = require('../utils/logger');
const calendarNotificationController = require('../controllers/calendarNotificationController');
const { withFencedJobLock } = require('./jobLockingService');

// Oct 30 item 29: this starter used to fire every 5 minutes with no
// in-process guard and no cross-replica lock, so a slow pass overlapped
// the next tick and a second API replica ran the same pass concurrently.
// The running flag (same shape as customer360Alerts /
// metricThresholdAlerts) skips an overlapping tick in this process; the
// fenced lock skips a concurrent pass on another replica. The lock TTL
// matches the 5-minute cadence; the renewal timer inside
// withFencedJobLock keeps it alive for a long pass.
const JOB_NAME = 'calendar-reminders';

// Run every 5 minutes to process reminder notifications
function startCalendarReminderJob() {
  let stopped = false;
  let running = null;
  const tick = () => {
    if (stopped || running) return;
    running = withFencedJobLock(JOB_NAME, async () => {
      await calendarNotificationController.processReminderNotifications();
    }, 300)
      .catch((err) => {
        logger.error('Calendar reminder job failed', { err });
      })
      .finally(() => {
        running = null;
      });
  };
  const interval = setInterval(tick, 5 * 60 * 1000); // 5 minutes
  interval.unref?.();

  logger.info('Calendar reminder job started');
  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      return running;
    },
  };
}

module.exports = { startCalendarReminderJob, JOB_NAME };
