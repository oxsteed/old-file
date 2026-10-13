import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Clock, User, Phone, Mail, AlertCircle, Plus } from 'lucide-react';
import { formatDate as formatLocalizedDate, formatDateTime } from '../../lib/format';
import { StaffCreateAppointmentModal } from './StaffCreateAppointmentModal';
import '../../styles/AppointmentCalendarView.css';

export function AppointmentCalendarView({ businessId }) {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState([]);
  const [services, setServices] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month'); // 'month', 'week', 'day'
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all', 'pending', 'confirmed', 'completed', 'cancelled'
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [reassignStaffId, setReassignStaffId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');

  useEffect(() => {
    loadAppointments();
  }, [businessId, currentDate]);

  useEffect(() => {
    loadServices();
  }, [businessId]);

  useEffect(() => {
    setShowReschedule(false);
    setReassignStaffId(selectedAppointment?.staff_id ? String(selectedAppointment.staff_id) : '');
  }, [selectedAppointment?.id]);

  const loadServices = async () => {
    try {
      const response = await api.get(`/businesses/${businessId}/services`);
      setServices(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setServices([]);
    }
  };

  const loadAppointments = async () => {
    try {
      setLoading(true);
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      const response = await api.get(`/businesses/${businessId}/appointments`, {
        params: {
          status: filter === 'all' ? undefined : filter,
          start_date: startOfMonth.toISOString().split('T')[0],
          end_date: endOfMonth.toISOString().split('T')[0]
        }
      });

      setAppointments(Array.isArray(response.data?.appointments) ? response.data.appointments : []);
    } catch (error) {
      toast.error(t('businessAppointments.loadFailed'));
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const formatDate = (dateStr) => {
    return formatLocalizedDate(dateStr, {
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateStr) => {
    return formatDateTime(dateStr, {
      hour: 'numeric',
      minute: '2-digit',
      month: undefined,
      day: undefined,
      year: undefined,
    });
  };

  const formatMoney = (cents) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);

  const getStatusColor = (status) => {
    const colors = {
      pending: '#f59e0b',
      confirmed: '#10b981',
      completed: '#6366f1',
      cancelled: '#ef4444',
      'no-show': '#8b5cf6'
    };
    return colors[status] || '#6b7280';
  };

  const statusLabel = (status) => t(`businessAppointments.status.${status || 'unknown'}`, {
    defaultValue: String(status || '').replace(/_/g, ' '),
  });

  const getAppointmentsForDate = (day) => {
    return appointments.filter(apt => {
      const aptDate = new Date(apt.start_time).getDate();
      return aptDate === day;
    });
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleUpdateStatus = async (appointmentId, newStatus) => {
    try {
      await api.put(`/businesses/${businessId}/appointments/${appointmentId}/status`, {
        status: newStatus
      });
      toast.success(t('businessAppointments.statusUpdated', { status: statusLabel(newStatus) }));
      setSelectedAppointment(null);
      loadAppointments();
    } catch (error) {
      toast.error(error.response?.data?.message || t('businessAppointments.updateFailed'));
    }
  };

  // P3-8-F09: the hub cancelled through PUT .../status, leaving the dedicated
  // POST .../cancel endpoint (cancellation policy, cancelled_by audit) with
  // zero callers. Cancel through the dedicated endpoint now.
  const handleCancel = async (appointmentId) => {
    try {
      const res = await api.post(`/businesses/${businessId}/appointments/${appointmentId}/cancel`, {
        cancelled_by: 'business'
      });
      if (res.data?.late_cancellation && res.data?.cancellation_fee_cents > 0) {
        toast.success(t('businessAppointments.lateFeeApplied', {
          amount: formatMoney(res.data.cancellation_fee_cents),
        }));
      } else {
        toast.success(t('businessAppointments.cancelSuccess'));
      }
      setSelectedAppointment(null);
      loadAppointments();
    } catch (error) {
      toast.error(error.response?.data?.message || t('businessAppointments.cancelFailed'));
    }
  };

  // P3-8-F09: reschedule through the dedicated POST .../reschedule endpoint.
  const handleReschedule = async (appointment) => {
    if (!rescheduleDate || !rescheduleTime) {
      toast.error(t('businessAppointments.fillRequired'));
      return;
    }
    try {
      const durationMs = new Date(appointment.end_time).getTime() - new Date(appointment.start_time).getTime();
      const newStart = new Date(`${rescheduleDate}T${rescheduleTime}:00`);
      const newEnd = new Date(newStart.getTime() + durationMs);
      await api.post(`/businesses/${businessId}/appointments/${appointment.id}/reschedule`, {
        new_start_time: newStart.toISOString(),
        new_end_time: newEnd.toISOString(),
      });
      toast.success(t('businessAppointments.rescheduled'));
      setShowReschedule(false);
      setSelectedAppointment(null);
      loadAppointments();
    } catch (error) {
      toast.error(error.response?.data?.message || t('businessAppointments.rescheduleFailed'));
    }
  };

  // P3-8-F07: reassign staff in place (no cancel + recreate).
  const handleReassignStaff = async (appointment) => {
    try {
      await api.put(`/businesses/${businessId}/appointments/${appointment.id}/staff`, {
        staff_id: reassignStaffId || null,
      });
      toast.success(t('businessAppointments.staffReassigned'));
      setSelectedAppointment(null);
      loadAppointments();
    } catch (error) {
      toast.error(error.response?.data?.message || t('businessAppointments.reassignFailed'));
    }
  };

  // P3-8-F05: record an off-platform payment collection for an upfront-
  // payment appointment.
  const handleRecordPayment = async (appointment) => {
    try {
      await api.post(`/businesses/${businessId}/appointments/${appointment.id}/record-payment`, {
        amount_cents: appointment.final_price_cents,
        payment_method: paymentMethod,
      });
      toast.success(t('businessAppointments.paymentRecorded'));
      setSelectedAppointment(null);
      loadAppointments();
    } catch (error) {
      toast.error(error.response?.data?.message || t('businessAppointments.paymentFailed'));
    }
  };

  const renderCalendarDays = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days = [];

    // Empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="acv-day acv-day-empty"></div>);
    }

    // Cells for each day of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dayAppointments = getAppointmentsForDate(day);
      const isToday = day === new Date().getDate() && 
                     currentDate.getMonth() === new Date().getMonth() &&
                     currentDate.getFullYear() === new Date().getFullYear();

      days.push(
        <div 
          key={day} 
          className={`acv-day ${isToday ? 'acv-day-today' : ''} ${dayAppointments.length > 0 ? 'acv-day-has-appointments' : ''}`}
        >
          <div className="acv-day-number">{day}</div>
          <div className="acv-day-appointments">
            {dayAppointments.slice(0, 2).map(apt => (
              <div 
                key={apt.id} 
                className="acv-day-apt-badge"
                style={{ backgroundColor: getStatusColor(apt.status) }}
                onClick={() => setSelectedAppointment(apt)}
                title={apt.service_name}
              >
                {formatTime(apt.start_time)}
              </div>
            ))}
            {dayAppointments.length > 2 && (
              <div className="acv-day-more">+{dayAppointments.length - 2}</div>
            )}
          </div>
        </div>
      );
    }

    return days;
  };

  const monthYear = formatLocalizedDate(currentDate, { month: 'long', year: 'numeric', day: undefined });
  const staffOptions = (() => {
    if (!selectedAppointment) return [];
    const svc = services.find((s) => String(s.id) === String(selectedAppointment.service_id));
    return Array.isArray(svc?.staff) ? svc.staff : [];
  })();
  const canModify = selectedAppointment && ['pending', 'confirmed'].includes(selectedAppointment.status);

  return (
    <div className="acv-container">
      <div className="acv-header">
        <h3>{t('businessAppointments.title')}</h3>
        <div className="acv-header-controls">
          <div className="acv-filter-buttons">
            {['all', 'pending', 'confirmed', 'completed', 'cancelled'].map(status => (
              <button
                key={status}
                className={`acv-filter-btn ${filter === status ? 'active' : ''}`}
                onClick={() => setFilter(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
          <button className="acv-btn acv-btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            {t('businessAppointments.newAppointment')}
          </button>
        </div>
      </div>

      <div className="acv-calendar">
        <div className="acv-calendar-header">
          <button onClick={handlePrevMonth} className="acv-nav-btn">
            <ChevronLeft size={18} />
          </button>
          <h4>{monthYear}</h4>
          <button onClick={handleNextMonth} className="acv-nav-btn">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="acv-weekdays">
          {['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(day => (
            <div key={day} className="acv-weekday">{t(`businessAppointments.weekdays.${day}`)}</div>
          ))}
        </div>

        <div className="acv-days-grid">
          {renderCalendarDays()}
        </div>
      </div>

      {showCreateModal && (
        <StaffCreateAppointmentModal
          businessId={businessId}
          services={services}
          onClose={() => setShowCreateModal(false)}
          onCreated={loadAppointments}
        />
      )}

      {selectedAppointment && (
        <div className="acv-detail-panel">
          <div className="acv-detail-header">
            <h4>{t('businessAppointments.detailsTitle')}</h4>
            <button onClick={() => setSelectedAppointment(null)} className="acv-detail-close">×</button>
          </div>

          <div className="acv-detail-content">
            <div className="acv-detail-section">
              <h5>{selectedAppointment.service_name}</h5>
              <div className="acv-detail-row">
                <Clock size={16} />
                <div>
                  <div className="label">{t('businessAppointments.dateTime')}</div>
                  <div className="value">
                    {t('businessAppointments.dateTimeValue', {
                      date: formatDate(selectedAppointment.start_time),
                      time: formatTime(selectedAppointment.start_time),
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="acv-detail-section">
              <div className="label">{t('businessAppointments.statusLabel')}</div>
              <div 
                className="acv-status-badge"
                style={{ backgroundColor: getStatusColor(selectedAppointment.status) }}
              >
                {statusLabel(selectedAppointment.status)}
              </div>
            </div>

            {selectedAppointment.customer_name && (
              <div className="acv-detail-section">
                <h5>{t('businessAppointments.customer')}</h5>
                <div className="acv-detail-row">
                  <User size={16} />
                  <div>
                    <div className="label">{t('businessAppointments.name')}</div>
                    <div className="value">{selectedAppointment.customer_name}</div>
                  </div>
                </div>
                {selectedAppointment.customer_email && (
                  <div className="acv-detail-row">
                    <Mail size={16} />
                    <div>
                      <div className="label">{t('businessAppointments.email')}</div>
                      <div className="value">{selectedAppointment.customer_email}</div>
                    </div>
                  </div>
                )}
                {selectedAppointment.customer_phone && (
                  <div className="acv-detail-row">
                    <Phone size={16} />
                    <div>
                      <div className="label">{t('businessAppointments.phone')}</div>
                      <div className="value">{selectedAppointment.customer_phone}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedAppointment.customer_notes && (
              <div className="acv-detail-section">
                <div className="label">{t('businessAppointments.customerNotes')}</div>
                <div className="acv-notes">{selectedAppointment.customer_notes}</div>
              </div>
            )}

            {selectedAppointment.cancellation_fee_cents > 0 && (
              <div className="acv-detail-section">
                <div className="label">{t('businessAppointments.lateFee')}</div>
                <div className="value">
                  <AlertCircle size={16} /> {formatMoney(selectedAppointment.cancellation_fee_cents)}
                </div>
              </div>
            )}

            {canModify && (
              <div className="acv-detail-section">
                <div className="label">{t('businessAppointments.reassignStaff')}</div>
                <div className="acv-inline-form">
                  <select
                    value={reassignStaffId}
                    onChange={(e) => setReassignStaffId(e.target.value)}
                    disabled={staffOptions.length === 0}
                  >
                    <option value="">{t('businessAppointments.anyStaff')}</option>
                    {staffOptions.map((st) => (
                      <option key={st.id} value={st.id}>{st.name || st.id}</option>
                    ))}
                  </select>
                  <button
                    className="acv-btn acv-btn-secondary"
                    onClick={() => handleReassignStaff(selectedAppointment)}
                  >
                    {t('businessAppointments.reassign')}
                  </button>
                </div>
              </div>
            )}

            {canModify && selectedAppointment.payment_status === 'pending' && (
              <div className="acv-detail-section">
                <div className="label">
                  {t('businessAppointments.paymentDue', { amount: formatMoney(selectedAppointment.final_price_cents) })}
                </div>
                <div className="acv-inline-form">
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    {['cash', 'card', 'transfer', 'other'].map((m) => (
                      <option key={m} value={m}>{t(`businessAppointments.paymentMethods.${m}`)}</option>
                    ))}
                  </select>
                  <button
                    className="acv-btn acv-btn-secondary"
                    onClick={() => handleRecordPayment(selectedAppointment)}
                  >
                    {t('businessAppointments.recordPayment')}
                  </button>
                </div>
              </div>
            )}

            {canModify && !showReschedule && (
              <div className="acv-detail-section">
                <button
                  className="acv-btn acv-btn-secondary"
                  onClick={() => {
                    const d = new Date(selectedAppointment.start_time);
                    setRescheduleDate(d.toISOString().split('T')[0]);
                    setRescheduleTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                    setShowReschedule(true);
                  }}
                >
                  {t('businessAppointments.reschedule')}
                </button>
              </div>
            )}

            {canModify && showReschedule && (
              <div className="acv-detail-section">
                <div className="label">{t('businessAppointments.rescheduleTitle')}</div>
                <div className="acv-inline-form">
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                  />
                  <input
                    type="time"
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                  />
                </div>
                <div className="acv-detail-actions">
                  <button
                    className="acv-btn acv-btn-confirm"
                    onClick={() => handleReschedule(selectedAppointment)}
                  >
                    {t('businessAppointments.confirmReschedule')}
                  </button>
                  <button
                    className="acv-btn acv-btn-secondary"
                    onClick={() => setShowReschedule(false)}
                  >
                    {t('businessAppointments.cancel')}
                  </button>
                </div>
              </div>
            )}

            <div className="acv-detail-actions">
              {selectedAppointment.status === 'pending' && (
                <>
                  <button 
                    className="acv-btn acv-btn-confirm"
                    onClick={() => handleUpdateStatus(selectedAppointment.id, 'confirmed')}
                  >
                    {t('businessAppointments.confirm')}
                  </button>
                  <button 
                    className="acv-btn acv-btn-cancel"
                    onClick={() => handleCancel(selectedAppointment.id)}
                  >
                    {t('businessAppointments.decline')}
                  </button>
                </>
              )}
              {selectedAppointment.status === 'confirmed' && (
                <>
                  <button 
                    className="acv-btn acv-btn-confirm"
                    onClick={() => handleUpdateStatus(selectedAppointment.id, 'completed')}
                  >
                    {t('businessAppointments.complete')}
                  </button>
                  <button 
                    className="acv-btn acv-btn-cancel"
                    onClick={() => handleCancel(selectedAppointment.id)}
                  >
                    {t('businessAppointments.cancel')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
