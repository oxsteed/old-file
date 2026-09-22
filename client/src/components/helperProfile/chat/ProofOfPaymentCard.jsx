import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Download, Loader2, Receipt } from 'lucide-react';
import api from '../../../api/axios';
import { formatPopAmount, parsePopMarker } from './messengerPop.js';
import './MessengerDock.css';

export default function ProofOfPaymentCard({
  markerText,
  initialPop = null,
  popId: idProp = null,
  isProvider = false,
  guestAuthHeaders = null,
  onStatusChange = null,
  onRefundRequest = null,
  compact = false,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const parsed = useMemo(() => (markerText ? parsePopMarker(markerText) : null), [markerText]);
  const popId = idProp || parsed?.id || initialPop?.id;

  const [pop, setPop] = useState(initialPop);
  const [loading, setLoading] = useState(!initialPop && Boolean(popId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!popId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/chat/pop/${popId}`, { headers: guestAuthHeaders || undefined });
      setPop(data);
    } catch {
      if (parsed) {
        setPop({
          id: parsed.id,
          status: parsed.status,
          amount_cents: parsed.amountCents,
          payment_method: parsed.paymentMethod,
          transaction_id: parsed.transactionId,
          paid_on: parsed.paidOn,
          quote_kind: parsed.quoteKind,
          quote_id: parsed.quoteId,
        });
      } else {
        setError(t('helperProfile.messenger.popLoadError'));
      }
    } finally {
      setLoading(false);
    }
  }, [popId, guestAuthHeaders, parsed, t]);

  useEffect(() => {
    if (!initialPop) load();
  }, [initialPop, load]);

  const status = pop?.status || parsed?.status || 'submitted';
  const amount = pop?.amount_cents ?? parsed?.amountCents ?? 0;

  const confirm = async (action) => {
    if (!popId || !isProvider) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/chat/pop/${popId}/confirm`, {
        action,
        reason: action === 'reject' ? rejectReason || undefined : undefined,
      });
      setPop(data.pop || { ...pop, status: action === 'confirm' ? 'confirmed' : 'rejected' });
      onStatusChange?.(data.pop?.status);
    } catch {
      setError(t('helperProfile.messenger.popConfirmError'));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!popId) return;
    try {
      const { data } = await api.get(`/chat/pop/${popId}/download`, {
        headers: guestAuthHeaders || undefined,
      });
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('helperProfile.messenger.popDownloadError'));
    }
  };

  if (loading) {
    return (
      <div className="messenger-artifact-card pop-card compact">
        <Loader2 className="spin" size={16} /> {t('helperProfile.messenger.popLoading')}
      </div>
    );
  }

  return (
    <div
      className={`messenger-artifact-card pop-card ${compact ? 'compact' : ''}`}
      role="region"
      aria-label={t('helperProfile.messenger.popCardAria')}
    >
      <div className="artifact-card-head">
        <Receipt size={14} aria-hidden />
        <span className="artifact-eyebrow">{t('helperProfile.messenger.popEyebrow')}</span>
        <span className={`artifact-status status-${status}`}>
          {t(`helperProfile.messenger.popStatus.${status}`, { defaultValue: status })}
        </span>
      </div>
      <div className="artifact-card-body">
        <div className="artifact-amount">{formatPopAmount(amount, locale, pop?.currency || 'USD')}</div>
        {pop?.payment_method || parsed?.paymentMethod ? (
          <div className="artifact-meta">
            {t('helperProfile.messenger.popMethod')}: {pop?.payment_method || parsed?.paymentMethod}
          </div>
        ) : null}
        {pop?.transaction_id || parsed?.transactionId ? (
          <div className="artifact-meta">
            {t('helperProfile.messenger.popTxn')}: {pop?.transaction_id || parsed?.transactionId}
          </div>
        ) : null}
        {pop?.paid_on || parsed?.paidOn ? (
          <div className="artifact-meta">
            {t('helperProfile.messenger.popPaidOn')}: {pop?.paid_on || parsed?.paidOn}
          </div>
        ) : null}
        {(pop?.quote_id || parsed?.quoteId) ? (
          <div className="artifact-meta">
            {t('helperProfile.messenger.popLinkedQuote')}: {pop?.quote_kind || parsed?.quoteKind} #
            {pop?.quote_id || parsed?.quoteId}
          </div>
        ) : null}
      </div>
      <div className="artifact-card-actions">
        {pop?.has_attachment ? (
          <button type="button" className="artifact-btn" onClick={download}>
            <Download size={14} aria-hidden /> {t('helperProfile.messenger.popDownload')}
          </button>
        ) : null}
        {isProvider && status === 'submitted' ? (
          <>
            <button type="button" className="artifact-btn primary" disabled={busy} onClick={() => confirm('confirm')}>
              <Check size={14} aria-hidden /> {t('helperProfile.messenger.popConfirm')}
            </button>
            <button type="button" className="artifact-btn danger" disabled={busy} onClick={() => confirm('reject')}>
              <X size={14} aria-hidden /> {t('helperProfile.messenger.popReject')}
            </button>
            <input
              className="artifact-input"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('helperProfile.messenger.popRejectReason')}
            />
          </>
        ) : null}
        {isProvider && onRefundRequest && (status === 'confirmed' || status === 'partially_refunded')
          && String(pop?.payment_method || parsed?.paymentMethod || '').toLowerCase().includes('credit') ? (
          <button
            type="button"
            className="artifact-btn"
            disabled={busy}
            onClick={() =>
              onRefundRequest({
                popId: pop?.id || parsed?.id,
                paymentRequestId: pop?.payment_request_id || null,
                creditTxnId: pop?.credit_txn_id || pop?.transaction_id || parsed?.transactionId || null,
                amountCents: Math.max(
                  0,
                  Number(pop?.amount_cents ?? parsed?.amountCents ?? 0) -
                    Number(pop?.refunded_amount_cents || 0),
                ),
                currency: pop?.currency || 'USD',
              })
            }
          >
            {t('messages.creditRefund.button')}
          </button>
        ) : null}
      </div>
      {error ? <p className="artifact-error">{error}</p> : null}
    </div>
  );
}
