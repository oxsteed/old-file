import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  GripVertical,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';

const blank = () => ({
  id: `field_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  label: '',
  type: 'text',
  required: true,
  options: [],
});

export default function ClientIntakeSharePanel({ open = false, onClose, guestSessionId, onShared }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filledFieldCount = useMemo(
    () => fields.filter((field) => field.label.trim()).length,
    [fields],
  );
  const canShare = Boolean(guestSessionId && title.trim() && filledFieldCount > 0 && !busy);

  if (!open) return null;

  const updateField = (index, patch) => {
    setFields((previous) => previous.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, ...patch } : field
    )));
  };

  const removeField = (index) => {
    setFields((previous) => previous.length > 1 ? previous.filter((_, fieldIndex) => fieldIndex !== index) : previous);
  };

  const share = async (event) => {
    event.preventDefault();
    if (!canShare) return;
    setBusy(true);
    setError('');
    try {
      const cleanedFields = fields
        .filter((field) => field.label.trim())
        .map((field) => ({ ...field, label: field.label.trim() }));
      const { data } = await api.post('/chat/intakes', {
        guestSessionId,
        title: title.trim(),
        description: description.trim(),
        fields: cleanedFields,
      });
      onShared?.(data);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || t('messages.clientIntake.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quote-share-panel client-intake-panel" role="dialog" aria-modal="true" aria-labelledby="client-intake-panel-title">
      <header className="client-intake-panel__header">
        <div className="client-intake-panel__header-main">
          <span className="client-intake-panel__icon" aria-hidden="true"><ClipboardList /></span>
          <div>
            <p className="client-intake-panel__eyebrow"><Sparkles aria-hidden="true" />{t('messages.clientIntake.eyebrow', { defaultValue: 'CLIENT INTAKE' })}</p>
            <h3 id="client-intake-panel-title">{t('messages.clientIntake.shareTitle')}</h3>
            <p className="client-intake-panel__subtitle">{t('messages.clientIntake.shareSubtitle', { defaultValue: 'Collect the details you need before the work begins.' })}</p>
          </div>
        </div>
        <button type="button" className="quote-share-panel__close client-intake-panel__close" onClick={onClose} aria-label={t('common.close')}><X aria-hidden="true" /></button>
      </header>

      <div className="client-intake-panel__progress" aria-live="polite">
        <span><CheckCircle2 aria-hidden="true" /> {t('messages.clientIntake.progressTitle', { defaultValue: 'Build your form' })}</span>
        <span>{filledFieldCount} {t('messages.clientIntake.questionCount', { defaultValue: filledFieldCount === 1 ? 'question' : 'questions' })}</span>
      </div>

      <form className="quote-share-panel__body client-intake-panel__body" onSubmit={share}>
        <section className="client-intake-panel__section" aria-labelledby="client-intake-details-heading">
          <div className="client-intake-panel__section-heading">
            <div><p className="client-intake-panel__section-kicker">01</p><h4 id="client-intake-details-heading">{t('messages.clientIntake.detailsHeading', { defaultValue: 'Set the direction' })}</h4></div>
            <span>{t('messages.clientIntake.requiredHint', { defaultValue: 'Required' })}</span>
          </div>
          <label className="client-intake-panel__label">
            <span>{t('messages.clientIntake.titleLabel')} <b aria-hidden="true">*</b></span>
            <input className="client-intake-panel__input client-intake-panel__input--title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} placeholder={t('messages.clientIntake.titlePlaceholder')} />
          </label>
          <label className="client-intake-panel__label">
            <span>{t('messages.clientIntake.descriptionLabel')} <em>{t('messages.clientIntake.optional', { defaultValue: 'Optional' })}</em></span>
            <textarea className="client-intake-panel__input client-intake-panel__textarea" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} placeholder={t('messages.clientIntake.descriptionPlaceholder')} />
          </label>
        </section>

        <section className="client-intake-panel__section" aria-labelledby="client-intake-questions-heading">
          <div className="client-intake-panel__section-heading">
            <div><p className="client-intake-panel__section-kicker">02</p><h4 id="client-intake-questions-heading">{t('messages.clientIntake.questionsHeading', { defaultValue: 'Ask what matters' })}</h4></div>
            <span>{t('messages.clientIntake.questionsHint', { defaultValue: 'Keep it focused' })}</span>
          </div>

          <div className="client-intake-panel__fields">
            {fields.map((field, index) => (
              <div key={field.id} className="client-intake-field">
                <div className="client-intake-field__rail" aria-hidden="true"><GripVertical /><span>{String(index + 1).padStart(2, '0')}</span></div>
                <div className="client-intake-field__content">
                  <div className="client-intake-field__topline">
                    <label className="client-intake-panel__label client-intake-field__question">
                      <span>{t('messages.clientIntake.questionLabel', { defaultValue: 'Question' })} <b aria-hidden="true">*</b></span>
                      <input className="client-intake-panel__input" value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} required={index === 0} maxLength={180} placeholder={t('messages.clientIntake.questionPlaceholder')} />
                    </label>
                    <button type="button" className="client-intake-field__remove" onClick={() => removeField(index)} disabled={fields.length === 1} aria-label={t('messages.clientIntake.removeQuestion', { defaultValue: 'Remove question' })}><Trash2 aria-hidden="true" /></button>
                  </div>
                  <div className="client-intake-field__controls">
                    <label className="client-intake-panel__label client-intake-field__type">
                      <span>{t('messages.clientIntake.answerType', { defaultValue: 'Answer type' })}</span>
                      <select className="client-intake-panel__input" value={field.type} onChange={(event) => updateField(index, { type: event.target.value })}>
                        <option value="text">{t('messages.clientIntake.text')}</option><option value="textarea">{t('messages.clientIntake.longText')}</option><option value="number">{t('messages.clientIntake.number')}</option><option value="date">{t('messages.clientIntake.date')}</option>
                      </select>
                    </label>
                    <label className="client-intake-field__required"><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} /><span>{t('messages.clientIntake.required', { defaultValue: 'Required' })}</span></label>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="button" className="client-intake-panel__add" onClick={() => setFields((previous) => [...previous, blank()])}>
            <span><Plus aria-hidden="true" /></span><span><strong>{t('messages.clientIntake.addQuestion')}</strong><small>{t('messages.clientIntake.addQuestionHint', { defaultValue: 'Add another detail for the client to answer' })}</small></span>
          </button>
        </section>

        {error ? <p className="quote-share-panel__error client-intake-panel__error" role="alert">{error}</p> : null}
        <footer className="client-intake-panel__footer">
          <p>{t('messages.clientIntake.sendHint', { defaultValue: 'The client will receive this form in the conversation.' })}</p>
          <div className="client-intake-panel__actions">
            <button type="button" className="client-intake-panel__cancel" onClick={onClose} disabled={busy}>{t('common.cancel', { defaultValue: 'Cancel' })}</button>
            <button type="submit" className="client-intake-panel__submit" disabled={!canShare}><Send aria-hidden="true" />{busy ? t('common.saving') : t('messages.clientIntake.send')}</button>
          </div>
        </footer>
      </form>
    </div>
  );
}
