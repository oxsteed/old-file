const logger = require('../utils/logger');
const calendarNotificationController = require('../controllers/calendarNotificationController');

// Run every 5 minutes to process reminder notifications
function startCalendarReminderJob() {
  const interval = setInterval(async () => {
    try {
      await calendarNotificationController.processReminderNotifications();
    } catch (err) {
      logger.error('Calendar reminder job failed', { err });
    }
  }, 5 * 60 * 1000); // 5 minutes

  logger.info('Calendar reminder job started');
  return { stop: () => clearInterval(interval) };
}

module.exports = { startCalendarReminderJob };
