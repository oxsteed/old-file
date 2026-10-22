import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import '../../styles/StaffCreateAppointmentModal.css';

// Staff-facing walk-in / phone booking form for the business hub calendar.
// Posts to the staff-create endpoint (no customer booking-rule middleware:
// staff may book walk-ins inside the normal advance-notice window).
// P3-8-F10: the hub calendar was list + status only; this is the staff
// booking UI.
export function StaffCreateAppointmentModal({ businessId, services, onClose, onCreated }) {
  const { t } = useTranslation();
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('09:00');
  const [confirmImmediately, setConfirmImmediately] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const service = services.find((s) => String(s.id) === String(serviceId));
  const staffOptions = Array.isArray(service?.staff) ? service.staff : [];

  useEffect(() => {
    setStaffId('');
  }, [serviceId]);

  const formatMoney = (cents) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!serviceId || !date || !time || !customerName.trim()) {
      toast.error(t('businessAppointments.fillRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + (service.duration_minutes || 60) * 60000);

      // Fail closed on price: the server requires base_price_cents and there
      // is nothing safe to charge without the priced quote.
      const priceRes = await api.get(
        `/businesses/${businessId}/services/${serviceId}/calculate-price`,
        { params: { booking_date: date, booking_time: time } }
      );
      const finalPrice = priceRes.data?.final_price_cents;
      if (!Number.isSafeInteger(finalPrice)) {
        toast.error(t('businessAppointments.priceUnavailable'));
        setSubmitting(false);
        return;
      }

      const createRes = await api.post(`/businesses/${businessId}/appointments/staff-create`, {
        service_id: serviceId,
        staff_id: staffId || null,
        customer_id: null,
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim() || null,
        customer_phone: customerPhone.trim() || null,
        customer_notes: notes.trim() || null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        base_price_cents: finalPrice,
      });
      const created = createRes.data;

      if (confirmImmediately && created?.id) {
        await api.put(`/businesses/${businessId}/appointments/${created.id}/status`, { status: 'confirmed' });
      }

      toast.success(t('businessAppointments.appointmentCreated'));
      onCreated();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || t('businessAppointments.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="scam-overlay" onClick={onClose}>
      <div className="scam-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scam-header">
          <h4>{t('businessAppointments.newAppointment')}</h4>
          <button className="scam-close" onClick={onClose} data-track="ui.1d98805aba.1">×</button>
        </div>
        <form onSubmit={handleSubmit} className="scam-form" data-track="ui.1d98805aba.2">
          <label>
            <span>{t('businessAppointments.selectService')}</span>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              <option value="">{t('businessAppointments.selectService')}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration_minutes} min, {formatMoney(s.base_price_cents)})
                </option>
              ))}
            </select>
          </label>

          {service && staffOptions.length > 0 && (
            <label>
              <span>{t('businessAppointments.selectStaff')}</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">{t('businessAppointments.anyStaff')}</option>
                {staffOptions.map((st) => (
                  <option key={st.id} value={st.id}>{st.name || st.id}</option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span>{t('businessAppointments.customerName')}</span>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
              maxLength={255}
            />
          </label>

          <div className="scam-row">
            <label>
              <span>{t('businessAppointments.phone')}</span>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                maxLength={20}
              />
            </label>
            <label>
              <span>{t('businessAppointments.email')}</span>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                maxLength={255}
              />
            </label>
          </div>

          <div className="scam-row">
            <label>
              <span>{t('businessAppointments.date')}</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label>
              <span>{t('businessAppointments.startTime')}</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </label>
          </div>

          <label>
            <span>{t('businessAppointments.customerNotes')}</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </label>

          <label className="scam-checkbox">
            <input
              type="checkbox"
              checked={confirmImmediately}
              onChange={(e) => setConfirmImmediately(e.target.checked)} data-track="ui.1d98805aba.3"
            />
            <span>{t('businessAppointments.confirmImmediately')}</span>
          </label>

          <div className="scam-actions">
            <button type="button" className="scam-btn scam-btn-secondary" onClick={onClose} data-track="ui.1d98805aba.4">
              {t('businessAppointments.cancel')}
            </button>
            <button type="submit" className="scam-btn scam-btn-primary" disabled={submitting} data-track="ui.1d98805aba.5">
              {submitting ? t('businessAppointments.creating') : t('businessAppointments.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
