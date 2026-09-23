import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { buildMessageActionItems } from './messengerShellState';

/**
 * Keep common message controls visible and tuck moderation under More.
 */
export default function MessageBubbleActions({
  onCopy,
  onEdit,
  onDelete,
  onReport = () => {},
  onBlock = () => {},
  canEdit = false,
  canDelete = false,
  canModerate = false,
  className = '',
}) {
  const { t } = useTranslation();
  const items = buildMessageActionItems({ canEdit, canDelete, canModerate });
  const visibleItems = items.filter((item) => item.kind === 'action' && !['report', 'block'].includes(item.id));

  const renderAction = (item) => {
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
      return <button key={item.id} type="button" className="messages-bubble-action-btn" onClick={onEdit}>{t('common.edit')}</button>;
    }
    if (item.id === 'delete') {
      return <button key={item.id} type="button" className="messages-bubble-action-btn" onClick={onDelete}>{t('common.delete')}</button>;
    }
    return null;
  };

  return (
    <div
      className={`messages-bubble-actions ${className}`.trim()}
      role="group"
      aria-label={t('messages.shell.messageActionsAria')}
    >
      {visibleItems.map(renderAction)}
      {canModerate && (
        <details className="messages-bubble-overflow">
          <summary aria-label={t('messages.shell.moreActions')}>
            {t('messages.shell.moreActions')}
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className="messages-bubble-overflow-menu">
            <button type="button" onClick={(event) => {
              onReport();
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}>
              {t('messages.reportMessage', { defaultValue: 'Report' })}
            </button>
            <button type="button" onClick={(event) => {
              onBlock();
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}>
              {t('messages.blockUser', { defaultValue: 'Block' })}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
