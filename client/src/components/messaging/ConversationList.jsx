import { useTranslation } from 'react-i18next';
import { MessageSquare, RotateCcw } from 'lucide-react';
import { formatInboxTime } from '../../utils/inboxTimeFormat';
import { conversationDisplayName, conversationPreview } from './messengerShellState';

/**
 * Shared conversation list for /messages and Business Hub Deals.
 * Pass `renderItem` for surface-specific row chrome; default row is deal-friendly.
 */
export default function ConversationList({
  items = [],
  selectedId = null,
  onSelect,
  loading = false,
  empty = null,
  ariaLabel,
  renderItem = null,
  getUnread = null,
  onRestore = null,
  restoreLabel = null,
  className = '',
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="messages-loading sms-list-loading">
        <div className="messages-spinner" />
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (!items.length) {
    return empty || (
      <div className="messages-empty compact sms-list-empty">
        <MessageSquare size={28} aria-hidden />
        <p>{t('messages.shell.listEmpty')}</p>
      </div>
    );
  }

  return (
    <section
      className={`messages-panel sms-conversation-list ${className}`.trim()}
      aria-label={ariaLabel || t('messages.conversationListAriaLabel')}
    >
      {items.map((conv) => {
        const isActive = String(selectedId) === String(conv.id);
        const unread = typeof getUnread === 'function'
          ? getUnread(conv)
          : parseInt(conv.unread_count, 10) > 0;
        if (typeof renderItem === 'function') {
          return renderItem(conv, { isActive, unread, onSelect });
        }
        const name = conversationDisplayName(conv, t('messages.customer'));
        const preview = conversationPreview(conv) || t('messages.noMessages');
        const time = formatInboxTime(conv.last_message_at || conv.created_at);
        const row = (
          <button
            key={conv.id}
            type="button"
            onClick={() => onSelect?.(conv)}
            className={`messages-row sms-conversation-row${unread ? ' unread' : ''}${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            <div className="messages-avatar">
              {(name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="messages-row-main">
              <div className="messages-row-top">
                <strong>{name}</strong>
                {time ? <span>{time}</span> : null}
              </div>
              <p className="messages-preview">{preview}</p>
            </div>
            {unread ? (
              <span className="messages-unread">
                {conv.unread_count || t('messages.newBadge')}
              </span>
            ) : null}
          </button>
        );

        if (!onRestore) return row;

        return (
          <div key={conv.id} className="messages-row-with-action">
            {row}
            <button
              type="button"
              className="messages-row-restore"
              onClick={(event) => {
                event.stopPropagation();
                onRestore(conv);
              }}
              aria-label={`${restoreLabel || t('messages.restore')} ${name}`}
              title={restoreLabel || t('messages.restore')}
            >
              <RotateCcw size={14} aria-hidden />
              <span>{restoreLabel || t('messages.restore')}</span>
            </button>
          </div>
        );
      })}
    </section>
  );
}
