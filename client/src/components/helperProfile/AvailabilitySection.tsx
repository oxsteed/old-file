import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Zap } from 'lucide-react';
import SectionCard from './ui/SectionCard';
import type {
  HelperAvailabilitySummary,
  HelperAvailabilitySummaryDay,
} from '../../api/helpers';
import { fetchHelperAvailabilitySummary } from '../../api/helpers';

interface AvailabilitySectionProps {
  helperId: string;
}

// Minutes (UTC) → locale time, e.g. "9:00 AM" / "9h00"
function formatMinutes(mins: number, locale: string): string {
  const d = new Date();
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function formatWindow(w: { start: number; end: number }, locale: string): string {
  return `${formatMinutes(w.start, locale)} - ${formatMinutes(w.end, locale)}`;
}

type DayTone = 'open' | 'limited' | 'booked' | 'off' | 'closed' | 'unset';

const DAY_TONE: Record<HelperAvailabilitySummaryDay['status'], DayTone> = {
  available: 'open',
  limited: 'limited',
  booked: 'booked',
  blocked: 'off',
  closed: 'closed',
  unset: 'unset',
};

const TONE_STYLES: Record<DayTone, { dot: string; chip: string; card: string }> = {
  open: {
    dot: 'bg-emerald-400',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-700/60',
    card: 'border-emerald-800/60 bg-emerald-950/20',
  },
  limited: {
    dot: 'bg-amber-400',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-700/60',
    card: 'border-amber-800/60 bg-amber-950/20',
  },
  booked: {
    dot: 'bg-sky-400',
    chip: 'bg-sky-500/15 text-sky-300 border-sky-700/60',
    card: 'border-gray-800 bg-gray-900/60',
  },
  off: {
    dot: 'bg-rose-400',
    chip: 'bg-rose-500/15 text-rose-300 border-rose-700/60',
    card: 'border-gray-800 bg-gray-900/40',
  },
  closed: {
    dot: 'bg-gray-600',
    chip: 'bg-gray-800 text-gray-500 border-gray-700',
    card: 'border-gray-800/70 bg-gray-900/30',
  },
  unset: {
    dot: 'bg-gray-600',
    chip: 'bg-gray-800 text-gray-500 border-gray-700 border-dashed',
    card: 'border-gray-800/70 bg-gray-900/30 border-dashed',
  },
};

const DAY_STATUS_KEY: Record<HelperAvailabilitySummaryDay['status'], string> = {
  available: 'dayAvailable',
  limited: 'dayLimited',
  booked: 'dayBooked',
  blocked: 'dayTimeOff',
  closed: 'dayClosed',
  unset: 'dayNotSet',
};

/**
 * One true-availability section for helper profiles.
 * Weekly template minus dated blocks minus appointments, summarized per day.
 */
const AvailabilitySection: React.FC<AvailabilitySectionProps> = ({ helperId }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const [data, setData] = useState<HelperAvailabilitySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchHelperAvailabilitySummary(helperId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        /* keep section hidden on failure */
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [helperId]);

  if (loading) {
    return (
      <SectionCard id="availability" title={t('helperProfile.availability.title')}>
        <div className="space-y-3" aria-label={t('helperProfile.availability.loading')}>
          <div className="h-6 bg-gray-800 rounded-full w-48 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-800/60 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </SectionCard>
    );
  }
  if (!data) return null;

  const { summary, days, hasTemplate } = data;
  const todayISO = new Date().toISOString().split('T')[0];

  // ── Headline status ──
  let headline = '';
  let subline = '';
  let headlineTone: 'open' | 'limited' | 'off' | 'closed' = 'open';
  if (summary.state === 'open-now') {
    headline =
      summary.openUntilMin != null
        ? t('helperProfile.availability.statusOpenNowUntil', {
            time: formatMinutes(summary.openUntilMin, locale),
          })
        : t('helperProfile.availability.statusOpenNow');
  } else if (summary.state === 'opens-today') {
    headlineTone = 'limited';
    headline =
      summary.opensAtMin != null
        ? t('helperProfile.availability.statusOpensToday', {
            time: formatMinutes(summary.opensAtMin, locale),
          })
        : t('helperProfile.availability.statusOpenNow');
  } else if (summary.state === 'opens-on' && summary.date) {
    headlineTone = 'limited';
    const d = new Date(summary.date + 'T12:00:00');
    headline = t('helperProfile.availability.statusNextAvailable', {
      date: d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
    });
  } else if (summary.state === 'none') {
    const anyBlocked = days.some((d) => d.status === 'blocked');
    if (anyBlocked) {
      headlineTone = 'off';
      headline = t('helperProfile.availability.statusTimeOff');
      subline = t('helperProfile.availability.statusTimeOffSub');
    } else {
      headlineTone = 'closed';
      headline = t('helperProfile.availability.statusFullyBooked');
      subline = t('helperProfile.availability.statusFullyBookedSub');
    }
  } else {
    headlineTone = 'closed';
    headline = t('helperProfile.availability.statusNoSchedule');
    subline = t('helperProfile.availability.statusNoScheduleSub');
  }

  const headlineStyles: Record<typeof headlineTone, string> = {
    open: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
    limited: 'bg-amber-900/40 text-amber-300 border-amber-800',
    off: 'bg-rose-900/40 text-rose-300 border-rose-900',
    closed: 'bg-gray-800/60 text-gray-400 border-gray-700',
  };

  return (
    <SectionCard id="availability" title={t('helperProfile.availability.title')}>
      {/* Status banner */}
      <div
        className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-sm font-semibold border mb-2 ${headlineStyles[headlineTone]}`}
        aria-live="polite"
      >
        <CalendarCheck className="w-4 h-4" aria-hidden="true" />
        {headline}
      </div>
      {subline && <p className="text-sm text-gray-500 mb-4">{subline}</p>}

      {/* Presence line */}
      <div className="flex items-center gap-3 mb-5 text-sm">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-2.5 h-2.5 rounded-full ${data.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`}
            aria-hidden="true"
          />
          <span className="text-gray-300">
            {data.isOnline
              ? t('helperProfile.chat.onlineNow')
              : t('helperProfile.chat.offline')}
          </span>
        </span>
        {data.responseTime && String(data.responseTime).toLowerCase() !== 'varies' && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Zap className="w-3 h-3" aria-hidden="true" />
            {t('helperProfile.chat.respondsIn', { time: data.responseTime })}
          </span>
        )}
      </div>

      {/* 7-day true-availability strip */}
      {hasTemplate && (
        <div
          className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2"
          role="list"
          aria-label={t('helperProfile.availability.aria')}
        >
          {days.map((day) => {
            const tone = DAY_TONE[day.status];
            const styles = TONE_STYLES[tone];
            const dateObj = new Date(day.date + 'T12:00:00');
            const isToday = day.date === todayISO;
            const showWindows =
              (day.status === 'available' || day.status === 'limited') &&
              day.windows.length > 0;
            return (
              <div
                key={day.date}
                role="listitem"
                aria-current={isToday ? 'date' : undefined}
                className={`rounded-xl border px-3 py-2.5 ${styles.card} ${
                  isToday ? 'ring-1 ring-brand-500/60' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-300">
                    {isToday
                      ? t('helperProfile.availability.today')
                      : dateObj.toLocaleDateString(locale, { weekday: 'short' })}
                  </span>
                  <span className={`w-2 h-2 rounded-full ${styles.dot}`} aria-hidden="true" />
                </div>
                <div className="text-xs text-gray-500 mb-1.5">
                  {dateObj.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })}
                </div>
                <div
                  className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border mb-1.5 ${styles.chip}`}
                >
                  {t(`helperProfile.availability.${DAY_STATUS_KEY[day.status]}`)}
                </div>
                {showWindows && (
                  <ul className="space-y-0.5">
                    {day.windows.slice(0, 3).map((w, i) => (
                      <li key={i} className="text-[11px] text-gray-400 tabular-nums">
                        {formatWindow({ start: w.startMin, end: w.endMin }, locale)}
                      </li>
                    ))}
                    {day.windows.length > 3 && (
                      <li className="text-[11px] text-gray-600">
                        +{day.windows.length - 3}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
};

export default AvailabilitySection;
