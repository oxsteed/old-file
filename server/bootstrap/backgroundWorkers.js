'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const bookingController = require('../controllers/bookingController');
const cleanupOldMessagesJob = require('../jobs/cleanupOldMessages');
const { cleanupExpiredSupportMessages } = require('../jobs/supportConversationRetentionCleanup');
const { pollTranslationJobs } = require('../modules/jobs/translationJobWorker');
const { startLocalDeliveryEventWorker } = require('../services/localDeliveryEventWorker');
const { startWeeklySummaryJob } = require('../jobs/weeklySummary');
const { startPlannedNeedsScheduler } = require('../jobs/plannedNeedsScheduler');
const { startDiscoverDigestJob } = require('../jobs/discoverDigest');
const { startConversationRetentionCleanup } = require('../jobs/conversationRetentionCleanup');
const { startGuestChatSessionTimeoutJob } = require('../jobs/guestChatSessionTimeout');
const { startSiteVisitRetentionJob } = require('../jobs/siteVisitRetention');
const { startConsultingSessionReminders } = require('../jobs/consultingSessionReminders');
const { startConsultingPostSessionFollowup } = require('../jobs/consultingPostSessionFollowup');
const { startConsultingNoShowFollowup } = require('../jobs/consultingNoShowFollowup');
const { startCalendarReminderJob } = require('../jobs/calendarReminders');
const { startDirectCalendarReminderJob } = require('../jobs/directCalendarReminders');
const { startAffiliateCommissionBatchJob } = require('../jobs/affiliateCommissionBatch');
const { startTemplateExpiryJob } = require('../jobs/templateExpiryJob');
const { startAcceptedJobExpiryJob } = require('../jobs/acceptedJobExpiryJob');
const { startScheduledDeletionJob } = require('../jobs/scheduledDeletionJob');
const { startRecurringJobScheduler } = require('../jobs/recurringJobScheduler');
const { startCustomerReengagementJob } = require('../jobs/customerReengagementJob');
const { releaseExpiredInventoryReservations } = require('../services/restaurantInventoryOrderService');
const { cleanupExpiredWalletOperations } = require('../services/foodWalletOperationsService');
const { startOxsteedCreditHoldExpiryJob } = require('../jobs/oxsteedCreditHoldExpiry');
const { startDirectSlotHoldExpiryJob } = require('../jobs/directSlotHoldExpiry');
const { startOxsteedCreditEntitlementExpiryJob } = require('../jobs/oxsteedCreditEntitlementExpiry');
const { startOxsteedCreditReconciliationJob } = require('../jobs/oxsteedCreditReconciliation');
const { startOxsteedCreditTopupExpiryJob } = require('../jobs/oxsteedCreditTopupExpiry');
const { startOxsteedCreditDualPostingBackfillJob } = require('../jobs/oxsteedCreditDualPostingBackfill');
const { startOxsteedCreditExternalReconciliationJob } = require('../jobs/oxsteedCreditExternalReconciliation');
const { startOxsteedCreditComplianceMonitorJob } = require('../jobs/oxsteedCreditComplianceMonitor');
const { startOxsteedCreditDisputeMonitorJob } = require('../jobs/oxsteedCreditDisputeMonitor');
const { startOxsteedCreditSettlementCycleJob } = require('../jobs/oxsteedCreditSettlementCycle');
const { startOxsteedCreditIntegrityJob } = require('../jobs/oxsteedCreditIntegrity');
const { startAdminAuditChainVerificationJob } = require('../jobs/adminAuditChainVerification');
const { startOxsteedCreditNotificationOutboxJob } = require('../jobs/oxsteedCreditNotificationOutbox');
const { startOxsteedCreditWorkerWatchdog } = require('../jobs/oxsteedCreditWorkerWatchdog');
const { startRestaurantWalletWatchdog } = require('../jobs/restaurantWalletWatchdog');
const { startMessageNotificationOutboxJob } = require('../jobs/messageNotificationOutbox');
const { startMarketplaceRefundReconciliationJob } = require('../jobs/marketplaceRefundReconciliation');
const { startPaymentRefundReconciliationJob } = require('../jobs/paymentRefundReconciliation');
const { startExternalRefundReconciliationJob } = require('../jobs/externalRefundReconciliation');
const { startPayoutSettlementReconciliationJob } = require('../jobs/payoutSettlementReconciliation');
const { startRestaurantPayoutReconciliationJob } = require('../jobs/restaurantPayoutReconciliation');
const { startWebhookRetryJob } = require('../jobs/webhookRetryWorker');
const { startSettingsChangeApplierJob } = require('../jobs/settingsChangeApplier');
const { startProfileVisibilityScheduler } = require('../jobs/profileVisibilityScheduledActions');
const { startProfileVisibilityNotificationRetryJob } = require('../jobs/profileVisibilityNotificationRetry');
const { runSupportSlaMonitor } = require('../services/supportSlaMonitor');
const { processSupportEmailOutbox } = require('../services/supportEmailOutbox');
const { processSupportFollowUpReminders } = require('../services/supportFollowUpReminderWorker');
const { processBusinessInvoiceOverdue } = require('../services/businessInvoiceOverdueWorker');
const { recoverStaleSupportChannelDeliveries } = require('../services/supportChannelDeliveryRecovery');

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
      startSiteVisitRetentionJob();
      startConsultingSessionReminders();
      startConsultingPostSessionFollowup();
      startConsultingNoShowFollowup();
      this.handles.push(startCalendarReminderJob());
      this.handles.push(startDirectCalendarReminderJob());
      this.handles.push(startAffiliateCommissionBatchJob());
      startScheduledDeletionJob();
      startTemplateExpiryJob();
      startAcceptedJobExpiryJob();
      startRecurringJobScheduler();
      startCustomerReengagementJob();
      startOxsteedCreditHoldExpiryJob();
      startDirectSlotHoldExpiryJob();
      startOxsteedCreditEntitlementExpiryJob();
      startOxsteedCreditReconciliationJob();
    startOxsteedCreditTopupExpiryJob();
      startOxsteedCreditDualPostingBackfillJob();
      startOxsteedCreditExternalReconciliationJob();
      startOxsteedCreditComplianceMonitorJob();
      startOxsteedCreditDisputeMonitorJob();
      startOxsteedCreditSettlementCycleJob();
      startOxsteedCreditIntegrityJob();
      startAdminAuditChainVerificationJob();
      startOxsteedCreditNotificationOutboxJob();
      startOxsteedCreditWorkerWatchdog();
      startRestaurantWalletWatchdog();
      startMessageNotificationOutboxJob();
      startMarketplaceRefundReconciliationJob();
      startPaymentRefundReconciliationJob();
      startExternalRefundReconciliationJob();
      startPayoutSettlementReconciliationJob();
      startRestaurantPayoutReconciliationJob();
      startWebhookRetryJob();
      startSettingsChangeApplierJob();
      startProfileVisibilityScheduler();
      startProfileVisibilityNotificationRetryJob();
      cron.schedule('*/10 * * * * *', () => {
        require('../services/supportWaitService').processWaiting().catch((error) => {
          this.log.error('Support waiting worker failed', { error: error.message });
        });
      });

      cron.schedule('25 * * * * *', () => {
        runSupportSlaMonitor().catch((error) => {
          this.log.error('Support SLA monitor failed', { error: error.message });
        });
      });

      cron.schedule('35 * * * * *', () => {
        processSupportEmailOutbox().catch((error) => {
          this.log.warn('Support email outbox worker failed', { error: error.message });
        });
      });

      cron.schedule('40 * * * * *', () => {
        recoverStaleSupportChannelDeliveries().catch((error) => {
          this.log.warn('Support channel delivery recovery failed', { error: error.message });
        });
      });

      cron.schedule('45 * * * * *', () => {
        processSupportFollowUpReminders().catch((error) => {
          this.log.warn('Support follow-up reminder worker failed', { error: error.message });
        });
      });

      cron.schedule('50 * * * * *', () => {
        releaseExpiredInventoryReservations().catch((error) => {
          this.log.warn('Restaurant inventory reservation cleanup failed', { error: error.message });
        });
      });

      cron.schedule('15 * * * * *', () => {
        cleanupExpiredWalletOperations().catch((error) => {
          this.log.warn('Restaurant credit expiry cleanup failed', { error: error.message });
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

      // The active support conversation table uses a separate, lock-protected
      // retention worker. Keep the legacy message cleanup above for old data.
      cron.schedule('15 2 * * *', async () => {
        const result = await cleanupExpiredSupportMessages();
        if (!result.success) this.log.error('Support conversation retention job failed', result);
      });

      cron.schedule('5 3 * * *', () => {
        processBusinessInvoiceOverdue().catch((error) => {
          this.log.warn('Business invoice overdue job failed', { error: error.message });
        });
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

      this.handles.push(startLocalDeliveryEventWorker({ log: this.log }));
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
    const draining = [];
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
      try { draining.push(Promise.resolve(handle?.stop?.())); } catch (err) {
        this.log.warn('Failed to stop timer worker', { error: err.message });
      }
    }

    this.cronTaskIds.clear();
    this.handles = [];
    this.started = false;
    return Promise.allSettled(draining);
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
