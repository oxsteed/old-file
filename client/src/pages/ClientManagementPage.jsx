import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Briefcase,
  FileText,
  MessageCircle,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import api from '../api/axios';
import { formatDateTime } from '../lib/format';
import '../styles/ClientManagementPage.css';

const EMPTY_DATA = { conversations: [], guestInquiries: [], quotes: [] };

async function fetchAllHelperQuotes() {
  const pageSize = 200;
  const quotes = [];
  let offset = 0;

  while (true) {
    const response = await api.get('/chat/quotes/history', {
      params: { kind: 'helper', limit: pageSize, offset },
    });
    const page = asArray(response?.data?.quotes || response?.data);
    quotes.push(...page);
    if (page.length < pageSize) return quotes;
    offset += page.length;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function quoteStatusLabel(status) {
  return String(status || 'sent').replace(/_/g, ' ');
}

function quoteRecipientName(quote) {
  return quote.recipient_name || quote.client_name || quote.guest_name || '';
}

function mergeClient(target, source) {
  target.unreadCount += Number(source.unread_count) || 0;
  target.lastAt = [target.lastAt, source.last_message_at, source.updated_at, source.created_at]
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || target.lastAt;
  if (source.last_message) target.lastMessage = source.last_message;
  if (source.job_title && !target.jobTitles.includes(source.job_title)) target.jobTitles.push(source.job_title);
  if (source.job_id != null) target.jobIds.add(String(source.job_id));
  if (source.id && source.is_guest_inquiry) target.guestInquiryId = String(source.id).replace(/^guest-/, '');
  if (source.id && !source.is_guest_inquiry) target.conversationId = source.id;
  if (source.guest_email) target.email = source.guest_email;
  if (source.other_user_id) target.userId = source.other_user_id;
  return target;
}

function buildClients({ conversations, guestInquiries, quotes }) {
  const clients = new Map();
  const quoteRows = asArray(quotes);
  const clientsByConversation = new Map();
  const clientsByGuestSession = new Map();
  const clientsByEmail = new Map();
  const clientsByJob = new Map();
  const clientsByName = new Map();

  const getOrCreate = (key, details) => {
    if (!clients.has(key)) {
      clients.set(key, {
        key,
        name: details.name || '',
        email: details.email || '',
        kind: details.kind || 'account',
        unreadCount: 0,
        lastAt: details.lastAt || null,
        lastMessage: '',
        jobTitles: [],
        jobIds: new Set(),
        conversationId: null,
        guestInquiryId: null,
        userId: details.userId || null,
        quotes: [],
      });
    }
    return clients.get(key);
  };

  asArray(conversations).forEach((conversation) => {
    const key = conversation.other_user_id
      ? `account:${conversation.other_user_id}`
      : `conversation:${conversation.id}`;
    const client = mergeClient(getOrCreate(key, {
      name: conversation.other_user_name,
      kind: 'account',
      userId: conversation.other_user_id,
    }), conversation);
    if (conversation.id != null) clientsByConversation.set(String(conversation.id), client);
    if (conversation.job_id != null) clientsByJob.set(String(conversation.job_id), client);
    if (client.email) clientsByEmail.set(normalized(client.email), client);
    if (client.name) clientsByName.set(normalized(client.name), client);
  });

  asArray(guestInquiries).forEach((inquiry) => {
    const emailKey = normalized(inquiry.guest_email);
    const key = emailKey ? `guest:${emailKey}` : `guest:${inquiry.id}`;
    const client = mergeClient(getOrCreate(key, {
      name: inquiry.other_user_name || inquiry.guest_name,
      email: inquiry.guest_email,
      kind: 'guest',
    }), inquiry);
    if (inquiry.id) clientsByGuestSession.set(String(inquiry.id).replace(/^guest-/, ''), client);
    if (client.email) clientsByEmail.set(normalized(client.email), client);
    if (client.name) clientsByName.set(normalized(client.name), client);
  });

  quoteRows.forEach((quote) => {
    const jobId = quote.job_id == null ? '' : String(quote.job_id);
    const conversationId = quote.conversation_id == null ? '' : String(quote.conversation_id);
    const guestSessionId = quote.guest_session_id == null ? '' : String(quote.guest_session_id);
    const recipientName = quoteRecipientName(quote);
    const nameKey = normalized(recipientName);
    const matching = clientsByConversation.get(conversationId)
      || clientsByGuestSession.get(guestSessionId)
      || (jobId && clientsByJob.get(jobId))
      || (normalized(quote.client_email || quote.guest_email) && clientsByEmail.get(normalized(quote.client_email || quote.guest_email)))
      || (nameKey && clientsByName.get(nameKey));
    const client = matching || getOrCreate(
      conversationId
        ? `conversation:${conversationId}`
        : guestSessionId
          ? `guest:${guestSessionId}`
          : nameKey
            ? `quote-client:${nameKey}`
            : `quote-job:${jobId || quote.id}`,
      {
        name: recipientName,
        email: quote.client_email || quote.guest_email,
        kind: guestSessionId ? 'guest' : conversationId ? 'account' : 'quote',
      },
    );
    if (recipientName && !client.name) client.name = recipientName;
    if (quote.client_email || quote.guest_email) client.email = quote.client_email || quote.guest_email;
    if (guestSessionId) client.kind = 'guest';
    else if (conversationId && client.kind === 'quote') client.kind = 'account';
    if (conversationId) {
      client.conversationId = conversationId;
      clientsByConversation.set(conversationId, client);
    }
    if (guestSessionId) {
      client.guestInquiryId = guestSessionId;
      clientsByGuestSession.set(guestSessionId, client);
    }
    client.quotes.push(quote);
    if (quote.job_title && !client.jobTitles.includes(quote.job_title)) client.jobTitles.push(quote.job_title);
    if (jobId) {
      client.jobIds.add(jobId);
      clientsByJob.set(jobId, client);
    }
    if (client.email) clientsByEmail.set(normalized(client.email), client);
    if (client.name) clientsByName.set(normalized(client.name), client);
    client.lastAt = [client.lastAt, quote.created_at, quote.updated_at]
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || client.lastAt;
  });

  return [...clients.values()]
    .map((client) => ({ ...client, jobIds: [...client.jobIds] }))
    .sort((a, b) => {
      if (b.unreadCount !== a.unreadCount) return b.unreadCount - a.unreadCount;
      return new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime();
    });
}

function StatCard({ icon: Icon, label, value, tone = '' }) {
  return (
    <article className={`client-management__stat ${tone}`}>
      <div className="client-management__stat-icon" aria-hidden="true"><Icon size={18} /></div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function ClientCard({ client, onOpen, t }) {
  const hasConversation = Boolean(client.conversationId || client.guestInquiryId);
  const quoteCount = client.quotes.length;
  const latestQuote = client.quotes[0];
  const kindLabel = client.kind === 'guest'
    ? t('clientManagement.guestContact')
    : client.kind === 'quote'
      ? t('clientManagement.quoteContact')
      : t('clientManagement.accountClient');

  return (
    <article className={`client-management__card${client.unreadCount ? ' client-management__card--unread' : ''}`}>
      <div className="client-management__avatar" aria-hidden="true">
        {(client.name || 'C').trim().charAt(0).toUpperCase()}
      </div>
      <div className="client-management__card-main">
        <div className="client-management__card-heading">
          <div className="min-w-0">
            <h2>{client.name || t('clientManagement.unknownClient')}</h2>
            <p className="client-management__kind">{kindLabel}{client.email ? ` · ${client.email}` : ''}</p>
          </div>
          {client.lastAt && <time dateTime={client.lastAt}>{formatDateTime(client.lastAt)}</time>}
        </div>

        <div className="client-management__card-details">
          <p className="client-management__last-message">
            {client.lastMessage || (quoteCount ? t('clientManagement.quoteActivity') : t('clientManagement.noRecentActivity'))}
          </p>
          <div className="client-management__badges">
            {client.unreadCount > 0 && (
              <span className="client-management__badge client-management__badge--unread">
                {t('clientManagement.unreadCount', { count: client.unreadCount })}
              </span>
            )}
            {quoteCount > 0 && (
              <span className="client-management__badge client-management__badge--quote">
                <FileText size={13} /> {t('clientManagement.quoteCount', { count: quoteCount })}
                {latestQuote?.status ? ` · ${quoteStatusLabel(latestQuote.status)}` : ''}
              </span>
            )}
            {client.jobTitles.slice(0, 2).map((title) => (
              <span className="client-management__badge" key={title}>{title}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="client-management__card-action">
        {hasConversation ? (
          <button type="button" className="client-management__open" onClick={() => onOpen(client)}>
            {t('clientManagement.openConversation')} <ArrowRight size={16} />
          </button>
        ) : (
          <Link className="client-management__open" to="/helper/messages">
            {t('clientManagement.openMessages')} <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </article>
  );
}

export default function ClientManagementPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError(false);
    const requests = await Promise.allSettled([
      api.get('/messages/conversations'),
      api.get('/messages/guest-inquiries'),
      // This is the canonical provider history. It includes quotes shared in
      // authenticated conversations and guest live-chat sessions.
      fetchAllHelperQuotes(),
    ]);
    const [conversations, guestInquiries, quotes] = requests;
    const successful = requests.some((result) => result.status === 'fulfilled');
    if (!successful) setError(true);
    setData({
      conversations: conversations.status === 'fulfilled' ? asArray(conversations.value?.data) : [],
      guestInquiries: guestInquiries.status === 'fulfilled' ? asArray(guestInquiries.value?.data) : [],
      quotes: quotes.status === 'fulfilled' ? asArray(quotes.value) : [],
    });
    setLoading(false);
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  const clients = useMemo(() => buildClients(data), [data]);
  const unreadTotal = useMemo(() => clients.reduce((sum, client) => sum + client.unreadCount, 0), [clients]);
  const quoteTotal = useMemo(() => clients.reduce((sum, client) => sum + client.quotes.length, 0), [clients]);
  const filteredClients = useMemo(() => {
    const query = normalized(search);
    return clients.filter((client) => {
      if (filter === 'unread' && client.unreadCount === 0) return false;
      if (filter === 'quotes' && client.quotes.length === 0) return false;
      if (!query) return true;
      return [client.name, client.email, client.lastMessage, ...client.jobTitles]
        .some((value) => normalized(value).includes(query));
    });
  }, [clients, filter, search]);

  const openClient = (client) => {
    if (client.conversationId) navigate(`/helper/messages/${client.conversationId}`);
    else if (client.guestInquiryId) navigate(`/helper/messages/guest/${client.guestInquiryId}`);
  };

  return (
    <PageShell>
      <PageMeta
        title={t('clientManagement.pageTitle')}
        description={t('clientManagement.pageDescription')}
        noIndex
      />
      <section className="client-management">
        <div className="client-management__container">
          <header className="client-management__header">
            <div>
              <p className="client-management__eyebrow">{t('clientManagement.eyebrow')}</p>
              <h1>{t('clientManagement.title')}</h1>
              <p className="client-management__intro">{t('clientManagement.description')}</p>
            </div>
            <Link className="client-management__header-action" to="/helper/messages">
              <MessageCircle size={17} /> {t('clientManagement.openMessages')}
            </Link>
          </header>

          <section className="client-management__stats" aria-label={t('clientManagement.summaryLabel')}>
            <StatCard icon={Users} label={t('clientManagement.totalClients')} value={clients.length} />
            <StatCard icon={MessageCircle} label={t('clientManagement.unreadMessages')} value={unreadTotal} tone="client-management__stat--orange" />
            <StatCard icon={FileText} label={t('clientManagement.sentQuotes')} value={quoteTotal} tone="client-management__stat--green" />
          </section>

          <section className="client-management__workspace" aria-labelledby="client-list-heading">
            <div className="client-management__toolbar">
              <div className="client-management__search">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('clientManagement.searchPlaceholder')}
                  aria-label={t('clientManagement.searchLabel')}
                />
              </div>
              <div className="client-management__filters" role="group" aria-label={t('clientManagement.filterLabel')}>
                {[
                  ['all', t('clientManagement.filterAll')],
                  ['unread', t('clientManagement.filterUnread')],
                  ['quotes', t('clientManagement.filterQuotes')],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={filter === value ? 'is-active' : ''}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" className="client-management__refresh" onClick={loadClients} disabled={loading}>
                <RefreshCw size={16} className={loading ? 'is-spinning' : ''} />
                <span>{t('clientManagement.refresh')}</span>
              </button>
            </div>

            <div className="client-management__list-heading">
              <div>
                <p className="client-management__eyebrow">{t('clientManagement.directoryEyebrow')}</p>
                <h2 id="client-list-heading">{t('clientManagement.clientListTitle')}</h2>
              </div>
              <span>{t('clientManagement.showingCount', { count: filteredClients.length })}</span>
            </div>

            {loading ? (
              <div className="client-management__empty" role="status">
                <div className="client-management__empty-icon"><Users size={22} /></div>
                <h3>{t('clientManagement.loading')}</h3>
                <p>{t('clientManagement.loadingDescription')}</p>
              </div>
            ) : error ? (
              <div className="client-management__empty" role="alert">
                <div className="client-management__empty-icon client-management__empty-icon--error"><Briefcase size={22} /></div>
                <h3>{t('clientManagement.loadFailed')}</h3>
                <p>{t('clientManagement.loadFailedDescription')}</p>
                <button type="button" className="client-management__primary-action" onClick={loadClients}>{t('clientManagement.tryAgain')}</button>
              </div>
            ) : filteredClients.length ? (
              <div className="client-management__cards">
                {filteredClients.map((client) => <ClientCard key={client.key} client={client} onOpen={openClient} t={t} />)}
              </div>
            ) : (
              <div className="client-management__empty">
                <div className="client-management__empty-icon"><Users size={22} /></div>
                <h3>{search || filter !== 'all' ? t('clientManagement.noMatchingClients') : t('clientManagement.noClients')}</h3>
                <p>{search || filter !== 'all' ? t('clientManagement.noMatchingDescription') : t('clientManagement.noClientsDescription')}</p>
                {!search && filter === 'all' && (
                  <Link className="client-management__primary-action" to="/helper/messages">
                    {t('clientManagement.openMessages')} <ArrowRight size={16} />
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>
      </section>
    </PageShell>
  );
}
