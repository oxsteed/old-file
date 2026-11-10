'use strict';

const cron = require('node-cron');
const { startCustomer360Alerts } = require('../jobs/customer360Alerts');
const { startCustomer360Upgrades } = require('../jobs/customer360Upgrades');
const { startMetricThresholdAlerts } = require('../jobs/metricThresholdAlerts');
const { startMetricSnapshots } = require('../jobs/metricSnapshots');
const { startBroadcastDelivery } = require('../jobs/broadcastDelivery');
const { startRestaurantScreenSync } = require('../jobs/restaurantScreenSync');
const logger = require('../utils/logger');
const bookingController = require('../controllers/bookingController');
const cleanupOldMessagesJob = require('../jobs/cleanupOldMessages');
const guestChatRetention = require('../jobs/guestChatRetentionCleanup');
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
const { startBusinessAppointmentReminderJob } = require('../jobs/businessAppointmentReminders'); // Review P2-3-F04
const { startBusinessAppointmentNoShowSweeper } = require('../jobs/businessAppointmentNoShowSweeper'); // Review P3-8-F03
const { startCalendarReminderJob } = require('../jobs/calendarReminders');
const { startDirectCalendarReminderJob } = require('../jobs/directCalendarReminders');
const { startAffiliateCommissionBatchJob } = require('../jobs/affiliateCommissionBatch');
const { startTemplateExpiryJob } = require('../jobs/templateExpiryJob');
const { startAcceptedJobExpiryJob } = require('../jobs/acceptedJobExpiryJob');
const { startRestaurantTrainingOverdueJob } = require('../jobs/restaurantTrainingOverdueJob'); // S-12/S-14
const { startStaffInviteExpiryJob } = require('../jobs/staffInviteExpiryJob'); // S-10
const { startRestaurantPunchCloseoutJob } = require('../jobs/restaurantPunchCloseoutJob'); // Phase 2 punch integrity
const { startRestaurantScheduledReportsJob } = require('../jobs/restaurantScheduledReportsJob'); // Phase 7 scheduled reports
const { startRestaurantRetentionJob } = require('../jobs/restaurantRetentionJob'); // Phase 7 retention/erasure
const { startFranchiseRoyaltyRedriveJob } = require('../jobs/franchiseRoyaltyRedriveJob'); // Background-jobs audit #45 royalty re-drive
const { startCareersJobs } = require('../jobs/careersJobs');
const { startChatQuoteExpiryJob } = require('../jobs/chatQuoteExpiryJob');
const { startSupportTicketSlaJob } = require('../jobs/supportTicketSlaJob');
const { startHelperCompletionAutoConfirmJob } = require('../jobs/helperCompletionAutoConfirm');
const { startScheduledDeletionJob } = require('../jobs/scheduledDeletionJob');
const { startWorkAgreementProposalTimeoutJob } = require('../jobs/workAgreementProposalTimeout');
const { startRecurringJobScheduler } = require('../jobs/recurringJobScheduler');
const { startCustomerReengagementJob } = require('../jobs/customerReengagementJob');
const { releaseExpiredInventoryReservations } = require('../services/restaurantInventoryOrderService');
const { cancelAbandonedPayNowOrders } = require('../services/foodAbandonedOrderSweeper');
const { cleanupExpiredWalletOperations } = require('../services/foodWalletOperationsService');
const { startOxsteedCreditHoldExpiryJob } = require('../jobs/oxsteedCreditHoldExpiry');
const { startDirectSlotHoldExpiryJob } = require('../jobs/directSlotHoldExpiry');
const { startJobEventOutboxJob } = require('../jobs/jobEventOutbox');
const { startJobRevisionMaintenanceJob } = require('../jobs/jobRevisionMaintenance');
const { startPaymentLayersWorker } = require('../jobs/paymentLayersWorker');
const { startOxsteedCreditEntitlementExpiryJob } = require('../jobs/oxsteedCreditEntitlementExpiry');
const { startOxsteedCreditReconciliationJob } = require('../jobs/oxsteedCreditReconciliation');
const { startOxsteedCreditTopupExpiryJob } = require('../jobs/oxsteedCreditTopupExpiry');
const { startOxsteedCreditDualPostingBackfillJob } = require('../jobs/oxsteedCreditDualPostingBackfill');
const { startOxsteedCreditHousekeepingJob } = require('../jobs/oxsteedCreditHousekeeping');
const { startOxsteedCreditExternalReconciliationJob } = require('../jobs/oxsteedCreditExternalReconciliation');
const { startOxsteedCreditComplianceMonitorJob } = require('../jobs/oxsteedCreditComplianceMonitor');
const { startOxsteedCreditDisputeMonitorJob } = require('../jobs/oxsteedCreditDisputeMonitor');
const { startOxsteedCreditSettlementCycleJob } = require('../jobs/oxsteedCreditSettlementCycle');
const { startOxsteedCreditIntegrityJob } = require('../jobs/oxsteedCreditIntegrity');
const { startCreditLicenceOversightJobs } = require('../jobs/creditLicenceOversight');
const { startAdminAuditChainVerificationJob } = require('../jobs/adminAuditChainVerification');
const { startOxsteedCreditNotificationOutboxJob } = require('../jobs/oxsteedCreditNotificationOutbox');
const { startOxsteedCreditWorkerWatchdog } = require('../jobs/oxsteedCreditWorkerWatchdog');
const { startRestaurantWalletWatchdog } = require('../jobs/restaurantWalletWatchdog');
const { startMessageNotificationOutboxJob } = require('../jobs/messageNotificationOutbox');
const { startMarketplaceRefundReconciliationJob } = require('../jobs/marketplaceRefundReconciliation');
const { startPaymentRefundReconciliationJob } = require('../jobs/paymentRefundReconciliation');
const { startExternalRefundReconciliationJob } = require('../jobs/externalRefundReconciliation');
const { startLogisticsRefundProposalExpiryJob } = require('../jobs/logisticsRefundProposalExpiry');
const { startPayoutSettlementReconciliationJob } = require('../jobs/payoutSettlementReconciliation');
const { startRestaurantPayoutReconciliationJob } = require('../jobs/restaurantPayoutReconciliation');
const { startWebhookRetryJob } = require('../jobs/webhookRetryWorker');
const { startChargebackEvidenceDeadlineJob } = require('../jobs/chargebackEvidenceDeadline');
const { startWebhookReceiptRecoveryJob } = require('../jobs/webhookReceiptRecovery');
const { startBookingDepositSettlementJob } = require('../jobs/bookingDepositSettlement');
const { startSettingsChangeApplierJob } = require('../jobs/settingsChangeApplier');
const { startProfileVisibilityScheduler } = require('../jobs/profileVisibilityScheduledActions');
const { startProfileVisibilityNotificationRetryJob } = require('../jobs/profileVisibilityNotificationRetry');
const { startReferralRewardRetryJob } = require('../jobs/referralRewardRetry');
const { runSupportSlaMonitor } = require('../services/supportSlaMonitor');
const { processSupportEmailOutbox } = require('../services/supportEmailOutbox');
const { processSupportFollowUpReminders } = require('../services/supportFollowUpReminderWorker');
const { processBusinessInvoicePaymentReminders } = require('../services/businessInvoicePaymentReminderWorker');
const { recoverStaleSupportChannelDeliveries } = require('../services/supportChannelDeliveryRecovery');
const { dedicatedWorkerProcess } = require('../utils/workerTopology');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const runtimeState = require('../services/runtimeState');
const { WorkerOwnership } = require('./workerOwnership');
const { existsSync } = require('node:fs');
const { WORKER_ACTIVATION_FILE } = require('../utils/runtimeRole');

