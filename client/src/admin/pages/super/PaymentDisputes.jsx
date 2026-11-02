import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';
import { adminDateTime, adminMoney } from '../../lib/formatters';

// Payment-dispute queue (main-app refund/payment disputes). This is NOT the
// service-disputes page: that page calls /disputes/admin/all, while this one
// calls /admin/payment-disputes (requireAdmin + manage_disputes) and posts
// decisions to /admin/payment-disputes/:id/decision. The transition map below
// mirrors the server controller exactly; the server still enforces it and
// returns 409 for any move it does not allow.
const STATUSES = ['all', 'open', 'under_review', 'approved', 'denied', 'resolved', 'withdrawn'];
const PAGE_SIZE = 50;
const TRANSITIONS = {
  open: ['under_review', 'approved', 'denied', 'resolved'],
  under_review: ['approved', 'denied', 'resolved'],
  approved: ['resolved'],
};

function serverErrorMessage(err, fallback) {
  const serverError = err?.response?.data?.error;
  if (typeof serverError === 'string' && serverError) return serverError;
  if (serverError?.message) return serverError.message;
  return err?.message || fallback;
}

export default function PaymentDisputes() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('open');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [decisionStatus, setDecisionStatus] = useState('');
  const [note, setNote] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [noRefundReason, setNoRefundReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/payment-disputes', {
      signal,
      params: { ...(status !== 'all' ? { status } : {}), limit: PAGE_SIZE, offset },
    });
    return { disputes: body?.disputes || [] };
  }, [status, offset]);

  const disputes = data?.disputes || [];
  const hasMore = disputes.length === PAGE_SIZE;

  useEffect(() => { setOffset(0); }, [status]);

  const startDecide = (dispute) => {
    const allowed = TRANSITIONS[dispute.status] || [];
    setSelected(dispute);
    setDecisionStatus(allowed[0] || '');
    setNote('');
    setRefundReference('');
    setNoRefundReason('');
    setNotice('');
    setActionError('');
  };

  const submitDecision = async () => {
    if (!selected || !decisionStatus || !note.trim()) {
      setActionError(t('adminMoneyDisputes.noteRequired'));
      return;
    }
    setBusyId(selected.id);
    setNotice('');
    setActionError('');
    try {
      await adminApi.post(`/admin/payment-disputes/${selected.id}/decision`, {
        status: decisionStatus,
        note: note.trim(),
        ...(refundReference.trim() ? { refundReference: refundReference.trim() } : {}),
        ...(noRefundReason.trim() ? { noRefundReason: noRefundReason.trim() } : {}),
      });
      setConfirmOpen(false);
      setSelected(null);
      setNotice(t('adminMoneyDisputes.decidedNotice', { id: selected.id }));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminMoneyDisputes.decideFailed')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-white text-xl font-bold mb-1">
        {t('adminMoneyDisputes.title')}
      </h1>
      <p className="text-gray-400 text-sm mb-4">
        {t('adminMoneyDisputes.subtitle')}
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { setStatus(key); setSelected(null); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${status === key ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
          >
            {t(`adminMoneyDisputes.status.${key}`)}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={serverErrorMessage(loadError, t('adminMoneyDisputes.loadFailed'))} onRetry={reload} />
      )}
      {actionError && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {notice}
        </div>
      )}
      {!loading && !loadError && disputes.length === 0 && (
        <p className="text-gray-500">{t('adminMoneyDisputes.empty')}</p>
      )}

      {!loading && !loadError && disputes.length > 0 && (
        <div className="space-y-3">
          {disputes.map((dispute) => {
            const allowed = TRANSITIONS[dispute.status] || [];
            const decisions = Array.isArray(dispute.metadata?.decisions) ? dispute.metadata.decisions : [];
            const lastDecision = decisions[decisions.length - 1];
            const isSelected = selected?.id === dispute.id;
            return (
              <div key={dispute.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-white font-semibold">
                      {t('adminMoneyDisputes.dispute', { id: dispute.id })}
                      {' · '}
                      {t(`adminMoneyDisputes.status.${dispute.status}`)}
                    </p>
                    <p className="text-gray-400 text-sm mt-1">
                      {dispute.user_name || dispute.user_email || t('adminMoneyDisputes.unknownFiler')}
                      {dispute.user_email && dispute.user_name ? ` (${dispute.user_email})` : ''}
                      {' · '}
                      {dispute.source_type}
                      {dispute.source_id ? ` ${dispute.source_id}` : ''}
                      {dispute.transaction_reference ? ` · ${dispute.transaction_reference}` : ''}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {t('adminMoneyDisputes.reason', { reason: dispute.reason })}
                      {' · '}
                      {t('adminMoneyDisputes.requested', {
                        amount: adminMoney(Number(dispute.requested_refund_cents || 0) / 100, dispute.currency_code || 'USD'),
                      })}
                      {' · '}
                      {t('adminMoneyDisputes.opened', { date: adminDateTime(dispute.opened_at) })}
                      {dispute.support_ticket_number ? ` · ${t('adminMoneyDisputes.ticket', { ticket: dispute.support_ticket_number })}` : ''}
                    </p>
                    {dispute.details && (
                      <p className="text-gray-300 text-sm mt-2">{dispute.details}</p>
                    )}
                    {lastDecision && (
                      <p className="text-gray-400 text-sm mt-1">
                        {t('adminMoneyDisputes.lastDecision', { note: lastDecision.note || '' })}
                        {lastDecision.noRefundReason ? ` · ${t('adminMoneyDisputes.noRefundReasonShown', { reason: lastDecision.noRefundReason })}` : ''}
                        {lastDecision.refundReference ? ` · ${t('adminMoneyDisputes.refundReferenceShown', { reference: lastDecision.refundReference })}` : ''}
                      </p>
                    )}
                  </div>
                  {allowed.length > 0 && (
                    <button
                      type="button"
                      onClick={() => (isSelected ? setSelected(null) : startDecide(dispute))}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 text-white shrink-0"
                    >
                      {isSelected ? t('adminMoneyDisputes.cancelDecision') : t('adminMoneyDisputes.decide')}
                    </button>
                  )}
                </div>

                {isSelected && (
                  <div className="mt-4 border-t border-slate-700 pt-4 space-y-3">
                    <h2 className="text-white font-semibold text-sm">{t('adminMoneyDisputes.decideTitle')}</h2>
                    <label className="block text-sm text-gray-300">
                      {t('adminMoneyDisputes.statusLabel')}
                      <select
                        value={decisionStatus}
                        onChange={(event) => setDecisionStatus(event.target.value)}
                        className="mt-1 block w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white"
                      >
                        {allowed.map((next) => (
                          <option key={next} value={next}>{t(`adminMoneyDisputes.status.${next}`)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-gray-300">
                      {t('adminMoneyDisputes.noteLabel')}
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={t('adminMoneyDisputes.notePlaceholder')}
                        rows={3}
                        className="mt-1 block w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="block text-sm text-gray-300">
                      {t('adminMoneyDisputes.refundReferenceLabel')}
                      <input
                        type="text"
                        value={refundReference}
                        onChange={(event) => setRefundReference(event.target.value)}
                        placeholder={t('adminMoneyDisputes.refundReferencePlaceholder')}
                        className="mt-1 block w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white"
                      />
                    </label>
                    <label className="block text-sm text-gray-300">
                      {t('adminMoneyDisputes.noRefundReasonLabel')}
                      <input
                        type="text"
                        value={noRefundReason}
                        onChange={(event) => setNoRefundReason(event.target.value)}
                        placeholder={t('adminMoneyDisputes.noRefundReasonPlaceholder')}
                        className="mt-1 block w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-white"
                      />
                    </label>
                    {(decisionStatus === 'approved' || decisionStatus === 'resolved') && !refundReference.trim() && !noRefundReason.trim() && (
                      <p className="text-sm text-amber-300">{t('adminMoneyDisputes.closureNeedsRefundOrReason')}</p>
                    )}
                    <button
                      type="button"
                      disabled={!decisionStatus || !note.trim() || busyId === dispute.id}
                      onClick={() => setConfirmOpen(true)}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 text-white disabled:opacity-50"
                    >
                      {busyId === dispute.id ? t('adminMoneyDisputes.deciding') : t('adminMoneyDisputes.reviewDecision')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !loadError && disputes.length > 0 && (
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-800 text-gray-300 disabled:opacity-50"
          >
            {t('adminMoneyDisputes.prev')}
          </button>
          <span className="text-gray-400 text-sm">{t('adminMoneyDisputes.pageInfo', { count: disputes.length })}</span>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!hasMore}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-800 text-gray-300 disabled:opacity-50"
          >
            {t('adminMoneyDisputes.next')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen && !!selected}
        title={t('adminMoneyDisputes.decideConfirmTitle')}
        message={selected ? t('adminMoneyDisputes.decideConfirmBody', {
          id: selected.id,
          status: decisionStatus ? t(`adminMoneyDisputes.status.${decisionStatus}`) : '',
        }) : ''}
        confirmLabel={t('adminMoneyDisputes.decide')}
        onConfirm={submitDecision}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
