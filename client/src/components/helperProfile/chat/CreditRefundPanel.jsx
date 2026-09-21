import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../../api/axios';

function makeIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `refund-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CreditRefundPanel({
  open,
  onClose,
  conversationId,
  paymentRequestId = null,
  popId = null,
  creditTxnId = null,
  maxAmountCents = null,
  currency = 'USD',
  onRefunded,
}) {
  const { t } = useTranslation();
  const maxDollars = maxAmountCents != null ? (Number(maxAmountCents) / 100).toFixed(2) : '';
  const [amount, setAmount] = useState(maxDollars);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) {
      toast.error(t('messages.creditRefund.reasonRequired'));
      return;
    }
    const dollars = Number(amount);
    const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
    if (amountCents == null || amountCents <= 0) {
      toast.error(t('messages.creditRefund.amountRequired'));
      return;
    }
    if (maxAmountCents != null && amountCents > Number(maxAmountCents)) {
      toast.error(t('messages.creditRefund.amountTooHigh'));
      return;
    }
    setBusy(true);
    try {
      const id = paymentRequestId || 'by-pop';
      await api.post(`/chat/payments/${id}/refund`, {
        conversationId,
        paymentRequestId,
        popId,
        creditTxnId,
        amountCents,
        reason: reason.trim(),
        idempotencyKey: makeIdempotencyKey(),
      });
      toast.success(t('messages.creditRefund.success'));
      onRefunded?.();
      onClose?.();
    } catch (err) {
      const code = err?.response?.data?.code;
      const msg =
        code === 'already_refunded'
          ? t('messages.creditRefund.alreadyRefunded')
          : err?.response?.data?.error || t('messages.creditRefund.failed');
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="messenger-share-panel credit-refund-panel" role="dialog" aria-label={t('messages.creditRefund.title')}>
      <header>
        <h3>{t('messages.creditRefund.title')}</h3>
        <button type="button" onClick={onClose}>{t('common.close')}</button>
      </header>
      <form onSubmit={submit}>
        <label>
          {t('messages.creditRefund.amount')} ({currency})
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          {t('messages.creditRefund.reason')}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            disabled={busy}
            required
          />
        </label>
        <div className="messenger-share-actions">
          <button type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" disabled={busy}>
            {busy ? t('common.saving') : t('messages.creditRefund.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