class BackgroundWorkers {
  constructor({ log = logger, pool, onOwnerAcquired, managed = false } = {}) {
    this.log = log;
    this.started = false;
    this.owned = false;
    this.onOwnerAcquired = onOwnerAcquired;
    this.ownership = pool ? new WorkerOwnership({
      pool, log, mayAcquire: () => !managed || existsSync(WORKER_ACTIVATION_FILE),
    }) : null;
    this.cronTaskIds = new Set();
    this.handles = [];
    this.cronRuns = new Map();
  }

  captureCronTasks(existingTaskIds) {
    for (const taskId of cron.getTasks().keys()) {
      if (existingTaskIds.has(taskId) || this.cronTaskIds.has(taskId)) continue;
      this.cronTaskIds.add(taskId);
      const task = cron.getTask(taskId);
      task?.on?.('execution:started', ({ execution }) => {
        if (execution) this.cronRuns.set(execution.id, Promise.withResolvers());
      });
      const finish = ({ execution }) => {
        if (!execution) return;
        this.cronRuns.get(execution.id)?.resolve();
        this.cronRuns.delete(execution.id);
      };
      task?.on?.('execution:finished', finish);
      task?.on?.('execution:failed', finish);
    }
  }

  // Background-jobs audit, Oct 30 item 18: every inline cron in this file
  // used to be a bare cron.schedule call, so a second API replica (or a
  // slow tick overlapping the next one) ran the same sweep concurrently
  // with only warn/error logging as protection. Each cron now runs under
  // its own distinct fenced job lock (cron_job_locks row); a tick that
  // cannot acquire its lock is skipped instead of double-running, and a
  // lease lost mid-run fences the rest of that tick. The handler bodies
  // keep their own logging; this catch only covers lock/budget failures
  // from withFencedJobLock itself so a tick never becomes an unhandled
  // rejection. TTLs are matched to cadence: 60s for the sub-minute
  // sweeps (a crashed run must not lock out the next minute's ticks for
  // five minutes), 300s for the 15-minute/daily sweeps, 900s for the
  // slow retention cleanups. Whether multi-replica API deployment is
  // real is Emile's call (carried question); the fencing applies
  // regardless. The translation poll cron below is NOT routed through
  // here: item 28 owns its gating (dedicatedWorkerProcess) and its
  // claim is already atomic.
  //
  // Contract: every handler MUST return the promise of its work (or be
  // async). A fire-and-forget body that drops its promise resolves the
  // wrapper immediately, so withFencedJobLock would release the lock
  // while the service is still running and the next tick could
  // double-run it. The concurrency test pins this: while one tick's
  // processWaiting is still pending, a second tick must be skipped.
  scheduleFencedCron(expression, jobName, handler, { timezone, ttlSeconds = 300 } = {}) {
    const options = timezone ? { timezone } : undefined;
    return cron.schedule(expression, () => {
      withFencedJobLock(jobName, async () => {
        await handler();
      }, ttlSeconds).catch((error) => {
        this.log.warn(`Fenced cron ${jobName} failed`, { error: error.message });
      });
    }, options);
  }

