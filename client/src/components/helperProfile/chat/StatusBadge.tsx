import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, Bot, WifiOff, Mail, Loader2 } from 'lucide-react';
import type { ChatStatus } from '../../../types/helperProfile';

interface StatusBadgeProps {
  status: ChatStatus;
  className?: string;
  /** Icon + dot only (aria-label keeps full status text). Used in dock header. */
  iconOnly?: boolean;
}

const CONFIG: Record<
  ChatStatus,
  { icon: React.ElementType; dot: string; badge: string }
> = {
  live: {
    icon: Wifi,
    dot: 'bg-emerald-400 animate-pulse',
    badge: 'bg-emerald-900/50 text-emerald-400 border-emerald-800',
  },
  ai_assistant: {
    icon: Bot,
    dot: 'bg-sky-400',
    badge: 'bg-sky-900/50 text-sky-400 border-sky-800',
  },
  offline: {
    icon: WifiOff,
    dot: 'bg-gray-500',
    badge: 'bg-gray-800 text-gray-400 border-gray-700',
  },
  message_mode: {
    icon: Mail,
    dot: 'bg-amber-400',
    badge: 'bg-amber-900/40 text-amber-400 border-amber-800',
  },
  connecting: {
    icon: Loader2,
    dot: 'bg-gray-400 animate-spin',
    badge: 'bg-gray-800 text-gray-400 border-gray-700',
  },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '', iconOnly = false }) => {
  const { t } = useTranslation();
  const { icon: Icon, dot, badge } = CONFIG[status];

  const labelMap: Record<ChatStatus, string> = {
    live: t('helperProfile.chat.statusLive'),
    ai_assistant: t('helperProfile.chat.statusAiAssistant'),
    offline: t('helperProfile.chat.statusOffline'),
    message_mode: t('helperProfile.chat.statusMessageMode'),
    connecting: t('helperProfile.chat.statusConnecting'),
  };
  const label = labelMap[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${iconOnly ? 'p-1.5' : 'px-2 py-0.5'} rounded-full text-xs font-medium border ${badge} ${className}`}
      aria-label={t('helperProfile.chat.statusLabel', { label })}
      title={label}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} aria-hidden="true" />
      <Icon className="w-3 h-3" aria-hidden="true" />
      {!iconOnly ? label : <span className="sr-only">{label}</span>}
    </span>
  );
};

export default StatusBadge;
