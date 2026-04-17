import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Building2, User, UserCheck } from 'lucide-react';
import type { ChatMessage, MessageAuthorType } from '../../../types/helperProfile';

interface MessageBubbleProps {
  message: ChatMessage;
  helperName: string;
}

interface AuthorConfig {
  icon: React.ElementType;
  /** Tailwind classes for the bubble */
  bubble: string;
  /** Tailwind classes for the label */
  labelColor: string;
  /** Alignment */
  align: 'left' | 'right';
  /** Icon background */
  iconBg: string;
  iconColor: string;
}

const AUTHOR_CONFIG: Record<MessageAuthorType, AuthorConfig> = {
  user: {
    icon: User,
    bubble: 'bg-brand-500 text-white',
    labelColor: 'text-brand-400',
    align: 'right',
    iconBg: 'bg-brand-600',
    iconColor: 'text-white',
  },
  oxsteed_ai: {
    icon: Bot,
    bubble: 'bg-gray-800 text-gray-100 border border-gray-700',
    labelColor: 'text-sky-400',
    align: 'left',
    iconBg: 'bg-sky-900/60',
    iconColor: 'text-sky-400',
  },
  oxsteed_human: {
    icon: Building2,
    bubble: 'bg-gray-800 text-gray-100 border border-gray-700',
    labelColor: 'text-violet-400',
    align: 'left',
    iconBg: 'bg-violet-900/60',
    iconColor: 'text-violet-400',
  },
  helper_ai: {
    icon: Bot,
    bubble: 'bg-gray-800 text-gray-100 border border-gray-700',
    labelColor: 'text-emerald-400',
    align: 'left',
    iconBg: 'bg-emerald-900/60',
    iconColor: 'text-emerald-400',
  },
  helper_human: {
    icon: UserCheck,
    bubble: 'bg-gray-800 text-gray-100 border border-brand-800/50',
    labelColor: 'text-brand-400',
    align: 'left',
    iconBg: 'bg-brand-900/60',
    iconColor: 'text-brand-400',
  },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, helperName }) => {
  const { t } = useTranslation();
  const config = AUTHOR_CONFIG[message.authorType];
  const isUser = message.authorType === 'user';
  const Icon = config.icon;

  const labelMap: Record<MessageAuthorType, string> = {
    user: t('helperProfile.chat.youLabel'),
    oxsteed_ai: 'OxSteed AI',
    oxsteed_human: 'OxSteed Support',
    helper_ai: t('helperProfile.chat.aiAssistant'),
    helper_human: helperName,
  };
  const displayLabel = labelMap[message.authorType];

  return (
    <div
      className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      aria-label={t('helperProfile.chat.messageFrom', { name: displayLabel })}
    >
      {/* Avatar icon */}
      <div
        className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 ${config.iconBg}`}
        aria-hidden="true"
      >
        <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
      </div>

      {/* Content */}
      <div className={`flex flex-col gap-1 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Author label */}
        <span className={`text-xs font-semibold ${config.labelColor}`}>{displayLabel}</span>

        {/* Bubble */}
        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${config.bubble} ${
          isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'
        }`}>
          {message.content}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {message.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  className="flex items-center gap-2 text-xs underline opacity-80 hover:opacity-100"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  📎 {att.name}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <time
          dateTime={message.timestamp}
          className="text-xs text-gray-600"
        >
          {formatTimestamp(message.timestamp)}
        </time>
      </div>
    </div>
  );
};

export default MessageBubble;
