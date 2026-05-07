import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';

export default function HelperCancellationSettings() {
  const { t } = useTranslation();
  const [policies, setPolicies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [oxsteadEnabled, setOxsteadEnabled] = useState(true);
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customPolicy, setCustomPolicy] = useState({
    deposit_percent: 50,
    terms: '',
    min_notice_hours: 48
  });

  useEffect(() => {
    loadPolicies();
  }, []);

  const loadPolicies = async () => {
    try {
      const { data } = await api.get('/helper-settings/policies');
      setPolicies(data.data);
      setOxsteadEnabled(data.data.oxsteed_enabled ?? true);
      setCustomEnabled(data.data.custom_enabled ?? false);
      setCustomPolicy(data.data.custom_policy || {
        deposit_percent: 50,
        terms: '',
        min_notice_hours: 48
      });
    } catch (err) {
      toast.error(t('common.failedToLoad') || 'Failed to load policies');
      console.error('Error loading policies:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // Validation: at least one method enabled
    if (!oxsteadEnabled && !customEnabled) {
      toast.error(t('cancellationSettings.enableAtLeastOne') || 'Enable at least one payment method');
      return;
    }

    setSaving(true);
    try {
      await api.put('/helper-settings/policies', {
        oxsteed_enabled: oxsteadEnabled,
        custom_enabled: customEnabled,
        custom_policy: customEnabled ? customPolicy : {}
      });
      toast.success(t('cancellationSettings.policiesSaved') || 'Policies updated');
      loadPolicies();
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.response?.data?.error || t('common.failedToUpdate') || 'Failed to update policies';
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageShell>
        <PageMeta title={t('cancellationSettings.pageTitle') || 'Payment & Cancellation Policies'} />
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-600 dark:text-gray-400">{t('common.loading') || 'Loading...'}</div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('cancellationSettings.pageTitle') || 'Payment & Cancellation Policies'} />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">
          {t('cancellationSettings.pageTitle') || 'Payment & Cancellation Policies'}
        </h1>

        {/* OxSteed Payment Method */}
        <div className="bg-white dark:bg-gray-900 rounded-lg p-6 mb-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">{t('cancellationSettings.oxsteadPayment') || 'OxSteed Platform Payment'}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('cancellationSettings.oxsteadDescription') || 'Customers pay via OxSteed with standard cancellation protection'}
              </p>
            </div>
            <input
              type="checkbox"
              checked={oxsteadEnabled}
              onChange={(e) => setOxsteadEnabled(e.target.checked)}
              className="w-6 h-6 cursor-pointer"
              aria-label={t('cancellationSettings.enableOxsteed') || 'Enable OxSteed payments'}
            />
          </div>
          {oxsteadEnabled && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded border border-blue-200 dark:border-blue-700">
              <h3 className="font-semibold text-sm mb-2">{t('cancellationSettings.cancellationPolicy') || 'Cancellation Policy'}</h3>
              <ul className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
                <li>• <strong>{t('cancellationSettings.threeDaysPlus') || '3+ days before'}:</strong> {t('cancellationSettings.zeroPercent') || 'Customer pays 0% cancellation fee'}</li>
                <li>• <strong>{t('cancellationSettings.twentyFourTo72Hours') || '24h-3 days before'}:</strong> {t('cancellationSettings.fiftyPercent') || 'Customer pays 50% of fee cap (max $100)'}</li>
                <li>• <strong>{t('cancellationSettings.lessThan24Hours') || '<24h before'}:</strong> {t('cancellationSettings.fullPercent') || 'Customer pays 100% of fee cap (max $100)'}</li>
                <li className="mt-2 text-xs text-green-600">✓ {t('cancellationSettings.helperProtected') || 'You are protected from last-minute cancellations'}</li>
              </ul>
            </div>
          )}
        </div>

        {/* Custom Off-Platform Payment */}
        <div className="bg-white dark:bg-gray-900 rounded-lg p-6 mb-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">{t('cancellationSettings.customPayment') || 'Custom Off-Platform Payment'}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {t('cancellationSettings.customDescription') || 'Negotiate directly with customers (payment outside OxSteed)'}
              </p>
            </div>
            <input
              type="checkbox"
              checked={customEnabled}
              onChange={(e) => setCustomEnabled(e.target.checked)}
              className="w-6 h-6 cursor-pointer"
              aria-label={t('cancellationSettings.enableCustom') || 'Enable custom off-platform payments'}
            />
          </div>
          {customEnabled && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('cancellationSettings.depositRequired') || 'Deposit Required (%)'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={customPolicy.deposit_percent ?? 50}
                  onChange={(e) => setCustomPolicy({...customPolicy, deposit_percent: parseInt(e.target.value) || 0})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  aria-label={t('cancellationSettings.depositRequired') || 'Deposit percentage'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('cancellationSettings.minimumNoticeHours') || 'Minimum Notice Hours'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={customPolicy.min_notice_hours ?? 48}
                  onChange={(e) => setCustomPolicy({...customPolicy, min_notice_hours: parseInt(e.target.value) || 0})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  aria-label={t('cancellationSettings.minimumNoticeHours') || 'Minimum notice in hours'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('cancellationSettings.yourTerms') || 'Your Terms (shown to customers)'} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={customPolicy.terms ?? ''}
                  onChange={(e) => setCustomPolicy({...customPolicy, terms: e.target.value})}
                  placeholder={t('cancellationSettings.termsPlaceholder') || 'E.g., "50% upfront, 50% on completion. 100% refund if cancelled >48h before."'}
                  maxLength="1000"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg h-24 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  aria-label={t('cancellationSettings.yourTerms') || 'Your custom cancellation terms'}
                />
                <div className="text-xs text-gray-500 mt-1">{(customPolicy.terms?.length || 0)}/1000 characters</div>
              </div>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-lg border border-yellow-200 dark:border-yellow-700 mb-6">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>{t('cancellationSettings.noteTitle') || 'Note'}: </strong>
            {t('cancellationSettings.noteBody') || 'You must enable at least one payment method. Customers will see your enabled options when reviewing your bid.'}
          </p>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-400 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (t('common.saving') || 'Saving...') : (t('common.save') || 'Save Policies')}
        </button>
      </div>
    </PageShell>
  );
}
