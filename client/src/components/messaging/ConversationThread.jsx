import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, Globe, Paperclip } from 'lucide-react';
import { useConversationChat } from '../../hooks/useConversationChat';
import AutoTranslatedMessage from '../AutoTranslatedMessage';
import MessageReactions from '../MessageReactions';
import FinancialAdvisorPanel from '../FinancialAdvisorPanel';
import ConversationComposer from './ConversationComposer';
import { parseInlineAttachments, attachmentLabel, isImageAttachment } from '../../utils/messageAttachments';
import api from '../../api/axios';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageAttachments({ attachments }) {
  if (!attachments?.length) return null;
  return (
    <div className="messages-bubble-files">
      {attachments.map((att) => (
        isImageAttachment(att) ? (
          <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer">
            <img src={att.url} alt={attachmentLabel(att)} />
          </a>
        ) : (
          <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer">
            <Paperclip size={14} aria-hidden />
            {attachmentLabel(att)}
          </a>
        )
      ))}
    </div>
  );
}

export default function ConversationThread({
  conversationId,
  role = 'customer',
  onBack,
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [translateEnabled, setTranslateEnabled] = useState(() => {
    try { return localStorage.getItem('oxs:msg-translate') !== 'off'; } catch { return true; }
  });

  const toggleTranslate = () => {
    setTranslateEnabled((value) => {
      const next = !value;
      try { localStorage.setItem('oxs:msg-translate', next ? 'on' : 'off'); } catch {}
      return next;
    });
  };

  const chat = useConversationChat(conversationId, {
    listenProfileChat: role === 'helper',
  });

  const {
    messages, otherName, helperBusiness, jobTitle, otherUserId, jobId, helperId,
    newMessage, loading, sending, notFound, otherTyping, showSeen, lastSentByMe,
    stickToBottom, messagesEndRef, threadRef, inputRef,
    handleInputChange, handleBlur, sendMessage, retryMessage,
    handleThreadScroll, scrollToLatest, user,
  } = chat;

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm(t('messages.deleteConfirm'))) return;
    try {
      await api.delete(`/messages/conversations/${conversationId}/${messageId}`);
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  };

  const handleEditMessage = (messageId) => {
    const msg = messages.find((item) => item.id === messageId);
    if (msg) {
      setEditingId(messageId);
      setEditText(parseInlineAttachments(msg.content).text || msg.content);
    }
  };

  const handleSaveEdit = async (messageId) => {
    if (!editText.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await api.put(`/messages/conversations/${conversationId}/${messageId}`, {
        content: editText,
      });
      setEditingId(null);
      setEditText('');
    } catch (error) {
      console.error('Failed to edit message:', error);
    }
  };

  const starters = role === 'helper'
    ? [
        t('messages.starters.helper.thanks'),
        t('messages.starters.helper.when'),
        t('messages.starters.helper.details'),
      ]
    : [
        t('messages.starters.customer.available'),
        t('messages.starters.customer.quote'),
        t('messages.starters.customer.photos'),
      ];

  const profileHref = otherUserId && (role === 'customer' || String(helperId) === String(otherUserId))
    ? `/helpers/${otherUserId}`
    : null;

  if (loading) {
    return (
      <div className="messages-thread-loading">
        <div className="messages-spinner" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="messages-thread-empty">
        <p>{t('messages.conversationNotFound')}</p>
        <button type="button" onClick={onBack}>
          {t('messages.backToMessages')}
        </button>
      </div>
    );
  }

  return (
    <section className="messages-thread" aria-label={t('messages.chatWith', { name: otherName || '...' })}>
      <header className="messages-thread-head">
        <button type="button" className="messages-back mobile-only" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden />
          {t('common.back')}
        </button>
        <div className="messages-thread-person">
          <div className={`messages-avatar${role === 'helper' ? ' helper' : ''}`}>
            {(otherName || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            {profileHref ? (
              <Link to={profileHref} className="messages-thread-name">
                {otherName || (role === 'helper' ? t('messages.customer') : t('common.helper'))}
              </Link>
            ) : (
              <h1 className="messages-thread-name">
                {otherName || (role === 'helper' ? t('messages.customer') : t('common.helper'))}
              </h1>
            )}
            {helperBusiness && (
              <p className="messages-business">
                {role === 'helper' ? t('messages.via', { name: helperBusiness }) : helperBusiness}
              </p>
            )}
            {jobTitle && jobId && (
              <Link to={`/jobs/${jobId}`} className="messages-job">
                {t('messages.re', { title: jobTitle })}
              </Link>
            )}
            {jobTitle && !jobId && (
              <p className="messages-job">{t('messages.re', { title: jobTitle })}</p>
            )}
          </div>
        </div>
        <div className="messages-thread-actions">
          <button
            type="button"
            onClick={toggleTranslate}
            aria-pressed={translateEnabled}
            title={translateEnabled ? t('messages.translateOff') : t('messages.translateOn')}
            className={translateEnabled ? 'on' : ''}
          >
            <Globe size={14} aria-hidden />
            <span className="hide-sm">
              {translateEnabled ? t('messages.translateOff') : t('messages.translateOn')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowAdvisor((value) => !value)}
            title={t('financialAdvisor.title')}
          >
            {t('financialAdvisor.buttonLabel')}
          </button>
        </div>
      </header>

      <div
        ref={threadRef}
        className="messages-thread-scroll"
        onScroll={handleThreadScroll}
      >
        {messages.length === 0 && (
          <p className="messages-thread-note">
            {role === 'helper' ? t('messages.noMessagesReply') : t('messages.noMessagesStart')}
          </p>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === user?.id;
          const isLastFromMe = showSeen && msg.id === lastSentByMe?.id;
          const isEditing = editingId === msg.id;
          const parsed = parseInlineAttachments(msg.content);
          const attachments = [
            ...(Array.isArray(msg.attachments) ? msg.attachments : []),
            ...parsed.attachments,
          ];
          return (
            <div key={msg.id} className={`messages-bubble-wrap ${isMe ? 'mine' : 'theirs'}`}>
              {!isMe && msg.sender_name && (
                <span className="messages-bubble-author">{msg.sender_name}</span>
              )}
              {isEditing ? (
                <div className="messages-edit-box">
                  <textarea
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSaveEdit(msg.id);
                      }
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                    rows={2}
                    autoFocus
                  />
                  <div>
                    <button type="button" onClick={() => handleSaveEdit(msg.id)}>{t('common.save')}</button>
                    <button type="button" onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={`messages-bubble ${isMe ? 'mine' : 'theirs'}${msg._failed ? ' failed' : ''}${msg._pending ? ' pending' : ''}`}>
                    <AutoTranslatedMessage
                      text={parsed.text}
                      enabled={translateEnabled}
                      incomingOnly
                      isOwnMessage={isMe}
                    />
                    <MessageAttachments attachments={attachments} />
                    {msg.updated_at && msg.updated_at > msg.created_at && (
                      <span className="messages-edited">{t('messages.edited')}</span>
                    )}
                  </div>
                  {!msg._pending && !msg._failed && (
                    <MessageReactions
                      conversationId={conversationId}
                      messageId={msg.id}
                      reactions={msg.reactions || []}
                    />
                  )}
                  <div className="messages-bubble-meta">
                    {msg._pending && <span>{t('messages.sending')}</span>}
                    {msg._failed && (
                      <span className="failed">
                        {t('messages.failed')}
                        <button type="button" onClick={() => retryMessage(msg.id)}>
                          {t('messages.retry')}
                        </button>
                      </span>
                    )}
                    {!msg._pending && !msg._failed && <span>{formatTime(msg.created_at)}</span>}
                    {isLastFromMe && !msg._pending && !msg._failed && (
                      <span className="seen">{t('messages.seen')}</span>
                    )}
                    <div className="messages-bubble-actions">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(parsed.text || msg.content || '')}
                        aria-label={t('messages.copyMessage')}
                      >
                        {t('messages.copy')}
                      </button>
                      {isMe && (
                        <>
                          <button type="button" onClick={() => handleEditMessage(msg.id)}>
                            {t('common.edit')}
                          </button>
                          <button type="button" onClick={() => handleDeleteMessage(msg.id)}>
                            {t('common.delete')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {otherTyping && (
          <div className="messages-bubble-wrap theirs" aria-live="polite">
            <div className="messages-typing" aria-label={t('messages.typing')}>
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {!stickToBottom && (
        <button type="button" className="messages-jump-latest" onClick={() => scrollToLatest('smooth')}>
          <ChevronDown size={16} aria-hidden />
          {t('messages.jumpToLatest')}
        </button>
      )}

      <ConversationComposer
        conversationId={conversationId}
        value={newMessage}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onSend={sendMessage}
        sending={sending}
        inputRef={inputRef}
        starters={starters}
        showStarters={messages.length === 0}
        placeholder={role === 'helper' ? t('messages.typeReply') : t('messages.typeAMessage')}
      />

      <FinancialAdvisorPanel isOpen={showAdvisor} onClose={() => setShowAdvisor(false)} />
    </section>
  );
}
