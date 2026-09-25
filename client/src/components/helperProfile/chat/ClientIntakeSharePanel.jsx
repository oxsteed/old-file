import React, { useState } from 'react';
import { ClipboardList, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';

const blank = () => ({ id: `field_${Date.now()}_${Math.random().toString(16).slice(2)}`, label: '', type: 'text', required: true, options: [] });

export default function ClientIntakeSharePanel({ open = false, onClose, guestSessionId, onShared }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;
  const updateField = (index, patch) => setFields((prev) => prev.map((field, i) => i === index ? { ...field, ...patch } : field));
  const share = async (event) => {
    event.preventDefault();
    if (!guestSessionId || busy) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/chat/intakes', { guestSessionId, title, description, fields });
      onShared?.(data);
      onClose?.();
    } catch (err) { setError(err?.response?.data?.error || t('messages.clientIntake.failed')); }
    finally { setBusy(false); }
  };
  return (
    <div className="quote-share-panel" role="dialog" aria-modal="true" aria-label={t('messages.clientIntake.shareTitle')}>
      <header className="quote-share-panel__head">
        <h3><ClipboardList className="h-4 w-4" aria-hidden="true" />{t('messages.clientIntake.shareTitle')}</h3>
        <button type="button" className="quote-share-panel__close" onClick={onClose} aria-label={t('common.close')}><X className="h-4 w-4" /></button>
      </header>
      <form className="quote-share-panel__body space-y-3" onSubmit={share}>
        <label><span>{t('messages.clientIntake.titleLabel')}</span><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={t('messages.clientIntake.titlePlaceholder')} /></label>
        <label><span>{t('messages.clientIntake.descriptionLabel')}</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('messages.clientIntake.descriptionPlaceholder')} /></label>
        {fields.map((field, index) => (
          <div key={field.id} className="quote-share-panel__line">
            <input value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} required placeholder={t('messages.clientIntake.questionPlaceholder')} />
            <select value={field.type} onChange={(e) => updateField(index, { type: e.target.value })}>
              <option value="text">{t('messages.clientIntake.text')}</option><option value="textarea">{t('messages.clientIntake.longText')}</option><option value="number">{t('messages.clientIntake.number')}</option><option value="date">{t('messages.clientIntake.date')}</option>
            </select>
          </div>
        ))}
        <button type="button" className="quote-share-panel__link" onClick={() => setFields((prev) => [...prev, blank()])}><Plus className="h-4 w-4" />{t('messages.clientIntake.addQuestion')}</button>
        {error ? <p className="quote-share-panel__error">{error}</p> : null}
        <button type="submit" className="quote-share-panel__submit" disabled={busy}>{busy ? t('common.saving') : t('messages.clientIntake.send')}</button>
      </form>
    </div>
  );
}
