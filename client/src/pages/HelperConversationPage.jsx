import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConversationChat } from '../hooks/useConversationChat';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import AutoTranslatedMessage from '../components/AutoTranslatedMessage';
import MessageReactions from '../components/MessageReactions';
import FinancialAdvisorPanel from '../components/FinancialAdvisorPanel';
import api from '../api/axios';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function HelperConversationPage() {
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
    user,
  } = useConversationChat(conversationId, { listenProfileChat: true });

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm(t('messages.confirmDelete') || 'Delete this message?')) return;
    try {
      await api.delete(`/messages/conversations/${conversationId}/${messageId}`);
      // Socket event message:deleted will update the list in real-time
    } catch {
      // silent - socket event won't fire so the message stays, which is correct
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
    } catch {
      // silent - message stays unchanged on failure
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-950">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
        </div>
        <Footer />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-950">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
          <p className="text-gray-400 text-sm">{t('messages.notFoundSub')}</p>
          <button onClick={() => navigate('/helper/messages')} className="text-orange-400 text-sm hover:text-orange-300 transition">
            ← {t('messages.backToMessages')}
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <Navbar />
      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/helper/messages')}
            className="text-gray-400 hover:text-white flex items-center gap-1 text-sm transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('messages.back')}
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
              {(otherName || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-white truncate">{otherName || t('messages.customer')}</h1>
              {helperBusiness && (
                <p className="text-xs text-gray-500 truncate leading-tight">{t('messages.via', { name: helperBusiness })}</p>
              )}
              {jobTitle && (
                <p className="text-xs text-orange-400/80 truncate leading-tight">{t('messages.re', { title: jobTitle })}</p>
              )}
            </div>
          </div>
          {/* Financial Advisor button */}
          <button
            onClick={() => setShowAdvisor(v => !v)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/60 text-emerald-300 text-xs font-medium transition"
            title={t('financialAdvisor.title') || 'AI Finance Calculator'}
          >
            💰 <span className="hidden sm:inline">{t('financialAdvisor.buttonLabel') || 'AI Finance Calculator'}</span>
          </button>
        </div>

        {/* Message thread */}
        <div className="flex-1 bg-gray-900 border border-gray-700/50 rounded-2xl overflow-y-auto p-4 mb-4 min-h-[400px] max-h-[60vh] flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-600 text-center mt-8">{t('messages.noMessagesReply')}</p>
          )}
          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            const isLastFromMe = showSeen && msg.id === lastSentByMe?.id;
            const isEditing = editingId === msg.id;
            return (
              <div key={msg.id} className={`flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && msg.sender_name && (
                  <span className="text-xs text-gray-500 mb-1 ml-1">{msg.sender_name}</span>
                )}
                {isEditing ? (
                  <div className="max-w-xs sm:max-w-sm w-full flex flex-col gap-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(msg.id); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="px-4 py-2 rounded-2xl border border-orange-500 bg-gray-800 text-white text-sm resize-none focus:outline-none"
                      rows={2}
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => handleSaveEdit(msg.id)}
                        className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition"
                      >
                        {t('common.save') || 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition"
                      >
                        {t('common.cancel') || 'Cancel'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className={`px-4 py-2.5 rounded-2xl max-w-xs sm:max-w-sm text-sm leading-relaxed ${
                        isMe
                          ? 'bg-orange-500 text-white rounded-br-sm'
                          : 'bg-gray-700/70 text-gray-100 rounded-bl-sm'
                      }`}>
                        <AutoTranslatedMessage
                          text={msg.content}
                          incomingOnly
                          isOwnMessage={isMe}
                        />
                        {msg.updated_at && msg.updated_at > msg.created_at && (
                          <span className="text-xs opacity-70 ml-2">({t('messages.edited') || 'edited'})</span>
                        )}
                      </div>
                      <div className={isMe ? 'flex justify-end' : 'flex justify-start'}>
                        <MessageReactions
                          conversationId={conversationId}
                          messageId={msg.id}
                          reactions={msg.reactions || []}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 px-1">
                      <span className="text-[11px] text-gray-600">{formatTime(msg.created_at)}</span>
                      {isLastFromMe && (
                        <span className="text-[11px] text-orange-400 font-medium">{t('messages.seen')}</span>
                      )}
                      {/* Message action buttons - visible on hover */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={() => navigator.clipboard.writeText(msg.content)}
                          className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition"
                          title={t('messages.copy') || 'Copy'}
                          aria-label={t('messages.copy') || 'Copy message'}
                        >
                          📋
                        </button>
                        {isMe && (
                          <>
                            <button
                              onClick={() => handleEditMessage(msg.id)}
                              className="p-0.5 rounded text-gray-500 hover:text-orange-400 transition"
                              title={t('messages.edit') || 'Edit'}
                              aria-label={t('messages.edit') || 'Edit message'}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="p-0.5 rounded text-gray-500 hover:text-red-400 transition"
                              title={t('messages.delete') || 'Delete'}
                              aria-label={t('messages.delete') || 'Delete message'}
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
              <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-gray-700/70 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
            placeholder={t('messages.typeReply')}
            maxLength={4000}
            className="flex-1 rounded-xl bg-gray-900 border border-gray-700 text-white placeholder-gray-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition"
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
          >
            {sending ? t('messages.sending') : t('messages.send')}
          </button>
        </form>
        <p className="text-xs text-gray-600 mt-1.5 text-right">{t('messages.enterToSend')}</p>
      </main>
      <Footer />
      <FinancialAdvisorPanel isOpen={showAdvisor} onClose={() => setShowAdvisor(false)} />
    </div>
  );
}
