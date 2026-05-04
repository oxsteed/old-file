import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import HelperCalendarView from '../components/calendar/HelperCalendarView';
import CustomerCalendarView from '../components/calendar/CustomerCalendarView';
import '../styles/CalendarPage.css';

export default function CalendarPage() {
  const { t } = useTranslation();
  const { user, isHelper } = useAuth();
  const [viewMode, setViewMode] = useState('month');
  const [selectedDate, setSelectedDate] = useState(new Date());

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

        {isHelper ? (
          <HelperCalendarView
            viewMode={viewMode}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
          />
        ) : (
          <CustomerCalendarView
            viewMode={viewMode}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
          />
        )}
      </div>
    </PageShell>
  );
}
