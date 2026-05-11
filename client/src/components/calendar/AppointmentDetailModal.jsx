import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { toast } from 'sonner';
import RescheduleModal from './RescheduleModal';
import { calendarAppointmentStatusKey } from '../../utils/calendarI18n';
import '../../styles/AppointmentDetailModal.css';

export default function AppointmentDetailModal({ appointment, onClose, onUpdate, isCustomer }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [confirmReason, setConfirmReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [action, setAction] = useState(null);

  const startTime = new Date(appointment.scheduled_start_time);
  const endTime = new Date(appointment.scheduled_end_time);

  const [showReschedule, setShowReschedule] = useState(false);

  const canConfirm    = appointment.status === 'requested' && !isCustomer;
  const canCancel     = ['requested', 'confirmed'].includes(appointment.status);
  const canReschedule = ['requested', 'confirmed'].includes(appointment.status);

  // Google Calendar link
  function buildGoogleCalendarUrl() {
    const title   = encodeURIComponent(appointment.service_description || 'OxSteed Appointment');
    const loc     = encodeURIComponent(appointment.location_address || '');
    const start   = new Date(appointment.scheduled_start_time).toISOString().replace(/[-:]/g, '').replace('.000', '');
    const end     = new Date(appointment.scheduled_end_time).toISOString().replace(/[-:]/g, '').replace('.000', '');
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&location=${loc}`;
  }

  const handleConfirm = async () => {
    if (!canConfirm) return;

    try {
      setLoading(true);
      await api.post(`/calendar/appointments/${appointment.id}/confirm`);
      toast.success(t('calendar.appointmentConfirmed'));
      onUpdate();
      onClose();
    } catch (err) {
      toast.error(t('calendar.errorConfirming'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!canCancel || !cancelReason.trim()) {
      toast.error(t('calendar.provideCancelReason'));
      return;
    }

    try {
      setLoading(true);
      await api.post(`/calendar/appointments/${appointment.id}/cancel`, {
        cancellation_reason: cancelReason
      });
      toast.success(t('calendar.appointmentCancelled'));
      onUpdate();
      onClose();
    } catch (err) {
      toast.error(t('calendar.errorCancelling'));
      console.error(err);
    } finally {
      setLoading(false);
      setShowCancelConfirm(false);
      setCancelReason('');
    }
  };

  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adm-header">
          <h2>{t('calendar.appointmentDetails')}</h2>
          <button className="adm-close" onClick={onClose}>✕</button>
        </div>

        <div className="adm-content">
          <div className="adm-section">
            <h3>{t('calendar.appointmentInfo')}</h3>
            <div className="adm-detail">
              <label>{t('calendar.date')}</label>
              <div className="adm-value">{startTime.toLocaleDateString()}</div>
            </div>
            <div className="adm-detail">
              <label>{t('calendar.time')}</label>
              <div className="adm-value">
                {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -
                {endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div className="adm-detail">
              <label>{t('calendar.duration')}</label>
              <div className="adm-value">{Math.round((endTime - startTime) / (1000 * 60))} {t('calendar.minutes')}</div>
            </div>
            <div className="adm-detail">
              <label>{t('calendar.status')}</label>
              <div className={`adm-value adm-status adm-status-${appointment.status}`}>
                {t(calendarAppointmentStatusKey(appointment.status))}
              </div>
            </div>
          </div>

          <div className="adm-section">
            <h3>{isCustomer ? t('calendar.helperInfo') : t('calendar.customerInfo')}</h3>
            <div className="adm-detail">
              <label>{t('calendar.name')}</label>
              <div className="adm-value adm-person">
                {isCustomer ? (
                  <>
                    {appointment.helper_avatar && <img src={appointment.helper_avatar} alt="" />}
                    {appointment.helper_name}
                  </>
                ) : (
                  <>
                    {appointment.customer_avatar && <img src={appointment.customer_avatar} alt="" />}
                    {appointment.customer_name}
                  </>
                )}
              </div>
            </div>
            {!isCustomer && appointment.customer_email && (
              <div className="adm-detail">
                <label>{t('common.email', { defaultValue: 'Email' })}</label>
                <div className="adm-value">
                  <a href={`mailto:${appointment.customer_email}`}>{appointment.customer_email}</a>
                </div>
              </div>
            )}
            {!isCustomer && appointment.guest_phone && (
              <div className="adm-detail">
                <label>{t('common.phone', { defaultValue: 'Phone' })}</label>
                <div className="adm-value">
                  <a href={`tel:${appointment.guest_phone}`}>{appointment.guest_phone}</a>
                </div>
              </div>
            )}
          </div>

          <div className="adm-section">
            <h3>{t('calendar.serviceDetails')}</h3>
            {appointment.job_id && (
              <div className="adm-job-banner">
                <span className="adm-job-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                  </svg>
                  {t('calendar.fromJob')}
                </span>
                {appointment.job_title && (
                  <span className="adm-job-title">{appointment.job_title}</span>
                )}
                <button
                  className="adm-job-link"
                  onClick={() => { onClose(); navigate(`/jobs/${appointment.job_id}`); }}
                >
                  {t('calendar.viewJob')} →
                </button>
              </div>
            )}
            <div className="adm-detail">
              <label>{t('calendar.service')}</label>
              <div className="adm-value">{appointment.service_description}</div>
            </div>
            {appointment.location_address && (
              <div className="adm-detail">
                <label>{t('calendar.location')}</label>
                <div className="adm-value">{appointment.location_address}</div>
              </div>
            )}
            {appointment.customer_notes && (
              <div className="adm-detail">
                <label>{t('calendar.customerNotes')}</label>
                <div className="adm-value">{appointment.customer_notes}</div>
              </div>
            )}
            {appointment.helper_notes && (
              <div className="adm-detail">
                <label>{t('calendar.helperNotes')}</label>
                <div className="adm-value">{appointment.helper_notes}</div>
              </div>
            )}
          </div>

          {showCancelConfirm ? (
            <div className="adm-section adm-cancel-section">
              <label>{t('calendar.cancelReason')}</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t('calendar.cancelReasonPlaceholder')}
                rows="4"
              />
            </div>
          ) : null}
        </div>

        {/* Export to calendar */}
        {['confirmed', 'in_progress'].includes(appointment.status) && (
          <div className="adm-export-row">
            <a
              href={`/api/calendar/appointments/${appointment.id}/ical`}
              download={`oxsteed-appointment-${appointment.id}.ics`}
              className="adm-export-btn"
              aria-label={t('calendar.downloadIcal', { defaultValue: 'Download .ics file' })}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {t('calendar.downloadIcal', { defaultValue: 'Download .ics' })}
            </a>
            <a
              href={buildGoogleCalendarUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="adm-export-btn"
              aria-label={t('calendar.addToGoogle', { defaultValue: 'Add to Google Calendar' })}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M18 2h-3a2 2 0 0 0-2 2v3"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {t('calendar.addToGoogle', { defaultValue: 'Add to Google Calendar' })}
            </a>
          </div>
        )}

        <div className="adm-footer">
          {!showCancelConfirm && (
            <>
              {canConfirm && (
                <button
                  className="adm-btn adm-btn-primary"
                  onClick={handleConfirm}
                  disabled={loading}
                >
                  {t('calendar.confirmAppointment')}
                </button>
              )}
              {canReschedule && (
                <button
                  className="adm-btn adm-btn-secondary"
                  onClick={() => setShowReschedule(true)}
                  disabled={loading}
                >
                  {t('calendar.reschedule', { defaultValue: 'Reschedule' })}
                </button>
              )}
              {canCancel && (
                <button
                  className="adm-btn adm-btn-danger"
                  onClick={() => setShowCancelConfirm(true)}
                >
                  {t('calendar.cancelAppointment')}
                </button>
              )}
            </>
          )}
          {showCancelConfirm && (
            <>
              <button
                className="adm-btn adm-btn-danger"
                onClick={handleCancel}
                disabled={loading || !cancelReason.trim()}
              >
                {t('calendar.confirmCancel')}
              </button>
              <button
                className="adm-btn adm-btn-secondary"
                onClick={() => setShowCancelConfirm(false)}
                disabled={loading}
              >
                {t('calendar.keepAppointment')}
              </button>
            </>
          )}
          {!showCancelConfirm && (
            <button className="adm-btn adm-btn-secondary" onClick={onClose} disabled={loading}>
              {t('common.close')}
            </button>
          )}
        </div>
      </div>

      {/* Reschedule modal (rendered on top of detail modal) */}
      {showReschedule && (
        <RescheduleModal
          appointment={appointment}
          isCustomer={isCustomer}
          onClose={() => setShowReschedule(false)}
          onRescheduled={() => { onUpdate(); onClose(); }}
        />
      )}
    </div>
  );
}
