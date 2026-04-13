import { useParams, useNavigate } from 'react-router-dom';
import { useConversationChat } from '../hooks/useConversationChat';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function HelperConversationPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();

  const {
    messages, otherName, helperBusiness, jobTitle,
    newMessage, loading, sending, notFound,
    otherTyping, showSeen, lastSentByMe,
    messagesEndRef, inputRef,
    handleInputChange, handleBlur, handleSend, handleKeyDown,
    user,
  } = useConversationChat(conversationId, { listenProfileChat: true });

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
          <p className="text-gray-400 text-sm">This conversation doesn't exist or you don't have access.</p>
          <button onClick={() => navigate('/helper/messages')} className="text-orange-400 text-sm hover:text-orange-300 transition">
            ← Back to messages
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
            Back
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
              {(otherName || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-white truncate">{otherName || 'Customer'}</h1>
              {helperBusiness && (
                <p className="text-xs text-gray-500 truncate leading-tight">via {helperBusiness}</p>
              )}
              {jobTitle && (
                <p className="text-xs text-orange-400/80 truncate leading-tight">Re: {jobTitle}</p>
              )}
            </div>
          </div>
        </div>

        {/* Message thread */}
        <div className="flex-1 bg-gray-900 border border-gray-700/50 rounded-2xl overflow-y-auto p-4 mb-4 min-h-[400px] max-h-[60vh] flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-600 text-center mt-8">No messages yet. Send the first reply below.</p>
          )}
          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            const isLastFromMe = showSeen && msg.id === lastSentByMe?.id;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && msg.sender_name && (
                  <span className="text-xs text-gray-500 mb-1 ml-1">{msg.sender_name}</span>
                )}
                <div className={`px-4 py-2.5 rounded-2xl max-w-xs sm:max-w-sm text-sm leading-relaxed ${
                  isMe
                    ? 'bg-orange-500 text-white rounded-br-sm'
                    : 'bg-gray-700/70 text-gray-100 rounded-bl-sm'
                }`}>
                  {msg.content}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 px-1">
                  <span className="text-[11px] text-gray-600">{formatTime(msg.created_at)}</span>
                  {isLastFromMe && (
                    <span className="text-[11px] text-orange-400 font-medium">Seen</span>
                  )}
                </div>
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
            placeholder="Type a reply…"
            maxLength={4000}
            className="flex-1 rounded-xl bg-gray-900 border border-gray-700 text-white placeholder-gray-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition"
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
        <p className="text-xs text-gray-600 mt-1.5 text-right">Enter to send</p>
      </main>
      <Footer />
    </div>
  );
}
