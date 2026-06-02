import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Clock, User, Phone, Mail, AlertCircle } from 'lucide-react';
import '../../styles/AppointmentCalendarView.css';

export function AppointmentCalendarView({ businessId }) {
  const [appointments, setAppointments] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month'); // 'month', 'week', 'day'
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all', 'pending', 'confirmed', 'completed', 'cancelled'

  useEffect(() => {
    loadAppointments();
  }, [businessId, currentDate]);

  const loadAppointments = async () => {
    try {
      setLoading(true);
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      const response = await api.get(`/businesses/${businessId}/appointments`, {
        params: {
          status: filter === 'all' ? undefined : filter,
          startDate: startOfMonth.toISOString().split('T')[0],
          endDate: endOfMonth.toISOString().split('T')[0]
        }
      });

      setAppointments(response.data.appointments || []);
    } catch (error) {
      toast.error('Failed to load appointments');
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
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (timeStr) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

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
      toast.success(`Appointment ${newStatus}`);
      loadAppointments();
    } catch (error) {
      toast.error('Failed to update appointment');
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
                {formatTime(apt.start_time.split('T')[1])}
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

  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="acv-container">
      <div className="acv-header">
        <h3>Appointment Calendar</h3>
        <div className="acv-header-controls">
          <div className="acv-filter-buttons">
            {['all', 'pending', 'confirmed', 'completed', 'cancelled'].map(status => (
              <button
                key={status}
                className={`acv-filter-btn ${filter === status ? 'active' : ''}`}
                onClick={() => setFilter(status)}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
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
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="acv-weekday">{day}</div>
          ))}
        </div>

        <div className="acv-days-grid">
          {renderCalendarDays()}
        </div>
      </div>

      {selectedAppointment && (
        <div className="acv-detail-panel">
          <div className="acv-detail-header">
            <h4>Appointment Details</h4>
            <button onClick={() => setSelectedAppointment(null)} className="acv-detail-close">×</button>
          </div>

          <div className="acv-detail-content">
            <div className="acv-detail-section">
              <h5>{selectedAppointment.service_name}</h5>
              <div className="acv-detail-row">
                <Clock size={16} />
                <div>
                  <div className="label">Date & Time</div>
                  <div className="value">
                    {formatDate(selectedAppointment.start_time)} at {formatTime(selectedAppointment.start_time.split('T')[1])}
                  </div>
                </div>
              </div>
            </div>

            <div className="acv-detail-section">
              <div className="label">Status</div>
              <div 
                className="acv-status-badge"
                style={{ backgroundColor: getStatusColor(selectedAppointment.status) }}
              >
                {selectedAppointment.status}
              </div>
            </div>

            {selectedAppointment.customer_name && (
              <div className="acv-detail-section">
                <h5>Customer</h5>
                <div className="acv-detail-row">
                  <User size={16} />
                  <div>
                    <div className="label">Name</div>
                    <div className="value">{selectedAppointment.customer_name}</div>
                  </div>
                </div>
                {selectedAppointment.customer_email && (
                  <div className="acv-detail-row">
                    <Mail size={16} />
                    <div>
                      <div className="label">Email</div>
                      <div className="value">{selectedAppointment.customer_email}</div>
                    </div>
                  </div>
                )}
                {selectedAppointment.customer_phone && (
                  <div className="acv-detail-row">
                    <Phone size={16} />
                    <div>
                      <div className="label">Phone</div>
                      <div className="value">{selectedAppointment.customer_phone}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedAppointment.customer_notes && (
              <div className="acv-detail-section">
                <div className="label">Customer Notes</div>
                <div className="acv-notes">{selectedAppointment.customer_notes}</div>
              </div>
            )}

            <div className="acv-detail-actions">
              {selectedAppointment.status === 'pending' && (
                <>
                  <button 
                    className="acv-btn acv-btn-confirm"
                    onClick={() => handleUpdateStatus(selectedAppointment.id, 'confirmed')}
                  >
                    Confirm
                  </button>
                  <button 
                    className="acv-btn acv-btn-cancel"
                    onClick={() => handleUpdateStatus(selectedAppointment.id, 'cancelled')}
                  >
                    Decline
                  </button>
                </>
              )}
              {selectedAppointment.status === 'confirmed' && (
                <>
                  <button 
                    className="acv-btn acv-btn-confirm"
                    onClick={() => handleUpdateStatus(selectedAppointment.id, 'completed')}
                  >
                    Complete
                  </button>
                  <button 
                    className="acv-btn acv-btn-cancel"
                    onClick={() => handleUpdateStatus(selectedAppointment.id, 'cancelled')}
                  >
                    Cancel
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
