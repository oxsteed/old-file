import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send, Wallet, X } from 'lucide-react';
import api from '../../../api/axios';
import { createMessageRequestId } from '../../../lib/messageRequestId';
import './MessengerDock.css';

export default function PaymentRequestSharePanel({
  open = false,
  onClose,
  conversationId = null,
  guestSessionId = null,
  businessId = null,
  quoteKind = null,
  quoteId = null,
  defaultAmount = '',
  onShared,
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(defaultAmount || '');
  const [memo, setMemo] = useState('');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(null);
  const pendingRequestIdRef = useRef(null);

  useEffect(() => {
    if (!open) pendingRequestIdRef.current = null;
  }, [open]);

  if (!open) return null;

  const share = async () => {
    setSharing(true);
    setError(null);
    try {
      const amountCents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        setError(t('messages.paymentRequestShare.amountRequired'));
        setSharing(false);
        return;
      }
      const clientRequestId = pendingRequestIdRef.current || createMessageRequestId();
      pendingRequestIdRef.current = clientRequestId;
      const { data } = await api.post('/chat/payments/request', {
        conversationId: conversationId || undefined,
        guestSessionId: guestSessionId || undefined,
        businessId: businessId || undefined,
        amountCents,
        currency: 'USD',
        memo: memo || undefined,
        quoteKind: quoteKind || undefined,
        quoteId: quoteId || undefined,
        idempotencyKey: clientRequestId,
      });
      pendingRequestIdRef.current = null;
      onShared?.(data);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || t('messages.paymentRequestShare.failed'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      className="messenger-share-panel"
      role="dialog"
      aria-label={t('messages.paymentRequestShare.title')}
    >
      <div className="messenger-share-panel-head">
        <Wallet size={16} aria-hidden />
        <strong>{t('messages.paymentRequestShare.title')}</strong>
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
        <label>
          {t('messages.paymentRequestShare.amount')}
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          {t('messages.paymentRequestShare.memo')}
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={t('messages.paymentRequestShare.memoPh')}
            maxLength={500}
          />
        </label>
        {error ? <p className="artifact-error">{error}</p> : null}
        <button type="button" className="artifact-btn primary" disabled={sharing} onClick={share}>
          {sharing ? <Loader2 className="spin" size={14} /> : <Send size={14} />}{' '}
          {t('messages.paymentRequestShare.send')}
        </button>
      </div>
    </div>
  );
}
