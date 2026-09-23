import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  Archive,
  MessageSquare,
  RefreshCw,
  Search,
  UserCheck,
  UserRoundCheck,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import PageShell from '../PageShell';
import PageMeta from '../PageMeta';
import { formatInboxTime } from '../../utils/inboxTimeFormat';
import { parseConversationStartParams, conversationStartRequestBody } from '../../utils/conversationStart';
import {
  isGuestConversation,
  conversationSide,
  conversationMatchesSide,
  hasHelperInboxWork,
} from '../../utils/inboxRole';
import ConversationThread from './ConversationThread';
import ConversationList from './ConversationList';
import GuestInquiryPanel from './GuestInquiryPanel';
import { resolveShellChrome } from './messengerShellState';
import '../../pages/MessagesPage.css';
import './SharedMessengerShell.css';

export default function MessagingWorkspace({ role = 'auto', businessId = null, embedded = false }) {
  const { t } = useTranslation();
  const { user, isHelper: accountIsHelper } = useAuth();
  const location = useLocation();
  const helperRoute = Boolean(businessId) || location.pathname.startsWith('/helper/messages') || role === 'helper';
  const basePath = businessId ? `/business/${businessId}/workspace/messages` : helperRoute ? '/helper/messages' : '/messages';
  const { conversationId: routeConversationId, inquiryId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();

  const [embeddedConversationId, setEmbeddedConversationId] = useState(null);
  const [embeddedInquiryId, setEmbeddedInquiryId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [archivedConversations, setArchivedConversations] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState('all');
  const [newInbound, setNewInbound] = useState(new Set());
  const [businessFilter, setBusinessFilter] = useState('all');
  const [managedBusinesses, setManagedBusinesses] = useState([]);
  const [starting, setStarting] = useState(false);

  const conversationId = embedded ? embeddedConversationId : routeConversationId;
  const selectedInquiryId = embedded ? embeddedInquiryId : inquiryId;
  const selectedGuestId = selectedInquiryId || (String(conversationId || '').startsWith('guest-')
    ? String(conversationId).replace(/^guest-/i, '')
    : null);
  const selectedId = selectedGuestId ? `guest-${selectedGuestId}` : conversationId || null;
  const hasThread = Boolean(conversationId || selectedInquiryId);
  const userId = user?.id || null;
  const showHelperInbox = hasHelperInboxWork(userId, conversations, accountIsHelper || helperRoute);
  const dualRole = showHelperInbox && conversations.some((conv) => conversationSide(userId, conv) === 'customer');

  useEffect(() => {
    if (businessId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [ownedRes, managedRes] = await Promise.all([
          api.get('/businesses').catch(() => ({ data: { businesses: [] } })),
          api.get('/businesses/managed').catch(() => ({ data: { businesses: [] } })),
        ]);
        const all = [
          ...(ownedRes.data.businesses || []).map((b) => ({ id: b.id, name: b.business_name })),
          ...(managedRes.data.businesses || []).map((b) => ({ id: b.id, name: b.business_name })),
        ];
        const seen = new Set();
        if (cancelled) return;
        setManagedBusinesses(all.filter((b) => {
          if (seen.has(b.id)) return false;
          seen.add(b.id);
          return true;
        }));
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const fetchConversations = useCallback(async () => {
    try {
      setLoadError('');
      const params = businessId
        ? { business_id: businessId }
        : businessFilter !== 'all'
          ? { business_id: businessFilter }
          : undefined;
      const [convRes, guestRes] = await Promise.all([
        api.get('/messages/conversations', { params }),
        api.get('/messages/guest-inquiries', { params }).catch(() => ({ data: [] })),
      ]);
      const convList = Array.isArray(convRes.data) ? convRes.data : [];
      const guestList = Array.isArray(guestRes.data) ? guestRes.data : [];
      const merged = [...guestList, ...convList].sort((a, b) => {
        const ta = new Date(a.last_message_at || a.created_at || 0).getTime();
        const tb = new Date(b.last_message_at || b.created_at || 0).getTime();
        return tb - ta;
      });
      setConversations(merged);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setLoadError(err.response?.data?.error || t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [businessId, businessFilter, t]);

  const fetchArchived = useCallback(async () => {
    try {
      setArchivedLoading(true);
      if (businessId) {
        const { data } = await api.get('/messages/conversations', {
          params: { business_id: businessId, include_archived: 'true' },
        });
        const conversations = Array.isArray(data?.conversations) ? data.conversations : Array.isArray(data) ? data : [];
        setArchivedConversations(conversations.filter((conversation) => conversation.archived_at));
      } else {
        const { data } = await api.get('/messages/archived', { params: { limit: 100, offset: 0 } });
        setArchivedConversations(Array.isArray(data?.archived) ? data.archived : []);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.loadFailed'));
    } finally {
      setArchivedLoading(false);
    }
  }, [businessId, t]);

  useEffect(() => {
    setLoading(true);
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!socket) return undefined;
    const bumpConv = (id) => {
      fetchConversations();
      if (!id) return;
      setNewInbound((prev) => {
        const next = new Set(prev);
        next.add(String(id));
        return next;
      });
    };
    const handleMessageNew = ({ conversationId: id }) => {
      if (id) bumpConv(id);
      else fetchConversations();
    };
    const handleProfileChat = (payload) => {
      if (payload?.guestInquiry && payload?.guestInquiryId != null) {
        bumpConv(`guest-${payload.guestInquiryId}`);
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

  useEffect(() => {
    const start = parseConversationStartParams(location.search);
    const body = conversationStartRequestBody(start);
    if (!body) return undefined;
    let cancelled = false;
    setStarting(true);
    api.post('/messages/conversations', body)
      .then((res) => {
        if (cancelled || !res.data?.id) return;
        navigate(`${basePath}/${res.data.id}`, { replace: true });
      })
      .catch((err) => {
        const message = err.response?.data?.error || t('messages.startFailed');
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });
    return () => { cancelled = true; };
  }, [location.search, basePath, navigate, t]);

  const unreadCount = useMemo(
    () => conversations.reduce((sum, conv) => sum + (parseInt(conv.unread_count, 10) || 0), 0) + newInbound.size,
    [conversations, newInbound]
  );

  const guestCount = useMemo(
    () => conversations.filter(isGuestConversation).length,
    [conversations]
  );

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((conv) => {
      const unread = parseInt(conv.unread_count, 10) > 0 || newInbound.has(String(conv.id));
      if (filter === 'unread' && !unread) return false;
      if (!conversationMatchesSide(userId, conv, sideFilter)) return false;
      if (!q) return true;
      return [
        conv.other_user_name,
        conv.conversation_business_name,
        conv.helper_business_name,
        conv.job_title,
        conv.last_message,
        conv.guest_email,
      ].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [conversations, query, filter, sideFilter, newInbound, userId]);

  const filteredArchivedConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return archivedConversations;
    return archivedConversations.filter((conv) => [
      conv.other_user_name,
      conv.job_title,
      conv.conversation_business_name,
    ].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [archivedConversations, query]);

  const handleOpen = (conv) => {
    const convId = conv.id;
    setNewInbound((prev) => {
      const next = new Set(prev);
      next.delete(String(convId));
      return next;
    });
    if (isGuestConversation(conv)) {
      const uuid = String(convId).replace(/^guest-/i, '');
      if (embedded) {
        setEmbeddedConversationId(null);
        setEmbeddedInquiryId(uuid);
      } else {
        navigate(`/helper/messages/guest/${uuid}`);
      }
      return;
    }
    if (embedded) {
      setEmbeddedInquiryId(null);
      setEmbeddedConversationId(String(convId));
    } else {
      navigate(`${basePath}/${convId}`);
    }
  };

  const restoreArchived = async (conversationId) => {
    try {
      await api.post(`/messages/conversations/${conversationId}/restore`);
      toast.success(t('messages.restored'));
      await Promise.all([fetchArchived(), fetchConversations()]);
      if (String(selectedId) === String(conversationId)) {
        if (embedded) {
          setEmbeddedConversationId(null);
          setEmbeddedInquiryId(null);
        }
        else navigate(basePath);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.restoreFailed', { defaultValue: 'Failed to restore conversation' }));
    }
  };

  const archiveConversation = async (conversationId) => {
    try {
      await api.post(`/messages/conversations/${conversationId}/archive`);
      toast.success(t('messages.archived'));
      await fetchConversations();
      if (String(selectedId) === String(conversationId)) {
        if (embedded) {
          setEmbeddedConversationId(null);
          setEmbeddedInquiryId(null);
        }
        else navigate(basePath);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || t('messages.archiveFailed', { defaultValue: 'Failed to archive conversation' }));
    }
  };

  const closeThread = () => {
    if (embedded) {
      setEmbeddedConversationId(null);
      setEmbeddedInquiryId(null);
    }
    else navigate(basePath);
  };
  const selectedConversation = [...conversations, ...archivedConversations]
    .find((conv) => String(conv.id) === String(selectedId));
  const threadRole = conversationSide(userId, selectedConversation);
  const chrome = resolveShellChrome({ hasThread, compact: true });

  const workspaceContent = (
    <div className={`messages-page workspace${hasThread ? ' has-thread' : ''}`}>
        <header className="messages-hero compact shell-compact">
          <div>
            <p className="messages-kicker">
              {dualRole ? t('messages.unifiedKicker') : showHelperInbox ? t('messages.helperKicker') : t('messages.kicker')}
            </p>
            <h1>{dualRole ? t('messages.unifiedTitle') : showHelperInbox ? t('messages.helperTitle') : t('messages.title')}</h1>
          </div>
          {chrome.showCompactSummary && (
            <div className="messages-shell-summary" aria-label={t('messages.shell.summaryAria')}>
              <span className="messages-shell-summary-chip">
                {conversations.length} {t('messages.stats.conversations')}
              </span>
              <span className="messages-shell-summary-chip">
                {unreadCount} {showHelperInbox ? t('messages.stats.needsReply') : t('messages.stats.unread')}
              </span>
              {showHelperInbox ? (
                <span className="messages-shell-summary-chip">
                  {guestCount} {t('messages.stats.guestLeads')}
                </span>
              ) : null}
            </div>
          )}
        </header>

        <section className="messages-toolbar" aria-label={t('messages.toolsAriaLabel')}>
          <label className="messages-search">
            <Search size={18} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={showHelperInbox ? t('messages.helperSearchPlaceholder') : t('messages.searchPlaceholder')}
            />
          </label>
          <div className="messages-filter" role="group" aria-label={t('messages.filterAriaLabel')}>
            <button
              type="button"
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              {t('messages.allFilter')}
            </button>
            <button
              type="button"
              className={filter === 'unread' ? 'active' : ''}
              onClick={() => setFilter('unread')}
            >
              {t('messages.unreadFilter')}
              {unreadCount > 0 && <em>{unreadCount}</em>}
            </button>
          </div>
          {dualRole && (
            <div className="messages-filter" role="group" aria-label={t('messages.sideFilterAriaLabel')}>
              <button type="button" className={sideFilter === 'all' ? 'active' : ''} onClick={() => setSideFilter('all')}>
                {t('messages.sideAll')}
              </button>
              <button type="button" className={sideFilter === 'helper' ? 'active' : ''} onClick={() => setSideFilter('helper')}>
                {t('messages.sideHelper')}
              </button>
              <button type="button" className={sideFilter === 'customer' ? 'active' : ''} onClick={() => setSideFilter('customer')}>
                {t('messages.sideCustomer')}
              </button>
            </div>
          )}
          {!businessId && managedBusinesses.length > 0 && (
            <select
              value={businessFilter}
              onChange={(e) => {
                setBusinessFilter(e.target.value);
                setLoading(true);
              }}
              className="messages-business-select"
            >
              <option value="all">{t('messages.allConversations')}</option>
              {managedBusinesses.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <div className="messages-actions shell-demoted">
            <button
              type="button"
              onClick={() => {
                const next = !showArchived;
                setShowArchived(next);
                if (next) fetchArchived();
              }}
              aria-pressed={showArchived}
              title={t('messages.viewArchived')}
            >
              <Archive size={15} />
              {t('messages.viewArchived')}
            </button>
            <button type="button" onClick={fetchConversations} disabled={loading}>
              <RefreshCw size={15} />
              {t('messages.refresh')}
            </button>
            <details className="messages-more-details">
              <summary>{t('messages.shell.moreActions')}</summary>
              <div className="messages-more-menu" role="menu">
                {showHelperInbox && (
                  <Link to="/dashboard/edit-profile" role="menuitem">{t('messages.improveProfile')}</Link>
                )}
                <Link to="/helpers" role="menuitem">{t('messages.findHelpers')}</Link>
                <Link to="/post-job" role="menuitem">{t('messages.postJob')}</Link>
              </div>
            </details>
          </div>
        </section>

        <div className="messages-workspace">
          <div className="messages-inbox-pane">
            {loadError && (
              <div className="messages-inline-alert" role="alert">
                <p>{loadError}</p>
                <button type="button" onClick={() => fetchConversations()} disabled={loading}>
                  <RefreshCw size={14} />
                  {t('messages.retry')}
                </button>
              </div>
            )}
            {showArchived ? (
              archivedLoading ? (
                <div className="messages-loading">
                  <div className="messages-spinner" />
                  <p>{t('common.loading')}</p>
                </div>
              ) : filteredArchivedConversations.length === 0 ? (
                <div className="messages-empty compact">
                  <Archive size={30} />
                  <h2>{t('messages.noArchivedConversations')}</h2>
                </div>
              ) : (
                <ConversationList
                  items={filteredArchivedConversations}
                  selectedId={selectedId}
                  onSelect={handleOpen}
                  ariaLabel={t('messages.viewArchived')}
                />
              )
            ) : loading || starting ? (
              <div className="messages-loading">
                <div className="messages-spinner" />
                <p>{starting ? t('messages.startingConversation') : t('common.loading')}</p>
              </div>
            ) : conversations.length === 0 && loadError ? (
              <div className="messages-empty compact">
                <MessageSquare size={30} />
                <h2>{t('messages.loadFailedTitle')}</h2>
                <p>{t('messages.loadFailedHint')}</p>
                <Link to="/support/escalation">{t('messages.contactSupport')}</Link>
              </div>
            ) : conversations.length === 0 ? (
              showHelperInbox ? <EmptyHelperInbox t={t} /> : <EmptyMessages t={t} />
            ) : filteredConversations.length === 0 ? (
              <div className="messages-empty compact">
                <MessageSquare size={30} />
                <h2>
                  {filter === 'unread'
                    ? t('messages.filteredUnreadEmpty.title')
                    : t(showHelperInbox ? 'messages.helperFilteredEmpty.title' : 'messages.filteredEmpty.title')}
                </h2>
                <p>
                  {filter === 'unread'
                    ? t('messages.filteredUnreadEmpty.text')
                    : t(showHelperInbox ? 'messages.helperFilteredEmpty.text' : 'messages.filteredEmpty.text')}
                </p>
              </div>
            ) : (
              <ConversationList
                items={filteredConversations}
                selectedId={selectedId}
                onSelect={handleOpen}
                getUnread={(conv) => parseInt(conv.unread_count, 10) > 0 || newInbound.has(String(conv.id))}
                renderItem={(conv, { isActive, unread }) => {
                  const isNew = newInbound.has(String(conv.id));
                  const badge = isNew && !parseInt(conv.unread_count, 10) ? t('messages.newBadge') : conv.unread_count;
                  const isGuestRow = isGuestConversation(conv);
                  const side = conversationSide(userId, conv);
                  const helperSide = side === 'helper';
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => handleOpen(conv)}
                      className={`messages-row sms-conversation-row${unread ? ' unread' : ''}${isActive ? ' active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <div className={`messages-avatar${helperSide ? ' helper' : ''}`}>
                        {(conv.other_user_name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="messages-row-main">
                        <div className="messages-row-top">
                          <strong>
                            {conv.other_user_name || (helperSide ? t('messages.customer') : t('common.helper'))}
                            {isGuestRow && <em className="messages-guest-badge">{t('messages.guestInquiryBadge')}</em>}
                            {dualRole && !isGuestRow && (
                              <em className="messages-guest-badge">
                                {helperSide ? t('messages.youAreHelper') : t('messages.youAreCustomer')}
                              </em>
                            )}
                          </strong>
                          <span>{formatInboxTime(conv.last_message_at || conv.created_at)}</span>
                        </div>
                        {(conv.conversation_business_name || conv.helper_business_name) && (
                          <p className="messages-business">
                            {helperSide
                              ? t('messages.via', { name: conv.conversation_business_name || conv.helper_business_name })
                              : (conv.helper_business_name || conv.conversation_business_name)}
                          </p>
                        )}
                        {conv.job_title && (
                          <p className="messages-job">{t('messages.re', { title: conv.job_title })}</p>
                        )}
                        <p className="messages-preview">{conv.last_message || t('messages.noMessages')}</p>
                      </div>
                      {unread && <span className="messages-unread">{badge}</span>}
                    </button>
                  );
                }}
              />
            )}
          </div>

          <div className="messages-thread-pane">
            {inquiryId || selectedGuestId ? (
              <GuestInquiryPanel
                inquiryId={selectedGuestId}
                embedded
                onBack={closeThread}
              />
            ) : conversationId ? (
              <ConversationThread
                conversationId={conversationId}
                role={threadRole}
                providerMode={helperRoute}
                onBack={closeThread}
                onArchive={selectedConversation && !selectedConversation.archived_at
                  ? () => archiveConversation(conversationId)
                  : undefined}
                onRestore={selectedConversation?.archived_at
                  ? () => restoreArchived(conversationId)
                  : undefined}
              />
            ) : (
              <div className="messages-thread-empty desktop-only">
                <MessageSquare size={32} />
                <h2>{t('messages.selectConversation')}</h2>
                <p>{t('messages.selectConversationHint')}</p>
              </div>
            )}
          </div>
        </div>

    </div>
  );

  return (
    <>
      <PageMeta
        title={dualRole ? t('messages.unifiedMetaTitle') : showHelperInbox ? t('messages.helperMetaTitle') : t('messages.title')}
        description={dualRole ? t('messages.unifiedMetaDesc') : showHelperInbox ? t('messages.helperMetaDesc') : t('messages.metaDesc')}
        noIndex
      />
      {embedded ? (
        <div className="messages-embedded-workspace">{workspaceContent}</div>
      ) : (
        <PageShell hideFooter>{workspaceContent}</PageShell>
      )}
    </>
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
          <Link to="/support/escalation">{t('messages.contactSupport')}</Link>
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

function EmptyHelperInbox({ t }) {
  return (
    <section className="messages-empty">
      <div className="messages-empty-main">
        <div className="messages-empty-icon">
          <MessageSquare size={34} />
        </div>
        <p className="messages-kicker">{t('messages.helperEmpty.kicker')}</p>
        <h2>{t('messages.helperEmpty.title')}</h2>
        <p>{t('messages.helperEmpty.text')}</p>
        <div className="messages-empty-actions">
          <Link to="/dashboard/edit-profile">{t('messages.improveProfile')}</Link>
          <Link to="/jobs">{t('messages.findJobs')}</Link>
          <Link to="/support/escalation">{t('messages.contactSupport')}</Link>
        </div>
      </div>
      <div className="messages-empty-side">
        <h3>{t('messages.helperEmpty.helpTitle')}</h3>
        <ul>
          <li>{t('messages.helperEmpty.helpProfile')}</li>
          <li>{t('messages.helperEmpty.helpShare')}</li>
          <li>{t('messages.helperEmpty.helpBid')}</li>
          <li>{t('messages.helperEmpty.helpReply')}</li>
        </ul>
        <Link to="/features#messages" className="messages-learn-link">
          {t('messages.empty.learnLink')}
          <UserRoundCheck size={15} />
        </Link>
      </div>
    </section>
  );
}
