import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import RsdPager, { serverErrorMessage } from '../lib/RsdPager';
import { adminDateTime } from '../lib/formatters';

// Webhook receipt recovery (finding 24): filters, total, pager. Stripe rows
// can be replayed; Didit rows carry an explicit cannot-replay state and can
// only be resolved. Resolve requires a note and moves the receipt to a
// distinct 'resolved' status: it never claims the event was processed.
const PAGE_LIMIT = 50;

export default function WebhookReceipts() {
  const { t } = useTranslation();
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const [account, setAccount] = useState('');
  const [restaurantId, setRestaurantId] = useState('');
  const [offset, setOffset] = useState(0);
  const [resolveNote, setResolveNote] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/super/webhook-receipts', {
      signal,
      timeout: 15000,
      params: {
        ...(provider ? { provider } : {}),
        ...(status ? { status } : {}),
        ...(eventType ? { eventType } : {}),
        ...(account ? { account } : {}),
        ...(restaurantId ? { restaurantId } : {}),
        limit: PAGE_LIMIT,
        offset,
      },
    });
    return { receipts: body?.receipts || [], total: body?.total ?? 0 };
  }, [provider, status, eventType, account, restaurantId, offset]);

  const receipts = data?.receipts || [];
  const total = data?.total ?? 0;
  const applyFilter = (setter) => (event) => {
    setter(event.target.value);
    setOffset(0);
  };

  const replay = async (receipt) => {
    setBusyId(receipt.id);
    setActionError('');
    setNotice('');
    try {
      const { data: body } = await adminApi.post(`/admin/super/webhook-receipts/${receipt.id}/replay`, {});
      if (body?.ok) setNotice(t('adminWebhookReceipts.replayDone'));
      else setActionError(body?.code || t('adminWebhookReceipts.actionFailed'));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminWebhookReceipts.actionFailed')));
    } finally {
      setBusyId(null);
    }
  };

  const resolve = async (receipt) => {
    if (!resolveNote.trim()) {
      setActionError(t('adminWebhookReceipts.noteRequired'));
      return;
    }
    setBusyId(receipt.id);
    setActionError('');
    setNotice('');
    try {
      const { data: body } = await adminApi.post(`/admin/super/webhook-receipts/${receipt.id}/resolve`, { note: resolveNote.trim() });
      if (body?.ok) {
        setNotice(t('adminWebhookReceipts.resolveDone'));
        setResolveNote('');
      } else {
        setActionError(body?.code || t('adminWebhookReceipts.actionFailed'));
      }
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminWebhookReceipts.actionFailed')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminWebhookReceipts.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminWebhookReceipts.subtitle')}</p>
      <p className="mb-4 text-sm text-amber-300">{t('adminWebhookReceipts.resolveWarning')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={provider} onChange={applyFilter(setProvider)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminWebhookReceipts.allProviders')}</option>
          <option value="stripe">stripe</option>
          <option value="didit">didit</option>
        </select>
        <select value={status} onChange={applyFilter(setStatus)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminWebhookReceipts.allStatuses')}</option>
          {['failed', 'processing', 'resolved'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <input value={eventType} onChange={applyFilter(setEventType)} placeholder={t('adminWebhookReceipts.eventTypePlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input value={account} onChange={applyFilter(setAccount)} placeholder={t('adminWebhookReceipts.accountPlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input value={restaurantId} onChange={applyFilter(setRestaurantId)} placeholder={t('adminWebhookReceipts.restaurantIdPlaceholder')} inputMode="numeric" className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
      </div>

      {actionError && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
      )}
      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={serverErrorMessage(loadError, t('adminWebhookReceipts.loadFailed'))} onRetry={reload} />
      )}
      {!loading && !loadError && receipts.length === 0 && (
        <p className="text-gray-500">{t('adminWebhookReceipts.empty')}</p>
      )}
      {!loading && !loadError && receipts.length > 0 && (
        <div className="space-y-3">
          {receipts.map((receipt) => (
            <div key={receipt.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{receipt.event_type}</span>
                <span className="text-xs text-gray-400">{receipt.provider} · {receipt.status}</span>
              </div>
              <p className="mt-1 text-sm text-gray-400">
                {receipt.event_id}
                {receipt.account_id ? ` · ${t('adminWebhookReceipts.account', { id: receipt.account_id })}` : ''}
                {` · ${t('adminWebhookReceipts.attempts', { count: receipt.attempts })}`}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {adminDateTime(receipt.last_seen_at)}
                {receipt.last_error ? ` · ${receipt.last_error}` : ''}
              </p>
              {receipt.resolution_note && (
                <p className="mt-1 text-sm text-gray-300">{t('adminWebhookReceipts.resolutionNote', { note: receipt.resolution_note })}</p>
              )}
              {receipt.status !== 'resolved' && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {receipt.canReplay ? (
                    <button type="button" disabled={busyId === receipt.id} onClick={() => setConfirm({ receipt, action: 'replay', title: t('adminWebhookReceipts.replay') })} className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {t('adminWebhookReceipts.replay')}
                    </button>
                  ) : (
                    <span className="text-xs text-amber-300">{t('adminWebhookReceipts.cannotReplay')}</span>
                  )}
                  <input
                    value={resolveNote}
                    onChange={(event) => setResolveNote(event.target.value)}
                    placeholder={t('adminWebhookReceipts.resolveNotePlaceholder')}
                    className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
                  />
                  <button type="button" disabled={busyId === receipt.id} onClick={() => setConfirm({ receipt, action: 'resolve', title: t('adminWebhookReceipts.resolve') })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200 disabled:opacity-50">
                    {t('adminWebhookReceipts.resolve')}
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
          message={confirm.action === 'resolve' ? t('adminWebhookReceipts.confirmResolve') : t('adminWebhookReceipts.confirmReplay')}
          confirmLabel={confirm.title}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const { receipt, action } = confirm;
            setConfirm(null);
            if (action === 'replay') await replay(receipt);
            else await resolve(receipt);
          }}
        />
      )}
    </div>
  );
}
