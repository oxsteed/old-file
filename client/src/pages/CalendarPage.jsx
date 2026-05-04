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
    <div className="cp-mini-cal">
      <div className="cp-mini-cal-header">
        <button className="cp-mini-nav" onClick={prevMonth} aria-label="Previous month">
          ‹
        </button>
        <span className="cp-mini-month">{monthLabel}</span>
        <button className="cp-mini-nav" onClick={nextMonth} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="cp-mini-cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="cp-mini-dow">
            {d}
          </div>
        ))}
        {days.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} className="cp-mini-day cp-mini-empty" />;
          const isToday = isSameDay(day, today);
          const isSelected = isSameDay(day, selectedDate);
          return (
            <button
              key={day.toISOString()}
              className={[
                'cp-mini-day',
                isToday ? 'cp-mini-today' : '',
                isSelected && !isToday ? 'cp-mini-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
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
      <PageMeta
        title={t('calendar.pageTitle')}
        description={t('calendar.pageDescription')}
      />
      <div className="cp-container">
        {/* ── Top header: title + view toggle ── */}
        <div className="cp-header">
          <div className="cp-header-left">
            <h1>{t('calendar.title')}</h1>
            <p className="cp-subtitle">
              {isHelper ? t('calendar.subtitleHelper') : t('calendar.subtitleCustomer')}
            </p>
          </div>
          <div className="cp-view-modes">
            <button
              className={`cp-view-btn ${viewMode === 'day' ? 'active' : ''}`}
              onClick={() => setViewMode('day')}
              title={t('calendar.dayView')}
            >
              {t('calendar.day')}
            </button>
            <button
              className={`cp-view-btn ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}
              title={t('calendar.weekView')}
            >
              {t('calendar.week')}
            </button>
            <button
              className={`cp-view-btn ${viewMode === 'month' ? 'active' : ''}`}
              onClick={() => setViewMode('month')}
              title={t('calendar.monthView')}
            >
              {t('calendar.month')}
            </button>
            <button
              className={`cp-view-btn ${viewMode === 'agenda' ? 'active' : ''}`}
              onClick={() => setViewMode('agenda')}
              title={t('calendar.agendaView')}
            >
              {t('calendar.agenda')}
            </button>
          </div>
        </div>

        {/* ── Body: sidebar + calendar grid ── */}
        <div className="cp-body">
          {/* ── Left sidebar ── */}
          <aside className="cp-sidebar" aria-label={t('calendar.sidebarLabel', { defaultValue: 'Calendar sidebar' })}>
            {/* Primary CTA — helpers only */}
            {isHelper && (
              <button
                className="cp-block-time-btn"
                onClick={() => setBlockModalRequest(true)}
                aria-label={t('calendar.blockTime', { defaultValue: 'Block Time' })}
              >
                <span className="cp-block-time-plus" aria-hidden="true">+</span>
                {t('calendar.blockTime', { defaultValue: 'Block Time' })}
              </button>
            )}

            {/* Mini month navigator */}
            <MiniCalendar selectedDate={selectedDate} onDateChange={setSelectedDate} />

            {/* Legend */}
            <div className="cp-legend">
              <div className="cp-legend-title">
                {t('calendar.legendTitle', { defaultValue: 'Legend' })}
              </div>
              <div className="cp-legend-item">
                <span className="cp-legend-dot" style={{ background: '#f97316' }} />
                {t('calendar.statusConfirmed', { defaultValue: 'Confirmed' })}
              </div>
              <div className="cp-legend-item">
                <span className="cp-legend-dot" style={{ background: '#3b82f6' }} />
                {t('calendar.statusRequested', { defaultValue: 'Requested' })}
              </div>
              <div className="cp-legend-item">
                <span className="cp-legend-dot" style={{ background: '#f59e0b' }} />
                {t('calendar.statusInProgress', { defaultValue: 'In Progress' })}
              </div>
              <div className="cp-legend-item">
                <span className="cp-legend-dot" style={{ background: '#6b7280' }} />
                {t('calendar.statusCompleted', { defaultValue: 'Completed' })}
              </div>
              {isHelper && (
                <>
                  <div className="cp-legend-divider" />
                  <div className="cp-legend-item">
                    <span className="cp-legend-dot" style={{ background: '#10b981' }} />
                    {t('calendar.blockAvailable', { defaultValue: 'Available' })}
                  </div>
                  <div className="cp-legend-item">
                    <span className="cp-legend-dot" style={{ background: '#ef4444' }} />
                    {t('calendar.blockBusy', { defaultValue: 'Busy' })}
                  </div>
                </>
              )}
            </div>
          </aside>

          {/* ── Main calendar ── */}
          <div className="cp-main">
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
        </div>
      </div>
    </PageShell>
  );
}
