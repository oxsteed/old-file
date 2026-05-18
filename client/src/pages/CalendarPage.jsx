import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Clock3,
  LayoutGrid,
  ListTodo,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
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

function MiniCalendar({ selectedDate, onDateChange }) {
  const today = new Date();

  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    setViewMonth((prev) => {
      const d = new Date(selectedDate);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
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
  for (let i = 0; i < firstDay; i += 1) days.push(null);
  for (let i = 1; i <= daysInMonth; i += 1) days.push(new Date(year, month, i));

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mini-calendar">
      <div className="mini-calendar-header">
        <button onClick={prevMonth} aria-label="Previous month">{"<"}</button>
        <span>{monthLabel}</span>
        <button onClick={nextMonth} aria-label="Next month">{">"}</button>
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

function SummaryCard({ icon: Icon, label, value, hint }) {
  return (
    <article className="calendar-summary-card">
      <div className="calendar-summary-card-top">
        <span className="calendar-summary-label">{label}</span>
        <div className="calendar-summary-icon">
          <Icon size={18} />
        </div>
      </div>
      <div className="calendar-summary-value">{value}</div>
      <p>{hint}</p>
    </article>
  );
}

export default function CalendarPage() {
  const { t } = useTranslation();
  const { user, isHelper } = useAuth();
  const [viewMode, setViewMode] = useState('month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [blockModalRequest, setBlockModalRequest] = useState(false);

  if (!user) return null;

  const selectedDateLabel = selectedDate.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const selectedMonthLabel = selectedDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const summaryCards = isHelper
    ? [
        {
          icon: CalendarClock,
          label: 'Current view',
          value: viewMode === 'booking-requests' ? 'Requests' : viewMode.charAt(0).toUpperCase() + viewMode.slice(1),
          hint: 'Switch between schedule planning and incoming booking demand.',
        },
        {
          icon: Clock3,
          label: 'Date focus',
          value: selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          hint: 'The active day anchoring your current planning view.',
        },
        {
          icon: ShieldCheck,
          label: 'Availability control',
          value: 'Live',
          hint: 'Protect time quickly when you need to stay realistic.',
        },
      ]
    : [
        {
          icon: CalendarClock,
          label: 'Current view',
          value: viewMode.charAt(0).toUpperCase() + viewMode.slice(1),
          hint: 'Move between day, week, month, and agenda planning.',
        },
        {
          icon: Clock3,
          label: 'Date focus',
          value: selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          hint: 'Use this to center the timeline around the day you care about.',
        },
        {
          icon: ListTodo,
          label: 'Calendar role',
          value: 'Planning',
          hint: 'Track appointments, service commitments, and upcoming work.',
        },
      ];

  return (
    <PageShell>
      <PageMeta title={t('calendar.title')} />
      <div className="calendar-page">
        <section className="calendar-hero">
          <div className="calendar-hero-copy">
            <div className="calendar-hero-badge">
              <Sparkles size={14} />
              Calendar workspace
            </div>
            <div className="calendar-title-block">
              <h1>{t('calendar.title')}</h1>
              <p>{isHelper ? t('calendar.subtitleHelper') : t('calendar.subtitleCustomer')}</p>
            </div>
            <div className="calendar-focus-row">
              <span className="calendar-focus-pill">{selectedDateLabel}</span>
              <span className="calendar-focus-text">
                {isHelper
                  ? 'Protect open time, review booking demand, and keep your service week realistic.'
                  : 'See your upcoming appointments and commitments in one cleaner planning surface.'}
              </span>
            </div>
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
                {t('calendar.bookingRequests', { defaultValue: 'Booking Requests' })}
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
        </section>

        <section className="calendar-summary-grid">
          {summaryCards.map((card) => (
            <SummaryCard
              key={card.label}
              icon={card.icon}
              label={card.label}
              value={card.value}
              hint={card.hint}
            />
          ))}
        </section>

        <div className="calendar-body">
          <aside className="calendar-sidebar">
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

            <div className="calendar-sidebar-panel calendar-date-panel">
              <div className="calendar-sidebar-panel-header">
                <LayoutGrid size={18} />
                <div>
                  <h3>Calendar focus</h3>
                  <p>{selectedMonthLabel}</p>
                </div>
              </div>
              <MiniCalendar selectedDate={selectedDate} onDateChange={setSelectedDate} />
            </div>

            <div className="calendar-sidebar-panel calendar-brief-panel">
              <div className="calendar-sidebar-panel-header">
                <CalendarClock size={18} />
                <div>
                  <h3>{isHelper ? 'Today at a glance' : 'Planning note'}</h3>
                  <p>{selectedDateLabel}</p>
                </div>
              </div>
              <p className="calendar-brief-copy">
                {isHelper
                  ? 'Use booking requests to capture demand, then switch back to agenda or week view to balance confirmed work.'
                  : 'Agenda view is the fastest way to scan what is coming next if you only need the upcoming timeline.'}
              </p>
              <div className="calendar-quick-links">
                {isHelper ? (
                  <>
                    <Link to="/helper-dashboard">Helper dashboard</Link>
                    <Link to="/helper/messages">Messages</Link>
                    <Link to="/my-bookings">My bookings</Link>
                  </>
                ) : (
                  <>
                    <Link to="/my-bookings">My bookings</Link>
                    <Link to="/messages">Messages</Link>
                    <Link to="/dashboard">Dashboard</Link>
                  </>
                )}
              </div>
            </div>

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

          <main className="calendar-main">
            <div className="calendar-main-shell">
              <div className="calendar-main-shell-header">
                <div>
                  <p className="calendar-main-shell-eyebrow">
                    {viewMode === 'booking-requests'
                      ? t('calendar.bookingRequests', { defaultValue: 'Booking Requests' })
                      : `${t('calendar.title')} ${viewMode}`}
                  </p>
                  <h2>{selectedDateLabel}</h2>
                </div>
                <div className="calendar-main-shell-meta">
                  {isHelper ? 'Helper operations' : 'Customer planning'}
                </div>
              </div>

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
            </div>
          </main>
        </div>
      </div>
    </PageShell>
  );
}
