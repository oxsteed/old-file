import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

/**
 * Super-admin view of currently-locked (IP, name) pairs from the access-gate
 * rate limiter. Each row shows when the lockout started, when it expires,
 * and a "Lift" button that requires a reason and clears the row.
 *
 * Also surfaces a small audit table of recent attempts (last 100) so the
 * super-admin can spot patterns before deciding whether to lift.
 */
export default function AccessGateLockouts() {
  const { t } = useTranslation();
  const [showFailedOnly, setShowFailedOnly] = useState(true);
  const [liftTarget, setLiftTarget] = useState(null); // lockout id awaiting lift confirmation

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const [lockoutsRes, attemptsRes] = await Promise.all([
      adminApi.get('/admin/super/access-gate/lockouts', { signal }),
      adminApi.get('/admin/super/access-gate/attempts', {
        signal,
        params: { limit: 100, success: showFailedOnly ? '0' : undefined },
      }),
    ]);
    return {
      lockouts: lockoutsRes.data?.items || [],
      attempts: attemptsRes.data?.items || [],
      maxFails: lockoutsRes.data?.maxFails || 3,
      lockoutHours: lockoutsRes.data?.lockoutHours || 24,
    };
  }, [showFailedOnly]);

  const lockouts = data?.lockouts || [];
  const attempts = data?.attempts || [];
  const maxFails = data?.maxFails || 3;
  const lockoutHours = data?.lockoutHours || 24;

  async function doLift(reason) {
    try {
      await adminApi.post(`/admin/super/access-gate/lockouts/${liftTarget}/lift`, { reason });
      toast.success(t('adminAccessGateLifted'));
      setLiftTarget(null);
      reload();
    } catch (err) {
      throw new Error(err.response?.data?.error || t('adminAccessGateLiftFailed'));
    }
  }

  function relativeTime(value) {
    if (!value) return '-';
    const ms = new Date(value).getTime() - Date.now();
    if (Math.abs(ms) < 60_000) return t('adminAccessGateRelSeconds', { count: Math.round(ms / 1000) });
    if (Math.abs(ms) < 3_600_000) return t('adminAccessGateRelMinutes', { count: Math.round(ms / 60_000) });
    if (Math.abs(ms) < 86_400_000) return t('adminAccessGateRelHours', { count: Math.round(ms / 3_600_000) });
    return t('adminAccessGateRelDays', { count: Math.round(ms / 86_400_000) });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('adminAccessGateTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('adminAccessGateSubtitle', { maxFails, lockoutHours })}
        </p>
      </div>

      <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold">{t('adminAccessGateCurrentlyLocked')}</h2>
          <button
            type="button"
            onClick={reload}
            className="text-sm text-orange-600 hover:text-orange-700 underline"
          >
            {t('common.refresh')}
          </button>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-gray-500">{t('common.loading')}</div>
        ) : error ? (
          <div className="p-4"><AdminErrorState onRetry={reload} /></div>
        ) : lockouts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500">{t('adminAccessGateNoLockouts')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('adminAccessGateColIp')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColName')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColFails')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColFirstFail')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColLockedUntil')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColTimeLeft')}</th>
                <th className="px-4 py-2 text-right">{t('adminAccessGateColAction')}</th>
              </tr>
            </thead>
            <tbody>
              {lockouts.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2 font-mono text-xs">{row.ip}</td>
                  <td className="px-4 py-2">{row.displayName} <span className="text-gray-400">({row.normalizedName})</span></td>
                  <td className="px-4 py-2">{row.failCount}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(row.firstFailAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-gray-500">{new Date(row.lockedUntil).toLocaleString()}</td>
                  <td className="px-4 py-2 text-orange-600">{relativeTime(row.lockedUntil)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setLiftTarget(row.id)}
                      className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded"
                    >
                      {t('adminAccessGateLift')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold">{t('adminAccessGateRecentAttempts')}</h2>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <input
              type="checkbox"
              checked={showFailedOnly}
              onChange={(e) => setShowFailedOnly(e.target.checked)}
            />
            {t('adminAccessGateFailedOnly')}
          </label>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-gray-500">{t('common.loading')}</div>
        ) : error ? (
          <div className="p-4"><AdminErrorState onRetry={reload} /></div>
        ) : attempts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500">{t('adminAccessGateNoAttempts')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('adminAccessGateColWhen')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColIp')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColClaimedName')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColScope')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColResult')}</th>
                <th className="px-4 py-2">{t('adminAccessGateColError')}</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2 text-gray-500">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.ip}</td>
                  <td className="px-4 py-2">{row.claimedName}</td>
                  <td className="px-4 py-2">{row.scope}</td>
                  <td className="px-4 py-2">
                    {row.success ? (
                      <span className="text-emerald-600">{t('adminAccessGateOk')}</span>
                    ) : (
                      <span className="text-rose-600">{t('adminAccessGateFail')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{row.errorCode || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={liftTarget != null}
        title={t('adminAccessGateConfirmTitle')}
        message={t('adminAccessGateConfirmMessage')}
        requireReason
        reasonLabel={t('adminAccessGateReasonLabel')}
        reasonPlaceholder={t('adminAccessGateReasonPlaceholder')}
        confirmLabel={t('adminAccessGateConfirmLabel')}
        danger
        onConfirm={doLift}
        onClose={() => setLiftTarget(null)}
      />
    </div>
  );
}
