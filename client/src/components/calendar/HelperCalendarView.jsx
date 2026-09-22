import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import AppointmentDetailModal from './AppointmentDetailModal';
import AvailabilityBlockModal from './AvailabilityBlockModal';
import BookingRequestsPanel from './BookingRequestsPanel';
import { useSocket } from '../../hooks/useSocket';
import { calendarAppointmentStatusKey } from '../../utils/calendarI18n';
import '../../styles/HelperCalendarView.css';

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
    // Show next 30 days from today
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

export default function HelperCalendarView({
  viewMode,
  selectedDate,
  onDateChange,
  blockModalRequest = false,
  onBlockModalRequestHandled,
}) {
  const { t } = useTranslation();
  const { socket } = useSocket();
  const [appointments, setAppointments] = useState([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState([]);
  // Start with false so the calendar is immediately visible; data loads async
  const [loading, setLoading] = useState(false);
  const [showLoadingBar, setShowLoadingBar] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // Respond to sidebar "+ Block Time" button from parent
  useEffect(() => {
    if (blockModalRequest) {
      setSelectedTimeSlot(null);
      setShowAvailabilityModal(true);
      onBlockModalRequestHandled?.();
    }
  }, [blockModalRequest, onBlockModalRequestHandled]);

  const loadCalendarData = useCallback(async () => {
    setLoading(true);
    // Delay showing the loading bar to avoid flashing for quick loads (< 300ms)
    const loadingTimer = setTimeout(() => setShowLoadingBar(true), 300);

    try {
      const dateRange = getDateRange(selectedDate, viewMode);

      // Use allSettled so one failing endpoint doesn't blank the whole view
      const [apptsResult, availResult] = await Promise.allSettled([
        api.get('/calendar/appointments', {
          params: {
            role: 'helper',
            from_date: dateRange.start.toISOString(),
            to_date: dateRange.end.toISOString(),
            limit: 100,
          },
        }),
        api.get('/calendar/availability/mine', {
          params: {
            from_date: dateRange.start.toISOString(),
            to_date: dateRange.end.toISOString(),
            limit: 100,
          },
        }),
      ]);

      setAppointments(
        apptsResult.status === 'fulfilled' && Array.isArray(apptsResult.value.data?.appointments)
          ? apptsResult.value.data.appointments
          : []
      );

      // Handle both 'blocks' and 'availability' keys for compatibility
      const blocksData = availResult.status === 'fulfilled'
        ? (availResult.value.data?.blocks || availResult.value.data?.availability || [])
        : [];

      setAvailabilityBlocks(Array.isArray(blocksData) ? blocksData : []);

      // Only toast if both calls failed
      if (apptsResult.status === 'rejected' && availResult.status === 'rejected') {
        toast.error(t('calendar.errorLoading'));
      }
    } catch (err) {
      toast.error(t('calendar.errorLoading'));
      setAppointments([]);
      setAvailabilityBlocks([]);
    } finally {
      clearTimeout(loadingTimer);
      setLoading(false);
      setShowLoadingBar(false);
    }
  }, [selectedDate, viewMode, t]);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  // Listen for job cancellations and remove from calendar
  useEffect(() => {
    if (!socket?.connected) return;

    const handleJobCancelled = (data) => {
      // Remove cancelled appointment from calendar
      setAppointments((prevAppointments) => {
        const filtered = prevAppointments.filter(apt => apt.job_id !== data.jobId);

        if (filtered.length < prevAppointments.length) {
          toast.success(t('calendar.jobCancelled') || 'Job cancelled. Your time is now free.');
        }

        return filtered;
      });
    };

    socket.on('job:cancelled', handleJobCancelled);

    return () => {
      socket.off('job:cancelled', handleJobCancelled);
    };
  }, [socket, t]);

  const handleBlockTimeClick = (date, hour) => {
    setSelectedTimeSlot({ date, hour });
    setShowAvailabilityModal(true);
  };

  const handleAvailabilityCreated = () => {
    setShowAvailabilityModal(false);
    setSelectedTimeSlot(null);
    loadCalendarData();
    toast.success(t('calendar.availabilityCreated'));
  };

  // Navigate by the right unit for each view
  const navigate = (direction) => {
    const d = new Date(selectedDate);
    if (viewMode === 'day') {
      d.setDate(d.getDate() + direction);
    } else if (viewMode === 'week') {
      d.setDate(d.getDate() + direction * 7);
    } else if (viewMode === 'month') {
      d.setMonth(d.getMonth() + direction);
      // Keep day in range (e.g. Jan 31 → Feb 28)
      const intended = d.getMonth();
      if (d.getMonth() !== ((new Date(selectedDate).getMonth() + direction + 12) % 12)) {
        d.setDate(0);
      }
    } else {
      // agenda: 30-day pages
      d.setDate(d.getDate() + direction * 30);
    }
    onDateChange(d);
  };

  // Header label varies by view
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
    // month
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };

  // Hide prev/next nav for agenda (it's always "next 30 days")
  const showNav = viewMode !== 'agenda';

  return (
    <div className="hcv-container">
      <div className="hcv-header">
        {showNav ? (
          <button className="hcv-nav-btn" onClick={() => navigate(-1)}>
            ← {t('calendar.previous')}
          </button>
        ) : (
          <div className="hcv-nav-placeholder" />
        )}

        <div className="hcv-header-center">
          <h2 className="hcv-date">{getHeaderLabel()}</h2>
          <button
            className="hcv-today-btn"
            onClick={() => onDateChange(new Date())}
          >
            {t('calendar.today', { defaultValue: 'Today' })}
          </button>
        </div>

        {showNav ? (
          <button className="hcv-nav-btn" onClick={() => navigate(1)}>
            {t('calendar.next')} →
          </button>
        ) : (
          <div className="hcv-nav-placeholder" />
        )}
      </div>

      {showLoadingBar && (
        <div className="hcv-loading-bar" role="status" aria-live="polite">
          <span className="hcv-loading-spinner" aria-hidden="true">⟳</span>
          {t('common.loading')}
        </div>
      )}

      {/* Show booking requests panel above calendar (when not in booking-requests view) */}
      {viewMode !== 'booking-requests' && (
        <BookingRequestsPanel
          compact={true}
          onBookingConfirmed={loadCalendarData}
        />
      )}

      {viewMode === 'week' && (
        <>
          <WeekView
            appointments={appointments}
            availabilityBlocks={availabilityBlocks}
            selectedDate={selectedDate}
            onBlockTime={handleBlockTimeClick}
            onSelectAppointment={setSelectedAppointment}
          />
          <p className="hcv-slot-hint">
            {t('calendar.slotHint', { defaultValue: 'Click any time slot to set your availability or block time.' })}
          </p>
        </>
      )}

      {viewMode === 'day' && (
        <>
          <DayView
            appointments={appointments}
            availabilityBlocks={availabilityBlocks}
            selectedDate={selectedDate}
            onBlockTime={handleBlockTimeClick}
            onSelectAppointment={setSelectedAppointment}
          />
          <p className="hcv-slot-hint">
            {t('calendar.slotHint', { defaultValue: 'Click any time slot to set your availability or block time.' })}
          </p>
        </>
      )}

      {viewMode === 'month' && (
        <MonthView
          selectedDate={selectedDate}
          appointments={appointments}
          onDateChange={onDateChange}
        />
      )}

        {viewMode === 'booking-requests' && (
        <BookingRequestsView
          onBookingConfirmed={loadCalendarData}
        />
      )}

      {viewMode === 'agenda' && (
        <AgendaView
          appointments={appointments}
          onSelectAppointment={setSelectedAppointment}
          t={t}
        />
      )}

      {selectedAppointment && (
        <AppointmentDetailModal
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onUpdate={loadCalendarData}
        />
      )}

      {showAvailabilityModal && (
        <AvailabilityBlockModal
          initialDate={selectedTimeSlot?.date}
          initialHour={selectedTimeSlot?.hour}
          onClose={() => setShowAvailabilityModal(false)}
          onCreated={handleAvailabilityCreated}
        />
      )}
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({ appointments, availabilityBlocks, selectedDate, onBlockTime, onSelectAppointment }) {
  const { t } = useTranslation();
  const today = new Date();
  const scrollRef = useRef(null);

  // Live "minutes since midnight" for the now indicator
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

  // Auto-scroll to current time on mount (show 1 hour before now)
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
    <div className="hcv-week-view">
      <div className="hcv-week-header">
        <div className="hcv-time-label" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={`hcv-day-header ${isSameDay(day, today) ? 'hcv-today' : ''}`}
          >
            <div className="hcv-day-name">
              {t(`calendar.dayShort.${DAYS_OF_WEEK[day.getDay()]}`)}
            </div>
            <div className={`hcv-day-date ${isSameDay(day, today) ? 'hcv-today-circle' : ''}`}>
              {day.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Scrollable body — header stays fixed above */}
      <div className="hcv-week-body" ref={scrollRef}>
        <div className="hcv-week-grid">
          <div className="hcv-times">
            {HOURS.map((hour) => (
              <div key={hour} className="hcv-time-slot">
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`hcv-day-column${isToday ? ' hcv-day-today' : ''}`}
              >
                {/* Current-time indicator — only in today's column */}
                {isToday && (
                  <div
                    className="hcv-now-indicator"
                    style={{ top: `${nowMinutes}px` }}
                    aria-hidden="true"
                  >
                    <div className="hcv-now-dot" />
                  </div>
                )}

                {HOURS.map((hour) => {
                  const slotStart = new Date(day);
                  slotStart.setHours(hour, 0, 0, 0);
                  const slotEnd = new Date(slotStart);
                  slotEnd.setHours(hour + 1, 0, 0, 0);

                  const dayAppointments = appointments.filter((apt) => {
                    if (!apt?.scheduled_start_time || !apt?.scheduled_end_time) return false;
                    try {
                      const aptStart = new Date(apt.scheduled_start_time);
                      const aptEnd = new Date(apt.scheduled_end_time);
                      return !isNaN(aptStart) && !isNaN(aptEnd) && aptStart < slotEnd && aptEnd > slotStart;
                    } catch {
                      return false;
                    }
                  });

                  const dayBlocks = availabilityBlocks.filter((block) => {
                    // Be more lenient with data format — try both snake_case and camelCase
                    const startTime = block?.start_time || block?.startTime;
                    const endTime = block?.end_time || block?.endTime;

                    if (!startTime || !endTime) return false;

                    try {
                      const blockStart = new Date(startTime);
                      const blockEnd = new Date(endTime);
                      // Validate dates are valid and in the correct time slot
                      if (isNaN(blockStart.getTime()) || isNaN(blockEnd.getTime())) return false;
                      return blockStart < slotEnd && blockEnd > slotStart;
                    } catch {
                      return false;
                    }
                  });

                  return (
                    <div
                      key={`${day.toISOString()}-${hour}`}
                      className="hcv-slot"
                      onClick={() => onBlockTime(day, hour)}
                    >
                      {dayBlocks.map((block) => (
                        <div
                          key={block.id}
                          className={`hcv-block hcv-block-${block.type}`}
                          title={block.title || `${block.type} time`}
                        >
                          {block.title || block.type}
                        </div>
                      ))}
                      {dayAppointments.map((apt) => {
                        const aptStart = new Date(apt.scheduled_start_time);
                        const timeStr = isNaN(aptStart)
                          ? ''
                          : aptStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div
                            key={apt.id}
                            className={`hcv-appointment hcv-apt-${apt.status}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectAppointment(apt);
                            }}
                            title={apt.service_description}
                          >
                            <span className="hcv-apt-time">{timeStr}</span>
                            <span className="hcv-apt-name">{apt.customer_name}</span>
                          </div>
                        );
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

function DayView({ appointments, availabilityBlocks, selectedDate, onBlockTime, onSelectAppointment }) {
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
    <div className="hcv-day-view">
      <div className="hcv-day-title">
        {selectedDate.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </div>
      <div className="hcv-day-body" ref={scrollRef}>
        <div className="hcv-day-grid">
          <div className="hcv-times">
            {HOURS.map((hour) => (
              <div key={hour} className="hcv-time-slot">
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          <div className={`hcv-day-events${isToday ? ' hcv-day-today' : ''}`}>
            {/* Now indicator for today */}
            {isToday && (
              <div
                className="hcv-now-indicator"
                style={{ top: `${nowMinutes}px` }}
                aria-hidden="true"
              >
                <div className="hcv-now-dot" />
              </div>
            )}
            {HOURS.map((hour) => {
              const slotStart = new Date(selectedDate);
              slotStart.setHours(hour, 0, 0, 0);
              const slotEnd = new Date(slotStart);
              slotEnd.setHours(hour + 1, 0, 0, 0);

              const hourAppointments = appointments.filter((apt) => {
                if (!apt?.scheduled_start_time || !apt?.scheduled_end_time) return false;
                const aptStart = new Date(apt.scheduled_start_time);
                const aptEnd = new Date(apt.scheduled_end_time);
                return aptStart < slotEnd && aptEnd > slotStart;
              });

              const hourBlocks = availabilityBlocks.filter((block) => {
                // Be more lenient with data format — try both snake_case and camelCase
                const startTime = block?.start_time || block?.startTime;
                const endTime = block?.end_time || block?.endTime;

                if (!startTime || !endTime) return false;

                try {
                  const blockStart = new Date(startTime);
                  const blockEnd = new Date(endTime);
                  // Validate dates are valid and in the correct time slot
                  if (isNaN(blockStart.getTime()) || isNaN(blockEnd.getTime())) return false;
                  return blockStart < slotEnd && blockEnd > slotStart;
                } catch {
                  return false;
                }
              });

              return (
                <div
                  key={`slot-${hour}`}
                  className="hcv-slot"
                  onClick={() => onBlockTime(selectedDate, hour)}
                >
                  {hourBlocks.map((block) => (
                    <div
                      key={block.id}
                      className={`hcv-block hcv-block-${block.type}`}
                      title={block.title || `${block.type} time`}
                    >
                      {block.title || block.type}
                    </div>
                  ))}
                  {hourAppointments.map((apt) => {
                    const aptStart = new Date(apt.scheduled_start_time);
                    const timeStr = isNaN(aptStart)
                      ? ''
                      : aptStart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div
                        key={apt.id}
                        className={`hcv-appointment hcv-apt-${apt.status}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAppointment(apt);
                        }}
                      >
                        <span className="hcv-apt-time">{timeStr}</span>
                        <span className="hcv-apt-name">
                          {apt.customer_name}
                          {apt.service_description ? ` – ${apt.service_description}` : ''}
                        </span>
                      </div>
                    );
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

// ─── Month View ───────────────────────────────────────────────────────────────
// No internal state or nav — driven entirely by selectedDate from parent.

function MonthView({ selectedDate, appointments, onDateChange }) {
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
    <div className="hcv-month-view">
      <div className="hcv-month-grid">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="hcv-month-day-name">
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
                'hcv-month-day',
                day ? 'active' : 'empty',
                isToday ? 'hcv-month-today' : '',
                isSelected && !isToday ? 'hcv-month-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => day && onDateChange(day)}
            >
              {day && (
                <>
                  <div className={`hcv-month-day-number ${isToday ? 'hcv-today-circle' : ''}`}>
                    {day.getDate()}
                  </div>
                  <div className="hcv-month-day-events">
                    {appointments
                      .filter((apt) => {
                        if (!apt?.scheduled_start_time) return false;
                        const aptDate = new Date(apt.scheduled_start_time);
                        return !isNaN(aptDate) && isSameDay(aptDate, day);
                      })
                      .slice(0, 2)
                      .map((apt) => (
                        <div key={apt.id} className={`hcv-month-event hcv-apt-${apt.status || 'pending'}`}>
                          {(apt.customer_name || 'Unknown').split(' ')[0]}
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

// ─── Agenda View ──────────────────────────────────────────────────────────────

function AgendaView({ appointments, onSelectAppointment, t }) {
  // Sort all appointments by start time, filter to future/today only
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sorted = [...appointments]
    .filter((apt) => {
      if (!apt?.scheduled_start_time) return false;
      const d = new Date(apt.scheduled_start_time);
      return !isNaN(d) && d >= today;
    })
    .sort((a, b) => new Date(a.scheduled_start_time) - new Date(b.scheduled_start_time));

  if (sorted.length === 0) {
    return (
      <div className="hcv-agenda-empty">
        <div className="hcv-agenda-empty-icon" aria-hidden="true">📅</div>
        <p className="hcv-agenda-empty-title">
          {t('calendar.noUpcomingAppointments', { defaultValue: 'No upcoming appointments' })}
        </p>
        <p className="hcv-agenda-empty-sub">
          {t('calendar.agendaEmptySub', { defaultValue: 'Your confirmed appointments will appear here.' })}
        </p>
      </div>
    );
  }

  // Group by date
  const groups = [];
  let currentKey = null;
  for (const apt of sorted) {
    const d = new Date(apt.scheduled_start_time);
    const key = d.toDateString();
    if (key !== currentKey) {
      groups.push({ key, date: d, items: [] });
      currentKey = key;
    }
    groups[groups.length - 1].items.push(apt);
  }

  const STATUS_COLORS = {
    requested: '#3b82f6',
    confirmed: '#f97316',
    in_progress: '#f59e0b',
    completed: '#6b7280',
    cancelled: '#9ca3af',
  };

  return (
    <div className="hcv-agenda-view">
      {groups.map(({ key, date, items }) => {
        const isToday = isSameDay(date, new Date());
        return (
          <div key={key} className="hcv-agenda-group">
            <div className={`hcv-agenda-date-header ${isToday ? 'hcv-agenda-today' : ''}`}>
              {isToday
                ? t('calendar.today', { defaultValue: 'Today' })
                : date.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
            </div>
            {items.map((apt) => {
              const start = new Date(apt.scheduled_start_time);
              const end = apt.scheduled_end_time ? new Date(apt.scheduled_end_time) : null;
              const color = STATUS_COLORS[apt.status] || '#6b7280';
              return (
                <button
                  key={apt.id}
                  className="hcv-agenda-event"
                  onClick={() => onSelectAppointment(apt)}
                  style={{ borderLeftColor: color }}
                >
                  <div className="hcv-agenda-event-time">
                    {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    {end && (
                      <>
                        {' – '}
                        {end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </>
                    )}
                  </div>
                  <div className="hcv-agenda-event-body">
                    <div className="hcv-agenda-event-title">
                      {apt.service_description || t('calendar.service', { defaultValue: 'Appointment' })}
                    </div>
                    {apt.customer_name && (
                      <div className="hcv-agenda-event-sub">{apt.customer_name}</div>
                    )}
                  </div>
                  <div
                    className="hcv-agenda-event-status"
                    style={{ color }}
                  >
                    {t(calendarAppointmentStatusKey(apt.status), {
                      defaultValue: apt.status || '',
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Booking Requests View ────────────────────────────────────────────────────
// Thin wrapper: same shared /bookings/incoming API as BookingRequestsPanel.

function BookingRequestsView({ onBookingConfirmed }) {
  return (
    <div className="booking-requests-container">
      <BookingRequestsPanel compact={false} onBookingConfirmed={onBookingConfirmed} />
    </div>
  );
}
