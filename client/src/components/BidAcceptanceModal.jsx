import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function BidAcceptanceModal({
  bid,
  helperPolicies,
  onCancel,
  onConfirm
}) {
  const { t } = useTranslation();
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [loading, setLoading] = useState(false);

  // Direct payment is the launch-safe default. Stripe-style protected payment
  // remains a future option, but it is not part of the launch flow.
  const policiesLoaded = helperPolicies != null;
  const canSelectCustom  = policiesLoaded ? (helperPolicies?.custom_enabled ?? true) : true;

  // Default to direct payment if it is available.
  React.useEffect(() => {
    if (!selectedPaymentMethod) {
      if (canSelectCustom) {
        setSelectedPaymentMethod('off_platform');
      }
    }
  }, [canSelectCustom, selectedPaymentMethod]);

  const handleConfirm = () => {
    if (!selectedPaymentMethod) {
      toast.error(t('bidAcceptanceModal.selectPaymentMethod') || 'Please select a payment method');
      return;
    }

    // Return the payment method selection to parent
    onConfirm({ payment_method: selectedPaymentMethod });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-6">
          {t('bidAcceptanceModal.choosePaymentMethod') || 'Choose Payment Method'}
        </h2>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {t('bidAcceptanceModal.selectPaymentExplanation') || 'Select how you\'ll pay for this job. Each option has different cancellation terms.'}
        </p>

        <div className="space-y-4 mb-6">
          {/* Custom Off-Platform Payment Method Option */}
          {canSelectCustom && (
            <div
              onClick={() => setSelectedPaymentMethod('off_platform')}
              className={`border-2 rounded-lg p-4 cursor-pointer transition ${
                selectedPaymentMethod === 'off_platform'
                  ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-orange-300 dark:hover:border-orange-700'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="payment-method"
                  value="off_platform"
                  checked={selectedPaymentMethod === 'off_platform'}
                  onChange={() => setSelectedPaymentMethod('off_platform')}
                  className="mt-1"
                  aria-label={t('bidAcceptanceModal.customOption') || 'Custom off-platform payment'}
                />
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">
                    {t('bidAcceptanceModal.customPayment') || 'Direct Customer-Helper Payment'}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    {t('bidAcceptanceModal.customDescription') || 'Pay outside OxSteed and keep the record in the app.'}
                  </p>

                  {/* Custom Terms Display */}
                  <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded border border-orange-200 dark:border-orange-700">
                    <p className="text-sm font-semibold mb-2">
                      {t('bidAcceptanceModal.customTerms') || 'Helper\'s Terms:'}
                    </p>
                    {helperPolicies?.custom_policy?.terms ? (
                      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                        {helperPolicies.custom_policy.terms}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500 italic">
                        {t('bidAcceptanceModal.noTermsProvided') || 'No specific terms provided'}
                      </p>
                    )}

                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1 mt-2 pt-2 border-t border-purple-200 dark:border-purple-700">
                      <p>
                        <strong>{t('bidAcceptanceModal.depositRequired') || 'Deposit Required'}:</strong>{' '}
                        {helperPolicies?.custom_policy?.deposit_percent ?? 50}%
                      </p>
                      <p>
                        <strong>{t('bidAcceptanceModal.minimumNotice') || 'Minimum Notice'}:</strong>{' '}
                        {helperPolicies?.custom_policy?.min_notice_hours ?? 48} {t('bidAcceptanceModal.hours') || 'hours'}
                      </p>
                    </div>

                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2 font-semibold">
                      ⚠ {t('bidAcceptanceModal.customPaymentWarning') || 'Use chat/activity to share proof or confirmation after payment.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* No Valid Options */}
          {!canSelectCustom && (
            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded border border-red-200 dark:border-red-700">
              <p className="text-sm text-red-800 dark:text-red-200">
                {t('bidAcceptanceModal.noPaymentMethods') || 'This helper has not configured any payment methods. Please contact support.'}
              </p>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="bg-yellow-50 dark:bg-yellow-900/10 p-3 rounded-lg border border-yellow-200 dark:border-yellow-700 mb-6">
          <p className="text-xs text-yellow-800 dark:text-yellow-200">
            <strong>{t('bidAcceptanceModal.noteTitle') || 'Note'}:</strong>{' '}
            {t('bidAcceptanceModal.noteBody') || 'Once you accept the bid, the payment method cannot be changed. Make sure you understand the cancellation terms before confirming.'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {t('bidAcceptanceModal.cancel') || 'Cancel'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !selectedPaymentMethod}
            className="flex-1 px-4 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-400 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {loading
              ? t('bidAcceptanceModal.accepting') || 'Accepting...'
              : t('bidAcceptanceModal.acceptBid') || 'Accept Bid'}
          </button>
        </div>
      </div>
    </div>
  );
}
