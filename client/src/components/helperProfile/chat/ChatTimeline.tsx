import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
          return (
            <MessageBubble
              key={item.id}
              message={item}
              helperName={helperName}
              currentUserId={currentUserId}
              onDelete={onMessageDelete}
              onEdit={onMessageEdit}
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
