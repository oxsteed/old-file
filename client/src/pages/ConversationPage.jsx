import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConversationChat } from '../hooks/useConversationChat';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import AutoTranslatedMessage from '../components/AutoTranslatedMessage';
import MessageReactions from '../components/MessageReactions';
import FinancialAdvisorPanel from '../components/FinancialAdvisorPanel';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const MessageActions = ({ message, user, onDelete, onEdit }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const isOwn = message.sender_id === user?.id;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = () => {
    if (window.confirm(t('messages.deleteConfirm'))) {
      onDelete?.(message.id);
    }
  };

  return (
    <div className="flex items-center gap-1 mt-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleCopy}
        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition"
        title={copied ? t('messages.copied') : t('messages.copyMessage')}
        aria-label={t('messages.copy')}
      >
        📋
      </button>
      {isOwn && (
        <>
          <button
            onClick={() => onEdit?.(message.id)}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition"
            title={t('messages.editMessage')}
            aria-label={t('common.edit')}
          >
            ✏️
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition"
            title={t('messages.deleteMessage')}
            aria-label={t('common.delete')}
          >
            🗑️
          </button>
        </>
      )}
    </div>
  );
};

export default function ConversationPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [editingId, setEditingId] = React.useState(null);
  const [editText, setEditText] = React.useState('');
  const [showAdvisor, setShowAdvisor] = React.useState(false);

  const {
    messages, otherName, helperBusiness, jobTitle,
    newMessage, loading, sending, notFound,
    otherTyping, showSeen, lastSentByMe,
    messagesEndRef, inputRef,
    handleInputChange, handleBlur, handleSend, handleKeyDown,
    retryMessage,
    user,
  } = useConversationChat(conversationId);

  const handleDeleteMessage = async (messageId) => {
    try {
      await api.delete(`/messages/conversations/${conversationId}/${messageId}`);
      // Message will be removed by socket event, or we can refetch
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  };

  const handleEditMessage = (messageId) => {
    const msg = messages.find(m => m.id === messageId);
    if (msg) {
      setEditingId(messageId);
      setEditText(msg.content);
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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
        <Footer />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('messages.conversationNotFound')}</p>
          <button onClick={() => navigate('/messages')} className="text-blue-600 dark:text-blue-400 text-sm hover:underline">
            {t('messages.backToMessages')}
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <PageMeta title={t('messages.chatWith', { name: otherName || '...' })} noIndex={true} />
      <Navbar />
      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/messages')}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1 text-sm transition"
          >

            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('common.back')}
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
              {(otherName || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate">{otherName || t('common.helper')}</h1>
              {helperBusiness && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-tight">{helperBusiness}</p>
              )}
              {jobTitle && (
                <p className="text-xs text-blue-600 truncate leading-tight">{t('messages.re')}: {jobTitle}</p>
              )}
            </div>
          </div>
          {/* Financial Advisor button */}
          <button
            onClick={() => setShowAdvisor(v => !v)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-medium transition"
            title={t('financialAdvisor.title') || 'AI Finance Calculator'}
          >
            💰 <span className="hidden sm:inline">{t('financialAdvisor.buttonLabel') || 'AI Finance Calculator'}</span>
          </button>
        </div>

        {/* Message thread */}
        <div className="flex-1 bg-white dark:bg-gray-900 rounded-xl shadow overflow-y-auto p-4 mb-3 min-h-[400px] max-h-[60vh] flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-8">{t('messages.noMessagesStart')}</p>
          )}
          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            const isLastFromMe = showSeen && msg.id === lastSentByMe?.id;
            const isEditing = editingId === msg.id;
            return (
              <div key={msg.id} className={`flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && msg.sender_name && (
                  <span className="text-xs text-gray-400 mb-1 ml-1">{msg.sender_name}</span>
                )}
                {isEditing ? (
                  <div className="max-w-xs sm:max-w-sm w-full flex flex-col gap-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="px-4 py-2 rounded-2xl border border-blue-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm resize-none"
                      rows={2}
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => handleSaveEdit(msg.id)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        {t('common.save')}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 text-xs bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={`flex flex-col gap-1`}>
                      <div className={`px-4 py-2 rounded-2xl max-w-xs sm:max-w-sm text-sm leading-relaxed transition-opacity ${
                        isMe
                          ? `rounded-br-sm ${msg._failed ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'} ${msg._pending ? 'opacity-60' : 'opacity-100'}`
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-sm'
                      }`}>
                        <AutoTranslatedMessage
                          text={msg.content}
                          incomingOnly
                          isOwnMessage={isMe}
                        />
                        {msg.updated_at && msg.updated_at > msg.created_at && (
                          <span className="text-xs opacity-75 ml-2">(edited)</span>
                        )}
                      </div>
                      {!msg._pending && !msg._failed && (
                        <div className={isMe ? 'flex justify-end' : 'flex justify-start'}>
                          <MessageReactions
                            conversationId={conversationId}
                            messageId={msg.id}
                            reactions={msg.reactions || []}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 px-1">
                      {msg._pending && (
                        <span className="text-[11px] text-gray-400 flex items-center gap-1">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                          </svg>
                          {t('messages.sending') || 'Sending'}
                        </span>
                      )}
                      {msg._failed && (
                        <span className="text-[11px] text-red-500 flex items-center gap-1">
                          {t('messages.failed') || 'Not sent'}
                          <button
                            onClick={() => retryMessage(msg.id)}
                            className="underline hover:no-underline font-medium"
                          >
                            {t('messages.retry') || 'Retry'}
                          </button>
                        </span>
                      )}
                      {!msg._pending && !msg._failed && (
                        <span className="text-[11px] text-gray-400">{formatTime(msg.created_at)}</span>
                      )}
                      {isLastFromMe && !msg._pending && !msg._failed && (
                        <span className="text-[11px] text-blue-500 font-medium">{t('messages.seen')}</span>
                      )}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content);
                          }}
                          className="p-0.5 rounded text-gray-400 hover:text-gray-600 transition"
                          title={t('messages.copyMessage')}
                          aria-label={t('messages.copyMessage')}
                        >
                          📋
                        </button>
                        {isMe && (
                          <>
                            <button
                              onClick={() => handleEditMessage(msg.id)}
                              className="p-0.5 rounded text-gray-400 hover:text-gray-600 transition"
                              title={t('messages.editMessage')}
                              aria-label={t('messages.editMessage')}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="p-0.5 rounded text-gray-400 hover:text-red-600 transition"
                              title={t('messages.deleteMessage')}
                              aria-label={t('messages.deleteMessage')}
                            >
                              🗑️
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
          {/* Typing indicator */}
          {otherTyping && (
            <div className="flex items-start">
              <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm bg-gray-100 dark:bg-gray-700 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Compose */}
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={t('messages.typeAMessage')}
            maxLength={4000}
            className="flex-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition"
          >
            {sending ? t('common.sending') : t('common.send')}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-1.5 text-right">{t('messages.enterToSend')}</p>
      </main>
      <Footer />
      <FinancialAdvisorPanel isOpen={showAdvisor} onClose={() => setShowAdvisor(false)} />
    </div>
  );
}
