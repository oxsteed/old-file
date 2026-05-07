import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import '../../styles/CustomerCalendarView.css';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
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

  if (mode === 'day') {
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
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (mode === 'agenda') {
    start = new Date();
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 30);
    end.setHours(23, 59, 59, 999);
  } else {
    // month
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return { start, end };
}

// Convert jobs and bookings to calendar events
function buildCalendarEvents(jobs, bookings) {
  const events = [];

  // Add jobs as events
  jobs.forEach(job => {
    if (job.scheduled_date || job.scheduled_start_at) {
      const startDate = job.scheduled_start_at
        ? new Date(job.scheduled_start_at)
        : new Date(job.scheduled_date + 'T09:00:00');

      const endDate = job.scheduled_end_at
        ? new Date(job.scheduled_end_at)
        : new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // 2 hour default

      events.push({
        id: `job-${job.id}`,
        job_id: job.id,
        type: 'job',
        title: job.title,
        scheduled_start_time: startDate.toISOString(),
        scheduled_end_time: endDate.toISOString(),
        status: job.status,
        price: job.budget_max || job.budget_min,
        helper_name: job.preferred_helper_name || 'Pending',
        category: job.category_name,
      });
    }
  });

  // Add bookings as events
  bookings.forEach(booking => {
    if (booking.scheduled_date || booking.start_time) {
      const startDate = booking.start_time
        ? new Date(booking.start_time)
        : new Date(booking.scheduled_date + 'T09:00:00');

      const endDate = booking.end_time
        ? new Date(booking.end_time)
        : new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      events.push({
        id: `booking-${booking.id}`,
        booking_id: booking.id,
        type: 'booking',
        title: booking.service_name || 'Service Request',
        scheduled_start_time: startDate.toISOString(),
        scheduled_end_time: endDate.toISOString(),
        status: booking.status,
        price: booking.price,
        helper_name: booking.helper_name || 'Pending',
        category: 'Booking',
      });
    }
  });

  return events;
}

