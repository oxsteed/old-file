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
            <p className="messages-kicker">{t('messages.kicker')}</p>
            <h1>{t('messages.title')}</h1>
            <p>{t('messages.heroDescription')}</p>
          </div>
          <div className="messages-hero-stats">
            <div>
              <span>{conversations.length}</span>
              <small>{t('messages.stats.conversations')}</small>
            </div>
            <div>
              <span>{unreadCount}</span>
              <small>{t('messages.stats.unread')}</small>
            </div>
          </div>
        </header>

        <section className="messages-toolbar" aria-label={t('messages.toolsAriaLabel')}>
          <label className="messages-search">
            <Search size={18} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('messages.searchPlaceholder')}
            />
          </label>
          <div className="messages-actions">
            <Link to="/helpers">{t('messages.findHelpers')}</Link>
            <Link to="/post-job">{t('messages.postJob')}</Link>
          </div>
        </section>

        {loading ? (
          <div className="messages-loading">
            <div className="messages-spinner" />
            <p>{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyMessages t={t} />
        ) : filteredConversations.length === 0 ? (
          <div className="messages-empty compact">
            <MessageSquare size={30} />
            <h2>{t('messages.filteredEmpty.title')}</h2>
            <p>{t('messages.filteredEmpty.text')}</p>
          </div>
        ) : (
          <section className="messages-panel" aria-label={t('messages.conversationListAriaLabel')}>
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

        <section className="messages-guide" aria-label={t('messages.guide.ariaLabel')}>
          <GuideItem icon={Briefcase} title={t('messages.guide.jobs.title')} text={t('messages.guide.jobs.text')} />
          <GuideItem icon={CalendarDays} title={t('messages.guide.bookings.title')} text={t('messages.guide.bookings.text')} />
          <GuideItem icon={ShieldCheck} title={t('messages.guide.trust.title')} text={t('messages.guide.trust.text')} />
          <GuideItem icon={Sparkles} title={t('messages.guide.repeat.title')} text={t('messages.guide.repeat.text')} />
        </section>
      </div>
    </PageShell>
  );
}

function EmptyMessages({ t }) {
  return (
    <section className="messages-empty">
      <div className="messages-empty-main">
        <div className="messages-empty-icon">
          <MessageSquare size={34} />
        </div>
        <p className="messages-kicker">{t('messages.empty.kicker')}</p>
        <h2>{t('messages.empty.title')}</h2>
        <p>{t('messages.empty.text')}</p>
        <div className="messages-empty-actions">
          <Link to="/helpers">{t('messages.empty.findHelper')}</Link>
          <Link to="/post-job">{t('messages.postJob')}</Link>
          <Link to="/planned-needs">{t('messages.empty.planFutureWork')}</Link>
        </div>
      </div>
      <div className="messages-empty-side">
        <h3>{t('messages.empty.helpTitle')}</h3>
        <ul>
          <li>{t('messages.empty.helpShareDetails')}</li>
          <li>{t('messages.empty.helpExpectations')}</li>
          <li>{t('messages.empty.helpContext')}</li>
          <li>{t('messages.empty.helpRepeat')}</li>
        </ul>
        <Link to="/features#messages" className="messages-learn-link">
          {t('messages.empty.learnLink')}
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
