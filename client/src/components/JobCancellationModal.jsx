import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function JobCancellationModal({
  job,
  bid,
  isCustomer,
  counterpartyName,
  onCancel,
  onConfirm
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  // Calculate time until start
  const jobStartTime = new Date(job.scheduled_date);
  const timeUntilStart = jobStartTime - Date.now();
  const hoursUntilStart = timeUntilStart / (1000 * 60 * 60);

  let timeCategory = '';
  let feeToPay = 0;

  if (hoursUntilStart >= 72) {
    timeCategory = t('cancellationModal.threeDaysPlus') || '3+ days before';
    feeToPay = 0;
  } else if (hoursUntilStart >= 24) {
    timeCategory = t('cancellationModal.twentyFourTo72Hours') || '24h-3 days before';
    const feeCap = Math.min(Math.round(bid.amount * 0.1), 10000); // in cents
    feeToPay = Math.round(feeCap * 0.5);
  } else {
    timeCategory = t('cancellationModal.lessThan24Hours') || 'Less than 24h before';
    feeToPay = Math.min(Math.round(bid.amount * 0.1), 10000); // in cents
  }

  const handleCancel = async () => {
    setLoading(true);
    try {
      // For customers, show moral acknowledgement first
      if (isCustomer && feeToPay > 0) {
        const confirmed = window.confirm(
          `${t('cancellationModal.affectingHelper') || 'By cancelling, you\'re affecting'} ${counterpartyName}'s ${t('cancellationModal.abilityToEarn') || 'ability to earn'}. ` +
          `${t('cancellationModal.theyBlockedTime') || 'They have blocked their time for your job'}. ` +
          `${t('cancellationModal.youWillBeCharged') || 'You will be charged'} $${(feeToPay / 100).toFixed(2)} ${t('cancellationModal.forThisCancellation') || 'for this cancellation'}.\n\n` +
          `${t('cancellationModal.doYouWantToProceed') || 'Do you want to proceed?'}`
        );
        if (!confirmed) {
          setLoading(false);
          return;
        }
      }

      const { data } = await api.post(`/jobs/${job.id}/cancel`, {
        reason: reason || null
      });

      const message = feeToPay > 0
        ? `${t('cancellationModal.jobCancelled') || 'Job cancelled'}. ${t('cancellationModal.feeApplied') || 'Fee of'} $${(feeToPay / 100).toFixed(2)} ${t('cancellationModal.hasBeenApplied') || 'has been applied'}.`
        : `${t('cancellationModal.jobCancelledSuccessfully') || 'Job cancelled successfully'}.`;

      toast.success(message);
      onConfirm(data.data);
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.response?.data?.error || t('common.failedToCancel') || 'Failed to cancel job';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const paymentIsOxsteed = bid.payment_method === 'oxsteed';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">
          {t('cancellationModal.cancelJob') || 'Cancel Job?'}
        </h2>

        {/* Show who this affects */}
        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded mb-4 border border-yellow-200 dark:border-yellow-700">
          <p className="text-sm font-semibold mb-2">
            {isCustomer
              ? `${counterpartyName} ${t('cancellationModal.hasBlockedTime') || 'has blocked their time for this job'}.`
              : `${counterpartyName} ${t('cancellationModal.isCountingOnYou') || 'is counting on you for this job'}.`
            }
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {isCustomer
              ? t('cancellationModal.yourCancellationAffects') || 'Your cancellation affects their ability to earn. They may have turned down other work.'
              : t('cancellationModal.yourCancellationMayLeave') || 'Your cancellation may leave them without help at the last minute.'
            }
          </p>
        </div>

        {/* Fee information (only for OxSteed) */}
        {paymentIsOxsteed && (
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded mb-4 border border-blue-200 dark:border-blue-700">
            <p className="text-sm font-semibold mb-2">
              {t('cancellationModal.cancellationFee') || 'Cancellation Fee'}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t('cancellationModal.timeUntilJob') || 'Time until job'}: <strong>{Math.round(hoursUntilStart)} ${t('cancellationModal.hours') || 'hours'}</strong>
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              {t('cancellationModal.timingBracket') || 'Timing bracket'}: <strong>{timeCategory}</strong>
            </p>
            {feeToPay > 0 ? (
              <p className="text-sm font-semibold text-red-600 mt-2">
                {t('cancellationModal.youWillBeCharged') || 'You will be charged'}: ${(feeToPay / 100).toFixed(2)}
              </p>
            ) : (
              <p className="text-sm font-semibold text-green-600 mt-2">
                ✓ {t('cancellationModal.noCancellationFee') || 'No cancellation fee'} ({t('cancellationModal.farEnoughInAdvance') || 'far enough in advance'})
              </p>
            )}
          </div>
        )}

        {/* Reason (optional) */}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('cancellationModal.reasonPlaceholder') || 'Optional: Tell the helper why you\'re cancelling'}
          maxLength="500"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-4 h-20 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 resize-none"
          aria-label={t('cancellationModal.reason') || 'Cancellation reason'}
        />
        <div className="text-xs text-gray-500 mb-4">{reason.length}/500 characters</div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('cancellationModal.keepJob') || 'Keep Job'}
          </button>
          <button
            onClick={handleCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-500 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (t('cancellationModal.cancelling') || 'Cancelling...') : (t('cancellationModal.cancelJob') || 'Cancel Job')}
          </button>
        </div>
      </div>
    </div>
  );
}
