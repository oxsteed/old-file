import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  Building2,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import api from '../api/axios';
import { useSocket } from '../hooks/useSocket';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import { formatInboxTime } from '../utils/inboxTimeFormat';
import './MessagesPage.css';

export default function HelperInboxPage() {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newInbound, setNewInbound] = useState(new Set());
  const [businessFilter, setBusinessFilter] = useState('all');
  const [managedBusinesses, setManagedBusinesses] = useState([]);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { socket } = useSocket();

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
        const seen = new Set();
        setManagedBusinesses(all.filter(b => {
          if (seen.has(b.id)) return false;
          seen.add(b.id);
          return true;
        }));
      } catch {}
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

  const unreadCount = useMemo(
    () => conversations.reduce((sum, conv) => sum + (parseInt(conv.unread_count, 10) || 0), 0) + newInbound.size,
    [conversations, newInbound]
  );

  const guestCount = conversations.filter((conv) => conv.is_guest_inquiry || String(conv.id).startsWith('guest-')).length;

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conv) => [
      conv.other_user_name,
      conv.conversation_business_name,
      conv.helper_business_name,
      conv.job_title,
      conv.last_message,
      conv.guest_email,
    ].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [conversations, query]);

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
      } catch {}
      navigate(`/helper/messages/guest/${uuid}`);
      return;
    }
    navigate(`/helper/messages/${convId}`);
  };

  return (
    <PageShell>
      <PageMeta title="Helper Inbox - OxSteed" description="Manage customer messages, job conversations, and guest profile inquiries." noIndex />
      <div className="messages-page">
        <header className="messages-hero">
          <div>
            <p className="messages-kicker">Business inbox</p>
            <h1>{t('messages.title')}</h1>
            <p>
              This is where leads become customers: profile questions, guest inquiries,
              job conversations, booking details, and repeat customer follow-up all land here.
            </p>
          </div>
          <div className="messages-hero-stats">
            <div>
              <span>{conversations.length}</span>
              <small>Total threads</small>
            </div>
            <div>
              <span>{unreadCount}</span>
              <small>Needs reply</small>
            </div>
            <div>
              <span>{guestCount}</span>
              <small>Guest leads</small>
            </div>
          </div>
        </header>

        <section className="messages-toolbar" aria-label="Helper inbox tools">
          <label className="messages-search">
            <Search size={18} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customers, businesses, jobs, or lead notes..."
            />
          </label>
          {managedBusinesses.length > 0 && (
            <select
              value={businessFilter}
              onChange={e => {
                setBusinessFilter(e.target.value);
                setLoading(true);
              }}
              className="messages-business-select"
            >
              <option value="all">{t('messages.allConversations')}</option>
              {managedBusinesses.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <div className="messages-actions">
            <button type="button" onClick={fetchConversations} disabled={loading}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <Link to="/dashboard/edit-profile">Improve profile</Link>
          </div>
        </section>

        {loading ? (
          <div className="messages-loading">
            <div className="messages-spinner" />
            <p>{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyHelperInbox />
        ) : filteredConversations.length === 0 ? (
          <div className="messages-empty compact">
            <MessageSquare size={30} />
            <h2>No customer threads match that search.</h2>
            <p>Try a customer name, business name, job title, guest email, or message phrase.</p>
          </div>
        ) : (
          <section className="messages-panel" aria-label="Helper conversation list">
            {filteredConversations.map((conv) => {
              const isNew = newInbound.has(String(conv.id));
              const unread = parseInt(conv.unread_count, 10) > 0 || isNew;
              const badge = isNew && !parseInt(conv.unread_count, 10) ? t('messages.newBadge') : conv.unread_count;
              const isGuestRow = conv.is_guest_inquiry || String(conv.id).startsWith('guest-');
              return (
                <button
                  key={conv.id}
                  onClick={() => handleOpen(conv)}
                  className={`messages-row${unread ? ' unread' : ''}`}
                >
                  <div className="messages-avatar helper">
                    {(conv.other_user_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="messages-row-main">
                    <div className="messages-row-top">
                      <strong>
                        {conv.other_user_name || t('messages.customer')}
                        {isGuestRow && <em className="messages-guest-badge">{t('messages.guestInquiryBadge')}</em>}
                      </strong>
                      <span>{formatInboxTime(conv.last_message_at || conv.created_at)}</span>
                    </div>
                    {(conv.conversation_business_name || conv.helper_business_name) && (
                      <p className="messages-business">
                        {t('messages.via', { name: conv.conversation_business_name || conv.helper_business_name })}
                      </p>
                    )}
                    {conv.job_title && (
                      <p className="messages-job">{t('messages.re', { title: conv.job_title })}</p>
                    )}
                    <p className="messages-preview">{conv.last_message || t('messages.lastMessageFallback')}</p>
                  </div>
                  {unread && <span className="messages-unread">{badge}</span>}
                </button>
              );
            })}
          </section>
        )}

        <section className="messages-guide" aria-label="Helper inbox guide">
          <GuideItem icon={UserRoundCheck} title="Profile leads" text="Questions from your public profile can become bookings, jobs, or repeat customers." />
          <GuideItem icon={Briefcase} title="Job context" text="Keep scope, expectations, photos, and bid follow-up attached to the work." />
          <GuideItem icon={Building2} title="Business routing" text="Filter by business when you manage more than one profile or support a team." />
          <GuideItem icon={Sparkles} title="Better conversion" text="Fast, clear replies build trust before a customer decides who to hire." />
        </section>
      </div>
    </PageShell>
  );
}

function EmptyHelperInbox() {
  return (
    <section className="messages-empty">
      <div className="messages-empty-main">
        <div className="messages-empty-icon">
          <MessageSquare size={34} />
        </div>
        <p className="messages-kicker">No customer messages yet</p>
        <h2>Your business inbox is ready for leads.</h2>
        <p>
          Customer conversations will appear here when people message your profile,
          respond to your bids, book you directly, or ask about active work.
        </p>
        <div className="messages-empty-actions">
          <Link to="/dashboard/edit-profile">Improve profile</Link>
          <Link to="/jobs">Find jobs</Link>
          <Link to="/qr-generator">Create QR code</Link>
        </div>
      </div>
      <div className="messages-empty-side">
        <h3>How to generate more conversations</h3>
        <ul>
          <li>Complete your services, pricing, photos, FAQs, and profile cover.</li>
          <li>Share your public profile or QR code with people you meet offline.</li>
          <li>Bid on jobs with clear scope, timing, and next steps.</li>
          <li>Reply quickly so customers feel they are dealing with a real business.</li>
        </ul>
        <Link to="/features#messages" className="messages-learn-link">
          Learn how messages connect
          <UserRoundCheck size={15} />
        </Link>
      </div>
    </section>
  );
}

function GuideItem({ icon: Icon, title, text }) {
  return (
    <div className="messages-guide-item">
      <Icon size={18} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
