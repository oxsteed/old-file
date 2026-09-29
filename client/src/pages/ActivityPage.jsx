import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bell,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  Link2,
  MessageCircle,
  RefreshCw,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime, formatMoney } from '../lib/format';
import ConfirmPaymentReceiptModal from '../components/ConfirmPaymentReceiptModal';

const ACTIVITY_FILTERS = [
  { key: 'all', labelKey: 'filters.all' },
  { key: 'notifications', labelKey: 'filters.notifications' },
  { key: 'bids', labelKey: 'filters.bids' },
  { key: 'orders', labelKey: 'filters.orders' },
  { key: 'bookings', labelKey: 'filters.bookings' },
  { key: 'messages', labelKey: 'filters.messages' },
  { key: 'support', labelKey: 'filters.support' },
];

const EVENT_ICONS = {
  notification: Bell,
  bid: Briefcase,
  order: ShoppingBag,
  booking: Clock3,
  message: MessageCircle,
  support_case: CheckCircle2,
  restaurant_support_case: CheckCircle2,
};

const EVENT_FILTER_BY_SOURCE = {
  notification: 'notifications',
  bid: 'bids',
  order: 'orders',
  food_order: 'orders',
  booking: 'bookings',
  message: 'messages',
  support_case: 'support',
  restaurant_support_case: 'support',
};

const PAYMENT_STATUS_STYLES = {
  requested: 'bg-yellow-500/15 text-yellow-400',
  viewed: 'bg-blue-500/15 text-blue-400',
  processor_pending: 'bg-blue-500/15 text-blue-400',
  authorized: 'bg-blue-500/15 text-blue-400',
  confirmed: 'bg-emerald-500/15 text-emerald-400',
  settled: 'bg-emerald-500/15 text-emerald-400',
  cancelled: 'bg-gray-500/15 text-gray-400',
  expired: 'bg-gray-500/15 text-gray-400',
  failed: 'bg-red-500/15 text-red-400',
};

function money(amountCents, currencyCode) {
  return formatMoney((Number(amountCents || 0) / 100), { currency: currencyCode || 'USD' });
}

function formatEventDetail(event) {
  return event.detail || event.subtitle || event.description || '';
}

function eventFilterKey(event) {
  return EVENT_FILTER_BY_SOURCE[event.source] || EVENT_FILTER_BY_SOURCE[event.type] || 'all';
}

function ActivityIcon({ event }) {
  const Icon = EVENT_ICONS[event.source] || EVENT_ICONS[event.type] || Activity;
  return (
    <div className="w-11 h-11 rounded-2xl bg-orange-500/10 text-orange-400 flex items-center justify-center shrink-0">
      <Icon size={18} />
    </div>
  );
}

function StatCard({ label, value, hint, icon: Icon }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
          <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
        </div>
        {Icon && (
          <div className="w-10 h-10 rounded-2xl bg-orange-500/10 text-orange-400 flex items-center justify-center">
            <Icon size={18} />
          </div>
        )}
      </div>
      <p className="mt-3 text-sm text-slate-400">{hint}</p>
    </article>
  );
}

