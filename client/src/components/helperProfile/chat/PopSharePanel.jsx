import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Receipt, Send, X } from 'lucide-react';
import api from '../../../api/axios';
import './MessengerDock.css';

export default function PopSharePanel({
  open = false,
  onClose,
  conversationId = null,
  guestSessionId = null,
  businessId = null,
  quoteKind = null,
  quoteId = null,
  guestAuthHeaders = null,
  onShared,
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [txn, setTxn] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const share = async () => {
    setSharing(true);
    setError(null);
    try {
      const fd = new FormData();
      if (conversationId) fd.append('conversationId', conversationId);
      if (guestSessionId) fd.append('guestSessionId', guestSessionId);
      if (businessId) fd.append('businessId', businessId);
      if (amount) fd.append('amount', amount);
      if (method) fd.append('payment_method', method);
      if (txn) fd.append('transaction_id', txn);
      if (paidOn) fd.append('paid_on', paidOn);
      if (notes) fd.append('notes', notes);
      if (quoteKind) fd.append('quote_kind', quoteKind);
      if (quoteId) fd.append('quote_id', quoteId);
      if (file) fd.append('file', file);
      const { data } = await api.post('/chat/pop/share', fd, {
        headers: guestAuthHeaders || undefined,
      });
      onShared?.(data);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || t('messages.popShare.failed'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="messenger-share-panel" role="dialog" aria-label={t('messages.popShare.title')}>
      <div className="messenger-share-panel-head">
        <Receipt size={16} aria-hidden />
        <strong>{t('messages.popShare.title')}</strong>
        <button type="button" className="messenger-share-close" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}>
          <X size={16} />
        </button>
      </div>
      <div className="messenger-share-panel-body">
        <label>
          {t('messages.popShare.amount')}
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          {t('messages.popShare.method')}
          <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t('messages.popShare.methodPh')} />
        </label>
        <label>
          {t('messages.popShare.txn')}
          <input value={txn} onChange={(e) => setTxn(e.target.value)} />
        </label>
        <label>
          {t('messages.popShare.paidOn')}
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label>
          {t('messages.popShare.notes')}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <label>
          {t('messages.popShare.file')}
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {error ? <p className="artifact-error">{error}</p> : null}
      </div>
      <div className="messenger-share-panel-foot">
        <button type="button" className="artifact-btn primary" disabled={sharing} onClick={share}>
          {sharing ? <Loader2 className="spin" size={14} /> : <Send size={14} />} {t('messages.popShare.send')}
        </button>
      </div>
    </div>
  );
}
