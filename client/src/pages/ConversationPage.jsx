import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const TYPING_EMIT_COOLDOWN = 2000; // stop-typing fires 2s after last keystroke

export default function ConversationPage() {
  const { conversationId } = useParams();
  const [messages, setMessages]             = useState([]);
  const [otherName, setOtherName]           = useState('');
  const [helperBusiness, setHelperBusiness] = useState('');
  const [jobTitle, setJobTitle]             = useState('');
  const [newMessage, setNewMessage]         = useState('');
  const [loading, setLoading]               = useState(true);
  const [sending, setSending]               = useState(false);
  const [notFound, setNotFound]             = useState(false);
  const [otherTyping, setOtherTyping]       = useState(false);
  // Track which messages have been read by the other party
  const [lastReadAt, setLastReadAt]         = useState(null);

  const messagesEndRef  = useRef(null);
  const inputRef        = useRef(null);
  const typingTimerRef  = useRef(null);
  const isTypingRef     = useRef(false);

  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, connected, joinConversation, leaveConversation } = useSocket();

  // ── Initial load ─────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get(`/messages/conversations/${conversationId}`);
      const data = Array.isArray(res.data) ? res.data : [];
      setMessages(data);
      // Derive other party's name from first message not sent by us
      const other = data.find(m => m.sender_id !== user?.id);
      if (other?.sender_name) setOtherName(other.sender_name);
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 404) {
        setNotFound(true);
      }
      console.error('[ConversationPage] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, user?.id]);

  // Load conversation metadata (name, business, job title) independently so
  // the header is accurate even before any messages exist.
  useEffect(() => {
    api.get(`/messages/conversations/${conversationId}/meta`)
      .then(res => {
        if (res.data.other_user_name) setOtherName(res.data.other_user_name);
        if (res.data.helper_business_name) setHelperBusiness(res.data.helper_business_name);
        if (res.data.job_title) setJobTitle(res.data.job_title);
      })
      .catch(() => {}); // non-fatal; header falls back to derived name
  }, [conversationId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // ── Join / leave socket room ──────────────────────────────────
  // `connected` is included so the room is rejoined on reconnect — Socket.IO
  // drops all room memberships on disconnect, so we must re-emit conversation:join
  // whenever the connection comes back up.
  useEffect(() => {
    if (!socket || !connected || !conversationId) return;
    joinConversation(conversationId);
    return () => leaveConversation(conversationId);
  }, [socket, connected, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Real-time events ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // New inbound or outbound message delivered to this thread
    const onMessageNew = ({ conversationId: cid, message }) => {
      if (String(cid) !== String(conversationId)) return;
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev; // dedup
        return [...prev, message];
      });
      // Derive name from inbound messages
      if (message.sender_id !== user?.id && message.sender_name && !otherName) {
        setOtherName(message.sender_name);
      }
    };

    // Other party started typing
    const onTyping = ({ conversationId: cid }) => {
      if (String(cid) !== String(conversationId)) return;
      setOtherTyping(true);
    };

    // Other party stopped typing
    const onStoppedTyping = ({ conversationId: cid }) => {
      if (String(cid) !== String(conversationId)) return;
      setOtherTyping(false);
    };

    // Other party read our messages — ignore self-triggered events because
    // broadcastToConversation() delivers to all room members including the reader.
    const onMessagesRead = ({ conversationId: cid, readBy, readAt }) => {
      if (String(cid) !== String(conversationId)) return;
      if (String(readBy) === String(user?.id)) return; // own read action, not the other party
      setLastReadAt(readAt);
    };

    socket.on('message:new',        onMessageNew);
    socket.on('user:typing',        onTyping);
    socket.on('user:stopped_typing', onStoppedTyping);
    socket.on('messages:read',      onMessagesRead);

    return () => {
      socket.off('message:new',        onMessageNew);
      socket.off('user:typing',        onTyping);
      socket.off('user:stopped_typing', onStoppedTyping);
      socket.off('messages:read',      onMessagesRead);
    };
  }, [socket, conversationId, user?.id, otherName]);

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, otherTyping]);

  // ── Typing indicator emit ─────────────────────────────────────
  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    if (!socket) return;

    if (!isTypingRef.current) {
      socket.emit('typing:start', conversationId);
      isTypingRef.current = true;
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit('typing:stop', conversationId);
      isTypingRef.current = false;
    }, TYPING_EMIT_COOLDOWN);
  };

  // Stop typing on blur
  const handleBlur = () => {
    if (isTypingRef.current && socket) {
      clearTimeout(typingTimerRef.current);
      socket.emit('typing:stop', conversationId);
      isTypingRef.current = false;
    }
  };

  // ── Send ──────────────────────────────────────────────────────
  const handleSend = async (e) => {
    e?.preventDefault();
    const content = newMessage.trim();
    if (!content || sending) return;

    // Stop typing indicator immediately on send
    if (isTypingRef.current && socket) {
      clearTimeout(typingTimerRef.current);
      socket.emit('typing:stop', conversationId);
      isTypingRef.current = false;
    }

    setSending(true);
    setNewMessage('');
    try {
      const res = await api.post(`/messages/conversations/${conversationId}`, { content });
      // Add via API response; socket will also fire for other-device dedup
      setMessages(prev => {
        if (prev.some(m => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
    } catch (err) {
      console.error('[ConversationPage] send error:', err);
      setNewMessage(content); // restore on failure
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Derived: last message sent by me (for "Seen" indicator) ───
  const lastSentByMe = [...messages].reverse().find(m => m.sender_id === user?.id);
  const showSeen = lastReadAt && lastSentByMe &&
    new Date(lastReadAt) >= new Date(lastSentByMe.created_at);

  // ── Render ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
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
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
          <p className="text-gray-500 text-sm">This conversation doesn't exist or you don't have access.</p>
          <button onClick={() => navigate('/messages')} className="text-blue-600 text-sm hover:underline">
            ← Back to messages
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />
      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/messages')}
            className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 flex-shrink-0">
              {(otherName || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-900 truncate">{otherName || 'Helper'}</h1>
              {helperBusiness && (
                <p className="text-xs text-gray-500 truncate leading-tight">{helperBusiness}</p>
              )}
              {jobTitle && (
                <p className="text-xs text-blue-600 truncate leading-tight">Re: {jobTitle}</p>
              )}
            </div>
          </div>
        </div>

        {/* Message thread */}
        <div className="flex-1 bg-white rounded-xl shadow overflow-y-auto p-4 mb-3 min-h-[400px] max-h-[60vh] flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-8">No messages yet. Say hello!</p>
          )}

          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            const isLastFromMe = showSeen && msg.id === lastSentByMe?.id;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && msg.sender_name && (
                  <span className="text-xs text-gray-400 mb-1 ml-1">{msg.sender_name}</span>
                )}
                <div className={`px-4 py-2 rounded-2xl max-w-xs sm:max-w-sm text-sm leading-relaxed ${
                  isMe
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>
                  {msg.content}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 px-1">
                  <span className="text-[11px] text-gray-400">{formatTime(msg.created_at)}</span>
                  {isLastFromMe && (
                    <span className="text-[11px] text-blue-500 font-medium">Seen</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {otherTyping && (
            <div className="flex items-start">
              <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm bg-gray-100 flex items-center gap-1">
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
            placeholder="Type a message…"
            maxLength={4000}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-1.5 text-right">Enter to send</p>

      </main>
      <Footer />
    </div>
  );
}
