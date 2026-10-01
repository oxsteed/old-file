import React, { useState } from 'react';
import { ClipboardList, Loader2, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';

export default function ClientIntakeCard({
  intake,
  isProvider = false,
  guestVerified = false,
  guestAuthHeaders = null,
}) {
  const { t } = useTranslation();
  const fields = Array.isArray(intake?.fields) ? intake.fields : [];
  const completed = intake?.status === 'completed' || Boolean(intake?.responses);
  const [responses, setResponses] = useState(intake?.responses || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(completed);

  const submit = async (event) => {
    event.preventDefault();
    if (!guestVerified || busy || !intake?.id) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/chat/intakes/${intake.id}/respond`, { responses }, { headers: guestAuthHeaders || {} });
      setSubmitted(true);
    } catch (err) {
      setError(err?.response?.data?.error || t('messages.clientIntake.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="client-intake-card rounded-xl border border-orange-400/30 bg-orange-950/20 p-3.5 text-start">
      <div className="flex items-start gap-2">
        <ClipboardList className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h4 className="client-intake-card__title font-semibold text-white">{intake?.title || t('messages.clientIntake.title')}</h4>
          {intake?.description ? <p className="client-intake-card__description mt-1 text-xs leading-relaxed text-gray-300">{intake.description}</p> : null}
        </div>
        {submitted ? <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-label={t('messages.clientIntake.completed')} /> : null}
      </div>
      {completed || submitted ? (
        <div className="client-intake-card__responses mt-3 space-y-2 text-xs text-gray-300">
          {fields.map((field) => (
            <div key={field.id} className="client-intake-card__response rounded-lg bg-gray-900/50 px-2.5 py-2">
              <span className="client-intake-card__question font-medium text-gray-400">{field.label}</span>
              <p className="client-intake-card__answer mt-0.5 text-gray-100">{String(responses?.[field.id] || '—')}</p>
            </div>
          ))}
          {!isProvider && submitted ? <p className="text-emerald-300">{t('messages.clientIntake.thanks')}</p> : null}
        </div>
      ) : isProvider ? (
        <p className="client-intake-card__waiting mt-3 text-xs text-gray-400">{t('messages.clientIntake.waiting')}</p>
      ) : (
        <form className="mt-3 space-y-2.5" onSubmit={submit}>
          {fields.map((field) => (
            <label key={field.id} className="client-intake-card__label block text-xs text-gray-300">
              <span className="mb-1 block font-medium">{field.label}{field.required ? ' *' : ''}</span>
              {field.type === 'textarea' ? (
                <textarea
                  className="client-intake-card__input w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white"
                  rows={3}
                  value={responses[field.id] || ''}
                  onChange={(event) => setResponses((prev) => ({ ...prev, [field.id]: event.target.value }))}
                  required={field.required}
                />
              ) : field.type === 'select' ? (
                <select
                  className="client-intake-card__input w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white"
                  value={responses[field.id] || ''}
                  onChange={(event) => setResponses((prev) => ({ ...prev, [field.id]: event.target.value }))}
                  required={field.required}
                >
                  <option value="">{t('messages.clientIntake.choose')}</option>
                  {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <input
                  type={field.type || 'text'}
                  className="client-intake-card__input w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-white"
                  value={responses[field.id] || ''}
                  onChange={(event) => setResponses((prev) => ({ ...prev, [field.id]: event.target.value }))}
                  required={field.required}
                />
              )}
            </label>
          ))}
          {error ? <p className="client-intake-card__error text-xs text-red-300" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy || !guestVerified} className="client-intake-card__submit inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('messages.clientIntake.submit')}
          </button>
        </form>
      )}
    </div>
  );
}
