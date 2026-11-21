import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { schedulingApi } from '../api/scheduling';
import './ConsultantSessionDialogs.css';

// Group 10 Slice C, item 519: cancel a confirmed appointment. The
// cancellation moves both the scheduled row and the session in one
// transaction server-side and records the reason plus an optional refund
// request. Refunds themselves stay on the admin refund endpoint: this
// dialog only records that the caller wants one.
//
// Props:
//   scheduledSession { scheduled_id, scheduled_date, scheduled_time }
//   canRequestRefund  show the refund-request checkbox (client side only)
//   onClose           called when the dialog is dismissed
//   onDone            called with the cancelled row on success
export default function ConsultantCancelSessionDialog({ scheduledSession, canRequestRefund = false, onClose, onDone }) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState('');
  const [refundRequested, setRefundRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const dateLocale = i18n.language || 'en';

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const { data } = await schedulingApi.cancelSession(scheduledSession.scheduled_id, {
        reason: reason.trim() || null,
        refundRequested: canRequestRefund ? refundRequested : false,
      });
      toast.success(t('scheduling.cancelled'));
      onDone?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.errorUpdating'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="csd-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="csd-dialog csd-dialog-narrow">
        <h2 className="csd-title">{t('scheduling.cancelTitle')}</h2>
        <p className="text-sm mb-4 csd-muted">
          {scheduledSession?.scheduled_date
            ? new Date(`${scheduledSession.scheduled_date}T${scheduledSession.scheduled_time || '09:00'}`).toLocaleDateString(dateLocale, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : ''}
        </p>

        <label className="csd-label">{t('scheduling.cancelReason')}</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={t('scheduling.cancelReasonPlaceholder')}
          className="csd-input csd-textarea csd-field"
        />

        {canRequestRefund && (
          <label className="flex items-start gap-2 text-sm mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={refundRequested}
              onChange={(e) => setRefundRequested(e.target.checked)}
              className="mt-0.5" data-track="ui.dd92451f6d.1"
            />
            <span>{t('scheduling.requestRefund')}</span>
          </label>
        )}

        <p className="text-xs mb-4 csd-muted">
          {t('scheduling.cancelNote')}
        </p>

        <div className="csd-actions">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-md font-semibold text-sm csd-btn-secondary" data-track="ui.dd92451f6d.2"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-60" data-track="ui.dd92451f6d.3"
          >
            {saving ? t('common.loading') : t('scheduling.cancelSession')}
          </button>
        </div>
      </div>
    </div>
  );
}
