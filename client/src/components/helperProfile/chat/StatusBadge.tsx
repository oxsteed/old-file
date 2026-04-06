import React from 'react';
import { Wifi, Bot, WifiOff, Mail, Loader2 } from 'lucide-react';
import type { ChatStatus } from '../../../types/helperProfile';

interface StatusBadgeProps {
  status: ChatStatus;
  className?: string;
}

const CONFIG: Record<
  ChatStatus,
  { label: string; icon: React.ElementType; dot: string; badge: string }
> = {
  live: {
    label: 'Live',
    icon: Wifi,
    dot: 'bg-emerald-400 animate-pulse',
    badge: 'bg-emerald-900/50 text-emerald-400 border-emerald-800',
  },
  ai_assistant: {
    label: 'AI Assistant',
    icon: Bot,
    dot: 'bg-sky-400',
    badge: 'bg-sky-900/50 text-sky-400 border-sky-800',
  },
  offline: {
    label: 'Offline',
    icon: WifiOff,
    dot: 'bg-gray-500',
    badge: 'bg-gray-800 text-gray-400 border-gray-700',
  },
  message_mode: {
    label: 'Message Mode',
    icon: Mail,
    dot: 'bg-amber-400',
    badge: 'bg-amber-900/40 text-amber-400 border-amber-800',
  },
  connecting: {
    label: 'Connecting…',
    icon: Loader2,
    dot: 'bg-gray-400 animate-spin',
    badge: 'bg-gray-800 text-gray-400 border-gray-700',
  },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const { label, icon: Icon, dot, badge } = CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${badge} ${className}`}
      aria-label={`Status: ${label}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} aria-hidden="true" />
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label}
    </span>
  );
};

export default StatusBadge;
