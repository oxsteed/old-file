import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import HelperCalendarView from '../components/calendar/HelperCalendarView';
import CustomerCalendarView from '../components/calendar/CustomerCalendarView';
import '../styles/CalendarPage.css';

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─── Mini Month Navigator ─────────────────────────────────────────────────────

function MiniCalendar({ selectedDate, onDateChange }) {
  const today = new Date();

  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Follow selectedDate's month when it changes externally
  useEffect(() => {
    setViewMonth((prev) => {
      const d = new Date(selectedDate);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      // Only update if month/year actually changed to avoid resetting manual nav
      if (prev.getFullYear() === d.getFullYear() && prev.getMonth() === d.getMonth()) {
        return prev;
      }
      return d;
    });
  }, [selectedDate]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const prevMonth = () => {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() - 1);
    setViewMonth(d);
  };
  const nextMonth = () => {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + 1);
    setViewMonth(d);
  };

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mini-calendar">
      <div className="mini-calendar-header">
        <button onClick={prevMonth} aria-label="Previous month">‹</button>
        <span>{monthLabel}</span>
        <button onClick={nextMonth} aria-label="Next month">›</button>
      </div>
      <div className="mini-calendar-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="mini-calendar-dow">{d}</span>
        ))}
        {days.map((day, idx) => {
          if (!day) return <span key={`empty-${idx}`} />;
          const isToday = isSameDay(day, today);
          const isSelected = isSameDay(day, selectedDate);
          return (
            <button
              key={idx}
              className={`mini-calendar-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onDateChange(day)}
              aria-label={day.toLocaleDateString()}
              aria-pressed={isSelected}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const { t } = useTranslation();
  const { user, isHelper } = useAuth();
  const [viewMode, setViewMode] = useState('month');
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Signal to HelperCalendarView to open the block-time modal
  const [blockModalRequest, setBlockModalRequest] = useState(false);

  if (!user) {
    return null;
  }

  return (
    <PageShell>
      <PageMeta title={t('calendar.title')} />
      <div className="calendar-page">
        {/* ── Top header: title + view toggle ── */}
        <div className="calendar-header">
          <div className="calendar-title-block">
            <h1>{t('calendar.title')}</h1>
            <p>{isHelper ? t('calendar.subtitleHelper') : t('calendar.subtitleCustomer')}</p>
          </div>
          <div className="calendar-view-toggle">
            <button
              className={viewMode === 'day' ? 'active' : ''}
              onClick={() => setViewMode('day')}
              title={t('calendar.dayView')}
            >
              {t('calendar.day')}
            </button>
            <button
              className={viewMode === 'week' ? 'active' : ''}
              onClick={() => setViewMode('week')}
              title={t('calendar.weekView')}
            >
              {t('calendar.week')}
            </button>
            <button
              className={viewMode === 'month' ? 'active' : ''}
              onClick={() => setViewMode('month')}
              title={t('calendar.monthView')}
            >
              {t('calendar.month')}
            </button>
            {isHelper && (
              <button
                className={viewMode === 'booking-requests' ? 'active booking-requests-btn' : 'booking-requests-btn'}
                onClick={() => setViewMode('booking-requests')}
                title={t('calendar.bookingRequestsView', { defaultValue: 'View direct booking requests' })}
              >
                {t('calendar.bookingRequests', { defaultValue: 'Booking Request' })}
              </button>
            )}
            <button
              className={viewMode === 'agenda' ? 'active' : ''}
              onClick={() => setViewMode('agenda')}
              title={t('calendar.agendaView')}
            >
              {t('calendar.agenda')}
            </button>
          </div>
        </div>

        {/* ── Body: sidebar + calendar grid ── */}
        <div className="calendar-body">
          {/* ── Left sidebar ── */}
          <aside className="calendar-sidebar">
            {/* Primary CTA — helpers only */}
            {isHelper && (
              <button
                className="block-time-btn"
                onClick={() => setBlockModalRequest(true)}
                aria-label={t('calendar.blockTime', { defaultValue: 'Block Time' })}
              >
                <span aria-hidden="true">+</span>
                {t('calendar.blockTime', { defaultValue: 'Block Time' })}
              </button>
            )}
            {/* Mini month navigator */}
            <MiniCalendar selectedDate={selectedDate} onDateChange={setSelectedDate} />
            {/* Legend */}
            <div className="calendar-legend">
              <h3>{t('calendar.legendTitle', { defaultValue: 'Legend' })}</h3>
              <ul>
                <li><span className="legend-dot confirmed" /> {t('calendar.statusConfirmed', { defaultValue: 'Confirmed' })}</li>
                <li><span className="legend-dot requested" /> {t('calendar.statusRequested', { defaultValue: 'Requested' })}</li>
                <li><span className="legend-dot in-progress" /> {t('calendar.statusInProgress', { defaultValue: 'In Progress' })}</li>
                <li><span className="legend-dot completed" /> {t('calendar.statusCompleted', { defaultValue: 'Completed' })}</li>
                {isHelper && (
                  <>
                    <li><span className="legend-dot available" /> {t('calendar.blockAvailable', { defaultValue: 'Available' })}</li>
                    <li><span className="legend-dot busy" /> {t('calendar.blockBusy', { defaultValue: 'Busy' })}</li>
                  </>
                )}
              </ul>
            </div>
          </aside>

          {/* ── Main calendar ── */}
          <main className="calendar-main">
            {isHelper ? (
              <HelperCalendarView
                viewMode={viewMode}
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
                blockModalRequest={blockModalRequest}
                onBlockModalRequestHandled={() => setBlockModalRequest(false)}
              />
            ) : (
              <CustomerCalendarView
                viewMode={viewMode}
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
              />
            )}
          </main>
        </div>
      </div>
    </PageShell>
  );
}
