import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import RsdPager, { serverErrorMessage } from '../lib/RsdPager';
import { adminDateTime } from '../lib/formatters';

// Food fraud-signal review (finding 22): gated server-side on
// view_financials for the list and manage_financials for review. Review
// records reviewer, note, and timestamp, plus a fail-closed audit row.
const PAGE_LIMIT = 50;

export default function FoodFraudSignals() {
  const { t } = useTranslation();
  const [reviewed, setReviewed] = useState('');
  const [severity, setSeverity] = useState('');
  const [restaurantId, setRestaurantId] = useState('');
  const [offset, setOffset] = useState(0);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/food/admin/fraud-signals', {
      signal,
      timeout: 15000,
      params: {
        ...(reviewed ? { reviewed } : {}),
        ...(severity ? { severity } : {}),
        ...(restaurantId ? { restaurantId } : {}),
        limit: PAGE_LIMIT,
        offset,
      },
    });
    return { signals: body?.signals || [], total: body?.total ?? 0 };
  }, [reviewed, severity, restaurantId, offset]);

  const signals = data?.signals || [];
  const total = data?.total ?? 0;
  const applyFilter = (setter) => (event) => {
    setter(event.target.value);
    setOffset(0);
  };

  const review = async (signal) => {
    setBusyId(signal.id);
    setActionError('');
    setNotice('');
    try {
      await adminApi.post(`/food/admin/fraud-signals/${signal.id}/review`, { note: notes[signal.id] || '' });
      setNotice(t('adminFraudSignals.reviewDone'));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminFraudSignals.actionFailed')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminFraudSignals.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminFraudSignals.subtitle')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={reviewed} onChange={applyFilter(setReviewed)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminFraudSignals.allReviewed')}</option>
          <option value="false">{t('adminFraudSignals.unreviewedOnly')}</option>
          <option value="true">{t('adminFraudSignals.reviewedOnly')}</option>
        </select>
        <select value={severity} onChange={applyFilter(setSeverity)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminFraudSignals.allSeverities')}</option>
          {['info', 'warn', 'block'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <input
          value={restaurantId}
          onChange={applyFilter(setRestaurantId)}
          placeholder={t('adminFraudSignals.restaurantIdPlaceholder')}
          inputMode="numeric"
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
        />
      </div>

      {actionError && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
      )}
      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={serverErrorMessage(loadError, t('adminFraudSignals.loadFailed'))} onRetry={reload} />
      )}
      {!loading && !loadError && signals.length === 0 && (
        <p className="text-gray-500">{t('adminFraudSignals.empty')}</p>
      )}
      {!loading && !loadError && signals.length > 0 && (
        <div className="space-y-3">
          {signals.map((signal) => (
            <div key={signal.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{signal.signal_type}</span>
                <span className="text-xs text-gray-400">{signal.severity} · {signal.reviewed ? t('adminFraudSignals.reviewed') : t('adminFraudSignals.unreviewed')}</span>
              </div>
              <p className="mt-1 text-sm text-gray-400">
                {signal.restaurant_name || t('adminFraudSignals.restaurant', { id: signal.restaurant_id })}
                {signal.customer_email ? ` · ${signal.customer_email}` : ''}
                {` · ${adminDateTime(signal.created_at)}`}
              </p>
              {signal.reviewed_by_email && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('adminFraudSignals.reviewedBy', { email: signal.reviewed_by_email })}
                  {signal.reviewed_at ? ` · ${adminDateTime(signal.reviewed_at)}` : ''}
                </p>
              )}
              {signal.review_note && <p className="mt-1 text-sm text-gray-300">{signal.review_note}</p>}
              {!signal.reviewed && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={notes[signal.id] || ''}
                    onChange={(event) => setNotes((prev) => ({ ...prev, [signal.id]: event.target.value }))}
                    placeholder={t('adminFraudSignals.notePlaceholder')}
                    className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={busyId === signal.id}
                    onClick={() => setConfirm({ signal, title: t('adminFraudSignals.review') })}
                    className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {t('adminFraudSignals.review')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && !loadError && (
        <RsdPager offset={offset} limit={PAGE_LIMIT} total={total} onPage={setOffset} />
      )}
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={t('adminFraudSignals.confirmReview')}
          confirmLabel={confirm.title}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const { signal } = confirm;
            setConfirm(null);
            await review(signal);
          }}
        />
      )}
    </div>
  );
}
