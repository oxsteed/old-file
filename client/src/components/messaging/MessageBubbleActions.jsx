import { useTranslation } from 'react-i18next';
import { buildMessageActionItems } from './messengerShellState';

/**
 * Spaced Copy | Edit | Delete controls — never concatenated text.
 */
export default function MessageBubbleActions({
  onCopy,
  onEdit,
  onDelete,
  canEdit = false,
  canDelete = false,
  className = '',
}) {
  const { t } = useTranslation();
  const items = buildMessageActionItems({ canEdit, canDelete });

  return (
    <div
      className={`messages-bubble-actions ${className}`.trim()}
      role="group"
      aria-label={t('messages.shell.messageActionsAria')}
    >
      {items.map((item) => {
        if (item.kind === 'sep') {
          return (
            <span key={item.id} className="messages-bubble-action-sep" aria-hidden="true">
              |
            </span>
          );
        }
        if (item.id === 'copy') {
          return (
            <button
              key={item.id}
              type="button"
              className="messages-bubble-action-btn"
              onClick={onCopy}
              aria-label={t('messages.copyMessage')}
            >
              {t('messages.copy')}
            </button>
          );
        }
        if (item.id === 'edit') {
          return (
            <button
              key={item.id}
              type="button"
              className="messages-bubble-action-btn"
              onClick={onEdit}
            >
              {t('common.edit')}
            </button>
          );
        }
        if (item.id === 'delete') {
          return (
            <button
              key={item.id}
              type="button"
              className="messages-bubble-action-btn"
              onClick={onDelete}
            >
              {t('common.delete')}
            </button>
          );
        }
        return null;
      })}
    </div>
  );
}
