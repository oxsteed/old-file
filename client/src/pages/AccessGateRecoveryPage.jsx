import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

/**
 * Recovery landing page. Email sent by /api/auth/internal-access/recovery/request
 * links here with ?token=<raw>. We POST it to /recovery/use which:
 *   - validates the token (unused, unexpired)
 *   - lifts any active lockouts for the user's bound IP + name
 *
 * Always runs once per mount; subsequent token reuse fails with 409.
 */
export default function AccessGateRecoveryPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [status, setStatus] = useState('working'); // working | ok | error
  const [message, setMessage] = useState(t('accessGateRecovery.validating'));
  const [liftedCount, setLiftedCount] = useState(0);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage(t('accessGateRecovery.missingToken'));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post('/auth/internal-access/recovery/use', { token });
        if (cancelled) return;
        setStatus('ok');
        setLiftedCount(data.liftedCount || 0);
        setMessage(
          data.liftedCount
            ? t('accessGateRecovery.lifted', { count: data.liftedCount })
            : t('accessGateRecovery.consumed')
        );
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        const status = err.response?.status;
        if (status === 409) setMessage(t('accessGateRecovery.errors.alreadyUsed'));
        else if (status === 410) setMessage(t('accessGateRecovery.errors.expired'));
        else setMessage(err.response?.data?.error || t('accessGateRecovery.errors.failed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-gray-900/80 border border-gray-800 rounded-xl p-6 shadow-xl">
        <h1 className="text-xl font-semibold mb-3">{t('accessGateRecovery.title')}</h1>
        <div
          className={`px-3 py-2 rounded mb-4 text-sm ${
            status === 'ok'
              ? 'bg-emerald-900/40 border border-emerald-700 text-emerald-200'
              : status === 'error'
              ? 'bg-rose-900/40 border border-rose-700 text-rose-200'
              : 'bg-gray-800/60 border border-gray-700 text-gray-200'
          }`}
        >
          {message}
        </div>
        {status === 'ok' && liftedCount > 0 && (
          <p className="text-xs text-gray-400 mb-4">
            {t('accessGateRecovery.postClearHelp')}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
          onClick={() => navigate('/admin/login')}
          className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 rounded-lg"
        >
          {t('accessGateRecovery.cta.adminLogin')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/logistics')}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-100 font-semibold py-2 rounded-lg"
          >
            {t('accessGateRecovery.cta.logisticsHome')}
          </button>
        </div>
      </div>
    </div>
  );
}
