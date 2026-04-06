import React from 'react';
import { Clock } from 'lucide-react';
import type { DayHours } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface HoursSectionProps {
  hours: DayHours[];
}

function getTodayStatus(hours: DayHours[]): { label: string; open: boolean } {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = days[new Date().getDay()];
  const entry = hours.find((h) => h.day === today);
  if (!entry || entry.closed) return { label: 'Closed today', open: false };
  return { label: `Open today · ${entry.open} – ${entry.close}`, open: true };
}

const HoursSection: React.FC<HoursSectionProps> = ({ hours }) => {
  const todayStatus = getTodayStatus(hours);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName = days[new Date().getDay()];

  return (
    <SectionCard id="hours" title="Business Hours">
      {/* Today's status pill */}
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-4 ${
          todayStatus.open
            ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800'
            : 'bg-red-900/30 text-red-400 border border-red-900'
        }`}
        aria-live="polite"
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            todayStatus.open ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'
          }`}
          aria-hidden="true"
        />
        {todayStatus.label}
      </div>

      <ul className="space-y-1" role="list" aria-label="Weekly business hours">
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
                {entry.day}
                {isToday && (
                  <span className="ml-2 text-xs text-brand-400 font-normal">(today)</span>
                )}
              </span>
              {entry.closed ? (
                <span className="text-gray-600">Closed</span>
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
