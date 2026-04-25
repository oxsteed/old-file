import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import '../../styles/AppointmentDetailModal.css';

export default function AppointmentDetailModal({ appointment, onClose, onUpdate, isCustomer }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [confirmReason, setConfirmReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [action, setAction] = useState(null);

  const startTime = new Date(appointment.scheduled_start_time);
  const endTime = new Date(appointment.scheduled_end_time);

  const canConfirm = appointment.status === 'requested' && !isCustomer;
  const canCancel = ['requested', 'confirmed'].includes(appointment.status);

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
                {t(`calendar.status${appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}`)}
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
          </div>

          <div className="adm-section">
            <h3>{t('calendar.serviceDetails')}</h3>
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
    </div>
  );
}