export default function CustomerCalendarView({
  viewMode = 'month',
  selectedDate,
  onDateChange,
  onEventClick,
}) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showLoadingBar, setShowLoadingBar] = useState(false);

  const loadCalendarData = useCallback(async () => {
    setLoading(true);
    const loadingTimer = setTimeout(() => setShowLoadingBar(true), 300);

    try {
      const dateRange = getDateRange(selectedDate, viewMode);

      const [jobsResult, bookingsResult] = await Promise.allSettled([
        api.get('/jobs/me/list'),
        api.get('/bookings'),
      ]);

      const jobsData = jobsResult.status === 'fulfilled'
        ? (Array.isArray(jobsResult.value.data) ? jobsResult.value.data : jobsResult.value.data?.jobs || [])
        : [];

      const bookingsData = bookingsResult.status === 'fulfilled'
        ? (Array.isArray(bookingsResult.value.data?.data) ? bookingsResult.value.data.data : [])
        : [];

      // Filter for scheduled events only (must have date and status that indicates scheduled)
      const scheduledJobs = jobsData.filter(j => j.scheduled_date || j.scheduled_start_at);
      const scheduledBookings = bookingsData.filter(b => (b.scheduled_date || b.start_time) && b.status !== 'declined' && b.status !== 'expired');

      setJobs(scheduledJobs);
      setBookings(scheduledBookings);
      setEvents(buildCalendarEvents(scheduledJobs, scheduledBookings));

      if (jobsResult.status === 'rejected' && bookingsResult.status === 'rejected') {
        toast.error(t('calendar.errorLoading'));
      }
    } catch (err) {
      console.error('CustomerCalendarView: failed to load events', err);
      toast.error(t('calendar.errorLoading'));
      setJobs([]);
      setBookings([]);
      setEvents([]);
    } finally {
      clearTimeout(loadingTimer);
      setLoading(false);
      setShowLoadingBar(false);
    }
  }, [selectedDate, viewMode, t]);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  const navigate = (direction) => {
    const d = new Date(selectedDate);
    if (viewMode === 'day') {
      d.setDate(d.getDate() + direction);
    } else if (viewMode === 'week') {
      d.setDate(d.getDate() + direction * 7);
    } else if (viewMode === 'month') {
      d.setMonth(d.getMonth() + direction);
      const intended = d.getMonth();
      if (d.getMonth() !== ((new Date(selectedDate).getMonth() + direction + 12) % 12)) {
        d.setDate(0);
      }
    } else {
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

  const showNav = viewMode !== 'agenda';

  return (
    <div className="ccv-container">
      <div className="ccv-header">
        {showNav ? (
          <button className="ccv-nav-btn" onClick={() => navigate(-1)}>
            ← {t('calendar.previous')}
          </button>
        ) : (
          <div className="ccv-nav-placeholder" />
        )}

        <div className="ccv-header-center">
          <h2 className="ccv-date">{getHeaderLabel()}</h2>
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

      {showLoadingBar && (
        <div className="ccv-loading-bar" role="status" aria-live="polite">
          <span className="ccv-loading-spinner" aria-hidden="true">⟳</span>
          {t('common.loading')}
        </div>
      )}

      {viewMode === 'month' && (
        <MonthView
          selectedDate={selectedDate}
          events={events}
          onDateChange={onDateChange}
          onEventClick={onEventClick}
        />
      )}

      {viewMode === 'week' && (
        <WeekView
          selectedDate={selectedDate}
          events={events}
          onEventClick={onEventClick}
        />
      )}

      {viewMode === 'day' && (
        <DayView
          selectedDate={selectedDate}
          events={events}
          onEventClick={onEventClick}
        />
      )}

      {viewMode === 'agenda' && (
        <AgendaView
          events={events}
          onEventClick={onEventClick}
          t={t}
        />
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({ selectedDate, events, onDateChange, onEventClick }) {
  const { t } = useTranslation();
  const today = new Date();

  const month = selectedDate.getMonth();
  const year = selectedDate.getFullYear();
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
      <div className="ccv-month-grid">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="ccv-month-day-name">
            {t(`calendar.dayShort.${day}`)}
          </div>
        ))}
        {days.map((day, idx) => {
          const isToday = day && isSameDay(day, today);
          const isSelected = day && isSameDay(day, selectedDate);
          const dayEvents = day
            ? events.filter((evt) => {
                try {
                  const evtDate = new Date(evt.scheduled_start_time);
                  return isSameDay(evtDate, day);
                } catch {
                  return false;
                }
              })
            : [];

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
                    {dayEvents.slice(0, 3).map((evt) => (
                      <div
                        key={evt.id}
                        className={`ccv-month-event ccv-event-${evt.type} ccv-status-${evt.status}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick?.(evt);
                        }}
                        title={evt.title}
                      >
                        {evt.title.split(' ')[0]}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="ccv-month-more">+{dayEvents.length - 3}</div>
                    )}
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

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({ selectedDate, events, onEventClick }) {
  const { t } = useTranslation();
  const today = new Date();
  const scrollRef = useRef(null);

  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, nowMinutes - 60);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="ccv-time-label" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={`ccv-day-header ${isSameDay(day, today) ? 'ccv-today' : ''}`}
          >
            <div className="ccv-day-name">
              {t(`calendar.dayShort.${DAYS_OF_WEEK[day.getDay()]}`)}
            </div>
            <div className={`ccv-day-date ${isSameDay(day, today) ? 'ccv-today-circle' : ''}`}>
              {day.getDate()}
            </div>
          </div>
        ))}
      </div>

      <div className="ccv-week-body" ref={scrollRef}>
        <div className="ccv-week-grid">
          <div className="ccv-times">
            {HOURS.map((hour) => (
              <div key={hour} className="ccv-time-slot">
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`ccv-day-column${isToday ? ' ccv-day-today' : ''}`}
              >
                {isToday && (
                  <div
                    className="ccv-now-indicator"
                    style={{ top: `${nowMinutes}px` }}
                    aria-hidden="true"
                  >
                    <div className="ccv-now-dot" />
                  </div>
                )}

                {HOURS.map((hour) => {
                  const slotStart = new Date(day);
                  slotStart.setHours(hour, 0, 0, 0);
                  const slotEnd = new Date(slotStart);
                  slotEnd.setHours(hour + 1, 0, 0, 0);

                  const slotEvents = events.filter((evt) => {
                    try {
                      const evtStart = new Date(evt.scheduled_start_time);
                      const evtEnd = new Date(evt.scheduled_end_time);
                      return evtStart < slotEnd && evtEnd > slotStart;
                    } catch {
                      return false;
                    }
                  });

                  return (
                    <div key={`${day.toISOString()}-${hour}`} className="ccv-slot">
                      {slotEvents.map((evt) => {
                        try {
                          const evtStart = new Date(evt.scheduled_start_time);
                          const timeStr = evtStart.toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                          return (
                            <div
                              key={evt.id}
                              className={`ccv-event ccv-event-${evt.type} ccv-status-${evt.status}`}
                              onClick={() => onEventClick?.(evt)}
                              title={evt.title}
                            >
                              <span className="ccv-event-time">{timeStr}</span>
                              <span className="ccv-event-title">{evt.title}</span>
                              {evt.price && <span className="ccv-event-price">${evt.price}</span>}
                            </div>
                          );
                        } catch {
                          return null;
                        }
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({ selectedDate, events, onEventClick }) {
  const scrollRef = useRef(null);
  const today = new Date();
  const isToday = isSameDay(selectedDate, today);

  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (scrollRef.current && isToday) {
      scrollRef.current.scrollTop = Math.max(0, nowMinutes - 60);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ccv-day-view">
      <div className="ccv-day-title">
        {selectedDate.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </div>
      <div className="ccv-day-body" ref={scrollRef}>
        <div className="ccv-day-grid">
          <div className="ccv-times">
            {HOURS.map((hour) => (
              <div key={hour} className="ccv-time-slot">
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          <div className={`ccv-day-events${isToday ? ' ccv-day-today' : ''}`}>
            {isToday && (
              <div
                className="ccv-now-indicator"
                style={{ top: `${nowMinutes}px` }}
                aria-hidden="true"
              >
                <div className="ccv-now-dot" />
              </div>
            )}
            {HOURS.map((hour) => {
              const slotStart = new Date(selectedDate);
              slotStart.setHours(hour, 0, 0, 0);
              const slotEnd = new Date(slotStart);
              slotEnd.setHours(hour + 1, 0, 0, 0);

              const hourEvents = events.filter((evt) => {
                try {
                  const evtStart = new Date(evt.scheduled_start_time);
                  const evtEnd = new Date(evt.scheduled_end_time);
                  return evtStart < slotEnd && evtEnd > slotStart;
                } catch {
                  return false;
                }
              });

              return (
                <div key={`slot-${hour}`} className="ccv-slot">
                  {hourEvents.map((evt) => {
                    try {
                      const evtStart = new Date(evt.scheduled_start_time);
                      const timeStr = evtStart.toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      return (
                        <div
                          key={evt.id}
                          className={`ccv-event ccv-event-${evt.type} ccv-status-${evt.status}`}
                          onClick={() => onEventClick?.(evt)}
                          title={evt.title}
                        >
                          <span className="ccv-event-time">{timeStr}</span>
                          <span className="ccv-event-title">{evt.title}</span>
                          {evt.price && <span className="ccv-event-price">${evt.price}</span>}
                        </div>
                      );
                    } catch {
                      return null;
                    }
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Agenda View ──────────────────────────────────────────────────────────────

function AgendaView({ events, onEventClick, t }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sorted = [...events]
    .filter((evt) => {
      try {
        const d = new Date(evt.scheduled_start_time);
        return !isNaN(d) && d >= today;
      } catch {
        return false;
      }
    })
    .sort((a, b) => new Date(a.scheduled_start_time) - new Date(b.scheduled_start_time));

  if (sorted.length === 0) {
    return (
      <div className="ccv-agenda-empty">
        <div className="ccv-agenda-empty-icon" aria-hidden="true">📅</div>
        <p className="ccv-agenda-empty-title">
          {t('calendar.noUpcomingAppointments', { defaultValue: 'No upcoming appointments' })}
        </p>
        <p className="ccv-agenda-empty-sub">
          {t('calendar.agendaEmptySub', { defaultValue: 'Your confirmed appointments will appear here.' })}
        </p>
      </div>
    );
  }

  const groups = [];
  let currentKey = null;
  for (const evt of sorted) {
    try {
      const d = new Date(evt.scheduled_start_time);
      const key = d.toDateString();
      if (key !== currentKey) {
        groups.push({ key, date: d, items: [] });
        currentKey = key;
      }
      groups[groups.length - 1].items.push(evt);
    } catch {
      // skip invalid dates
    }
  }

  const STATUS_COLORS = {
    open: '#10b981',
    published: '#10b981',
    matched: '#10b981',
    pending: '#eab308',
    accepted: '#f97316',
    in_progress: '#f59e0b',
    completed: '#6b7280',
    cancelled: '#9ca3af',
  };

  return (
    <div className="ccv-agenda-view">
      {groups.map(({ key, date, items }) => {
        const isToday = isSameDay(date, new Date());
        return (
          <div key={key} className="ccv-agenda-group">
            <div className={`ccv-agenda-date-header ${isToday ? 'ccv-agenda-today' : ''}`}>
              {isToday
                ? t('calendar.today', { defaultValue: 'Today' })
                : date.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
            </div>
            {items.map((evt) => {
              try {
                const start = new Date(evt.scheduled_start_time);
                const end = evt.scheduled_end_time ? new Date(evt.scheduled_end_time) : null;
                const color = STATUS_COLORS[evt.status] || '#6b7280';
                return (
                  <button
                    key={evt.id}
                    className={`ccv-agenda-event ccv-event-${evt.type}`}
                    onClick={() => onEventClick?.(evt)}
                    style={{ borderLeftColor: color }}
                  >
                    <div className="ccv-agenda-event-time">
                      {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      {end && (
                        <>
                          {' – '}
                          {end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </>
                      )}
                    </div>
                    <div className="ccv-agenda-event-details">
                      <p className="ccv-agenda-event-title">{evt.title}</p>
                      <p className="ccv-agenda-event-meta">
                        {evt.helper_name}{evt.price && ` · $${evt.price}`}
                      </p>
                    </div>
                  </button>
                );
              } catch {
                return null;
              }
            })}
          </div>
        );
      })}
    </div>
  );
}

export default CustomerCalendarView;
