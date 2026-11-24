// Group 11 item 566: availability calendar for the tool-rental booking
// flow. Month view over the listing's booked ranges (from
// GET /:toolId/availability): booked days are blocked, past days are
// disabled, and a range that would cross a booked day cannot be picked.
// The server still re-checks the range on createBooking, so the calendar
// is a preflight, never the enforcement.
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isToolRentalDateBooked, toolRentalRangeHasBooked } from '../utils/toolRentalDates';

export interface BookedRange {
  start_date: string;
  end_date: string;
}

interface ToolRentalCalendarProps {
  bookedRanges: BookedRange[];
  startDate: string;
  endDate: string;
  onChange: (startDate: string, endDate: string) => void;
  disabled?: boolean;
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : null;
}

const ToolRentalCalendar: React.FC<ToolRentalCalendarProps> = ({
  bookedRanges,
  startDate,
  endDate,
  onChange,
  disabled = false,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const today = useMemo(() => toDateOnly(new Date()), []);
  const anchor = parseDateOnly(startDate) || new Date();
  const [viewYear, setViewYear] = useState(anchor.getFullYear());
  const [viewMonth, setViewMonth] = useState(anchor.getMonth());
  const [blockedNotice, setBlockedNotice] = useState(false);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
  const weekdayLabels = useMemo(() => {
    const base = new Date(2026, 0, 4); // a Sunday
    return Array.from({ length: 7 }, (_, i) => new Date(
      base.getFullYear(), base.getMonth(), base.getDate() + i,
    ).toLocaleDateString(locale, { weekday: 'short' }));
  }, [locale]);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const out: Array<{ date: string; day: number; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i += 1) {
      const dayDate = new Date(viewYear, viewMonth, i - startOffset + 1);
      out.push({
        date: toDateOnly(dayDate),
        day: dayDate.getDate(),
        inMonth: dayDate.getMonth() === viewMonth,
      });
    }
    void daysInMonth;
    return out;
  }, [viewYear, viewMonth]);

  const isPast = (date: string) => date < today;
  const isBooked = (date: string) => isToolRentalDateBooked(date, bookedRanges);
  const isSelected = (date: string) => date === startDate || (endDate !== '' && date === endDate);
  const isInRange = (date: string) => (
    startDate !== '' && endDate !== '' && date > startDate && date < endDate
  );

  const moveMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };
  const prevDisabled = viewYear * 12 + viewMonth <= new Date().getFullYear() * 12 + new Date().getMonth();

  const handleDayClick = (date: string) => {
    if (disabled || isPast(date) || isBooked(date)) return;
    setBlockedNotice(false);
    if (startDate === '' || (startDate !== '' && endDate !== '')) {
      onChange(date, '');
      return;
    }
    if (date === startDate) {
      onChange('', '');
      return;
    }
    if (date < startDate) {
      onChange(date, '');
      return;
    }
    if (toolRentalRangeHasBooked(startDate, date, bookedRanges)) {
      setBlockedNotice(true);
      return;
    }
    onChange(startDate, date);
  };

  return (
    <div className="tool-rental-calendar" data-testid="tool-rental-calendar">
      <div className="tool-rental-calendar-header">
        <button
          type="button"
          onClick={() => moveMonth(-1)}
          disabled={disabled || prevDisabled}
          aria-label={t('toolRentals.calendarPrevMonth')}
          className="tool-rental-calendar-nav"
        >
          ‹
        </button>
        <span className="tool-rental-calendar-month" aria-live="polite">{monthLabel}</span>
        <button
          type="button"
          onClick={() => moveMonth(1)}
          disabled={disabled}
          aria-label={t('toolRentals.calendarNextMonth')}
          className="tool-rental-calendar-nav"
        >
          ›
        </button>
      </div>
      <div className="tool-rental-calendar-grid" role="grid" aria-label={monthLabel}>
        {weekdayLabels.map((label) => (
          <div key={label} className="tool-rental-calendar-weekday" role="columnheader">{label}</div>
        ))}
        {cells.map((cell) => {
          const booked = isBooked(cell.date);
          const past = isPast(cell.date);
          const selected = isSelected(cell.date);
          const inRange = isInRange(cell.date);
          const className = [
            'tool-rental-calendar-day',
            cell.inMonth ? '' : 'tool-rental-calendar-day-outside',
            booked ? 'tool-rental-calendar-day-booked' : '',
            past && !booked ? 'tool-rental-calendar-day-past' : '',
            selected ? 'tool-rental-calendar-day-selected' : '',
            inRange ? 'tool-rental-calendar-day-range' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={cell.date}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-disabled={past || booked}
              disabled={disabled || past || booked}
              onClick={() => handleDayClick(cell.date)}
              className={className}
              title={booked ? t('toolRentals.calendarBooked') : undefined}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
      {blockedNotice && (
        <p className="tool-rental-calendar-blocked" role="alert">
          {t('toolRentals.calendarRangeBlocked')}
        </p>
      )}
      <div className="tool-rental-calendar-legend">
        <span className="tool-rental-calendar-legend-item">
          <span className="tool-rental-calendar-swatch tool-rental-calendar-swatch-available" />
          {t('toolRentals.calendarAvailable')}
        </span>
        <span className="tool-rental-calendar-legend-item">
          <span className="tool-rental-calendar-swatch tool-rental-calendar-swatch-booked" />
          {t('toolRentals.calendarBooked')}
        </span>
        <span className="tool-rental-calendar-legend-item">
          <span className="tool-rental-calendar-swatch tool-rental-calendar-swatch-selected" />
          {t('toolRentals.calendarSelected')}
        </span>
      </div>
      {(startDate !== '' || endDate !== '') && (
        <button
          type="button"
          onClick={() => { setBlockedNotice(false); onChange('', ''); }}
          disabled={disabled}
          className="tool-rental-calendar-clear"
        >
          {t('toolRentals.calendarClear')}
        </button>
      )}
    </div>
  );
};

export default ToolRentalCalendar;
