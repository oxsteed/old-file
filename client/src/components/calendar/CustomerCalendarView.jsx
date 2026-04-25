import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import AppointmentDetailModal from './AppointmentDetailModal';
import CreateAppointmentModal from './CreateAppointmentModal';
import '../../styles/CustomerCalendarView.css';

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export default function CustomerCalendarView({ viewMode, selectedDate, onDateChange }) {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    loadAppointments();
  }, [selectedDate, viewMode, filterStatus]);

  const loadAppointments = async () => {
    try {
      setLoading(true);
      const dateRange = getDateRange(selectedDate, viewMode);

      const res = await api.get('/calendar/appointments', {
        params: {
          role: 'customer',
          from_date: dateRange.start.toISOString(),
          to_date: dateRange.end.toISOString(),
          status: filterStatus === 'all' ? undefined : filterStatus,
          limit: 100
        }
      });

      setAppointments(res.data.appointments);
    } catch (err) {
      toast.error(t('calendar.errorLoading'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getDateRange = (date, mode) => {
    const d = new Date(date);
    let start, end;

    if (mode === 'agenda') {
      // Agenda: next 30 days
      start = new Date(d);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 30);
    } else if (mode === 'day') {
      start = new Date(d);
      start.setHours(0, 0, 0, 0);
      end = new Date(d);
      end.setHours(23, 59, 59, 999);
    } else if (mode === 'week') {
      const dayOfWeek = d.getDay();
      start = new Date(d);
      start.setDate(d.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 7);
    } else {
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    return { start, end };
  };

  const upcomingAppointments = appointments.filter(
    (apt) => new Date(apt.scheduled_start_time) >= new Date()
  );

  const pastAppointments = appointments.filter(
    (apt) => new Date(apt.scheduled_start_time) < new Date()
  );

  if (loading) {
    return <div className="ccv-loading">{t('common.loading')}</div>;
  }

  return (
    <div className="ccv-container">
      <div className="ccv-actions">
        <button
          className="ccv-create-btn"
          onClick={() => setShowCreateModal(true)}
        >
          + {t('calendar.requestAppointment')}
        </button>
        <div className="ccv-filters">
          <button
            className={`ccv-filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            {t('calendar.filterAll')}
          </button>
          <button
            className={`ccv-filter-btn ${filterStatus === 'requested' ? 'active' : ''}`}
            onClick={() => setFilterStatus('requested')}
          >
            {t('calendar.statusRequested')}
          </button>
          <button
            className={`ccv-filter-btn ${filterStatus === 'confirmed' ? 'active' : ''}`}
            onClick={() => setFilterStatus('confirmed')}
          >
            {t('calendar.statusConfirmed')}
          </button>
          <button
            className={`ccv-filter-btn ${filterStatus === 'completed' ? 'active' : ''}`}
            onClick={() => setFilterStatus('completed')}
          >
            {t('calendar.statusCompleted')}
          </button>
        </div>
      </div>

      {viewMode === 'agenda' && (
        <AgendaView
          upcomingAppointments={upcomingAppointments}
          pastAppointments={pastAppointments}
          onSelectAppointment={setSelectedAppointment}
        />
      )}

      {viewMode === 'month' && (
        <MonthView
          selectedDate={selectedDate}
          appointments={appointments}
          onDateChange={onDateChange}
        />
      )}

      {viewMode === 'week' && (
        <WeekView
          selectedDate={selectedDate}
          appointments={appointments}
          onDateChange={onDateChange}
          onSelectAppointment={setSelectedAppointment}
        />
      )}

      {viewMode === 'day' && (
        <DayView
          selectedDate={selectedDate}
          appointments={appointments}
          onSelectAppointment={setSelectedAppointment}
        />
      )}

      {selectedAppointment && (
        <AppointmentDetailModal
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onUpdate={loadAppointments}
          isCustomer={true}
        />
      )}

      {showCreateModal && (
        <CreateAppointmentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadAppointments();
            toast.success(t('calendar.appointmentRequested'));
          }}
        />
      )}
    </div>
  );
}

function AgendaView({ upcomingAppointments, pastAppointments, onSelectAppointment }) {
  const { t } = useTranslation();

  return (
    <div className="ccv-agenda-view">
      <div className="ccv-section">
        <h2 className="ccv-section-title">{t('calendar.upcomingAppointments')}</h2>
        {upcomingAppointments.length === 0 ? (
          <div className="ccv-empty-state">
            <p>{t('calendar.noUpcomingAppointments')}</p>
          </div>
        ) : (
          <div className="ccv-appointment-list">
            {upcomingAppointments.map((apt) => (
              <AppointmentCard
                key={apt.id}
                appointment={apt}
                onSelect={onSelectAppointment}
              />
            ))}
          </div>
        )}
      </div>

      {pastAppointments.length > 0 && (
        <div className="ccv-section">
          <h2 className="ccv-section-title">{t('calendar.pastAppointments')}</h2>
          <div className="ccv-appointment-list">
            {pastAppointments.map((apt) => (
              <AppointmentCard
                key={apt.id}
                appointment={apt}
                onSelect={onSelectAppointment}
                isPast={true}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekView({ selectedDate, appointments, onDateChange, onSelectAppointment }) {
  const { t } = useTranslation();
  const [weekStart, setWeekStart] = useState(getWeekStart(selectedDate));

  useEffect(() => {
    setWeekStart(getWeekStart(selectedDate));
  }, [selectedDate]);

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="ccv-week-view">
      <div className="ccv-week-header">
        {days.map((day) => (
          <div key={day.toISOString()} className="ccv-day-header">
            <div className="ccv-day-name">
              {t(`calendar.dayShort.${DAYS_OF_WEEK[day.getDay()]}`)}
            </div>
            <div className="ccv-day-date">{day.getDate()}</div>
          </div>
        ))}
      </div>

      <div className="ccv-week-grid">
        {days.map((day) => {
          const dayAppts = appointments.filter((apt) => {
            const aptDate = new Date(apt.scheduled_start_time);
            return aptDate.toDateString() === day.toDateString();
          });

          return (
            <div key={day.toISOString()} className="ccv-day-column">
              {dayAppts.length === 0 ? (
                <div className="ccv-empty-day">{t('calendar.noAppointments')}</div>
              ) : (
                dayAppts.map((apt) => (
                  <div
                    key={apt.id}
                    className={`ccv-appointment-card ccv-apt-${apt.status}`}
                    onClick={() => onSelectAppointment(apt)}
                  >
                    <div className="ccv-apt-time">
                      {new Date(apt.scheduled_start_time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                    <div className="ccv-apt-helper">{apt.helper_name}</div>
                    <div className="ccv-apt-service">{apt.service_description}</div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ selectedDate, appointments, onSelectAppointment }) {
  const { t } = useTranslation();

  const dayAppointments = appointments.filter((apt) => {
    const aptDate = new Date(apt.scheduled_start_time);
    return aptDate.toDateString() === selectedDate.toDateString();
  });

  return (
    <div className="ccv-day-view">
      <div className="ccv-day-title">
        {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      {dayAppointments.length === 0 ? (
        <div className="ccv-empty-state">
          <p>{t('calendar.noAppointmentsDay')}</p>
        </div>
      ) : (
        <div className="ccv-day-list">
          {dayAppointments.map((apt) => (
            <AppointmentCard
              key={apt.id}
              appointment={apt}
              onSelect={onSelectAppointment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthView({ selectedDate, appointments, onDateChange }) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(selectedDate.getMonth());
  const [year, setYear] = useState(selectedDate.getFullYear());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const days = [];

  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }

  return (
    <div className="ccv-month-view">
      <div className="ccv-month-header">
        <button onClick={() => {
          if (month === 0) {
            setMonth(11);
            setYear(year - 1);
          } else {
            setMonth(month - 1);
          }
        }}>
          ← {t('calendar.previous')}
        </button>
        <h3>{new Date(year, month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <button onClick={() => {
          if (month === 11) {
            setMonth(0);
            setYear(year + 1);
          } else {
            setMonth(month + 1);
          }
        }}>
          {t('calendar.next')} →
        </button>
      </div>

      <div className="ccv-month-grid">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="ccv-month-day-name">
            {t(`calendar.dayShort.${day}`)}
          </div>
        ))}
        {days.map((day, idx) => (
          <div
            key={idx}
            className={`ccv-month-day ${day ? 'active' : 'empty'}`}
            onClick={() => day && onDateChange(day)}
          >
            {day && (
              <>
                <div className="ccv-month-day-number">{day.getDate()}</div>
                <div className="ccv-month-day-events">
                  {appointments
                    .filter((apt) => {
                      const aptDate = new Date(apt.scheduled_start_time);
                      return aptDate.toDateString() === day.toDateString();
                    })
                    .slice(0, 2)
                    .map((apt) => (
                      <div key={apt.id} className={`ccv-month-event ccv-apt-${apt.status}`}>
                        {apt.helper_name.split(' ')[0]}
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AppointmentCard({ appointment, onSelect, isPast }) {
  const { t } = useTranslation();
  const startTime = new Date(appointment.scheduled_start_time);
  const endTime = new Date(appointment.scheduled_end_time);

  return (
    <div
      className={`ccv-appt-card ccv-apt-${appointment.status} ${isPast ? 'past' : ''}`}
      onClick={() => onSelect(appointment)}
    >
      <div className="ccv-appt-header">
        <div className="ccv-appt-time">
          {startTime.toLocaleDateString()} {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className={`ccv-appt-status ccv-status-${appointment.status}`}>
          {t(`calendar.status${appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}`)}
        </div>
      </div>
      <div className="ccv-appt-details">
        <div className="ccv-appt-helper">
          {appointment.helper_avatar && <img src={appointment.helper_avatar} alt="" />}
          <span>{appointment.helper_name}</span>
        </div>
        <div className="ccv-appt-service">{appointment.service_description}</div>
        {appointment.location_address && (
          <div className="ccv-appt-location">📍 {appointment.location_address}</div>
        )}
      </div>
      <div className="ccv-appt-duration">
        {Math.round((endTime - startTime) / (1000 * 60))} {t('calendar.minutes')}
      </div>
    </div>
  );
}
