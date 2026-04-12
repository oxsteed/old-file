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

const TYPING_EMIT_COOLDOWN = 2000;

export default function HelperConversationPage() {
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
  const [lastReadAt, setLastReadAt]         = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);
  const typingTimerRef = useRef(null);
  const isTypingRef    = useRef(false);

  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, connected, joinConversation, leaveConversation } = useSocket();

  // ── Initial load ─────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get(`/messages/conversations/${conversationId}`);
      const data = Array.isArray(res.data) ? res.data : [];
      setMessages(data);
      const other = data.find(m => m.sender_id !== user?.id);
      if (other?.sender_name) setOtherName(other.sender_name);
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 403) {
        setNotFound(true);
      }
      console.error('[HelperConversation] Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, user?.id]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Load conversation metadata for the header
  useEffect(() => {
    api.get(`/messages/conversations/${conversationId}/meta`)
      .then(res => {
        if (res.data.other_user_name) setOtherName(res.data.other_user_name);
        if (res.data.helper_business_name) setHelperBusiness(res.data.helper_business_name);
        if (res.data.job_title) setJobTitle(res.data.job_title);
      })
      .catch(() => {});
  }, [conversationId]);

  // ── Join / leave socket room ──────────────────────────────────
  // `connected` is included so the room is rejoined on reconnect — Socket.IO
  // drops all room memberships on disconnect, so we must re-emit conversation:join
  // whenever the connection comes back up.
  useEffect(() => {
    if (!socket || !connected || !conversationId) return;
    joinConversation(conversationId);
    return () => leaveConversation(conversationId);
  }, [socket, connected, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, otherTyping]);

  // ── Real-time events ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleNew = ({ conversationId: cid, message }) => {
      if (String(cid) !== String(conversationId)) return;
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      if (message.sender_id !== user?.id && message.sender_name && !otherName) {
        setOtherName(message.sender_name);
      }
    };

    // Inbound from customer via profile chat (also caught by handleNew above
    // once they're in the same conversation room, but keep for fallback)
    const handleProfileNew = ({ conversationId: cid, message, senderName }) => {
      if (String(cid) !== String(conversationId)) return;
      const enriched = senderName && !message.sender_name
        ? { ...message, sender_name: senderName }
        : message;
      if (senderName && !otherName) setOtherName(senderName);
      setMessages(prev => {
        if (prev.some(m => m.id === enriched.id)) return prev;
        return [...prev, enriched];
      });
    };

    const onTyping = ({ conversationId: cid }) => {
      if (String(cid) !== String(conversationId)) return;
      setOtherTyping(true);
    };

    const onStoppedTyping = ({ conversationId: cid }) => {
      if (String(cid) !== String(conversationId)) return;
      setOtherTyping(false);
    };

    const onMessagesRead = ({ conversationId: cid, readBy, readAt }) => {
      if (String(cid) !== String(conversationId)) return;
      if (String(readBy) === String(user?.id)) return; // ignore own read events
      setLastReadAt(readAt);
    };

    socket.on('message:new',             handleNew);
    socket.on('profile_chat:new_message', handleProfileNew);
    socket.on('user:typing',             onTyping);
    socket.on('user:stopped_typing',     onStoppedTyping);
    socket.on('messages:read',           onMessagesRead);

    return () => {
      socket.off('message:new',             handleNew);
      socket.off('profile_chat:new_message', handleProfileNew);
      socket.off('user:typing',             onTyping);
      socket.off('user:stopped_typing',     onStoppedTyping);
      socket.off('messages:read',           onMessagesRead);
    };
  }, [socket, conversationId, user?.id, otherName]);

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

    if (isTypingRef.current && socket) {
      clearTimeout(typingTimerRef.current);
      socket.emit('typing:stop', conversationId);
      isTypingRef.current = false;
    }

    setSending(true);
    setNewMessage('');
    try {
      const res = await api.post(`/messages/conversations/${conversationId}`, { content });
      setMessages(prev => {
        if (prev.some(m => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
    } catch (err) {
      console.error('[HelperConversation] Failed to send message:', err);
      setNewMessage(content);
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

  // ── "Seen" indicator ──────────────────────────────────────────
  const lastSentByMe = [...messages].reverse().find(m => m.sender_id === user?.id);
  const showSeen = lastReadAt && lastSentByMe &&
    new Date(lastReadAt) >= new Date(lastSentByMe.created_at);

  // ── Render ────────────────────────────────────────────────────
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
