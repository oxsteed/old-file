import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Wallet } from 'lucide-react';
import api from '../../../api/axios';
import { formatPopAmount } from './messengerPop.js';
import { canPayWithOxsteedCredit, parsePaymentRequestMarker } from './messengerCreditPay.js';
import PayWithCreditModal from './PayWithCreditModal.jsx';
import './MessengerDock.css';

export default function PaymentRequestCard({
  markerText,
  initialRequest = null,
  requestId: idProp = null,
  conversationId = null,
  isProvider = false,
  isAuthenticated = false,
  guestVerified = false,
  payeeBusinessId = null,
  payeeHelperId = null,
  onRequestSignIn,
  onPaid,
  readOnly = false,
  compact = false,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const parsed = useMemo(
    () => (markerText ? parsePaymentRequestMarker(markerText) : null),
    [markerText],
  );
  const requestId = idProp || parsed?.id || initialRequest?.id;

  const [req, setReq] = useState(initialRequest);
  const [loading, setLoading] = useState(!initialRequest && Boolean(requestId));
  const [error, setError] = useState(null);
  const [showPay, setShowPay] = useState(false);

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/chat/payments/request/${requestId}`);
      setReq(data);
    } catch {
      if (parsed) {
        setReq({
          id: parsed.id,
          status: parsed.status,
          amount_cents: parsed.amountCents,
          currency: parsed.currency,
          memo: parsed.memo,
          quote_kind: parsed.quoteKind,
          quote_id: parsed.quoteId,
        });
      } else {
        setError(t('helperProfile.messenger.paymentRequestLoadError'));
      }
    } finally {
      setLoading(false);
    }
  }, [requestId, parsed, t]);

  useEffect(() => {
    if (!initialRequest) load();
  }, [initialRequest, load]);

  const status = req?.status || parsed?.status || 'open';
  const amount = req?.amount_cents ?? parsed?.amountCents ?? 0;
  const currency = req?.currency || parsed?.currency || 'USD';
  const gate = canPayWithOxsteedCredit({ isAuthenticated, guestVerified });

  if (loading) {
    return (
      <div className="messenger-artifact-card payreq-card compact">
        <Loader2 className="spin" size={16} /> {t('helperProfile.messenger.paymentRequestLoading')}
      </div>
    );
  }

  return (
    <>
      <div
        className={`messenger-artifact-card payreq-card ${compact ? 'compact' : ''}`}
        role="region"
        aria-label={t('helperProfile.messenger.paymentRequestCardAria')}
      >
        <div className="artifact-card-head">
          <Wallet size={14} aria-hidden />
          <span className="artifact-eyebrow">{t('helperProfile.messenger.paymentRequestEyebrow')}</span>
          <span className={`artifact-status status-${status}`}>
            {t(`helperProfile.messenger.paymentRequestStatus.${status}`, { defaultValue: status })}
          </span>
        </div>
        <div className="artifact-card-body">
          <div className="artifact-amount">{formatPopAmount(amount, locale, currency)}</div>
          {req?.memo || parsed?.memo ? (
            <div className="artifact-meta">{req?.memo || parsed?.memo}</div>
          ) : null}
          {(req?.quote_id || parsed?.quoteId) ? (
            <div className="artifact-meta">
              {t('helperProfile.messenger.popLinkedQuote')}: {req?.quote_kind || parsed?.quoteKind} #
              {req?.quote_id || parsed?.quoteId}
            </div>
          ) : null}
        </div>
        {!readOnly && !isProvider && status === 'open' ? (
          <div className="artifact-card-actions">
            {gate.ok ? (
              <button type="button" className="artifact-btn primary" onClick={() => setShowPay(true)}>
                <Wallet size={14} aria-hidden /> {t('helperProfile.messenger.creditPayButton')}
              </button>
            ) : (
              <button
                type="button"
                className="artifact-btn primary"
                onClick={() => onRequestSignIn?.()}
              >
                {t('helperProfile.messenger.creditPaySignInCta')}
              </button>
            )}
          </div>
        ) : null}
        {error ? <p className="artifact-error">{error}</p> : null}
      </div>
      <PayWithCreditModal
        open={showPay && !readOnly}
        onClose={() => setShowPay(false)}
        conversationId={conversationId || req?.conversation_id}
        amountCents={amount}
        currency={currency}
        quoteKind={req?.quote_kind || parsed?.quoteKind || null}
        quoteId={req?.quote_id || parsed?.quoteId || null}
        paymentRequestId={requestId}
        payeeBusinessId={payeeBusinessId || req?.business_id}
        payeeHelperId={payeeHelperId || req?.helper_id}
        memo={req?.memo || parsed?.memo}
        isAuthenticated={isAuthenticated}
        onRequestSignIn={onRequestSignIn}
        onPaid={(data) => {
          setReq((r) => (r ? { ...r, status: 'paid' } : r));
          onPaid?.(data);
        }}
      />
    </>
  );
}
