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

interface TimelineEventItemProps {
  event: TimelineEvent;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
};

const TimelineEventItem: React.FC<TimelineEventItemProps> = ({ event }) => {
  const style = EVENT_STYLES[event.itemType] ?? EVENT_STYLES.system;
  const IconComponent = SUB_TYPE_ICON[event.eventType] ?? style.icon;

  return (
    <div
      className="flex items-center gap-2 justify-center"
      role="status"
      aria-label={`Event: ${event.content}`}
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
          {formatTimestamp(event.timestamp)}
        </time>
      </div>

      {/* Right rule */}
      <div className="flex-1 h-px bg-gray-800" aria-hidden="true" />
    </div>
  );
};

export default TimelineEventItem;
