import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { useSocket } from '../hooks/useSocket';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { formatInboxTime } from '../utils/inboxTimeFormat';

export default function HelperInboxPage() {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  // Track conversation IDs that have arrived since the list was last refreshed
  const [newInbound, setNewInbound] = useState(new Set());
  // Business filter for reps managing multiple businesses
  const [businessFilter, setBusinessFilter] = useState('all');
  const [managedBusinesses, setManagedBusinesses] = useState([]);
  const navigate = useNavigate();
  const { socket } = useSocket();

  // Fetch businesses the user manages (owned + rep)
  useEffect(() => {
    (async () => {
      try {
        const [ownedRes, managedRes] = await Promise.all([
          api.get('/businesses').catch(() => ({ data: { businesses: [] } })),
          api.get('/businesses/managed').catch(() => ({ data: { businesses: [] } })),
        ]);
        const all = [
          ...(ownedRes.data.businesses || []).map(b => ({ id: b.id, name: b.business_name })),
          ...(managedRes.data.businesses || []).map(b => ({ id: b.id, name: b.business_name })),
        ];
        // Deduplicate by id
        const seen = new Set();
        setManagedBusinesses(all.filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true; }));
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params = businessFilter !== 'all' ? `?business_id=${businessFilter}` : '';
      const [convRes, guestRes] = await Promise.all([
        api.get(`/messages/conversations${params}`),
        api.get(`/messages/guest-inquiries${params}`).catch(() => ({ data: [] })),
      ]);
      const convList = convRes.data || [];
      const guestList = guestRes.data || [];
      const merged = [...guestList, ...convList].sort((a, b) => {
        const ta = new Date(a.last_message_at || a.created_at || 0).getTime();
        const tb = new Date(b.last_message_at || b.created_at || 0).getTime();
        return tb - ta;
      });
      setConversations(merged);
    } catch (err) {
      console.error('[HelperInbox] Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [businessFilter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Real-time: registered threads + guest profile inquiries (guest uses synthetic ids).
  useEffect(() => {
    if (!socket) return;

    const bumpConv = (conversationId) => {
      fetchConversations();
      setNewInbound((prev) => {
        const next = new Set(prev);
        next.add(String(conversationId));
        return next;
      });
    };

    const handleMessageNew = ({ conversationId }) => {
      if (conversationId) bumpConv(conversationId);
    };

    const handleProfileChat = (payload) => {
      if (payload?.guestInquiry && payload?.guestInquiryId != null) {
        fetchConversations();
        setNewInbound((prev) => {
          const next = new Set(prev);
          next.add(`guest-${payload.guestInquiryId}`);
          return next;
        });
        return;
      }
      if (payload?.conversationId) bumpConv(payload.conversationId);
    };

    socket.on('message:new', handleMessageNew);
    socket.on('profile_chat:new_message', handleProfileChat);
    return () => {
      socket.off('message:new', handleMessageNew);
      socket.off('profile_chat:new_message', handleProfileChat);
    };
  }, [socket, fetchConversations]);

  const handleOpen = (conv) => {
    const convId = conv.id;
    setNewInbound((prev) => {
      const next = new Set(prev);
      next.delete(String(convId));
      return next;
    });
    if (conv.is_guest_inquiry || String(convId).startsWith('guest-')) {
      const uuid = String(convId).replace(/^guest-/i, '');
      try {
        sessionStorage.setItem(
          `oxs:guest-inquiry:${uuid}`,
          JSON.stringify({
            guestName: conv.other_user_name,
            guestEmail: conv.guest_email,
            message: conv.guest_message_full || conv.last_message,
            createdAt: conv.last_message_at || conv.created_at,
          })
        );
      } catch { /* ignore quota */ }
      navigate(`/helper/messages/guest/${uuid}`);
      return;
    }
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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">{t('messages.title')}</h1>
          {managedBusinesses.length > 0 && (
            <select
              value={businessFilter}
              onChange={e => { setBusinessFilter(e.target.value); setLoading(true); }}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-orange-500"
            >
              <option value="all">{t('messages.allConversations')}</option>
              {managedBusinesses.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
        </div>

        {conversations.length === 0 ? (
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl p-10 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h3 className="text-sm font-semibold text-white mb-1">{t('messages.noMessages')}</h3>
            <p className="text-sm text-gray-500">
              {t('messages.helperNoConvSub')}
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-700/50 rounded-2xl divide-y divide-gray-700/50 overflow-hidden">
            {conversations.map((conv) => {
              const isNew  = newInbound.has(String(conv.id));
              const unread = parseInt(conv.unread_count) > 0 || isNew;
              const badge  = isNew && !parseInt(conv.unread_count) ? t('messages.newBadge') : conv.unread_count;
              const isGuestRow = conv.is_guest_inquiry || String(conv.id).startsWith('guest-');
              return (
                <button
                  key={conv.id}
                  onClick={() => handleOpen(conv)}
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
                          {conv.other_user_name || t('messages.customer')}
                          {isGuestRow && (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-orange-400/90">
                              {t('messages.guestInquiryBadge')}
                            </span>
                          )}
                        </p>
                        {/* Show which of the helper's businesses this conversation is under */}
                        {(conv.conversation_business_name || conv.helper_business_name) && (
                          <p className="text-xs text-gray-600 truncate leading-tight">
                            {t('messages.via', { name: conv.conversation_business_name || conv.helper_business_name })}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {formatInboxTime(conv.last_message_at)}
                      </span>
                    </div>
                    {conv.job_title && (
                      <p className="text-xs text-orange-400/80 mb-0.5 truncate">{t('messages.re', { title: conv.job_title })}</p>
                    )}
                    <p className={`text-sm truncate ${unread ? 'text-gray-300' : 'text-gray-500'}`}>
                      {conv.last_message || t('messages.lastMessageFallback')}
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
