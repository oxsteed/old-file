import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import type { DayHours } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface HoursSectionProps {
  hours: DayHours[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Jan 1, 2023 was a Sunday - used as a stable reference date for day formatting
const DAY_REFERENCE_DATE = new Date(2023, 0, 1);

const HoursSection: React.FC<HoursSectionProps> = ({ hours }) => {
  const { t, i18n } = useTranslation();
  const todayName = DAY_NAMES[new Date().getDay()];

  const getDayDisplayName = (englishDayName: string): string => {
    const idx = DAY_NAMES.indexOf(englishDayName);
    if (idx === -1) return englishDayName;
    const d = new Date(DAY_REFERENCE_DATE);
    d.setDate(1 + idx);
    return d.toLocaleDateString(i18n.language, { weekday: 'long' });
  };
  const todayEntry = hours.find((h) => h.day === todayName);
  const todayOpen = !!(todayEntry && !todayEntry.closed);
  const todayLabel = todayOpen && todayEntry
    ? t('helperProfile.hours.openToday', { open: todayEntry.open, close: todayEntry.close })
    : t('helperProfile.hours.closedToday');

  return (
    <SectionCard id="hours" title={t('helperProfile.hours.title')}>
      {/* Today's status pill */}
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-4 ${
          todayOpen
            ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800'
            : 'bg-red-900/30 text-red-400 border border-red-900'
        }`}
        aria-live="polite"
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            todayOpen ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'
          }`}
          aria-hidden="true"
        />
        {todayLabel}
      </div>

      <ul className="space-y-1" role="list" aria-label={t('helperProfile.hours.hoursAria')}>
        {hours.map((entry) => {
          const isToday = entry.day === todayName;
          return (
            <li
              key={entry.day}
              className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm ${
                isToday ? 'bg-gray-800 text-white' : 'text-gray-400'
              }`}
              aria-current={isToday ? 'date' : undefined}
            >
              <span className={`font-medium w-28 ${isToday ? 'text-white' : 'text-gray-300'}`}>
                {getDayDisplayName(entry.day)}
                {isToday && (
                  <span className="ml-2 text-xs text-brand-400 font-normal">{t('helperProfile.hours.today')}</span>
                )}
              </span>
              {entry.closed ? (
                <span className="text-gray-600">{t('helperProfile.hours.closed')}</span>
              ) : (
                <span className="flex items-center gap-1 text-right">
                  <Clock className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
                  {entry.open} – {entry.close}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
};

export default HoursSection;
