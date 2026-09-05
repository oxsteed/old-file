'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const bookingController = require('../controllers/bookingController');
const cleanupOldMessagesJob = require('../jobs/cleanupOldMessages');
const { pollTranslationJobs } = require('../modules/jobs/translationJobWorker');
const { startWeeklySummaryJob } = require('../jobs/weeklySummary');
const { startPlannedNeedsScheduler } = require('../jobs/plannedNeedsScheduler');
const { startDiscoverDigestJob } = require('../jobs/discoverDigest');
const { startConversationRetentionCleanup } = require('../jobs/conversationRetentionCleanup');
const { startGuestChatSessionTimeoutJob } = require('../jobs/guestChatSessionTimeout');
const { startConsultingSessionReminders } = require('../jobs/consultingSessionReminders');
const { startConsultingPostSessionFollowup } = require('../jobs/consultingPostSessionFollowup');
const { startConsultingNoShowFollowup } = require('../jobs/consultingNoShowFollowup');
const { startCalendarReminderJob } = require('../jobs/calendarReminders');
const { startAffiliateCommissionBatchJob } = require('../jobs/affiliateCommissionBatch');
const { startTemplateExpiryJob } = require('../jobs/templateExpiryJob');
const { startAcceptedJobExpiryJob } = require('../jobs/acceptedJobExpiryJob');
const { startScheduledDeletionJob } = require('../jobs/scheduledDeletionJob');
const { startRecurringJobScheduler } = require('../jobs/recurringJobScheduler');
const { startCustomerReengagementJob } = require('../jobs/customerReengagementJob');

class BackgroundWorkers {
  constructor({ log = logger } = {}) {
    this.log = log;
    this.started = false;
    this.cronTaskIds = new Set();
    this.handles = [];
  }

  captureCronTasks(existingTaskIds) {
    for (const taskId of cron.getTasks().keys()) {
      if (!existingTaskIds.has(taskId)) this.cronTaskIds.add(taskId);
    }
  }

  start() {
    if (this.started) throw new Error('Background workers have already been started');
    const existingTaskIds = new Set(cron.getTasks().keys());

    try {
      startWeeklySummaryJob();
      startPlannedNeedsScheduler();
      startDiscoverDigestJob();
      startConversationRetentionCleanup();
      startGuestChatSessionTimeoutJob();
      startConsultingSessionReminders();
      startConsultingPostSessionFollowup();
      startConsultingNoShowFollowup();
      this.handles.push(startCalendarReminderJob());
      this.handles.push(startAffiliateCommissionBatchJob());
      startScheduledDeletionJob();
      startTemplateExpiryJob();
      startAcceptedJobExpiryJob();
      startRecurringJobScheduler();
      startCustomerReengagementJob();
      cron.schedule('*/10 * * * * *', () => {
        require('../services/supportWaitService').processWaiting().catch((error) => {
          this.log.error('Support waiting worker failed', { error: error.message });
        });
      });

      cron.schedule('*/15 * * * *', async () => {
        try {
          await bookingController.expirePendingBookingRequests();
          await bookingController.releaseStaleAcceptedBookings();
        } catch (err) {
          this.log.warn('Booking maintenance job failed', { error: err.message });
        }
      });

      cron.schedule(cleanupOldMessagesJob.cronExpression, async () => {
        try {
          const result = await cleanupOldMessagesJob.handler();
          this.log.info('Support message cleanup job completed', result);
        } catch (err) {
          this.log.error('Support message cleanup job failed', { error: err.message });
        }
      });

      const translationJobCron = process.env.TRANSLATION_JOB_POLL_CRON || '*/30 * * * * *';
      if (!cron.validate(translationJobCron)) {
        throw new Error(`Invalid TRANSLATION_JOB_POLL_CRON: ${translationJobCron}`);
      }
      cron.schedule(translationJobCron, async () => {
        try {
          await pollTranslationJobs();
        } catch (err) {
          this.log.warn('Translation job poll failed', { error: err.message });
        }
      });

      this.captureCronTasks(existingTaskIds);

      this.started = true;
      this.log.info('Background workers started', {
        cronTasks: this.cronTaskIds.size,
        timerWorkers: this.handles.filter(Boolean).length,
      });
      return this;
    } catch (err) {
      // Capture tasks created before the failure so rollback owns and stops
      // every partial worker registration.
      this.captureCronTasks(existingTaskIds);
      this.stop();
      throw err;
    }
  }

  stop() {
    for (const taskId of this.cronTaskIds) {
      const task = cron.getTask(taskId);
      try { task?.stop(); } catch (err) {
        this.log.warn('Failed to stop cron task', { taskId, error: err.message });
      }
      try { task?.destroy?.(); } catch (err) {
        this.log.warn('Failed to destroy cron task', { taskId, error: err.message });
      }
    }

    for (const handle of this.handles) {
      try { handle?.stop?.(); } catch (err) {
        this.log.warn('Failed to stop timer worker', { error: err.message });
      }
    }

    this.cronTaskIds.clear();
    this.handles = [];
    this.started = false;
  }

  status() {
    return {
      started: this.started,
      cronTasks: this.cronTaskIds.size,
      timerWorkers: this.handles.filter(Boolean).length,
    };
  }
}

module.exports = { BackgroundWorkers };
