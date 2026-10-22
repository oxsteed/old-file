import { useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';

import { validateBidEdit } from '../../utils/bidEdit';

export default function EditBidModal({ bid, onClose, onSaved }) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [amount, setAmount] = useState(bid.amount != null ? String(bid.amount) : '');
  const [etaHours, setEtaHours] = useState(bid.eta_hours != null ? String(bid.eta_hours) : '');
  const [message, setMessage] = useState(bid.message || '');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const found = validateBidEdit({ amount, etaHours, message });
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = { amount: Number(amount) };
      if (etaHours !== '') payload.eta_hours = Number(etaHours);
      if (message.trim()) payload.message = message.trim();
      const { data } = await api.put(`/bids/${bid.id}`, payload);
      toast.success(t('myBids.editSaved'));
      onSaved?.(data);
      onClose();
    } catch (err) {
      const code = err.response?.data?.code;
      toast.error(code === 'invalid_bid_state' || code === 'job_not_accepting_bids'
        ? t('myBids.editClosed') : t('myBids.editFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
      <form role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`} onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-5 space-y-3" data-track="ui.9c8c00d3d2.1">
        <h2 id={`${fieldId}-title`} className="text-lg font-semibold text-white">{t('myBids.editTitle')}</h2>
        <label className="block text-sm text-gray-300" htmlFor={`${fieldId}-amount`}>{t('myBids.editAmount')}</label>
        <input id={`${fieldId}-amount`} type="number" min="1" step="0.01" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} aria-invalid={Boolean(errors.amount)}
          className="w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
        {errors.amount && <p role="alert" className="text-xs text-red-400">{t(errors.amount)}</p>}
        <label className="block text-sm text-gray-300" htmlFor={`${fieldId}-eta`}>{t('myBids.editEta')}</label>
        <input id={`${fieldId}-eta`} type="number" min="0.5" step="0.5" value={etaHours}
          onChange={(e) => setEtaHours(e.target.value)} aria-invalid={Boolean(errors.etaHours)}
          className="w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
        {errors.etaHours && <p role="alert" className="text-xs text-red-400">{t(errors.etaHours)}</p>}
        <label className="block text-sm text-gray-300" htmlFor={`${fieldId}-message`}>{t('myBids.editMessage')}</label>
        <textarea id={`${fieldId}-message`} rows={4} maxLength={2000} value={message}
          onChange={(e) => setMessage(e.target.value)} className="w-full rounded-lg bg-gray-800 px-3 py-2 text-white" />
        {errors.message && <p role="alert" className="text-xs text-red-400">{t(errors.message)}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-300" data-track="ui.9c8c00d3d2.2">{t('myBids.editCancel')}</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" data-track="ui.9c8c00d3d2.3">
            {saving ? t('myBids.editSaving') : t('myBids.editSave')}
          </button>
        </div>
      </form>
    </div>
  );
}
