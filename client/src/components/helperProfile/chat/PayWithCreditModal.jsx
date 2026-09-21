import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Wallet, X } from 'lucide-react';
import api from '../../../api/axios';
import {
  CREDIT_PAY_METHOD,
  canPayWithOxsteedCredit,
  formatCreditBalanceHint,
  makeCreditPayIdempotencyKey,
  validateCreditPayAmount,
} from './messengerCreditPay.js';
import './MessengerDock.css';

/**
 * Confirm modal: pay amount with OxSteed Credit from live chat.
 */
export default function PayWithCreditModal({
  open = false,
  onClose,
  conversationId,
  amountCents,
  currency = 'USD',
  quoteKind = null,
  quoteId = null,
  paymentRequestId = null,
  payeeBusinessId = null,
  payeeHelperId = null,
  memo = null,
  isAuthenticated = false,
  onRequestSignIn,
  onPaid,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [hint, setHint] = useState(null);
  const [loadingHint, setLoadingHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !isAuthenticated || !conversationId) return undefined;
    let cancelled = false;
    setLoadingHint(true);
    api
      .get('/chat/payments/credit-hint', { params: { conversationId, businessId: payeeBusinessId || undefined } })
      .then(({ data }) => {
        if (!cancelled) setHint(data);
      })
      .catch(() => {
        if (!cancelled) setHint(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingHint(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isAuthenticated, conversationId, payeeBusinessId]);

  if (!open) return null;

  const gate = canPayWithOxsteedCredit({ isAuthenticated });
  const amountCheck = validateCreditPayAmount(amountCents);
  const balanceLabel = formatCreditBalanceHint(
    hint?.balanceCents,
    locale,
    hint?.currency || currency,
  );

  const pay = async () => {
    if (!gate.ok) {
      onRequestSignIn?.();
      return;
    }
    if (!amountCheck.ok) {
      setError(t('helperProfile.messenger.creditPayInvalidAmount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = makeCreditPayIdempotencyKey({
        conversationId,
        quoteId,
        paymentRequestId,
        amountCents: amountCheck.amountCents,
      });
      const { data } = await api.post('/chat/payments/oxsteed-credit', {
        conversationId,
        amountCents: amountCheck.amountCents,
        currency,
        quoteKind: quoteKind || undefined,
        quoteId: quoteId || undefined,
        paymentRequestId: paymentRequestId || undefined,
        payeeBusinessId: payeeBusinessId || undefined,
        payeeHelperId: payeeHelperId || undefined,
        memo: memo || undefined,
        idempotencyKey,
      });
      onPaid?.(data);
      onClose?.();
    } catch (err) {
      const code = err?.response?.data?.code;
      const msg = err?.response?.data?.error;
      if (code === 'auth_required_for_credit' || code === 'auth_required') {
        onRequestSignIn?.();
        setError(t('helperProfile.messenger.creditPaySignIn'));
      } else if (code === 'credit_provider_not_eligible') {
        setError(msg || t('helperProfile.messenger.creditPayProviderIneligible'));
      } else {
        setError(msg || t('helperProfile.messenger.creditPayFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="messenger-share-panel" role="dialog" aria-label={t('helperProfile.messenger.creditPayTitle')}>
      <div className="messenger-share-panel-head">
        <Wallet size={16} aria-hidden />
        <strong>{t('helperProfile.messenger.creditPayTitle')}</strong>
        <button
          type="button"
          className="messenger-share-close"
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Close' })}
        >
          <X size={16} />
        </button>
      </div>
      <div className="messenger-share-panel-body">
        <p className="artifact-amount">
          {formatCreditBalanceHint(amountCents, locale, currency) || `$${((amountCents || 0) / 100).toFixed(2)}`}
        </p>
        {loadingHint ? (
          <p className="artifact-meta">
            <Loader2 className="spin" size={14} /> {t('helperProfile.messenger.creditPayLoadingBalance')}
          </p>
        ) : balanceLabel ? (
          <p className="artifact-meta">
            {t('helperProfile.messenger.creditPayBalanceHint', { balance: balanceLabel })}
          </p>
        ) : null}
        {hint && hint.partnerEligible === false ? (
          <p className="artifact-error" role="alert">
            {hint.partnerError || t('helperProfile.messenger.creditPayProviderIneligible')}
          </p>
        ) : null}
        {!gate.ok ? (
          <p className="artifact-meta">{t('helperProfile.messenger.creditPaySignIn')}</p>
        ) : null}
        {error ? (
          <p className="artifact-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="artifact-card-actions" style={{ marginTop: 12 }}>
          {!gate.ok ? (
            <button type="button" className="artifact-btn primary" onClick={() => onRequestSignIn?.()}>
              {t('helperProfile.messenger.creditPaySignInCta')}
            </button>
          ) : (
            <button
              type="button"
              className="artifact-btn primary"
              disabled={busy || hint?.partnerEligible === false || !amountCheck.ok}
              onClick={pay}
            >
              {busy ? <Loader2 className="spin" size={14} /> : <Wallet size={14} />}{' '}
              {t('helperProfile.messenger.creditPayConfirm', { method: CREDIT_PAY_METHOD })}
            </button>
          )}
          <button type="button" className="artifact-btn" onClick={onClose} disabled={busy}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
        </div>
      </div>
    </div>
  );
}
