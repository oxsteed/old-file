import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useSocket } from '../hooks/useSocket';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function HelperInboxPage() {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  // Track conversation IDs that have arrived since the list was last refreshed
  const [newInbound, setNewInbound] = useState(new Set());
  const navigate = useNavigate();
  const { socket } = useSocket();

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/messages/conversations');
      setConversations(res.data);
    } catch (err) {
      console.error('[HelperInbox] Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Real-time inbox updates: listen for both direct messages (message:new) and
  // profile-page initiated conversations (profile_chat:new_message).
  useEffect(() => {
    if (!socket) return;

    const handleInbound = ({ conversationId }) => {
      if (!conversationId) return;
      fetchConversations();
      setNewInbound(prev => {
        const next = new Set(prev);
        next.add(String(conversationId));
        return next;
      });
    };

    socket.on('message:new',            handleInbound);
    socket.on('profile_chat:new_message', handleInbound);
    return () => {
      socket.off('message:new',            handleInbound);
      socket.off('profile_chat:new_message', handleInbound);
    };
  }, [socket, fetchConversations]);

  const handleOpen = (convId) => {
    setNewInbound(prev => {
      const next = new Set(prev);
      next.delete(String(convId));
      return next;
    });
    navigate(`/helper/messages/${convId}`);
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

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-6">Messages</h1>

        {conversations.length === 0 ? (
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl p-10 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h3 className="text-sm font-semibold text-white mb-1">No messages yet</h3>
            <p className="text-sm text-gray-500">
              When a customer contacts you from your profile, their message will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl divide-y divide-gray-700/50 overflow-hidden">
            {conversations.map((conv) => {
              const isNew  = newInbound.has(String(conv.id));
              const unread = parseInt(conv.unread_count) > 0 || isNew;
              const badge  = isNew && !parseInt(conv.unread_count) ? 'New' : conv.unread_count;
              return (
                <button
                  key={conv.id}
                  onClick={() => handleOpen(conv.id)}
                  className={`w-full text-left px-4 py-4 flex items-center gap-4 transition hover:bg-gray-800/60 ${
                    isNew ? 'bg-blue-500/5' : ''
                  }`}
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 text-sm font-bold text-gray-300">
                    {(conv.other_user_name || '?').charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="min-w-0 flex-1 mr-2">
                        <p className={`text-sm truncate ${unread ? 'font-semibold text-white' : 'font-medium text-gray-300'}`}>
                          {conv.other_user_name || 'Customer'}
                        </p>
                        {/* Show which of the helper's businesses this conversation is under */}
                        {conv.helper_business_name && (
                          <p className="text-xs text-gray-600 truncate leading-tight">
                            via {conv.helper_business_name}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {formatTime(conv.last_message_at)}
                      </span>
                    </div>
                    {conv.job_title && (
                      <p className="text-xs text-orange-400/80 mb-0.5 truncate">Re: {conv.job_title}</p>
                    )}
                    <p className={`text-sm truncate ${unread ? 'text-gray-300' : 'text-gray-500'}`}>
                      {conv.last_message || 'No messages yet'}
                    </p>
                  </div>

                  {unread && (
                    <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 bg-blue-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center leading-none">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
