import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import AppointmentDetailModal from './AppointmentDetailModal';
import CreateAppointmentModal from './CreateAppointmentModal';
import { calendarAppointmentStatusKey } from '../../utils/calendarI18n';
import '../../styles/CustomerCalendarView.css';

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getDateRange(date, mode) {
  const d = new Date(date);
  let start, end;
  if (mode === 'agenda') {
    start = new Date(d);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 30);
    end.setHours(23, 59, 59, 999);
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
    end.setDate(start.getDate() + 6); // 7 days total (0–6)
    end.setHours(23, 59, 59, 999);
  } else {
    // month
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  }
  return { start, end };
}

export default function CustomerCalendarView({ viewMode, selectedDate, onDateChange }) {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState([]);
  // FIX #1: was useState(true) which blocked the entire render until the API
  // returned. Now starts false so the calendar grid appears immediately;
  // a thin loading bar signals in-flight data.
  const [loading, setLoading] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const dateRange = getDateRange(selectedDate, viewMode);
      const res = await api.get('/calendar/appointments', {
        params: {
          role: 'customer',
          from_date: dateRange.start.toISOString(),
          to_date: dateRange.end.toISOString(),
          status: filterStatus === 'all' ? undefined : filterStatus,
          limit: 100,
        },
      });
      setAppointments(
        Array.isArray(res.data?.appointments) ? res.data.appointments : []
      );
    } catch {
      toast.error(t('calendar.errorLoading'));
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, viewMode, filterStatus, t]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // FIX #5: unified navigation — mirrors the one in HelperCalendarView.
  const navigate = (direction) => {
    const d = new Date(selectedDate);
    if (viewMode === 'day') {
      d.setDate(d.getDate() + direction);
    } else if (viewMode === 'week') {
      d.setDate(d.getDate() + direction * 7);
    } else if (viewMode === 'month') {
      d.setMonth(d.getMonth() + direction);
    } else {
      // agenda: page by 30 days
      d.setDate(d.getDate() + direction * 30);
    }
    onDateChange(d);
  };

  const getHeaderLabel = () => {
    const d = selectedDate;
    if (viewMode === 'day') {
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    if (viewMode === 'week') {
      const dow = d.getDay();
      const ws = new Date(d);
      ws.setDate(d.getDate() - dow);
      ws.setHours(0, 0, 0, 0);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      const opts = { month: 'short', day: 'numeric' };
      return `${ws.toLocaleDateString(undefined, opts)} – ${we.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
    }
    if (viewMode === 'agenda') {
      return t('calendar.agenda', { defaultValue: 'Agenda' });
    }
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };

  // Agenda view is always "next 30 days" — no prev/next needed.
  const showNav = viewMode !== 'agenda';

  const upcomingAppointments = appointments.filter((apt) => {
    if (!apt?.scheduled_start_time) return false;
    try {
      const aptDate = new Date(apt.scheduled_start_time);
      return !isNaN(aptDate) && aptDate >= new Date();
    } catch { return false; }
  });

  const pastAppointments = appointments.filter((apt) => {
    if (!apt?.scheduled_start_time) return false;
    try {
      const aptDate = new Date(apt.scheduled_start_time);
      return !isNaN(aptDate) && aptDate < new Date();
    } catch { return false; }
  });

  return (
    <div className="ccv-container">

      {/* FIX #2 + #5: single unified nav header — replaces the duplicate internal
          MonthView nav and adds the missing Today button for all customer views. */}
      <div className="ccv-nav-header">
        {showNav ? (
          <button className="ccv-nav-btn" onClick={() => navigate(-1)}>
            ← {t('calendar.previous')}
          </button>
        ) : (
          <div className="ccv-nav-placeholder" />
        )}

        <div className="ccv-nav-center">
          <h2 className="ccv-nav-label">{getHeaderLabel()}</h2>
          <button
            className="ccv-today-btn"
            onClick={() => onDateChange(new Date())}
          >
            {t('calendar.today', { defaultValue: 'Today' })}
          </button>
        </div>

        {showNav ? (
          <button className="ccv-nav-btn" onClick={() => navigate(1)}>
            {t('calendar.next')} →
          </button>
        ) : (
          <div className="ccv-nav-placeholder" />
        )}
      </div>

      {/* Thin inline loading bar — never blocks view rendering. */}
      {loading && (
        <div className="ccv-loading-bar" role="status" aria-live="polite">
          {t('common.loading')}
        </div>
      )}

      <div className="ccv-actions">
        <button className="ccv-create-btn" onClick={() => setShowCreateModal(true)}>
          + {t('calendar.requestAppointment')}
        </button>
        <div className="ccv-filters">
          {['all', 'requested', 'confirmed', 'completed'].map((status) => (
            <button
              key={status}
              className={`ccv-filter-btn ${filterStatus === status ? 'active' : ''}`}
              onClick={() => setFilterStatus(status)}
            >
              {status === 'all'
                ? t('calendar.filterAll')
                : t(calendarAppointmentStatusKey(status))}
            </button>
          ))}
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

// ─── Agenda View ──────────────────────────────────────────────────────────────
// FIX #3: improved empty state with sub-copy so users understand what will appear.

function AgendaView({ upcomingAppointments, pastAppointments, onSelectAppointment }) {
  const { t } = useTranslation();

  return (
    <div className="ccv-agenda-view">
      <div className="ccv-section">
        <h2 className="ccv-section-title">{t('calendar.upcomingAppointments')}</h2>
        {upcomingAppointments.length === 0 ? (
          <div className="ccv-empty-state">
            <div className="ccv-empty-icon" aria-hidden="true">📅</div>
            <p className="ccv-empty-title">{t('calendar.noUpcomingAppointments')}</p>
            <p className="ccv-empty-sub">
              {t('calendar.agendaEmptySub', {
                defaultValue: 'Jobs you accept will appear here.',
              })}
            </p>
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
                isPast
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────
// FIX #6: today's date now highlighted with a circle, matching HelperCalendarView.

function WeekView({ selectedDate, appointments, onDateChange, onSelectAppointment }) {
  const { t } = useTranslation();
  const today = new Date();

  const dayOfWeek = selectedDate.getDay();
  const weekStart = new Date(selectedDate);
  weekStart.setDate(selectedDate.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="ccv-week-view">
      <div className="ccv-week-header">
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`ccv-day-header ${isToday ? 'ccv-today' : ''}`}
              onClick={() => onDateChange(day)}
              style={{ cursor: 'pointer' }}
            >
              <div className="ccv-day-name">
                {t(`calendar.dayShort.${DAYS_OF_WEEK[day.getDay()]}`)}
              </div>
              <div className={`ccv-day-date ${isToday ? 'ccv-today-circle' : ''}`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ccv-week-grid">
        {days.map((day) => {
          const dayAppts = appointments.filter((apt) => {
            if (!apt?.scheduled_start_time) return false;
            const aptDate = new Date(apt.scheduled_start_time);
            return !isNaN(aptDate) && isSameDay(aptDate, day);
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
                        minute: '2-digit',
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

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({ selectedDate, appointments, onSelectAppointment }) {
  const { t } = useTranslation();

  const dayAppointments = appointments.filter((apt) => {
    if (!apt?.scheduled_start_time) return false;
    const aptDate = new Date(apt.scheduled_start_time);
    return !isNaN(aptDate) && isSameDay(aptDate, selectedDate);
  });

  return (
    <div className="ccv-day-view">
      <div className="ccv-day-title">
        {selectedDate.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </div>
      {dayAppointments.length === 0 ? (
        <div className="ccv-empty-state">
          <p>{t('calendar.noAppointmentsDay')}</p>
        </div>
      ) : (
        <div className="ccv-day-list">
          {dayAppointments.map((apt) => (
            <AppointmentCard key={apt.id} appointment={apt} onSelect={onSelectAppointment} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────
// FIX #2: removed internal useState(month/year) and the duplicate ← Prev/Next → buttons.
// The view now derives month/year purely from selectedDate; navigation lives in the
// shared nav header above, driven by onDateChange from the parent.
//
// FIX #6: today's date gets a highlighted circle, selected date gets a tint.

function MonthView({ selectedDate, appointments, onDateChange }) {
  const { t } = useTranslation();
  const today = new Date();

  const month = selectedDate.getMonth();
  const year = selectedDate.getFullYear();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));

  return (
    <div className="ccv-month-view">
      <div className="ccv-month-grid">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="ccv-month-day-name">
            {t(`calendar.dayShort.${day}`)}
          </div>
        ))}
        {days.map((day, idx) => {
          const isToday = day && isSameDay(day, today);
          const isSelected = day && isSameDay(day, selectedDate);
          return (
            <div
              key={idx}
              className={[
                'ccv-month-day',
                day ? 'active' : 'empty',
                isToday ? 'ccv-month-today' : '',
                isSelected && !isToday ? 'ccv-month-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => day && onDateChange(day)}
            >
              {day && (
                <>
                  <div className={`ccv-month-day-number ${isToday ? 'ccv-today-circle' : ''}`}>
                    {day.getDate()}
                  </div>
                  <div className="ccv-month-day-events">
                    {appointments
                      .filter((apt) => {
                        if (!apt?.scheduled_start_time) return false;
                        const aptDate = new Date(apt.scheduled_start_time);
                        return !isNaN(aptDate) && isSameDay(aptDate, day);
                      })
                      .slice(0, 2)
                      .map((apt) => (
                        <div
                          key={apt.id}
                          className={`ccv-month-event ccv-apt-${apt.status || 'pending'}`}
                        >
                          {(apt.helper_name || 'Unknown').split(' ')[0]}
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Appointment Card ─────────────────────────────────────────────────────────

function AppointmentCard({ appointment, onSelect, isPast }) {
  const { t } = useTranslation();
  const startTime = new Date(appointment.scheduled_start_time);
  const endTime = appointment.scheduled_end_time
    ? new Date(appointment.scheduled_end_time)
    : null;

  return (
    <div
      className={`ccv-appt-card ccv-apt-${appointment.status} ${isPast ? 'past' : ''}`}
      onClick={() => onSelect(appointment)}
    >
      <div className="ccv-appt-header">
        <div className="ccv-appt-time">
          {startTime.toLocaleDateString()}{' '}
          {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className={`ccv-appt-status ccv-status-${appointment.status}`}>
          {t(calendarAppointmentStatusKey(appointment.status))}
        </div>
      </div>
      <div className="ccv-appt-details">
        <div className="ccv-appt-helper">
          {appointment.helper_avatar && (
            <img src={appointment.helper_avatar} alt="" />
          )}
          <span>{appointment.helper_name}</span>
        </div>
        <div className="ccv-appt-service">{appointment.service_description}</div>
        {appointment.location_address && (
          <div className="ccv-appt-location">📍 {appointment.location_address}</div>
        )}
      </div>
      {endTime && (
        <div className="ccv-appt-duration">
          {Math.round((endTime - startTime) / (1000 * 60))} {t('calendar.minutes')}
        </div>
      )}
    </div>
  );
}
