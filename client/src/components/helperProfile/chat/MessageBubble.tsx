import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Building2, User, UserCheck, Copy, ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react';
import type { ChatMessage, MessageAuthorType } from '../../../types/helperProfile';
import api from '../../../api/axios';
import AutoTranslatedMessage from '../../AutoTranslatedMessage';
import QuoteCard from './QuoteCard';
import ProofOfPaymentCard from './ProofOfPaymentCard';
import AgreementCard from './AgreementCard';
import { parseQuoteMarker, stripQuoteMarkers } from './messengerQuotes.js';
import { parsePopMarker, stripPopMarkers } from './messengerPop.js';
import { parseAgreementMarker, stripAgreementMarkers } from './messengerAgreements.js';

interface MessageBubbleProps {
  message: ChatMessage;
  helperName: string;
  currentUserId?: string;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string) => void;
  onQuickReply?: (text: string) => void;
  showQuickReplies?: boolean;
  isAuthenticated?: boolean;
  guestVerified?: boolean;
  guestAuthHeaders?: Record<string, string> | null;
  onQuoteAccepted?: (payload: any) => void;
  onQuoteDeclined?: (payload: any, action?: string) => void;
  onQuoteRequestVerify?: () => void;
  isProviderView?: boolean;
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

const QUICK_REPLIES = [
  'Thanks for the help!',
  'Got it, thanks',
  'Can you explain that more?',
  'That makes sense',
  'Need more details',
  'Sounds good',
];

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

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  helperName,
  currentUserId,
  onDelete,
  onEdit,
  onQuickReply,
  showQuickReplies,
  isAuthenticated = false,
  guestVerified = false,
  guestAuthHeaders = null,
  onQuoteAccepted,
  onQuoteDeclined,
  onQuoteRequestVerify,
  isProviderView = false,
}) => {
  const { t } = useTranslation();
  const config = AUTHOR_CONFIG[message.authorType] || AUTHOR_CONFIG.user;
  const isUser = message.authorType === 'user';
  const isAI = message.authorType?.includes('ai');
  const Icon = config?.icon;
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showQuickRepliesMenu, setShowQuickRepliesMenu] = useState(false);
  const canEdit = currentUserId && message.authorType === 'user' && currentUserId === message.sender_id;

  const labelMap: Record<MessageAuthorType, string> = {
    user: t('helperProfile.chat.youLabel'),
    oxsteed_ai: t('helperProfile.chat.oxsteedAssistantLabel'),
    oxsteed_human: t('helperProfile.chat.oxsteedAssistantLabel'),
    helper_ai: t('helperProfile.chat.aiAssistant'),
    helper_human: helperName,
  };
  const displayLabel = labelMap[message.authorType];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail
    }
  };

  const handleFeedback = async (value: 'up' | 'down') => {
    setFeedback(feedback === value ? null : value);
    try {
      await api.post('/chat/feedback', {
        value: feedback === value ? null : value,
        messageContent: message.content.slice(0, 80),
        pageContext: { path: window.location.pathname },
      });
    } catch {
      // silent fail
    }
  };

  return (
    <div
      className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}
      aria-label={t('helperProfile.chat.messageFrom', { name: displayLabel })}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
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

        {/* Bubble with action buttons */}
        <div className="relative">
          <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${config.bubble} ${
            isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'
          }`}>
            {(() => {
              const quoteParsed = parseQuoteMarker(message.content);
              const popParsed = parsePopMarker(message.content);
              const agreementParsed = parseAgreementMarker(message.content);
              let displayText = message.content;
              if (quoteParsed) displayText = stripQuoteMarkers(displayText);
              if (popParsed) displayText = stripPopMarkers(displayText);
              if (agreementParsed) displayText = stripAgreementMarkers(displayText);
              return (
                <>
                  {displayText ? (
                    <AutoTranslatedMessage
                      text={displayText}
                      incomingOnly
                      isOwnMessage={isUser}
                      compact
                    />
                  ) : null}
                  {quoteParsed ? (
                    <div className="mt-2">
                      <QuoteCard
                        markerText={message.content}
                        isProvider={isProviderView}
                        isAuthenticated={isAuthenticated}
                        guestVerified={guestVerified}
                        guestAuthHeaders={guestAuthHeaders}
                        onAccepted={onQuoteAccepted}
                        onDeclined={onQuoteDeclined}
                        onRequestVerify={onQuoteRequestVerify}
                      />
                    </div>
                  ) : null}
                  {popParsed ? (
                    <div className="mt-2">
                      <ProofOfPaymentCard
                        markerText={message.content}
                        isProvider={isProviderView}
                        guestAuthHeaders={guestAuthHeaders}
                      />
                    </div>
                  ) : null}
                  {agreementParsed ? (
                    <div className="mt-2">
                      <AgreementCard
                        markerText={message.content}
                        isProvider={isProviderView}
                        isAuthenticated={isAuthenticated}
                        guestVerified={guestVerified}
                        guestAuthHeaders={guestAuthHeaders}
                        onRequestVerify={onQuoteRequestVerify}
                      />
                    </div>
                  ) : null}
                </>
              );
            })()}

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

          {/* Seen indicator for user messages */}
          {isUser && message.isRead && (
            <div className="text-xs text-gray-500 mt-1 text-right">
              {t('helperProfile.chat.seen')}
            </div>
          )}
        </div>

        {/* Action buttons (copy, like/dislike, edit, delete) */}
        {showActions && (
          <div className={`flex items-center gap-1 mt-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
              <button
                onClick={handleCopy}
                className="p-1 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition-colors"
                title={copied ? t('helperProfile.chat.copied') : t('helperProfile.chat.copyMessage')}
                aria-label={t('helperProfile.chat.copyMessage')}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>

              {isAI && (
                <>
                  <button
                    onClick={() => handleFeedback('up')}
                    className={`p-1 rounded-md transition-colors ${
                      feedback === 'up'
                        ? 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                    }`}
                    title={t('helperProfile.chat.helpful')}
                    aria-label={t('helperProfile.chat.helpfulLabel')}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleFeedback('down')}
                    className={`p-1 rounded-md transition-colors ${
                      feedback === 'down'
                        ? 'text-red-500 bg-red-100 dark:bg-red-900/30'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                    }`}
                    title={t('helperProfile.chat.notHelpful')}
                    aria-label={t('helperProfile.chat.notHelpfulLabel')}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setShowQuickRepliesMenu(!showQuickRepliesMenu)}
                    className={`p-1 rounded-md transition-colors ${
                      showQuickRepliesMenu
                        ? 'text-blue-500 bg-blue-100 dark:bg-blue-900/30'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                    }`}
                    title={t('helperProfile.chat.quickReplies')}
                    aria-label={t('helperProfile.chat.quickReplies')}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              {canEdit && (
                <>
                  <button
                    onClick={() => onEdit?.(message.id)}
                    className="p-1 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition-colors"
                    title={t('helperProfile.chat.editMessage')}
                    aria-label={t('helperProfile.chat.editMessage')}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(t('helperProfile.chat.deleteConfirm'))) {
                        onDelete?.(message.id);
                      }
                    }}
                    className="p-1 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors"
                    title={t('helperProfile.chat.deleteMessage')}
                    aria-label={t('helperProfile.chat.deleteMessage')}
                  >
                    🗑️
                  </button>
                </>
              )}
            </div>
          )}

        {/* Timestamp */}
        <time
          dateTime={message.timestamp}
          className="text-xs text-gray-600"
        >
          {formatTimestamp(message.timestamp)}
        </time>

        {/* Quick replies (for AI messages) */}
        {isAI && showQuickReplies && showQuickRepliesMenu && (
          <div className="mt-2 flex flex-wrap gap-1">
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply}
                onClick={() => {
                  onQuickReply?.(reply);
                  setShowQuickRepliesMenu(false);
                }}
                className="inline-block px-2.5 py-1 text-xs rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
              >
                {reply}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
