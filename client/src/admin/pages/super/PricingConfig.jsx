import React, { useState, useEffect } from 'react';
import api from '../../../api/axios';
import { useAuth } from '../../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import ConfirmDialog from '../../lib/ConfirmDialog';

export default function PricingConfig() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [form, setForm] = useState({
    tier1_price: '0',
    tier1_label: 'Free',
    tier2_price: '19.99',
    tier2_label: '/month',
    tier3_price: 'up to 17%',
    tier3_label: 'per transaction'
  });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);

  const { data, loading, error: fetchError, reload } = useAbortableFetch(async (signal) => {
    const res = await api.get('/config/pricing', { signal });
    return res.data;
  }, []);

  useEffect(() => {
    if (data) setForm(prev => ({ ...prev, ...data }));
  }, [data]);

  const loadError = !loading && fetchError
    ? (fetchError.response?.data?.error || t('superPricingConfig.errorLoad'))
    : '';

  const doSave = async () => {
    setSaved(false);
    setSaveError('');
    try {
      await api.put('/config/pricing', form);
      setSaved(true);
    } catch (err) {
      setSaveError(err.response?.data?.error || t('superPricingConfig.errorSave'));
      throw err; // keep the dialog open on failure
    }
  };

  if (user?.role !== 'super_admin') {
    return <div className="p-8 text-center text-red-500">{t('superPricingConfig.accessDenied')}</div>;
  }

  if (loading) return <div className="p-8 text-center">{t('superFinancials.loading')}</div>;

  if (loadError) {
    return (
      <div className="p-8 text-center text-gray-300">
        <p className="text-red-400">{loadError}</p>
        <button
          onClick={() => { setSaveError(''); reload(); }}
          className="mt-4 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded font-medium"
        >
          {t('superFinancials.retry')}
        </button>
      </div>
    );
  }

  const fields = [
    { key: 'tier1_price', labelKey: 'superPricingConfig.tier1Price' },
    { key: 'tier1_label', labelKey: 'superPricingConfig.tier1Label' },
    { key: 'tier2_price', labelKey: 'superPricingConfig.tier2Price' },
    { key: 'tier2_label', labelKey: 'superPricingConfig.tier2Label' },
    { key: 'tier3_price', labelKey: 'superPricingConfig.tier3Price' },
    { key: 'tier3_label', labelKey: 'superPricingConfig.tier3Label' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">{t('superPricingConfig.title')}</h1>
        <p className="text-gray-400 text-sm mb-8">{t('superPricingConfig.subtitle')}</p>
        <div className="space-y-4">
          {fields.map(f => (
            <div key={f.key} className="flex items-center gap-4">
              <label className="w-32 text-sm text-gray-300">{t(f.labelKey)}</label>
              <input
                type="text"
                value={form[f.key] || ''}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={() => setConfirmSave(true)}
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded font-medium"
          >
            {t('superPricingConfig.saveChanges')}
          </button>
          {saved && <span className="text-green-400 text-sm">{t('superPricingConfig.saved')}</span>}
          {saveError && <span className="text-red-400 text-sm">{saveError}</span>}
        </div>

        <ConfirmDialog
          open={confirmSave}
          title="Save pricing changes"
          message="Save these pricing changes? They take effect immediately across the platform."
          confirmLabel={t('superPricingConfig.saveChanges')}
          onConfirm={doSave}
          onClose={() => setConfirmSave(false)}
        />
      </div>
    </div>
  );
}
