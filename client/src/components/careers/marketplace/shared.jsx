import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Field, useCareerErrors } from '../ui';
import { stars } from '../../../features/careers/marketplaceModel';

/** Save a Blob as a download (résumé PDF, ICS, CSV). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download an authenticated file through the API client. */
export async function downloadVia(api, path, filename) {
  const r = await api.get(path, { responseType: 'blob' });
  saveBlob(r.data, filename);
}

/** Reason picker + optional details, used for jobs, messages and reviews. */
export function ReportForm({ reasons, reasonKey, onSubmit, onCancel, idPrefix }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="ox-careers-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason) return;
        setBusy(true);
        try { await onSubmit({ reason, details }); toast.success(t('careers.mk.report.thanks')); } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
      }}
    >
      <Field label={t('careers.mk.report.reason')} htmlFor={`${idPrefix}-reason`}>
        <select id={`${idPrefix}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required>
          <option value="">{t('careers.mk.report.pick')}</option>
          {reasons.map((r) => <option key={r} value={r}>{t(`${reasonKey}.${r}`)}</option>)}
        </select>
      </Field>
      <Field label={t('careers.mk.report.details')} htmlFor={`${idPrefix}-details`}>
        <textarea id={`${idPrefix}-details`} rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      <div className="ox-careers-actions">
        <button type="submit" className="ox-careers-btn danger" disabled={busy || !reason}>{t('careers.mk.report.send')}</button>
        <button type="button" className="ox-careers-btn" onClick={onCancel}>{t('careers.common.cancel')}</button>
      </div>
    </form>
  );
}

/** Stars with the number spelled out for assistive tech. */
export function Stars({ value }) {
  const { t } = useTranslation();
  if (value == null) return null;
  return <span className="ox-careers-stars" aria-label={t('careers.mk.reviews.starsLabel', { value: Number(value).toFixed(1) })}><span aria-hidden="true">{stars(value)}</span> {Number(value).toFixed(1)}</span>;
}

/** 1–5 rating input as a radio group. */
export function StarInput({ name, label, value, onChange, required }) {
  const { t } = useTranslation();
  return (
    <fieldset className="ox-careers-yesno">
      <legend>{label}{required ? ' *' : ''}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="ox-careers-check">
          <input type="radio" name={name} checked={Number(value) === n} onChange={() => onChange(n)} />
          <span aria-label={t('careers.mk.reviews.starsLabel', { value: n })}>{n}★</span>
        </label>
      ))}
    </fieldset>
  );
}
