import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

interface Props {
  token: string;
  onSuccess: (tier: string) => void;
  onBack: () => void;
}

export default function Step5ChoosePlan({ token: _token, onSuccess, onBack }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('free');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const plans = [
    {
      id: 'free',
      name: t('helperRegister.step5.freeName'),
      price: t('helperRegister.step5.freePrice'),
      period: t('helperRegister.step5.freePeriod'),
      description: t('helperRegister.step5.freeDesc'),
      features: [
        t('helperRegister.step5.freeFeat1'),
        t('helperRegister.step5.freeFeat2'),
        t('helperRegister.step5.freeFeat3'),
        t('helperRegister.step5.freeFeat4'),
      ],
      cta: t('helperRegister.step5.freeCta'),
    },
    {
      id: 'pro',
      name: t('helperRegister.step5.proName'),
      price: t('helperRegister.step5.proPrice'),
      period: t('helperRegister.step5.proPeriod'),
      badge: t('helperRegister.step5.mostPopular'),
      description: t('helperRegister.step5.proDesc'),
      features: [
        t('helperRegister.step5.proFeat1'),
        t('helperRegister.step5.proFeat2'),
        t('helperRegister.step5.proFeat3'),
        t('helperRegister.step5.proFeat4'),
        t('helperRegister.step5.proFeat5'),
      ],
      cta: t('helperRegister.step5.proCta'),
    },
  ];

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      await api.post('/helper-registration/tier', { tier: selected });
      onSuccess(selected);
    } catch (err: any) {
      setError(err.response?.data?.error || t('helperRegister.step5.failedSave'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm" role="alert">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {plans.map(plan => (
          <button key={plan.id} type="button" onClick={() => setSelected(plan.id)}
            className={`relative p-5 rounded-xl border-2 text-left transition ${
              selected === plan.id
                ? 'border-orange-500 bg-orange-500/5'
                : 'border-gray-700 bg-gray-900 hover:border-gray-600'
            }`}>
            {plan.badge && (
              <span className="absolute -top-3 left-4 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {plan.badge}
              </span>
            )}
            <div className="mb-3">
              <h3 className="text-white font-bold text-lg">{plan.name}</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-orange-400">{plan.price}</span>
                <span className="text-gray-500 text-sm">{plan.period}</span>
              </div>
              <p className="text-gray-400 text-sm mt-1">{plan.description}</p>
            </div>
            <ul className="space-y-2">
              {plan.features.map((f, i) => (
                <li key={i} className="text-gray-300 text-sm flex items-start gap-2">
                  <span className="text-green-400 mt-0.5">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {selected === 'pro' && (
        <div className="p-4 bg-gray-900 border border-gray-700 rounded-lg">
          <p className="text-gray-300 text-sm">
            {t('helperRegister.step5.proNotice')}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onBack}
          className="px-6 py-3 bg-transparent border border-gray-600 text-gray-300 hover:border-gray-500 rounded-lg transition">
          {t('helperRegister.step5.back')}
        </button>
        <button onClick={handleSubmit} disabled={loading}
          className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 transition">
          {loading ? t('helperRegister.step5.saving') : t('helperRegister.step5.continue')}
        </button>
      </div>
    </div>
  );
}
