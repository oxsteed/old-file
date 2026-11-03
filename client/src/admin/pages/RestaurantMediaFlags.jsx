import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import RsdPager, { serverErrorMessage } from '../lib/RsdPager';
import { adminDateTime } from '../lib/formatters';

// Dedicated restaurant media-flag queue (finding 21). The general MediaFlags
// page links here; this page owns the restaurant queue with pagination,
// a total, a restaurant filter, audited review, and unhide/restore.
const PAGE_LIMIT = 50;

export default function RestaurantMediaFlags() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('open');
  const [restaurantId, setRestaurantId] = useState('');
  const [offset, setOffset] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/restaurant-media/flags', {
      signal,
      timeout: 15000,
      params: {
        status,
        ...(restaurantId ? { restaurantId } : {}),
        limit: PAGE_LIMIT,
        offset,
      },
    });
    return { flags: body?.flags || [], total: body?.total ?? 0 };
  }, [status, restaurantId, offset]);

  const flags = data?.flags || [];
  const total = data?.total ?? 0;
  const applyFilter = (setter) => (event) => {
    setter(event.target.value);
    setOffset(0);
  };

  const runReview = async (flag, action) => {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await adminApi.post(`/admin/restaurant-media/flags/${flag.id}/review`, { action, note: note || undefined });
      setNotice(t('adminRestaurantMediaFlags.reviewDone'));
      setNote('');
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminRestaurantMediaFlags.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async (flag) => {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await adminApi.post(`/admin/restaurant-media/media/${flag.media_id}/restore`, {});
      setNotice(t('adminRestaurantMediaFlags.restoreDone'));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminRestaurantMediaFlags.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminRestaurantMediaFlags.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminRestaurantMediaFlags.subtitle')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={status} onChange={applyFilter(setStatus)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          {['open', 'resolved', 'dismissed'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <input
          value={restaurantId}
          onChange={applyFilter(setRestaurantId)}
          placeholder={t('adminRestaurantMediaFlags.restaurantIdPlaceholder')}
          inputMode="numeric"
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('adminRestaurantMediaFlags.reviewNotePlaceholder')}
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
        <AdminErrorState message={serverErrorMessage(loadError, t('adminRestaurantMediaFlags.loadFailed'))} onRetry={reload} />
      )}
      {!loading && !loadError && flags.length === 0 && (
        <p className="text-gray-500">{t('adminRestaurantMediaFlags.empty')}</p>
      )}
      {!loading && !loadError && flags.length > 0 && (
        <div className="space-y-3">
          {flags.map((flag) => (
            <div key={flag.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">
                  {flag.restaurant_name || t('adminRestaurantMediaFlags.restaurant', { id: flag.restaurant_id })}
                </span>
                <span className="text-xs text-gray-400">{flag.status} · {flag.reason}</span>
              </div>
              <p className="mt-1 text-sm text-gray-400">{flag.caption || flag.video_url || ''}</p>
              <p className="mt-1 text-xs text-gray-500">
                {flag.flagged_by_email ? `${t('adminRestaurantMediaFlags.flaggedBy')} ${flag.flagged_by_email} · ` : ''}
                {adminDateTime(flag.created_at)}
                {flag.decided_by_email ? ` · ${t('adminRestaurantMediaFlags.decidedBy')} ${flag.decided_by_email}` : ''}
                {flag.media_status ? ` · ${t('adminRestaurantMediaFlags.mediaStatus', { status: flag.media_status })}` : ''}
              </p>
              {flag.note && <p className="mt-1 text-sm text-gray-300">{flag.note}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {flag.status === 'open' && (
                  <>
                    <button type="button" disabled={busy} onClick={() => setConfirm({ flag, action: 'dismiss', title: t('adminRestaurantMediaFlags.dismiss') })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                      {t('adminRestaurantMediaFlags.dismiss')}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirm({ flag, action: 'remove', title: t('adminRestaurantMediaFlags.remove') })} className="rounded-lg bg-red-900/60 px-3 py-2 text-sm font-semibold text-red-200">
                      {t('adminRestaurantMediaFlags.remove')}
                    </button>
                  </>
                )}
                {flag.media_status === 'hidden' && (
                  <button type="button" disabled={busy} onClick={() => setConfirm({ flag, action: 'restore', title: t('adminRestaurantMediaFlags.restore') })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                    {t('adminRestaurantMediaFlags.restore')}
                  </button>
                )}
              </div>
              {flag.media_status === 'hidden' && (
                <p className="mt-2 text-xs text-gray-500">{t('adminRestaurantMediaFlags.restoreNote')}</p>
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
          message={t('adminRestaurantMediaFlags.confirmAction')}
          confirmLabel={confirm.title}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const { flag, action } = confirm;
            setConfirm(null);
            if (action === 'restore') await runRestore(flag);
            else await runReview(flag, action);
          }}
        />
      )}
    </div>
  );
}
