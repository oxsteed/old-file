import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ScrollText, Send, X } from 'lucide-react';
import api from '../../../api/axios';
import { createMessageRequestId } from '../../../lib/messageRequestId';
import './MessengerDock.css';

export default function AgreementSharePanel({
  open = false,
  onClose,
  conversationId = null,
  guestSessionId = null,
  businessId = null,
  onShared,
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requiredBeforeSchedule, setRequiredBeforeSchedule] = useState(false);
  const [file, setFile] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(null);
  const pendingRequestIdRef = useRef(null);

  if (!open) return null;

  const share = async () => {
    if (!title.trim()) {
      setError(t('messages.agreementShare.titleRequired'));
      return;
    }
    setSharing(true);
    setError(null);
    try {
      const clientRequestId = pendingRequestIdRef.current || createMessageRequestId();
      pendingRequestIdRef.current = clientRequestId;
      const fd = new FormData();
      if (conversationId) fd.append('conversationId', conversationId);
      if (guestSessionId) fd.append('guestSessionId', guestSessionId);
      if (businessId) fd.append('businessId', businessId);
      fd.append('title', title.trim());
      if (body.trim()) fd.append('body_text', body.trim());
      fd.append('required_before_schedule', requiredBeforeSchedule ? 'true' : 'false');
      if (file) fd.append('file', file);
      const { data } = await api.post('/chat/agreements/share', fd, {
        headers: { 'Idempotency-Key': clientRequestId },
      });
      onShared?.(data);
      pendingRequestIdRef.current = null;
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || t('messages.agreementShare.failed'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="messenger-share-panel" role="dialog" aria-label={t('messages.agreementShare.title')}>
      <div className="messenger-share-panel-head">
        <ScrollText size={16} aria-hidden />
        <strong>{t('messages.agreementShare.title')}</strong>
        <button type="button" className="messenger-share-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="messenger-share-panel-body">
        <label>
          {t('messages.agreementShare.titleLabel')}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('messages.agreementShare.titlePh')} />
        </label>
        <label>
          {t('messages.agreementShare.terms')}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder={t('messages.agreementShare.termsPh')} />
        </label>
        <label className="artifact-check">
          <input
            type="checkbox"
            checked={requiredBeforeSchedule}
            onChange={(e) => setRequiredBeforeSchedule(e.target.checked)}
          />
          {t('messages.agreementShare.requiredBeforeSchedule')}
        </label>
        <label>
          {t('messages.agreementShare.file')}
          <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {error ? <p className="artifact-error">{error}</p> : null}
      </div>
      <div className="messenger-share-panel-foot">
        <button type="button" className="artifact-btn primary" disabled={sharing} onClick={share}>
          {sharing ? <Loader2 className="spin" size={14} /> : <Send size={14} />} {t('messages.agreementShare.send')}
        </button>
      </div>
    </div>
  );
}
