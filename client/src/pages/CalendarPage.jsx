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
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
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

  const monthLabel = viewMonth.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mini-calendar">
      <div className="mini-calendar-header">
        <button onClick={prevMonth} aria-label={t('calendar.previousMonth')}>{"<"}</button>
        <span>{monthLabel}</span>
        <button onClick={nextMonth} aria-label={t('calendar.nextMonth')}>{">"}</button>
      </div>
      <div className="mini-calendar-grid">
        {['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day, i) => (
          <span key={i} className="mini-calendar-dow">{t(`calendar.dayShort.${day}`)}</span>
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
              aria-label={day.toLocaleDateString(locale)}
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
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const { user, isHelper } = useAuth();
  const [viewMode, setViewMode] = useState('month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [blockModalRequest, setBlockModalRequest] = useState(false);

  if (!user) return null;

  const selectedDateLabel = selectedDate.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const selectedMonthLabel = selectedDate.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  const viewModeLabel = (mode) => ({
    day: t('calendar.day'),
    week: t('calendar.week'),
    month: t('calendar.month'),
    agenda: t('calendar.agenda'),
    'booking-requests': t('calendar.bookingRequests'),
  }[mode] || mode);

  const summaryCards = isHelper
    ? [
        {
          icon: CalendarClock,
          label: t('calendar.summaryCurrentView'),
          value: viewModeLabel(viewMode),
          hint: t('calendar.summaryHelperViewHint'),
        },
        {
          icon: Clock3,
          label: t('calendar.summaryDateFocus'),
          value: selectedDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
          hint: t('calendar.summaryDateHint'),
        },
        {
          icon: ShieldCheck,
          label: t('calendar.summaryAvailability'),
          value: t('calendar.blockAvailable'),
          hint: t('calendar.summaryAvailabilityHint'),
        },
      ]
    : [
        {
          icon: CalendarClock,
          label: t('calendar.summaryCurrentView'),
          value: viewModeLabel(viewMode),
          hint: t('calendar.summaryCustomerViewHint'),
        },
        {
          icon: Clock3,
          label: t('calendar.summaryDateFocus'),
          value: selectedDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
          hint: t('calendar.summaryDateHint'),
        },
        {
          icon: ListTodo,
          label: t('calendar.summaryCalendarRole'),
          value: t('calendar.summaryPlanning'),
          hint: t('calendar.summaryPlanningHint'),
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
              {t('calendar.workspaceBadge')}
            </div>
            <div className="calendar-title-block">
              <h1>{t('calendar.title')}</h1>
              <p>{isHelper ? t('calendar.subtitleHelper') : t('calendar.subtitleCustomer')}</p>
            </div>
            <div className="calendar-focus-row">
              <span className="calendar-focus-pill">{selectedDateLabel}</span>
              <span className="calendar-focus-text">
                {isHelper
                  ? t('calendar.focusHelper')
                  : t('calendar.focusCustomer')}
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
                  <h3>{t('calendar.focusTitle')}</h3>
                  <p>{selectedMonthLabel}</p>
                </div>
              </div>
              <MiniCalendar selectedDate={selectedDate} onDateChange={setSelectedDate} />
            </div>

            <div className="calendar-sidebar-panel calendar-brief-panel">
              <div className="calendar-sidebar-panel-header">
                <CalendarClock size={18} />
                <div>
                  <h3>{isHelper ? t('calendar.todayAtGlance') : t('calendar.planningNote')}</h3>
                  <p>{selectedDateLabel}</p>
                </div>
              </div>
              <p className="calendar-brief-copy">
                {isHelper
                  ? t('calendar.briefHelper')
                  : t('calendar.briefCustomer')}
              </p>
              <div className="calendar-quick-links">
                {isHelper ? (
                  <>
                    <Link to="/helper-dashboard">{t('calendar.helperDashboard')}</Link>
                    <Link to="/helper/messages">{t('calendar.messages')}</Link>
                    <Link to="/my-bookings">{t('calendar.myBookings')}</Link>
                  </>
                ) : (
                  <>
                    <Link to="/my-bookings">{t('calendar.myBookings')}</Link>
                    <Link to="/messages">{t('calendar.messages')}</Link>
                    <Link to="/dashboard">{t('calendar.dashboard')}</Link>
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
                  {isHelper ? t('calendar.helperOperations') : t('calendar.customerPlanning')}
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
