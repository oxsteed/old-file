import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import type {
  TimelineItem,
  ChatMessage as ChatMessageType,
  TimelineEvent as TimelineEventType,
  TypingIndicator,
} from '../../../types/helperProfile';
import MessageBubble from './MessageBubble';
import TimelineEventItem from './TimelineEventItem';

interface ChatTimelineProps {
  items: TimelineItem[];
  helperName: string;
  typing?: TypingIndicator | null;
  currentUserId?: string;
  onMessageDelete?: (messageId: string) => void;
  onMessageEdit?: (messageId: string) => void;
  onQuickReply?: (text: string) => void;
  editingMessageId?: string | null;
  editingText?: string;
  onEditTextChange?: (text: string) => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
  isAuthenticated?: boolean;
  guestVerified?: boolean;
  guestAuthHeaders?: Record<string, string> | null;
  onQuoteAccepted?: (payload: any) => void;
  onQuoteDeclined?: (payload: any, action?: string) => void;
  onQuoteRequestVerify?: () => void;
  isProviderView?: boolean;
  conversationId?: string | null;
  onProposeTime?: (payload: { booking: any; conversationId?: string | null }) => void;
}

function isMessage(item: TimelineItem): item is ChatMessageType {
  return item.itemType === 'message';
}

const TypingBubble: React.FC<{ author: string }> = ({ author }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5" aria-live="polite" aria-label={t('helperProfile.chat.isTypingAria', { author })}>
      <div className="w-7 h-7 rounded-full bg-gray-700 flex-shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 px-3.5 py-2.5 rounded-2xl rounded-tl-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-gray-500">{t('helperProfile.chat.isTyping', { author })}</span>
    </div>
  );
};

const ChatTimeline: React.FC<ChatTimelineProps> = ({
  items,
  helperName,
  typing,
  currentUserId,
  onMessageDelete,
  onMessageEdit,
  onQuickReply,
  editingMessageId,
  editingText,
  onEditTextChange,
  onEditSave,
  onEditCancel,
  isAuthenticated,
  guestVerified,
  guestAuthHeaders,
  onQuoteAccepted,
  onQuoteDeclined,
  onQuoteRequestVerify,
  isProviderView,
  conversationId = null,
  onProposeTime,
}) => {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items, typing]);

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scroll-smooth"
      role="log"
      aria-label={t('helperProfile.chat.chatConversation')}
      aria-live="polite"
    >
      {items.map((item) => {
        if (isMessage(item)) {
          // Render inline edit form when this message is being edited
          if (editingMessageId === item.id) {
            return (
              <div key={item.id} className="flex flex-col items-end gap-1.5">
                <textarea
                  value={editingText}
                  onChange={e => onEditTextChange?.(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave?.(); }
                    if (e.key === 'Escape') onEditCancel?.();
                  }}
                  autoFocus
                  rows={2}
                  maxLength={4000}
                  className="w-full max-w-xs sm:max-w-sm rounded-2xl rounded-br-sm bg-brand-900 border border-brand-500 text-white text-sm px-3.5 py-2.5 resize-none focus:outline-none"
                  aria-label={t('helperProfile.chat.editMessage') || 'Edit message'}
                />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={onEditSave}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors"
                    aria-label={t('common.save') || 'Save'}
                  >
                    <Check className="w-3 h-3" /> {t('common.save') || 'Save'}
                  </button>
                  <button
                    onClick={onEditCancel}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium transition-colors"
                    aria-label={t('common.cancel') || 'Cancel'}
                  >
                    <X className="w-3 h-3" /> {t('common.cancel') || 'Cancel'}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <MessageBubble
              key={item.id}
              message={item}
              helperName={helperName}
              currentUserId={currentUserId}
              onDelete={onMessageDelete}
              onEdit={onMessageEdit}
              isAuthenticated={isAuthenticated}
              guestVerified={guestVerified}
              guestAuthHeaders={guestAuthHeaders}
              onQuoteAccepted={onQuoteAccepted}
              onQuoteDeclined={onQuoteDeclined}
              onQuoteRequestVerify={onQuoteRequestVerify}
              isProviderView={isProviderView}
              conversationId={conversationId}
              onProposeTime={onProposeTime}
              onQuickReply={onQuickReply}
              showQuickReplies={true}
            />
          );
        }
        return (
          <TimelineEventItem
            key={item.id}
            event={item as TimelineEventType}
          />
        );
      })}

      {typing && <TypingBubble author={typing.authorLabel} />}

      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
};

export default ChatTimeline;
