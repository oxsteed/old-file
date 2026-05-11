import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  CalendarDays,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import api from '../api/axios';
import { useSocket } from '../hooks/useSocket';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import { formatInboxTime } from '../utils/inboxTimeFormat';
import './MessagesPage.css';

export default function MessagesPage() {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { socket } = useSocket();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const helperId = params.get('helperId');
    const businessId = params.get('businessId');
    if (!helperId) return;

    api.post('/messages/conversations', {
      helperId,
      ...(businessId ? { businessId } : {}),
    }).then(res => {
      navigate(`/messages/${res.data.id}`, { replace: true });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/messages/conversations');
      setConversations(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchConversations();
    socket.on('message:new', handler);
    return () => socket.off('message:new', handler);
  }, [socket, fetchConversations]);

  const unreadCount = useMemo(
    () => conversations.reduce((sum, conv) => sum + (parseInt(conv.unread_count, 10) || 0), 0),
    [conversations]
  );

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conv) => [
      conv.other_user_name,
      conv.helper_business_name,
      conv.job_title,
      conv.last_message,
    ].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [conversations, query]);

  return (
    <PageShell>
      <PageMeta title={t('messages.title')} description={t('messages.metaDesc')} noIndex={true} />
      <div className="messages-page">
        <header className="messages-hero">
          <div>
            <p className="messages-kicker">Work conversations</p>
            <h1>{t('messages.title')}</h1>
            <p>
              Keep every helper question, job conversation, booking detail, and follow-up in one accountable place.
              Messages are where scope, timing, photos, access notes, and decisions stay connected to the work.
            </p>
          </div>
          <div className="messages-hero-stats">
            <div>
              <span>{conversations.length}</span>
              <small>Conversations</small>
            </div>
            <div>
              <span>{unreadCount}</span>
              <small>Unread</small>
            </div>
          </div>
        </header>

        <section className="messages-toolbar" aria-label="Message tools">
          <label className="messages-search">
            <Search size={18} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people, jobs, or messages..."
            />
          </label>
          <div className="messages-actions">
            <Link to="/helpers">Find helpers</Link>
            <Link to="/post-job">Post a job</Link>
          </div>
        </section>

        {loading ? (
          <div className="messages-loading">
            <div className="messages-spinner" />
            <p>{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyMessages />
        ) : filteredConversations.length === 0 ? (
          <div className="messages-empty compact">
            <MessageSquare size={30} />
            <h2>No conversations match that search.</h2>
            <p>Try a helper name, business name, job title, or a phrase from the last message.</p>
          </div>
        ) : (
          <section className="messages-panel" aria-label="Conversation list">
            {filteredConversations.map((conv) => {
              const unread = parseInt(conv.unread_count, 10) > 0;
              return (
                <button
                  key={conv.id}
                  onClick={() => navigate(`/messages/${conv.id}`)}
                  className={`messages-row${unread ? ' unread' : ''}`}
                >
                  <div className="messages-avatar">
                    {(conv.other_user_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="messages-row-main">
                    <div className="messages-row-top">
                      <strong>{conv.other_user_name || t('common.helper')}</strong>
                      <span>{formatInboxTime(conv.last_message_at)}</span>
                    </div>
                    {conv.helper_business_name && (
                      <p className="messages-business">{conv.helper_business_name}</p>
                    )}
                    {conv.job_title && (
                      <p className="messages-job">{t('messages.re')}: {conv.job_title}</p>
                    )}
                    <p className="messages-preview">{conv.last_message || t('messages.noMessages')}</p>
                  </div>
                  {unread && <span className="messages-unread">{conv.unread_count}</span>}
                </button>
              );
            })}
          </section>
        )}

        <section className="messages-guide" aria-label="How messages connect">
          <GuideItem icon={Briefcase} title="Jobs and bids" text="Clarify scope before accepting work and keep decisions attached to the job." />
          <GuideItem icon={CalendarDays} title="Bookings" text="Confirm timing, address details, access notes, and what should happen before arrival." />
          <GuideItem icon={ShieldCheck} title="Trust records" text="If a dispute or support issue happens later, conversation history helps explain what happened." />
          <GuideItem icon={Sparkles} title="Repeat relationships" text="Good conversations become saved helpers, repeat bookings, and planned future needs." />
        </section>
      </div>
    </PageShell>
  );
}

function EmptyMessages() {
  return (
    <section className="messages-empty">
      <div className="messages-empty-main">
        <div className="messages-empty-icon">
          <MessageSquare size={34} />
        </div>
        <p className="messages-kicker">No messages yet</p>
        <h2>Your inbox is ready when the work starts.</h2>
        <p>
          Messages appear when you contact a helper, receive a bid, book someone directly,
          ask a question about a service, or need follow-up on active work.
        </p>
        <div className="messages-empty-actions">
          <Link to="/helpers">Find a helper</Link>
          <Link to="/post-job">Post a job</Link>
          <Link to="/planned-needs">Plan future work</Link>
        </div>
      </div>
      <div className="messages-empty-side">
        <h3>What messages help with</h3>
        <ul>
          <li>Share photos, timing, access instructions, and job details.</li>
          <li>Keep helper and customer expectations in one place.</li>
          <li>Preserve context for payments, cancellations, and disputes.</li>
          <li>Build repeat relationships with helpers you trust.</li>
        </ul>
        <Link to="/features#messages" className="messages-learn-link">
          Learn how messages connect
          <UserCheck size={15} />
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