  start() {
    if (this.started) throw new Error('Background workers have already been started');
    this.started = true;
    if (this.ownership) {
      return this.ownership.start({ onAcquired: async () => {
        try { this.startOwned(); } catch (error) {
          await this.stopOwned();
          throw error;
        }
      } }).then(mode => {
        if (!this.owned && !this.ownership.stopping) runtimeState.update({ workersReady: true, workerMode: mode });
        return this;
      });
    }
    this.startOwned();
    return this;
  }

  startOwned() {
    if (this.owned) return this;
    this.owned = true;
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
      this.handles.push(startBusinessAppointmentReminderJob());
      this.handles.push(startBusinessAppointmentNoShowSweeper());
      this.handles.push(startAffiliateCommissionBatchJob());
      startScheduledDeletionJob();
      startTemplateExpiryJob();
      startAcceptedJobExpiryJob();
      startRestaurantTrainingOverdueJob();
      startStaffInviteExpiryJob();
      startRestaurantPunchCloseoutJob();
      startRestaurantScheduledReportsJob();
      startRestaurantRetentionJob();
      startFranchiseRoyaltyRedriveJob();
      startCareersJobs();
      startChatQuoteExpiryJob();
      startSupportTicketSlaJob();
      startHelperCompletionAutoConfirmJob();
      startWorkAgreementProposalTimeoutJob();
      startRecurringJobScheduler();
      startCustomerReengagementJob();
      startOxsteedCreditHoldExpiryJob();
      startDirectSlotHoldExpiryJob();
      startOxsteedCreditEntitlementExpiryJob();
      startOxsteedCreditReconciliationJob();
    startOxsteedCreditTopupExpiryJob();
      startOxsteedCreditDualPostingBackfillJob();
      startOxsteedCreditHousekeepingJob();
      startOxsteedCreditExternalReconciliationJob();
      startOxsteedCreditComplianceMonitorJob();
      startOxsteedCreditDisputeMonitorJob();
      startOxsteedCreditSettlementCycleJob();
      startOxsteedCreditIntegrityJob();
      startCreditLicenceOversightJobs();
      startAdminAuditChainVerificationJob();
      startOxsteedCreditNotificationOutboxJob();
      startOxsteedCreditWorkerWatchdog();
      startRestaurantWalletWatchdog();
      startMessageNotificationOutboxJob();
      startJobEventOutboxJob();
      this.handles.push(startRestaurantScreenSync());
      this.handles.push(startCustomer360Alerts());
      this.handles.push(startCustomer360Upgrades());
      this.handles.push(startMetricThresholdAlerts());
      this.handles.push(startMetricSnapshots());
      this.handles.push(startBroadcastDelivery());
      startJobRevisionMaintenanceJob();
      startPaymentLayersWorker();
      startMarketplaceRefundReconciliationJob();
      startPaymentRefundReconciliationJob();
      startExternalRefundReconciliationJob();
      startLogisticsRefundProposalExpiryJob();
      startPayoutSettlementReconciliationJob();
      startRestaurantPayoutReconciliationJob();
      startWebhookRetryJob();
      startChargebackEvidenceDeadlineJob();
      startWebhookReceiptRecoveryJob();
      startBookingDepositSettlementJob();
      startSettingsChangeApplierJob();
      startProfileVisibilityScheduler();
      startProfileVisibilityNotificationRetryJob();
      startReferralRewardRetryJob();
      // Growth Center link analytics retention (daily, 03:17 UTC).
      this.scheduleFencedCron('0 17 3 * * *', 'promotion-link-prune', () =>
        require('../analytics/promotionLinkAnalytics').prunePromotionLinkEvents(require('../db')).catch((error) => {
          this.log.warn('Promotion link analytics retention failed', { error: error.message });
        }), { timezone: 'UTC' });
      // Decision 3: signed-in account links for non-consent visits expire
      // after the 7-day attribution window (hourly, at :41).
      this.scheduleFencedCron('0 41 * * * *', 'promotion-account-link-expiry', () =>
        require('../analytics/promotionLinkAnalytics').clearExpiredAccountLinks(require('../db')).catch((error) => {
          this.log.warn('Promotion account-link expiry failed', { error: error.message });
        }), { timezone: 'UTC' });

      this.scheduleFencedCron('*/10 * * * * *', 'support-waiting', () =>
        require('../services/supportWaitService').processWaiting().catch((error) => {
          this.log.error('Support waiting worker failed', { error: error.message });
        }), { ttlSeconds: 60 });

      this.scheduleFencedCron('25 * * * * *', 'support-sla-monitor', () =>
        runSupportSlaMonitor().catch((error) => {
          this.log.error('Support SLA monitor failed', { error: error.message });
        }), { ttlSeconds: 60 });

      this.scheduleFencedCron('35 * * * * *', 'support-email-outbox', () =>
        processSupportEmailOutbox().catch((error) => {
          this.log.warn('Support email outbox worker failed', { error: error.message });
        }), { ttlSeconds: 60 });

      this.scheduleFencedCron('40 * * * * *', 'support-channel-delivery-recovery', () =>
        recoverStaleSupportChannelDeliveries().catch((error) => {
          this.log.warn('Support channel delivery recovery failed', { error: error.message });
        }), { ttlSeconds: 60 });

      this.scheduleFencedCron('45 * * * * *', 'support-follow-up-reminders', () =>
        processSupportFollowUpReminders().catch((error) => {
          this.log.warn('Support follow-up reminder worker failed', { error: error.message });
        }), { ttlSeconds: 60 });

      this.scheduleFencedCron('50 * * * * *', 'restaurant-inventory-reservation-release', () =>
        releaseExpiredInventoryReservations().catch((error) => {
          this.log.warn('Restaurant inventory reservation cleanup failed', { error: error.message });
        }), { ttlSeconds: 60 });

      this.scheduleFencedCron('15 * * * * *', 'restaurant-wallet-operation-cleanup', () =>
        cleanupExpiredWalletOperations().catch((error) => {
          this.log.warn('Restaurant credit expiry cleanup failed', { error: error.message });
        }), { ttlSeconds: 60 });

      this.scheduleFencedCron('*/15 * * * *', 'booking-maintenance-sweep', async () => {
        try {
          await bookingController.expirePendingBookingRequests();
          await bookingController.releaseStaleAcceptedBookings();
        } catch (err) {
          this.log.warn('Booking maintenance job failed', { error: err.message });
        }
        try {
          await cancelAbandonedPayNowOrders();
        } catch (err) {
          this.log.warn('Abandoned pay_now order sweep failed', { error: err.message });
        }
      });

      this.scheduleFencedCron(cleanupOldMessagesJob.cronExpression, 'support-message-cleanup', async () => {
        try {
          const result = await cleanupOldMessagesJob.handler();
          this.log.info('Support message cleanup job completed', result);
        } catch (err) {
          this.log.error('Support message cleanup job failed', { error: err.message });
        }
      }, { ttlSeconds: 900 });

      this.scheduleFencedCron(guestChatRetention.cronExpression, 'guest-chat-retention-cleanup', async () => {
        try {
          await guestChatRetention.cleanupGuestChatRetention();
        } catch (err) {
          this.log.error('Guest chat retention cleanup failed', { error: err.message });
        }
      }, { ttlSeconds: 900 });

      // The active support conversation table uses a separate, lock-protected
      // retention worker. Keep the legacy message cleanup above for old data.
      this.scheduleFencedCron('15 2 * * *', 'support-conversation-retention-cleanup', async () => {
        const result = await cleanupExpiredSupportMessages();
        if (!result.success) this.log.error('Support conversation retention job failed', result);
      }, { ttlSeconds: 900 });

      this.scheduleFencedCron('5 3 * * *', 'business-invoice-payment-reminders', () =>
        processBusinessInvoicePaymentReminders().catch((error) => {
          this.log.warn('Business invoice payment reminder job failed', { error: error.message });
        }));

      // Background-jobs audit, Oct 30 item 28 (cadence residual): the
      // API cron and the dedicated worker used to poll concurrently at
      // different cadences (30s here, 1.5s in workerMain.js). The claim
      // is atomic, so jobs were never double-processed, but every tick
      // was duplicate polling. The cron now runs only when no dedicated
      // worker is deployed, like the fleet below, so exactly one poller
      // exists per deployment; its default cadence matches the worker's
      // 1.5s poll as closely as cron allows (every 2s), and
      // TRANSLATION_JOB_POLL_CRON still overrides it.
      if (!dedicatedWorkerProcess()) {
        const translationJobCron = process.env.TRANSLATION_JOB_POLL_CRON || '*/2 * * * * *';
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
      }

      this.captureCronTasks(existingTaskIds);

      this.handles.push(startLocalDeliveryEventWorker({ log: this.log }));
      // Review P1-344 / P2-573 / P3-869 / P3-872: the interval workers used to
      // run only in workerMain.js, which production never started. The API
      // runs them unless a dedicated worker process is declared.
      if (!dedicatedWorkerProcess()) {
        this.handles.push(require('../workers/scheduledWorkerSchedule').startScheduledWorkers({ log: this.log }));
      }
      this.log.info('Background workers started', {
        cronTasks: this.cronTaskIds.size,
        timerWorkers: this.handles.filter(Boolean).length,
      });
      runtimeState.update({ workersReady: true, workerMode: 'combined' });
      const extraStart = this.onOwnerAcquired?.();
      if (extraStart?.catch) extraStart.catch(error => this.log.warn('Worker owner hook failed', { error: error.message }));
      return this;
    } catch (err) {
      // Capture tasks created before the failure so rollback owns and stops
      // every partial worker registration.
      this.captureCronTasks(existingTaskIds);
      if (!this.ownership) void this.stopOwned();
      this.started = false;
      throw err;
    }
  }

  async stopOwned() {
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
    this.owned = false;
    return Promise.allSettled([...draining, ...Array.from(this.cronRuns.values(), run => run.promise)]);
  }

  async stop() {
    if (!this.started && !this.ownership?.started) return;
    if (this.ownership) await this.ownership.stop(() => this.stopOwned());
    else await this.stopOwned();
    this.started = false;
    runtimeState.update({ workersReady: false, workerMode: 'combined' });
  }

  status() {
    const status = {
      started: this.started,
      cronTasks: this.cronTaskIds.size,
      timerWorkers: this.handles.filter(Boolean).length,
    };
    if (this.ownership) Object.assign(status, { owner: this.owned, mode: this.ownership.mode });
    return status;
  }
}

module.exports = { BackgroundWorkers };
