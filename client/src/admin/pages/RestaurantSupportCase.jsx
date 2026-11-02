import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import { serverErrorMessage } from '../lib/RsdPager';
import { adminDateTime } from '../lib/formatters';
import { createMessageRequestId } from '../../lib/messageRequestId';

// Admin restaurant support case detail (findings 7, 19): the admin surface
// calls the admin endpoints, never the customer endpoints, and includes the
// admin reply control (sender type oxsteed) plus assign, escalate,
// deescalate, approve-resolution, close, and reopen.
export default function RestaurantSupportCase() {
  const { t } = useTranslation();
  const { caseId } = useParams();
  const [reply, setReply] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [approveResolution, setApproveResolution] = useState('');
  const [approveAmount, setApproveAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get(`/admin/restaurants/support/cases/${caseId}`, { signal, timeout: 15000 });
    return body;
  }, [caseId]);

  const supportCase = data?.case || null;
  const messages = data?.messages || [];
  const events = data?.events || [];

  const runAction = async (path, body, successKey) => {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await adminApi.post(`/admin/restaurants/support/cases/${caseId}${path}`, body);
      setNotice(t(successKey));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminRestaurantSupportCase.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    setActionError('');
    try {
      await adminApi.post(`/admin/restaurants/support/cases/${caseId}/messages`, {
        message: reply.trim(),
        clientMessageId: createMessageRequestId(),
      });
      setReply('');
      setNotice(t('adminRestaurantSupportCase.replySent'));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminRestaurantSupportCase.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <Link to="/admin/restaurants/support" className="text-sm text-orange-400 hover:underline">
        {t('adminRestaurantSupportCase.backToQueue')}
      </Link>
      {loading && <p className="mt-4 text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <div className="mt-4">
          <AdminErrorState message={serverErrorMessage(loadError, t('adminRestaurantSupportCase.loadFailed'))} onRetry={reload} />
        </div>
      )}
      {!loading && !loadError && !supportCase && (
        <p className="mt-4 text-gray-500">{t('adminRestaurantSupportCase.empty')}</p>
      )}
      {!loading && !loadError && supportCase && (
        <div className="mt-4 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">
              {supportCase.public_case_number || `#${supportCase.id}`} · {supportCase.title || supportCase.issue_type}
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              {supportCase.status} · {supportCase.owner_type} · {t('adminRestaurantSupportCase.restaurant', { id: supportCase.restaurant_id })}
              {supportCase.order_id ? ` · ${t('adminRestaurantSupportCase.order', { id: supportCase.order_id })}` : ''}
            </p>
            <p className="mt-2 text-sm text-gray-300">{supportCase.description}</p>
            {supportCase.final_resolution && (
              <p className="mt-2 text-sm text-amber-300">
                {t('adminRestaurantSupportCase.offeredResolution', { resolution: supportCase.final_resolution, amount: supportCase.resolution_amount_cents ?? '' })}
              </p>
            )}
          </div>

          {actionError && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
          )}
          {notice && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
          )}

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 font-semibold text-white">{t('adminRestaurantSupportCase.replyTitle')}</h2>
            <p className="mb-2 text-xs text-gray-400">{t('adminRestaurantSupportCase.replyNote')}</p>
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              rows={4}
              className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              disabled={busy || !reply.trim()}
              onClick={sendReply}
              className="mt-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t('adminRestaurantSupportCase.sendReply')}
            </button>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 font-semibold text-white">{t('adminRestaurantSupportCase.actionsTitle')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={assignTo}
                onChange={(event) => setAssignTo(event.target.value)}
                placeholder={t('adminRestaurantSupportCase.assignPlaceholder')}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
              />
              <button type="button" disabled={busy} onClick={() => runAction('/assign', { assignedToUserId: assignTo || null }, 'adminRestaurantSupportCase.assigned')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {t('adminRestaurantSupportCase.assign')}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm({ action: 'escalate', title: t('adminRestaurantSupportCase.escalate'), body: { ownerType: 'oxsteed' } })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {t('adminRestaurantSupportCase.escalate')}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm({ action: 'deescalate', title: t('adminRestaurantSupportCase.deescalate'), body: {} })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {t('adminRestaurantSupportCase.deescalate')}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm({ action: 'close', title: t('adminRestaurantSupportCase.close'), body: {} })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {t('adminRestaurantSupportCase.close')}
              </button>
              <button type="button" disabled={busy} onClick={() => runAction('/reopen', {}, 'adminRestaurantSupportCase.reopened')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {t('adminRestaurantSupportCase.reopen')}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={approveResolution} onChange={(event) => setApproveResolution(event.target.value)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
                <option value="">{t('adminRestaurantSupportCase.approvePlaceholder')}</option>
                {['refund', 'partial_refund', 'store_credit', 'apology_only', 'replacement'].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
              <input
                value={approveAmount}
                onChange={(event) => setApproveAmount(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder={t('adminRestaurantSupportCase.amountPlaceholder')}
                inputMode="numeric"
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                disabled={busy || !approveResolution}
                onClick={() => setConfirm({ action: 'approve', title: t('adminRestaurantSupportCase.approve'), body: { resolution: approveResolution, amountCents: approveAmount ? Number(approveAmount) : null } })}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200"
              >
                {t('adminRestaurantSupportCase.approve')}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">{t('adminRestaurantSupportCase.approveNote')}</p>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 font-semibold text-white">{t('adminRestaurantSupportCase.messagesTitle')}</h2>
            {messages.length === 0 && <p className="text-sm text-gray-500">{t('adminRestaurantSupportCase.noMessages')}</p>}
            <div className="space-y-3">
              {messages.map((message) => (
                <div key={message.id} className="rounded-lg bg-slate-800 p-3">
                  <p className="text-xs text-gray-400">
                    {message.sender_type} · {adminDateTime(message.created_at)}
                    {message.internal_note ? ` · ${t('adminRestaurantSupportCase.internalNote')}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-gray-200">{message.message}</p>
                </div>
              ))}
            </div>
          </section>

          {events.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 font-semibold text-white">{t('adminRestaurantSupportCase.eventsTitle')}</h2>
              <div className="space-y-2">
                {events.map((event) => (
                  <p key={event.id} className="text-xs text-gray-400">
                    {adminDateTime(event.created_at)} · {event.actor_type} · {event.event_type}
                  </p>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={t('adminRestaurantSupportCase.confirmAction')}
          confirmLabel={confirm.title}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            const path = confirm.action === 'approve' ? '/approve-resolution' : `/${confirm.action}`;
            await runAction(path, confirm.body, 'adminRestaurantSupportCase.actionDone');
          }}
        />
      )}
    </div>
  );
}
