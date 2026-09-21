import React from 'react';
import {
  CalendarCheck,
  Package,
  Briefcase,
  AlertCircle,
  Info,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import type { TimelineEvent } from '../../../types/helperProfile';
import { useTranslation } from 'react-i18next';

interface TimelineEventItemProps {
  event: TimelineEvent;
}

function formatTimestamp(iso: string, locale: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}

interface EventStyle {
  icon: React.ElementType;
  iconColor: string;
  pillBg: string;
  pillText: string;
  pillBorder: string;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  booking_event: {
    icon: CalendarCheck,
    iconColor: 'text-emerald-400',
    pillBg: 'bg-emerald-900/30',
    pillText: 'text-emerald-300',
    pillBorder: 'border-emerald-800',
  },
  order_event: {
    icon: Package,
    iconColor: 'text-sky-400',
    pillBg: 'bg-sky-900/30',
    pillText: 'text-sky-300',
    pillBorder: 'border-sky-800',
  },
  job_status: {
    icon: Briefcase,
    iconColor: 'text-violet-400',
    pillBg: 'bg-violet-900/30',
    pillText: 'text-violet-300',
    pillBorder: 'border-violet-800',
  },
  handoff: {
    icon: AlertCircle,
    iconColor: 'text-amber-400',
    pillBg: 'bg-amber-900/30',
    pillText: 'text-amber-300',
    pillBorder: 'border-amber-800',
  },
  system: {
    icon: Info,
    iconColor: 'text-gray-500',
    pillBg: 'bg-gray-800/60',
    pillText: 'text-gray-400',
    pillBorder: 'border-gray-700',
  },
};

// Extra icon per event sub-type
const SUB_TYPE_ICON: Record<string, React.ElementType> = {
  booking_confirmed: CheckCircle2,
  quote_sent: Clock,
  quote_accepted: CheckCircle2,
  quote_declined: AlertCircle,
  quote_scheduled: CalendarCheck,
  quote_expired: Clock,
  quote_superseded: Info,
  guest_delivered: CheckCircle2,
};

const TimelineEventItem: React.FC<TimelineEventItemProps> = ({ event }) => {
  const { t, i18n } = useTranslation();
  const guestOk = event.eventType === 'guest_delivered';
  const baseStyle = EVENT_STYLES[event.itemType] ?? EVENT_STYLES.system;
  const style = guestOk
    ? {
        icon: CheckCircle2,
        iconColor: 'text-emerald-400',
        pillBg: 'bg-emerald-950/40',
        pillText: 'text-emerald-200',
        pillBorder: 'border-emerald-700/80',
      }
    : baseStyle;
  const IconComponent = SUB_TYPE_ICON[event.eventType] ?? style.icon;

  return (
    <div
      className="flex items-center gap-2 justify-center"
      role="status"
      aria-label={t('timelineEvent.ariaLabel', { content: event.content })}
    >
      {/* Left rule */}
      <div className="flex-1 h-px bg-gray-800" aria-hidden="true" />

      {/* Pill */}
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${style.pillBg} ${style.pillText} ${style.pillBorder} max-w-[80%] text-center`}
      >
        <IconComponent className={`w-3.5 h-3.5 flex-shrink-0 ${style.iconColor}`} aria-hidden="true" />
        <span>{event.content}</span>
        <time dateTime={event.timestamp} className="text-xs opacity-60 ml-1">
          {formatTimestamp(event.timestamp, i18n.resolvedLanguage || i18n.language || 'en')}
        </time>
      </div>

      {/* Right rule */}
      <div className="flex-1 h-px bg-gray-800" aria-hidden="true" />
    </div>
  );
};

export default TimelineEventItem;