function ActivityCard({ event, onOpen }) {
  const { t } = useTranslation();
  const actionLabel = event.actionLabel || t('activity.open', { defaultValue: 'Open' });
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-sm">
      <div className="flex gap-3">
        <ActivityIcon event={event} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-white font-semibold leading-tight">{event.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{event.subtitle}</p>
            </div>
            {event.eventAt && (
              <span className="text-xs text-slate-500 shrink-0">{formatDateTime(event.eventAt)}</span>
            )}
          </div>

          {formatEventDetail(event) && (
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">{formatEventDetail(event)}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {event.source?.replace('_', ' ') || 'activity'}
            </span>
            {event.isUnread && (
              <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2.5 py-1 text-[11px] font-semibold text-blue-300">
                {t('activity.unread')}
              </span>
            )}
            {event.actionUrl && (
              <button
                type="button"
                onClick={() => onOpen(event.actionUrl)}
                className="ml-auto inline-flex items-center gap-1 rounded-full bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-orange-600"
              >
                {actionLabel}
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function humanizeEventType(type) {
  const words = String(type || '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

function AuditTimeline({ events, request, t }) {
  if (!events || events.length === 0) {
    return <p className="text-sm text-slate-500">{t('activity.historyEmpty', 'No history events yet.')}</p>;
  }
  return (
    <ol className="relative mt-1 space-y-4 border-s border-white/10 ps-5">
      {events.map((event) => {
        const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details)
          ? event.details
          : {};
        return (
          <li key={event.id} className="relative">
            <span
              className="absolute -start-[23px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-400/10"
              aria-hidden="true"
            />
            <p className="text-sm font-semibold text-slate-200">
              {t(`activity.auditEvents.${event.event_type}`, humanizeEventType(event.event_type))}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {event.actor_name}
              {event.created_at ? ` · ${formatDateTime(event.created_at)}` : ''}
            </p>
            {(details.amount_cents != null || details.confirmation_code || details.note || details.proof || details.proof_link) && (
              <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                {details.amount_cents != null && (
                  <p>
                    {t('activity.auditAmount', 'Amount')}: <span className="text-slate-200">{money(details.amount_cents, details.currency_code || request.currencyCode)}</span>
                  </p>
                )}
                {details.confirmation_code && (
                  <p>
                    {t('activity.confirmationCode')}: <span className="text-slate-200">{details.confirmation_code}</span>
                  </p>
                )}
                {details.note && (
                  <p>
                    {t('activity.note')}: <span className="text-slate-200">{details.note}</span>
                  </p>
                )}
                {(details.proof || details.proof_link) && (
                  <p>{t('activity.auditProof', 'Proof')}: <span className="text-slate-200">{t('activity.proofLinkAvailable')}</span></p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function PaymentRequestCard({ request, onConfirm, currentUserId }) {
  const { t } = useTranslation();
  const isRecipient = request.payeeId && String(request.payeeId) === String(currentUserId);
  const confirmed = request.status === 'confirmed' || !!request.confirmedAt;
  const metadata = request.metadata || {};
  const clientMetadata = metadata.clientMetadata || {};
  const proofAttachment = request.proofAttachment || metadata.proofAttachment || clientMetadata.proofAttachment || null;
  const proofLink = request.proofLink || metadata.proofLink || clientMetadata.proofLink || proofAttachment?.url || '';
  const confirmationCode = request.confirmationCode || metadata.confirmationCode || clientMetadata.confirmationCode || '';
  const note = request.confirmationNote || metadata.confirmationNote || metadata.note || clientMetadata.confirmationNote || clientMetadata.note || '';
  const amountLabel = money(request.amountCents, request.currencyCode);
  const [expanded, setExpanded] = useState(false);
  const [auditEvents, setAuditEvents] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');

  const toggleHistory = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (auditEvents || auditLoading) return;
    setAuditLoading(true);
    setAuditError('');
    try {
      const { data } = await api.get(`/main-app/payment-requests/${request.id}`);
      const payload = data?.data || data || {};
      setAuditEvents(Array.isArray(payload.events) ? payload.events : []);
    } catch (err) {
      setAuditError(t('activity.historyError', 'Could not load history.'));
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-sm">
      <div className="flex gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
          <Wallet size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
            <h3 className="text-white font-semibold leading-tight">{request.description || t('activity.paymentRecord')}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {request.sourceType?.replace('_', ' ')}{request.sourceId ? ` · ${request.sourceId}` : ''}
              </p>
            </div>
            <span className="text-sm font-semibold text-white">{amountLabel}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${PAYMENT_STATUS_STYLES[request.status] || 'bg-white/5 text-slate-400'}`}>
              {request.status}
            </span>
            {request.settlementMode && (
              <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {request.settlementMode.replace('_', ' ')}
              </span>
            )}
            {confirmed && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                {t('activity.confirmedInApp')}
              </span>
            )}
          </div>

          <div className="mt-3 space-y-1 text-sm text-slate-400">
            {confirmationCode && <p>{t('activity.confirmationCode')}: <span className="text-slate-200">{confirmationCode}</span></p>}
            {note && <p>{t('activity.note')}: <span className="text-slate-200">{note}</span></p>}
            {(proofAttachment?.name || proofLink) && (
              <div className="space-y-1">
                {proofAttachment?.name && (
                  <p className="flex items-center gap-2">
                    {t('activity.attachment')}: <span className="text-slate-200">{proofAttachment.name}</span>
                    <Link2 size={14} />
                  </p>
                )}
                {proofLink && (
                  <p className="flex items-center gap-2">
                    {t('activity.proofLinkAvailable')}
                    <Link2 size={14} />
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {proofLink && (
              <a
                href={proofLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                >
                  {t('activity.openProof')} <ExternalLink size={14} />
                </a>
            )}
            {isRecipient && !confirmed && (
              <button
                type="button"
                onClick={() => onConfirm(request)}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
              >
                <CheckCircle2 size={14} />
                {t('activity.confirmReceipt')}
              </button>
            )}
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
              {expanded ? t('activity.hideHistory', 'Hide history') : t('activity.viewHistory', 'View history')}
            </button>
          </div>

          {expanded && (
            <div className="mt-4 border-t border-white/10 pt-4">
              {auditLoading && (
                <p className="text-sm text-slate-500">{t('activity.historyLoading', 'Loading history...')}</p>
              )}
              {auditError && !auditLoading && (
                <p className="text-sm text-red-400">{auditError}</p>
              )}
              {!auditLoading && !auditError && (
                <AuditTimeline events={auditEvents} request={request} t={t} />
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function ActivityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [confirmingRequest, setConfirmingRequest] = useState(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const loadActivity = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const [activityRes, paymentRes] = await Promise.all([
        api.get('/main-app/activity?limit=60'),
        api.get('/main-app/payment-requests?limit=40'),
      ]);
      setEvents(Array.isArray(activityRes.data?.events) ? activityRes.data.events : []);
      setPaymentRequests(Array.isArray(paymentRes.data?.paymentRequests) ? paymentRes.data.paymentRequests : []);
    } catch (err) {
      const message = err?.response?.data?.error?.message
        || err?.response?.data?.message
        || t('activity.loadFailed', { defaultValue: 'Unable to load activity right now.' });
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  const visibleEvents = useMemo(() => {
    if (selectedFilter === 'all') return events;
    return events.filter((event) => eventFilterKey(event) === selectedFilter);
  }, [events, selectedFilter]);

  const unreadCount = useMemo(() => events.filter((event) => event.isUnread).length, [events]);
  const paymentActionCount = useMemo(
    () => paymentRequests.filter((request) => request.status !== 'confirmed' && request.status !== 'settled').length,
    [paymentRequests]
  );
  const confirmedCount = useMemo(
    () => paymentRequests.filter((request) => request.status === 'confirmed' || request.confirmedAt).length,
    [paymentRequests]
  );

  const handleOpen = useCallback((path) => {
    if (!path) return;
    navigate(path);
  }, [navigate]);

  const handleConfirm = useCallback((request) => {
    setConfirmingRequest(request);
    setConfirmModalOpen(true);
  }, []);

  const handleConfirmSuccess = useCallback((updatedRequest) => {
    if (!updatedRequest) return;
    setPaymentRequests((prev) => prev.map((request) => (
      String(request.id) === String(updatedRequest.id) ? { ...request, ...updatedRequest } : request
    )));
    loadActivity({ silent: true });
  }, [loadActivity]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <PageMeta title={t('activity.title', { defaultValue: 'Activity' })} noIndex />
      <Navbar />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 p-6 shadow-lg shadow-black/20 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">
              <Activity size={13} />
              {t('activity.liveHistory')}
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t('activity.title', { defaultValue: 'Activity' })}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              {t('activity.description')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => loadActivity({ silent: true })}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              {t('activity.refresh')}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t('activity.stats.unread')} value={unreadCount} hint={t('activity.stats.unreadHint')} icon={Bell} />
          <StatCard label={t('activity.stats.paymentRecords')} value={paymentRequests.length} hint={t('activity.stats.paymentRecordsHint')} icon={Wallet} />
          <StatCard label={t('activity.stats.needsConfirmation')} value={paymentActionCount} hint={t('activity.stats.needsConfirmationHint')} icon={CheckCircle2} />
          <StatCard label={t('activity.stats.confirmedReceipts')} value={confirmedCount} hint={t('activity.stats.confirmedReceiptsHint')} icon={FileText} />
        </section>

        <section className="mb-6 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Filter size={15} className="text-orange-400" />
            {t('activity.filterActivity')}
          </div>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_FILTERS.map((filter) => {
              const active = selectedFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setSelectedFilter(filter.key)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {t(`activity.${filter.labelKey}`)}
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">{t('activity.feedTitle')}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {t('activity.feedDescription')}
                </p>
              </div>
              {loading ? (
                <div className="h-9 w-9 rounded-full border-2 border-orange-500/20 border-t-orange-500 animate-spin" />
              ) : null}
            </div>

            {loading ? (
              <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-8 text-center text-slate-400">
                {t('activity.loading')}
              </div>
            ) : visibleEvents.length ? (
              <div className="space-y-4">
                {visibleEvents.map((event) => (
                  <ActivityCard key={event.id} event={event} onOpen={handleOpen} />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-8 text-center">
                <p className="text-lg font-semibold text-white">{t('activity.emptyTitle')}</p>
                <p className="mt-2 text-sm text-slate-400">
                  {t('activity.emptyDescription')}
                </p>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">{t('activity.paymentReceipts')}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {t('activity.paymentDescription')}
                  </p>
                </div>
                <Wallet size={18} className="text-orange-400" />
              </div>

              <div className="mt-4 space-y-3">
                {paymentRequests.length ? (
                  paymentRequests.slice(0, 8).map((request) => (
                    <PaymentRequestCard
                      key={request.id}
                      request={request}
                      currentUserId={user?.id}
                      onConfirm={handleConfirm}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                    {t('activity.noPaymentRecords')}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Clock3 size={16} className="text-orange-400" />
                {t('activity.coverageTitle')}
              </div>
              <ul className="mt-4 space-y-3 text-sm text-slate-400">
                <li className="flex gap-2">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                  {t('activity.coverageFeed')}
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                  {t('activity.coverageConfirmations')}
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                  {t('activity.coverageProof')}
                </li>
              </ul>
            </div>
          </aside>
        </section>
      </main>

      <Footer />

      <ConfirmPaymentReceiptModal
        isOpen={confirmModalOpen}
        paymentRequest={confirmingRequest}
        onClose={() => {
          setConfirmModalOpen(false);
          setConfirmingRequest(null);
        }}
        onSuccess={handleConfirmSuccess}
      />
    </div>
  );
}
