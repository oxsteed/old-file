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

export default function HelperConversationPage() {
  const { conversationId } = useParams();
  const [messages, setMessages] = useState([]);
  const [otherName, setOtherName] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket } = useSocket();

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get(`/messages/conversations/${conversationId}`);
      const data = Array.isArray(res.data) ? res.data : [];
      setMessages(data);
      // Derive the other party's name from the first message not sent by us
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

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Real-time: both message:new (helper's own sends bounce back) and
  // profile_chat:new_message (inbound from customer)
  useEffect(() => {
    if (!socket) return;

    const handleNew = ({ conversationId: cid, message }) => {
      if (String(cid) !== String(conversationId)) return;
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
    };

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

    socket.on('message:new', handleNew);
    socket.on('profile_chat:new_message', handleProfileNew);
    return () => {
      socket.off('message:new', handleNew);
      socket.off('profile_chat:new_message', handleProfileNew);
    };
  }, [socket, conversationId, otherName]);

  const handleSend = async (e) => {
    e.preventDefault();
    const content = newMessage.trim();
    if (!content || sending) return;
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
      setNewMessage(content); // restore on failure
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
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
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
              {(otherName || '?').charAt(0).toUpperCase()}
            </div>
            <h1 className="text-base font-semibold text-white">{otherName || 'Customer'}</h1>
          </div>
        </div>

        {/* Message thread */}
        <div className="flex-1 bg-gray-900 border border-gray-700/50 rounded-2xl overflow-y-auto p-4 mb-4 min-h-[400px] max-h-[60vh] flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-600 text-center mt-8">No messages yet. Send the first reply below.</p>
          )}
          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && msg.sender_name && (
                  <span className="text-xs text-gray-500 mb-1 ml-1">{msg.sender_name}</span>
                )}
                <div
                  className={`px-4 py-2.5 rounded-2xl max-w-xs text-sm leading-relaxed ${
                    isMe
                      ? 'bg-orange-500 text-white rounded-br-sm'
                      : 'bg-gray-700/70 text-gray-100 rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
                <span className="text-[11px] text-gray-600 mt-1 px-1">
                  {formatTime(msg.created_at)}
                </span>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Compose */}
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a reply…"
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
