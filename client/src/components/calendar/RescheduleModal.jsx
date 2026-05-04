/**
 * RescheduleModal
 *
 * Shown from AppointmentDetailModal when either party wants to propose
 * a new time. Presents a date+time picker, optional message, and submits
 * POST /api/calendar/appointments/:id/reschedule-request.
 *
 * The other party will see an in-app notification and can accept/decline
 * from their own AppointmentDetailModal.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import '../../styles/RescheduleModal.css';

function toLocalInputValue(date) {
  if (!date) return '';
  const d = new Date(date);
  // "YYYY-MM-DDTHH:MM" for datetime-local input
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d - offset).toISOString().slice(0, 16);
}

export default function RescheduleModal({ appointment, isCustomer, onClose, onRescheduled }) {
  const { t } = useTranslation();

  // Pre-fill with the current appointment time
  const [proposedStart, setProposedStart] = useState(
    toLocalInputValue(appointment.scheduled_start_time)
  );
  const [proposedEnd, setProposedEnd] = useState(
    toLocalInputValue(appointment.scheduled_end_time)
  );
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(null);

  // Check for an existing pending reschedule request from the other party
  React.useEffect(() => {
    async function loadPending() {
      try {
        const res = await api.get(`/calendar/appointments/${appointment.id}/reschedule-requests`);
        const pending = (res.data?.data || res.data || []).find(r => r.status === 'pending');
        if (pending) setPendingRequest(pending);
      } catch { /* ignore */ }
    }
    loadPending();
  }, [appointment.id]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!proposedStart || !proposedEnd) {
      toast.error(t('reschedule.fillBothTimes', { defaultValue: 'Please fill in both date and time fields.' }));
      return;
    }
    const start = new Date(proposedStart);
    const end   = new Date(proposedEnd);
    if (end <= start) {
      toast.error(t('reschedule.endAfterStart', { defaultValue: 'End time must be after start time.' }));
      return;
    }

    setLoading(true);
    try {
      await api.post(`/calendar/appointments/${appointment.id}/reschedule-request`, {
        proposed_start: start.toISOString(),
        proposed_end:   end.toISOString(),
        message:        message.trim() || null,
      });
      toast.success(t('reschedule.requestSent', { defaultValue: 'Reschedule request sent!' }));
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('reschedule.sendError', { defaultValue: 'Failed to send request.' }));
    } finally {
      setLoading(false);
    }
  }

  async function handleRespond(action) {
    if (!pendingRequest) return;
    setLoading(true);
    try {
      await api.put(
        `/calendar/appointments/${appointment.id}/reschedule-request/${pendingRequest.id}`,
        { action }
      );
      toast.success(
        action === 'accept'
          ? t('reschedule.accepted', { defaultValue: 'Reschedule accepted!' })
          : t('reschedule.declined', { defaultValue: 'Reschedule declined.' })
      );
      onRescheduled?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('reschedule.respondError', { defaultValue: 'Failed to respond.' }));
    } finally {
      setLoading(false);
    }
  }

  const otherRole = isCustomer ? 'helper' : 'customer';
  const otherLabel = isCustomer
    ? t('calendar.helperInfo', { defaultValue: 'Helper' })
    : t('calendar.customerInfo', { defaultValue: 'Customer' });

  return (
    <div className="rsm-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label={t('reschedule.title', { defaultValue: 'Propose a new time' })}>
      <div className="rsm-modal" onClick={e => e.stopPropagation()}>
        <div className="rsm-header">
          <h2>{t('reschedule.title', { defaultValue: 'Propose a new time' })}</h2>
          <button className="rsm-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Pending request from the other party */}
        {pendingRequest && pendingRequest.requested_by_role === otherRole && (
          <div className="rsm-pending-banner">
            <div className="rsm-pending-icon">📩</div>
            <div className="rsm-pending-body">
              <strong>{t('reschedule.pendingTitle', { defaultValue: '{{role}} requested a new time', role: otherLabel })}</strong>
              <span className="rsm-pending-time">
                {new Date(pendingRequest.proposed_start).toLocaleString(undefined, {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
                {' – '}
                {new Date(pendingRequest.proposed_end).toLocaleTimeString(undefined, {
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
              {pendingRequest.message && (
                <em className="rsm-pending-msg">"{pendingRequest.message}"</em>
              )}
            </div>
            <div className="rsm-pending-actions">
              <button className="rsm-btn-accept" onClick={() => handleRespond('accept')} disabled={loading}>
                {t('reschedule.accept', { defaultValue: 'Accept' })}
              </button>
              <button className="rsm-btn-decline" onClick={() => handleRespond('decline')} disabled={loading}>
                {t('reschedule.decline', { defaultValue: 'Decline' })}
              </button>
            </div>
          </div>
        )}

        {/* Propose a new time form */}
        <form className="rsm-form" onSubmit={handleSubmit}>
          <p className="rsm-hint">
            {t('reschedule.hint', { defaultValue: 'Your proposed time will be sent to the other party for approval.' })}
          </p>

          <div className="rsm-field">
            <label htmlFor="rsm-start">{t('reschedule.newStart', { defaultValue: 'New start time' })}</label>
            <input
              id="rsm-start"
              type="datetime-local"
              value={proposedStart}
              onChange={e => setProposedStart(e.target.value)}
              required
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>

          <div className="rsm-field">
            <label htmlFor="rsm-end">{t('reschedule.newEnd', { defaultValue: 'New end time' })}</label>
            <input
              id="rsm-end"
              type="datetime-local"
              value={proposedEnd}
              onChange={e => setProposedEnd(e.target.value)}
              required
              min={proposedStart || new Date().toISOString().slice(0, 16)}
            />
          </div>

          <div className="rsm-field">
            <label htmlFor="rsm-msg">{t('reschedule.message', { defaultValue: 'Message (optional)' })}</label>
            <textarea
              id="rsm-msg"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={t('reschedule.messagePlaceholder', { defaultValue: 'e.g. "Something came up — does this new time work?"' })}
              maxLength={500}
              rows={3}
            />
          </div>

          <div className="rsm-footer">
            <button type="button" className="rsm-btn-secondary" onClick={onClose} disabled={loading}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button type="submit" className="rsm-btn-primary" disabled={loading}>
              {loading
                ? t('reschedule.sending', { defaultValue: 'Sending…' })
                : t('reschedule.send', { defaultValue: 'Send Request' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
