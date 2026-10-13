import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import toast from 'react-hot-toast';
import PaymentRailChooser from './PaymentRailChooser';
import usePaymentLayersConfig from '../hooks/usePaymentLayersConfig';

export default function BidAcceptanceModal({
  bid,
  helperPolicies,
  onCancel,
  onConfirm
}) {
  const { t } = useTranslation();
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [loading, setLoading] = useState(false);
  // Rail engine (FEATURE_PAYMENT_RAILS): the server lists the rails for this
  // bid; when it is off the legacy direct-payment choice below is unchanged.
  const [railOptions, setRailOptions] = useState(null);
  const [railSelection, setRailSelection] = useState(null);

  React.useEffect(() => {
    let cancelled = false;
    const jobId = bid?.job_id;
    if (!jobId || !bid?.id) return undefined;
    api.get(`/payment-layers/jobs/${jobId}/options`, { params: { bid_id: bid.id } })
      .then(({ data }) => { if (!cancelled && data?.engine) setRailOptions(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bid?.job_id, bid?.id]);

  // Direct payment is the launch-safe default. The protected OxSteed
  // (Tier-3 escrow) option is offered only when the platform has launched
  // protected job payments AND the helper accepts them. The server still
  // enforces both (503 when unlaunched, 400 when the helper opted out),
  // so a stale client can never sneak an escrow acceptance through.
  const policiesLoaded = helperPolicies != null;
  const canSelectCustom  = policiesLoaded ? (helperPolicies?.custom_enabled ?? true) : true;
  const launchFlags = usePaymentLayersConfig();
  const canSelectProtected = policiesLoaded
    && Boolean(launchFlags?.PLATFORM_PAYMENTS)
    && helperPolicies?.oxsteed_enabled === true;

  // Cancellation fee cap for the protected option, mirroring assignHelper:
  // 10% of the bid, capped at $100.
  const bidCents = bid?.amount_cents ?? Math.round(Number(bid?.amount || 0) * 100);
  const escrowFeeCapCents = Math.min(Math.round(bidCents * 0.1), 10000);
  const escrowFeeCap = `$${(escrowFeeCapCents / 100).toFixed(2)}`;
  const escrowHalfFee = `$${(Math.round(escrowFeeCapCents * 0.5) / 100).toFixed(2)}`;

  // Default to direct payment if it is available.
  React.useEffect(() => {
    if (!selectedPaymentMethod) {
      if (canSelectCustom) {
        setSelectedPaymentMethod('off_platform');
      }
    }
  }, [canSelectCustom, selectedPaymentMethod]);

  const handleConfirm = () => {
    if (railOptions) {
      if (!railSelection?.ready) {
        toast.error(t('paymentRail.chooseRail'));
        return;
      }
      onConfirm(railSelection.payload);
      return;
    }
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

        {railOptions && (
          <PaymentRailChooser bid={bid} options={railOptions} helperPolicies={helperPolicies} onChange={setRailSelection} />
        )}
        <div className="space-y-4 mb-6" hidden={Boolean(railOptions)}>
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

                    {selectedPaymentMethod === 'off_platform' &&
                      Array.isArray(helperPolicies?.custom_policy?.payment_details) &&
                      helperPolicies.custom_policy.payment_details.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-orange-200 dark:border-orange-700">
                          <p className="text-sm font-semibold mb-2">
                            {t('bidAcceptanceModal.howToPayTitle', 'How to pay')}
                          </p>
                          <ul className="space-y-2">
                            {helperPolicies.custom_policy.payment_details.map((detail, index) => (
                              <li key={index} className="text-sm">
                                <p className="font-semibold text-gray-800 dark:text-gray-200">
                                  {detail.label}
                                </p>
                                {detail.link_url && (
                                  <p>
                                    <a
                                      href={detail.link_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 dark:text-blue-400 underline break-all"
                                    >
                                      {detail.link_url}
                                    </a>
                                  </p>
                                )}
                                {detail.handle && (
                                  <p className="text-xs text-gray-600 dark:text-gray-400">
                                    {detail.handle}
                                  </p>
                                )}
                                {detail.instructions && (
                                  <p className="text-xs text-gray-600 dark:text-gray-400">
                                    {detail.instructions}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Protected OxSteed payment (Tier-3 escrow). Offered only when the
              platform launched protected job payments and the helper accepts
              them (see canSelectProtected above). */}
          {canSelectProtected && (
            <div
              onClick={() => setSelectedPaymentMethod('oxsteed')}
              className={`border-2 rounded-lg p-4 cursor-pointer transition ${
                selectedPaymentMethod === 'oxsteed'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="payment-method"
                  value="oxsteed"
                  checked={selectedPaymentMethod === 'oxsteed'}
                  onChange={() => setSelectedPaymentMethod('oxsteed')}
                  className="mt-1"
                  aria-label={t('bidAcceptanceModal.oxsteadOption') || 'OxSteed platform payment'}
                />
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">
                    {t('bidAcceptanceModal.oxsteadPayment') || 'OxSteed Platform Payment'}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    {t('bidAcceptanceModal.oxsteadDescription') || 'Pay via OxSteed with built-in cancellation protection'}
                  </p>

                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-700">
                    <p className="text-sm font-semibold mb-2">
                      {t('bidAcceptanceModal.youAndHelperProtected') || 'You and the helper are both protected'}
                    </p>
                    <p className="text-sm font-semibold">
                      {t('bidAcceptanceModal.cancellationFeeStructure') || 'Cancellation Fee Structure:'}
                    </p>
                    <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 mt-1">
                      <li>
                        <strong>{t('bidAcceptanceModal.threeDaysPlus') || '3+ days before'}:</strong>{' '}
                        {t('bidAcceptanceModal.freeNoFee') || 'Free (no cancellation fee)'}
                      </li>
                      <li>
                        <strong>{t('bidAcceptanceModal.twentyFourTo72') || '24h-3 days before'}:</strong>{' '}
                        {escrowHalfFee}
                      </li>
                      <li>
                        <strong>{t('bidAcceptanceModal.lessThan24') || '<24h before'}:</strong>{' '}
                        {escrowFeeCap}
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* No Valid Options */}
          {!canSelectCustom && !canSelectProtected && (
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
            disabled={loading || (railOptions ? !railSelection?.ready : !selectedPaymentMethod)}
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
