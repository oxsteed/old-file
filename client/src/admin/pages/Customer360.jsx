import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, BadgeCheck, Briefcase, Calendar, ChevronLeft, Eye, FileWarning,
  Gavel, History, Landmark, LayoutDashboard, Loader2, Mail, MapPin, MessageSquare,
  Phone, RefreshCw, ShieldAlert, ShieldCheck, StickyNote, Ticket, Wallet,
} from 'lucide-react';
import adminApi from '../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import { adminDate, adminDateTime, adminMoney } from '../lib/formatters';
import { useAuth } from '../../hooks/useAuth';
import { useHasGrant } from '../lib/GrantGuard';
import ConfirmDialog from '../lib/ConfirmDialog';
import AdminErrorState from '../lib/AdminErrorState';

const DISPUTE_STATUSES = ['open', 'under_review', 'resolved'];
const OPEN_DISPUTE_STATUSES = new Set(['open', 'under_review']);

const NS = 'adminCustomer360';

function humanize(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Title-case a display name without mangling intentional casing. */
function displayName(first, last) {
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (!full) return '';
  return full
    .split(/\s+/)
    .map((w) => (/[A-Z]/.test(w.slice(1)) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function initials(first, last) {
  const parts = [first, last].filter(Boolean);
  if (!parts.length) return '?';
  return parts.map((p) => p.charAt(0).toUpperCase()).join('').slice(0, 2);
}

function toneClass(tone) {
  switch (tone) {
    case 'red':     return 'bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30';
    case 'amber':   return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30';
    case 'emerald': return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30';
    case 'sky':     return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30';
    default:        return 'bg-gray-500/15 text-gray-600 dark:text-gray-400 ring-1 ring-gray-500/30';
  }
}

function ToneBadge({ tone, children }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${toneClass(tone)}`}>
      {children}
    </span>
  );
}

function EmptyState({ message }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-200 dark:border-gray-800 px-3 py-6 text-center text-xs text-gray-600 dark:text-gray-400">
      {message}
    </p>
  );
}

function SectionError({ message, retryLabel, onRetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-xs text-red-700 dark:text-red-300">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-red-400/30 px-3 py-1.5 text-red-700 dark:text-red-200 hover:bg-red-500/10"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function Section({ title, subtitle, count, error, onRetry, children, action }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white dark:bg-[#111318] border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {typeof count === 'number' && (
            <span className="rounded-full border border-gray-300 dark:border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">
              {t(`${NS}.common.records`, { count })}
            </span>
          )}
        </div>
      </div>
      <div className="px-5 py-4">
        {error
          ? <SectionError message={error} retryLabel={t(`${NS}.retry`)} onRetry={onRetry} />
          : children}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
        active
          ? 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-200'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111318] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      <Icon size={13} />
      {label}
      {typeof count === 'number' && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-orange-500/20 text-orange-700 dark:text-orange-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Avatar with initials fallback when the photo is missing or fails to load. */
function Avatar({ user, size = 64 }) {
  const [failed, setFailed] = useState(false);
  const { t } = useTranslation();
  const showPhoto = user?.avatar_url && !failed;
  return showPhoto ? (
    <img
      src={user.avatar_url}
      alt=""
      onError={() => setFailed(true)}
      className="rounded-full object-cover ring-2 ring-gray-300 dark:ring-gray-600 shrink-0"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      role="img"
      aria-label={t(`${NS}.header.avatarFallback`)}
      className="rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-2 ring-gray-300 dark:ring-gray-600 shrink-0 flex items-center justify-center font-bold"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(user?.first_name, user?.last_name)}
    </div>
  );
}

function StatCard({ label, value, onClick, hint }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      title={hint}
      className={`bg-white dark:bg-[#111318] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-left transition ${
        clickable ? 'hover:border-orange-400/60 dark:hover:border-orange-500/50 cursor-pointer' : 'cursor-default'
      }`}
    >
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</p>
      <p className="font-bold text-gray-900 dark:text-white text-xl sm:text-2xl">{value}</p>
      {clickable && hint && <p className="mt-1 text-[10px] text-gray-400">{hint}</p>}
    </div>
  );
}

/** Tappable contact row: email, phone, and location open the right app. */
function ContactRow({ icon: Icon, href, children, external }) {
  const cls = 'flex items-center gap-1.5 min-w-0';
  const inner = (
    <>
      <Icon size={12} className="text-gray-500 shrink-0" />
      <span className="truncate">{children}</span>
    </>
  );
  if (!href) return <span className={cls}>{inner}</span>;
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={`${cls} text-gray-600 dark:text-gray-400 hover:text-sky-600 dark:hover:text-sky-300 hover:underline`}
    >
      {inner}
    </a>
  );
}

function fraudSeverity(t, value) {
  const key = String(value || '').toLowerCase();
  const map = {
    low:      { label: t(`${NS}.fraud.severityLow`), tone: 'gray' },
    medium:   { label: t(`${NS}.fraud.severityMedium`), tone: 'sky' },
    high:     { label: t(`${NS}.fraud.severityHigh`), tone: 'amber' },
    critical: { label: t(`${NS}.fraud.severityCritical`), tone: 'red' },
  };
  return map[key] || { label: humanize(value) || t(`${NS}.common.unknown`), tone: 'gray' };
}

function fraudStatus(t, value) {
  const key = String(value || '').toLowerCase();
  const map = {
    open:          { label: t(`${NS}.fraud.statusOpen`), tone: 'sky' },
    investigating: { label: t(`${NS}.fraud.statusInvestigating`), tone: 'amber' },
    resolved:      { label: t(`${NS}.fraud.statusResolved`), tone: 'emerald' },
    dismissed:     { label: t(`${NS}.fraud.statusDismissed`), tone: 'gray' },
  };
  return map[key] || { label: humanize(value) || t(`${NS}.common.unknown`), tone: 'gray' };
}

function FraudCaseCard({ fraudCase }) {
  const { t } = useTranslation();
  const severity = fraudSeverity(t, fraudCase.severity);
  const status = fraudStatus(t, fraudCase.status);
  const shortId = String(fraudCase.id || '').slice(0, 8);
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {t(`${NS}.fraud.caseId`)} <span className="font-mono text-xs text-gray-600 dark:text-gray-400">#{shortId || fraudCase.id}</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t(`${NS}.fraud.category`)}: <span className="text-gray-700 dark:text-gray-300">{humanize(fraudCase.category) || t(`${NS}.common.unknown`)}</span>
            {' · '}{t(`${NS}.fraud.source`)}: <span className="text-gray-700 dark:text-gray-300">{humanize(fraudCase.source) || t(`${NS}.common.unknown`)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ToneBadge tone={severity.tone}>{severity.label}</ToneBadge>
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        </div>
      </div>
      {fraudCase.summary && (
        <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-400">{fraudCase.summary}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-gray-400">
        <span>{t(`${NS}.fraud.openedAt`)}: {adminDateTime(fraudCase.created_at)}</span>
        {fraudCase.resolved_at && <span>{t(`${NS}.fraud.resolvedAt`)}: {adminDateTime(fraudCase.resolved_at)}</span>}
        {fraudCase.owner_admin_id && (
          <span>{t(`${NS}.fraud.owner`)}: <span className="font-mono">{String(fraudCase.owner_admin_id).slice(0, 8)}</span></span>
        )}
      </div>
      {fraudCase.evidence && (
        <details className="mt-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            {t(`${NS}.fraud.evidence`)}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-gray-500">
            {typeof fraudCase.evidence === 'string' ? fraudCase.evidence : JSON.stringify(fraudCase.evidence, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/** Normalize every section into one chronological feed for the Overview timeline. */
function buildTimeline(t, { recentJobs, recentPayouts, recentReviews, tickets, disputes, fraudCases, incidents, activity, adminAudit }) {
  const items = [];
  const push = (source, id, ts, kind, title, detail, tone, link) => {
    if (!ts) return;
    const time = new Date(ts).getTime();
    if (!Number.isFinite(time)) return;
    items.push({ key: `${source}-${id}`, ts: time, kind, title, detail, tone, link });
  };
  for (const job of recentJobs) {
    push('job', job.id, job.created_at, 'booking',
      job.title || t(`${NS}.timeline.booking`),
      `${t(`${NS}.bookings.value`)}: ${job.final_price != null ? adminMoney(Number(job.final_price)) : '—'} · ${humanize(job.status)}`,
      'sky', job.id ? `/admin/jobs/${job.id}` : null);
  }
  for (const payout of recentPayouts) {
    push('payout', payout.job_title || payout.completed_at, payout.completed_at, 'payment',
      t(`${NS}.timeline.payout`),
      `${payout.job_title || t(`${NS}.payments.job`)} · ${adminMoney(Number(payout.net_to_helper_cents || 0) / 100)}`,
      'emerald', null);
  }
  for (const ticket of tickets) {
    push('ticket', ticket.id, ticket.created_at, 'support',
      `#${ticket.ticket_number || ticket.id} ${ticket.title || t(`${NS}.tickets.subject`)}`,
      humanize(ticket.status), 'amber', null);
  }
  for (const dispute of disputes) {
    push('dispute', dispute.id, dispute.created_at, 'dispute',
      humanize(dispute.reason) || t(`${NS}.disputes.reason`),
      humanize(dispute.status), 'red', dispute.id ? `/admin/disputes/${dispute.id}` : null);
  }
  for (const fraudCase of fraudCases) {
    push('fraud', fraudCase.id, fraudCase.created_at, 'fraud',
      `${t(`${NS}.fraud.caseId`)} #${String(fraudCase.id || '').slice(0, 8)}`,
      `${humanize(fraudCase.category)} · ${humanize(fraudCase.status)}`,
      'red', null);
  }
  for (const incident of incidents) {
    push('incident', incident.id, incident.created_at, 'incident',
      humanize(incident.reason) || t(`${NS}.incidents.reason`),
      humanize(incident.status), 'amber', null);
  }
  for (const review of recentReviews || []) {
    push('review', `${review.created_at}-${review.rating}`, review.created_at, 'review',
      t(`${NS}.timeline.review`, { rating: review.rating }),
      `${review.reviewer_name || ''}${review.comment ? ` · ${review.comment}` : ''}`.trim(),
      'sky', null);
  }
  for (const event of activity) {
    push('activity', event.id, event.created_at, 'activity',
      event.event_type || event.action_type || t(`${NS}.timeline.activity`),
      event.actor_name || event.actor_email || event.notes || '',
      'gray', null);
  }
  for (const entry of adminAudit) {
    push('adminAudit', entry.id, entry.created_at, 'admin',
      entry.action || t(`${NS}.timeline.adminAction`),
      `${entry.admin_name || entry.admin_email || t(`${NS}.audit.system`)}${entry.notes || entry.description ? ` · ${entry.notes || entry.description}` : ''}`,
      'gray', null);
  }
  return items.sort((a, b) => b.ts - a.ts);
}

const TIMELINE_KINDS = ['booking', 'payment', 'support', 'dispute', 'fraud', 'incident', 'review', 'activity', 'admin'];

function TimelineItem({ item }) {
  const { t } = useTranslation();
  const body = (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-2.5 w-full text-left">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={item.tone}>{t(`${NS}.timeline.kind.${item.kind}`, { defaultValue: humanize(item.kind) })}</ToneBadge>
          <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{item.title}</p>
        </div>
        {item.detail && <p className="mt-1 text-[11px] text-gray-500 line-clamp-2">{item.detail}</p>}
      </div>
      <span className="text-[10px] text-gray-500 shrink-0">{adminDateTime(new Date(item.ts).toISOString())}</span>
    </div>
  );
  return item.link ? (
    <Link to={item.link} className="block hover:opacity-90 transition">{body}</Link>
  ) : body;
}

export default function Customer360() {
  const { t } = useTranslation();
  const { userId } = useParams();
  const [tab, setTab] = useState('overview');
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageError, setMessageError] = useState(null);
  const [messageSent, setMessageSent] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'warn' | 'suspend' | 'restrict' | 'reactivate'
  const [investigation, setInvestigation] = useState({ loading: false, data: null, error: null, needsGrant: false });
  const [grantPurpose, setGrantPurpose] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState(null);
  const [grantRequested, setGrantRequested] = useState(false);

  const { user: adminUser } = useAuth();
  const isSuper = adminUser?.role === 'super_admin';
  const { allowed: canMessage } = useHasGrant('message_users');

  // Profile: same endpoint the admin user detail page uses.
  const { data: profileRes, loading: profileLoading, error: profileError, reload } =
    useAbortableFetch(async (signal) => {
      const { data } = await adminApi.get(`/admin/users/${userId}`, { signal });
      return data ?? null;
    }, [userId]);

  const user = profileRes?.user ?? null;
  const recentJobs = profileRes?.recentJobs ?? [];
  const recentPayouts = profileRes?.recentPayouts ?? [];
  const recentReviews = profileRes?.recentReviews ?? [];

  const profileKey = user ? String(user.id) : '';

  // Secondary sections: existing endpoints only, fetched in parallel with
  // per-section error capture so one failing call never blanks the page.
  const { data: aux, loading: auxLoading, reload: reloadAux } = useAbortableFetch(async (signal) => {
    if (!user) return null;
    const sections = {};
    const run = async (key, request, pick) => {
      try {
        const { data } = await request;
        sections[key] = { ok: true, value: pick(data) };
      } catch (err) {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'AbortError') throw err;
        sections[key] = { ok: false, error: err?.response?.data?.error || err?.message || t(`${NS}.loadFailed`) };
      }
    };
    await Promise.all([
      run('tickets', adminApi.get(`/admin/users/${userId}/support-tickets`, { signal }), (d) => d?.tickets ?? []),
      run(
        'fraud',
        adminApi.get('/admin/fraud/cases', { signal, params: { subject_type: 'user', subject_id: userId } }),
        (d) => d?.data?.cases ?? [],
      ),
      run(
        'incidents',
        adminApi.get('/admin/reports', { signal, params: { reportedUserId: userId, limit: 100 } }),
        (d) => d?.reports ?? [],
      ),
      run(
        'activity',
        adminApi.get(`/admin/users/${userId}/activity`, { signal, params: { limit: 100 } }),
        (d) => d?.events ?? [],
      ),
      run(
        'adminAudit',
        adminApi.get('/admin/audit-log', { signal, params: { target_type: 'user', target_id: userId, limit: 100 } }),
        (d) => d?.log ?? [],
      ),
      run('notes', adminApi.get(`/admin/users/${userId}/notes`, { signal }), (d) => d?.notes ?? []),
      ...DISPUTE_STATUSES.map((status) => run(
        `disputes:${status}`,
        adminApi.get('/disputes/admin/all', { signal, params: { status, user_id: userId, limit: 100 } }),
        (d) => d?.disputes ?? [],
      )),
    ]);
    return sections;
  }, [profileKey, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionValue = (key) => {
    const entry = aux?.[key];
    return entry && entry.ok ? entry.value : [];
  };
  const sectionError = (key) => {
    const entry = aux?.[key];
    return entry && !entry.ok ? entry.error : null;
  };

  const tickets = sectionValue('tickets');
  const fraudCases = sectionValue('fraud');
  const incidents = sectionValue('incidents');
  const activity = sectionValue('activity');
  const adminAudit = sectionValue('adminAudit');
  const notes = sectionValue('notes');

  const disputeSectionError = DISPUTE_STATUSES.map((s) => sectionError(`disputes:${s}`)).find(Boolean) || null;
  const disputes = useMemo(() => {
    if (!aux || !user) return [];
    // ADM-110: disputes are filtered server-side by ?user_id= (opener,
    // accused, or job party); the client only dedupes across statuses.
    const seen = new Set();
    const out = [];
    for (const status of DISPUTE_STATUSES) {
      const list = sectionValue(`disputes:${status}`);
      for (const dispute of list) {
        if (!dispute || seen.has(dispute.id)) continue;
        seen.add(dispute.id);
        out.push(dispute);
      }
    }
    return out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aux, user]);

  const paidOutCents = useMemo(
    () => recentPayouts.reduce((sum, p) => sum + (Number(p.net_to_helper_cents) || 0), 0),
    [recentPayouts],
  );
  const lifetimeCents = useMemo(
    () => recentJobs.reduce((sum, j) => sum + Math.round(Number(j.final_price || 0) * 100), 0),
    [recentJobs],
  );
  const openDisputes = useMemo(
    () => disputes.filter((d) => OPEN_DISPUTE_STATUSES.has(String(d.status).toLowerCase())),
    [disputes],
  );

  const timeline = useMemo(
    () => buildTimeline(t, { recentJobs, recentPayouts, recentReviews, tickets, disputes, fraudCases, incidents, activity, adminAudit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aux, recentJobs, recentPayouts, recentReviews, user],
  );
  const filteredTimeline = useMemo(
    () => (timelineFilter === 'all' ? timeline : timeline.filter((i) => i.kind === timelineFilter)),
    [timeline, timelineFilter],
  );

  // E13 investigation profile: fetched lazily when the tab opens. Super-admins
  // pass by role; other admins get the grant-request UI on 403.
  const loadInvestigation = async () => {
    setInvestigation({ loading: true, data: null, error: null, needsGrant: false });
    try {
      const { data } = await adminApi.get(`/admin/investigations/users/${userId}/profile`);
      setInvestigation({ loading: false, data: data?.user ?? null, error: null, needsGrant: false });
    } catch (err) {
      if (err?.response?.status === 403 && err?.response?.data?.code === 'investigation_access_required') {
        setInvestigation({ loading: false, data: null, error: null, needsGrant: true });
      } else {
        setInvestigation({
          loading: false, data: null, needsGrant: false,
          error: err?.response?.data?.error || err?.message || t(`${NS}.loadFailed`),
        });
      }
    }
  };

  useEffect(() => {
    if (tab === 'investigation' && !investigation.data && !investigation.loading && !investigation.needsGrant) {
      loadInvestigation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const requestGrant = async () => {
    if (!grantPurpose.trim() || grantBusy) return;
    setGrantBusy(true);
    setGrantError(null);
    try {
      await adminApi.post('/admin/investigations/access', {
        purpose: grantPurpose.trim(),
        scope_user_ids: [userId],
        investigation_ref: `customer-360:${userId}`,
      });
      setGrantRequested(true);
      setGrantPurpose('');
    } catch (err) {
      setGrantError(err?.response?.data?.error || err?.message || t(`${NS}.loadFailed`));
    } finally {
      setGrantBusy(false);
    }
  };

  const addNote = async () => {
    if (!noteDraft.trim() || noteBusy) return;
    setNoteBusy(true);
    setNoteError(null);
    try {
      await adminApi.post(`/admin/users/${userId}/notes`, { note_text: noteDraft.trim() });
      setNoteDraft('');
      reloadAux();
    } catch (err) {
      setNoteError(err?.response?.data?.error || err?.message || t(`${NS}.loadFailed`));
    } finally {
      setNoteBusy(false);
    }
  };

  const sendMessage = async () => {
    if (!messageBody.trim() || messageBusy) return;
    setMessageBusy(true);
    setMessageError(null);
    try {
      await adminApi.post(`/admin/messages/conversations/${userId}/send`, { content: messageBody.trim() });
      setMessageBody('');
      setMessageSent(true);
    } catch (err) {
      setMessageError(err?.response?.data?.error || err?.message || t(`${NS}.loadFailed`));
    } finally {
      setMessageBusy(false);
    }
  };

  const runPrivilegedAction = async (action, reason, extra = {}) => {
    const endpoints = {
      warn: ['post', `/admin/users/${userId}/warn`, { reason }],
      suspend: ['post', `/admin/users/${userId}/suspend`, { reason, days: extra.days || 0 }],
      restrict: ['post', `/admin/users/${userId}/restrict`, { reason }],
      reactivate: ['post', `/admin/users/${userId}/reactivate`, { reason }],
    };
    const [method, url, body] = endpoints[action];
    await adminApi[method](url, body);
    setConfirmAction(null);
    refreshAll();
  };

  if (profileLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-48">
        <Loader2 size={20} className="animate-spin text-gray-500" />
        <span className="ml-2 text-sm text-gray-500">{t(`${NS}.loading`)}</span>
      </div>
    );
  }

  if (profileError || !user) {
    return (
      <div className="p-6 sm:p-8">
        <Link to="/admin/users" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition mb-4">
          <ChevronLeft size={14} />{t(`${NS}.backToCustomer`)}
        </Link>
        {profileError ? (
          <AdminErrorState onRetry={reload} />
        ) : (
          <p className="text-sm text-gray-500">{t(`${NS}.profileLoadFailed`)}</p>
        )}
      </div>
    );
  }

  const accountStatus = !user.is_active
    ? (user.is_suspended ? 'suspended' : 'banned')
    : user.is_restricted ? 'restricted' : 'active';
  const statusTone = { active: 'emerald', suspended: 'amber', restricted: 'amber', banned: 'red' }[accountStatus] || 'gray';
  const accountStatusLabel = {
    active: t(`${NS}.overview.statusActive`),
    suspended: t(`${NS}.overview.statusSuspended`),
    banned: t(`${NS}.overview.statusBanned`),
    restricted: t(`${NS}.overview.statusRestricted`),
  }[accountStatus] || humanize(accountStatus);

  const name = displayName(user.first_name, user.last_name) || user.email || t(`${NS}.common.unknown`);
  const location = [user.city, user.state, user.country].filter(Boolean).join(', ');
  const mapsHref = location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}` : null;

  const verificationItems = [
    { label: t(`${NS}.risk.didit`), value: user.didit_status ? humanize(user.didit_status) : null, ok: String(user.didit_status).toLowerCase() === 'verified' || !!user.didit_verified_at },
    { label: t(`${NS}.risk.identity`), value: user.id_verified ? t(`${NS}.risk.verified`) : t(`${NS}.risk.unverified`), ok: !!user.id_verified },
    { label: t(`${NS}.risk.background`), value: user.background_check_status ? humanize(user.background_check_status) : (user.background_check_passed ? t(`${NS}.risk.passed`) : null), ok: !!user.background_check_passed || String(user.background_check_status).toLowerCase() === 'passed' },
    { label: t(`${NS}.risk.email`), value: user.email_verified ? t(`${NS}.risk.verified`) : t(`${NS}.risk.unverified`), ok: !!user.email_verified },
    { label: t(`${NS}.risk.w9`), value: user.w9_completed ? t(`${NS}.risk.complete`) : t(`${NS}.risk.incomplete`), ok: !!user.w9_completed },
    { label: t(`${NS}.risk.warnings`), value: String(user.warning_count || 0), ok: (user.warning_count || 0) === 0 },
  ];

  const tabs = [
    { id: 'overview', icon: LayoutDashboard, label: t(`${NS}.tabs.overview`) },
    { id: 'bookings', icon: Briefcase, label: t(`${NS}.tabs.bookings`), count: recentJobs.length },
    { id: 'payments', icon: Wallet, label: t(`${NS}.tabs.payments`), count: recentPayouts.length },
    { id: 'tickets', icon: Ticket, label: t(`${NS}.tabs.tickets`), count: tickets.length },
    { id: 'disputes', icon: Gavel, label: t(`${NS}.tabs.disputes`), count: disputes.length },
    { id: 'fraud', icon: ShieldAlert, label: t(`${NS}.tabs.fraud`), count: fraudCases.length },
    { id: 'incidents', icon: FileWarning, label: t(`${NS}.tabs.incidents`), count: incidents.length },
    { id: 'notes', icon: StickyNote, label: t(`${NS}.tabs.notes`), count: notes.length },
    { id: 'investigation', icon: Eye, label: t(`${NS}.tabs.investigation`) },
    { id: 'audit', icon: History, label: t(`${NS}.tabs.audit`) },
  ];

  const quickActions = [];
  if (canMessage) {
    quickActions.push({ id: 'message', icon: MessageSquare, label: t(`${NS}.actions.message`), onClick: () => { setMessageSent(false); setMessageError(null); setMessageOpen(true); } });
  }
  if (isSuper) {
    if (accountStatus === 'active') {
      quickActions.push({ id: 'warn', icon: AlertTriangle, label: t(`${NS}.actions.warn`), onClick: () => setConfirmAction('warn') });
      quickActions.push({ id: 'suspend', icon: ShieldAlert, label: t(`${NS}.actions.suspend`), danger: true, onClick: () => setConfirmAction('suspend') });
      quickActions.push({ id: 'restrict', icon: ShieldCheck, label: t(`${NS}.actions.restrict`), onClick: () => setConfirmAction('restrict') });
    } else {
      quickActions.push({ id: 'reactivate', icon: BadgeCheck, label: t(`${NS}.actions.reactivate`), onClick: () => setConfirmAction('reactivate') });
    }
    quickActions.push({ id: 'credit', icon: Landmark, label: t(`${NS}.actions.adjustCredit`), href: '/admin/super/oxsteed-credit' });
  }

  const refreshAll = () => { reload(); reloadAux(); };

  const confirmConfig = confirmAction ? {
    warn: { title: t(`${NS}.actions.warnTitle`), message: t(`${NS}.actions.warnMessage`, { name }), confirmLabel: t(`${NS}.actions.warn`), danger: false, requireReason: true },
    suspend: { title: t(`${NS}.actions.suspendTitle`), message: t(`${NS}.actions.suspendMessage`, { name }), confirmLabel: t(`${NS}.actions.suspend`), danger: true, requireReason: true },
    restrict: { title: t(`${NS}.actions.restrictTitle`), message: t(`${NS}.actions.restrictMessage`, { name }), confirmLabel: t(`${NS}.actions.restrict`), danger: true, requireReason: true },
    reactivate: { title: t(`${NS}.actions.reactivateTitle`), message: t(`${NS}.actions.reactivateMessage`, { name }), confirmLabel: t(`${NS}.actions.reactivate`), danger: false, requireReason: false },
  }[confirmAction] : null;

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <Link to={`/admin/users/${userId}`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition">
        <ChevronLeft size={14} />{t(`${NS}.backToCustomer`)}
      </Link>

      {/* Header */}
      <div className="bg-white dark:bg-[#111318] border border-gray-200 dark:border-gray-800 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <Avatar user={user} size={64} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">{t(`${NS}.title`)}</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white leading-tight">{name}</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-600 dark:text-gray-400">{t(`${NS}.subtitle`)}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-gray-500">
              {user.email && <ContactRow icon={Mail} href={`mailto:${user.email}`}>{user.email}</ContactRow>}
              {user.phone && <ContactRow icon={Phone} href={`tel:${user.phone.replace(/[^+\d]/g, '')}`}>{user.phone}</ContactRow>}
              {location && <ContactRow icon={MapPin} href={mapsHref} external>{location}</ContactRow>}
              {user.created_at && (
                <span className="flex items-center gap-1.5"><Calendar size={12} className="text-gray-500" />{t(`${NS}.overview.memberSince`)} {adminDate(user.created_at, { dateStyle: 'medium' })}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {user.role && <ToneBadge tone="sky">{humanize(user.role)}</ToneBadge>}
              <ToneBadge tone={statusTone}>{accountStatusLabel}</ToneBadge>
              {user.is_suspended && user.suspension_reason && (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">{user.suspension_reason}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-950/60 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 self-start"
          >
            <RefreshCw size={13} className={profileLoading || auxLoading ? 'animate-spin' : ''} />
            {t(`${NS}.refresh`)}
          </button>
        </div>

        {/* Quick actions */}
        {quickActions.length > 0 && (
          <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-800">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-2">{t(`${NS}.actions.title`)}</p>
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action) => action.href ? (
                <Link
                  key={action.id}
                  to={action.href}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <action.icon size={13} />{action.label}
                </Link>
              ) : (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    action.danger
                      ? 'border-red-400/40 text-red-700 dark:text-red-300 hover:bg-red-500/10'
                      : 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <action.icon size={13} />{action.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Risk & verification strip */}
      <div className="bg-white dark:bg-[#111318] border border-gray-200 dark:border-gray-800 rounded-2xl px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t(`${NS}.risk.title`)}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {verificationItems.map(({ label, value, ok }) => (
            <span
              key={label}
              title={value || t(`${NS}.common.unknown`)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
                ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30'
                   : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30'
              }`}
            >
              {ok ? <BadgeCheck size={12} /> : <AlertTriangle size={12} />}
              {label}: {value || t(`${NS}.common.unknown`)}
            </span>
          ))}
          {user.last_login_at && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 bg-gray-500/10 text-gray-600 dark:text-gray-400 ring-gray-500/30">
              {t(`${NS}.risk.lastLogin`)}: {adminDateTime(user.last_login_at)}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(({ id, icon, label, count }) => (
          <TabButton key={id} active={tab === id} onClick={() => setTab(id)} icon={icon} label={label} count={count} />
        ))}
      </div>

      {auxLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={13} className="animate-spin" />{t(`${NS}.loading`)}
        </div>
      )}

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={t(`${NS}.overview.statBookings`)}
              value={recentJobs.length}
              onClick={() => setTab('bookings')}
              hint={t(`${NS}.overview.viewTab`)}
            />
            <StatCard
              label={t(`${NS}.overview.statLifetimeValue`)}
              value={adminMoney(lifetimeCents / 100)}
              onClick={() => setTab('bookings')}
              hint={t(`${NS}.overview.recentVolumeHint`)}
            />
            <StatCard
              label={t(`${NS}.overview.statPaidOut`)}
              value={adminMoney(paidOutCents / 100)}
              onClick={() => setTab('payments')}
              hint={t(`${NS}.overview.viewTab`)}
            />
            <StatCard
              label={t(`${NS}.overview.statOpenDisputes`)}
              value={openDisputes.length}
              onClick={() => setTab('disputes')}
              hint={t(`${NS}.overview.viewTab`)}
            />
          </div>

          <Section
            title={t(`${NS}.timeline.title`)}
            subtitle={t(`${NS}.timeline.subtitle`)}
            count={filteredTimeline.length}
          >
            <div className="flex flex-wrap gap-1.5 mb-4">
              {['all', ...TIMELINE_KINDS].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setTimelineFilter(kind)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition ${
                    timelineFilter === kind
                      ? 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-200'
                      : 'border-gray-200 dark:border-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {kind === 'all' ? t(`${NS}.timeline.filterAll`) : t(`${NS}.timeline.kind.${kind}`, { defaultValue: humanize(kind) })}
                </button>
              ))}
            </div>
            {!filteredTimeline.length ? <EmptyState message={t(`${NS}.timeline.empty`)} /> : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {filteredTimeline.slice(0, 100).map((item) => (
                  <TimelineItem key={item.key} item={item} />
                ))}
              </div>
            )}
          </Section>

          <Section title={t(`${NS}.overview.profile`)}>
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                [t(`${NS}.overview.email`), user.email],
                [t(`${NS}.overview.phone`), user.phone],
                [t(`${NS}.overview.location`), location],
                [t(`${NS}.overview.role`), humanize(user.role)],
                [t(`${NS}.overview.status`), accountStatusLabel],
                [t(`${NS}.overview.memberSince`), user.created_at ? adminDate(user.created_at, { dateStyle: 'medium' }) : null],
                [t(`${NS}.overview.lastLogin`), user.last_login_at ? adminDateTime(user.last_login_at) : null],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-gray-200 dark:border-gray-800/60 pb-2">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="text-xs text-gray-700 dark:text-gray-200 text-right">{value || t(`${NS}.overview.notAvailable`)}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      )}

      {/* ── Bookings ── */}
      {tab === 'bookings' && (
        <Section
          title={t(`${NS}.bookings.title`)}
          subtitle={t(`${NS}.bookings.subtitle`)}
          count={recentJobs.length}
        >
          {!recentJobs.length ? <EmptyState message={t(`${NS}.bookings.empty`)} /> : (
            <div className="space-y-2">
              {recentJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/admin/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-3 hover:border-orange-400/50 transition"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{job.title || t(`${NS}.bookings.job`)}</p>
                    <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                      {t(`${NS}.bookings.created`)}: {adminDateTime(job.created_at)}
                      {job.final_price != null && <> · {t(`${NS}.bookings.value`)}: {adminMoney(Number(job.final_price))}</>}
                    </p>
                  </div>
                  <ToneBadge tone="gray">{humanize(job.status)}</ToneBadge>
                </Link>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Payments ── */}
      {tab === 'payments' && (
        <Section
          title={t(`${NS}.payments.title`)}
          subtitle={t(`${NS}.payments.subtitle`)}
          count={recentPayouts.length}
        >
          {!recentPayouts.length ? <EmptyState message={t(`${NS}.payments.empty`)} /> : (
            <div className="space-y-2">
              {recentPayouts.map((payout, i) => (
                <div key={`${payout.job_title}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{payout.job_title || t(`${NS}.payments.job`)}</p>
                    <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{t(`${NS}.payments.paidAt`)}: {adminDateTime(payout.completed_at)}</p>
                  </div>
                  <strong className="text-sm text-emerald-600 dark:text-emerald-300">{adminMoney(Number(payout.net_to_helper_cents || 0) / 100)}</strong>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Support tickets ── */}
      {tab === 'tickets' && (
        <Section
          title={t(`${NS}.tickets.title`)}
          subtitle={t(`${NS}.tickets.subtitle`)}
          count={tickets.length}
          error={sectionError('tickets')}
          onRetry={reloadAux}
        >
          {!tickets.length ? <EmptyState message={t(`${NS}.tickets.empty`)} /> : (
            <div className="space-y-2">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        <span className="font-mono text-xs text-gray-500">#{ticket.ticket_number || ticket.id}</span>{' '}
                        {ticket.title || t(`${NS}.tickets.subject`)}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                        {t(`${NS}.tickets.created`)}: {adminDateTime(ticket.created_at)}
                        {ticket.resolved_at && <> · {t(`${NS}.tickets.resolved`)}: {adminDateTime(ticket.resolved_at)}</>}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <ToneBadge tone="sky">{humanize(ticket.status)}</ToneBadge>
                      {ticket.priority && <ToneBadge tone={String(ticket.priority).toLowerCase() === 'high' ? 'red' : 'gray'}>{humanize(ticket.priority)}</ToneBadge>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Disputes ── */}
      {tab === 'disputes' && (
        <Section
          title={t(`${NS}.disputes.title`)}
          subtitle={t(`${NS}.disputes.subtitle`)}
          count={disputes.length}
          error={disputeSectionError}
          onRetry={reloadAux}
        >
          {!disputes.length ? <EmptyState message={t(`${NS}.disputes.empty`)} /> : (
            <div className="space-y-2">
              {disputes.map((dispute) => (
                <Link
                  key={dispute.id}
                  to={`/admin/disputes/${dispute.id}`}
                  className="block rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-3 hover:border-orange-400/50 transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{humanize(dispute.reason) || t(`${NS}.disputes.reason`)}</p>
                      <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                        {t(`${NS}.disputes.openedAt`)}: {adminDateTime(dispute.created_at)}
                        {dispute.resolved_at && <> · {t(`${NS}.disputes.resolvedAt`)}: {adminDateTime(dispute.resolved_at)}</>}
                        {dispute.job_id && <> · {t(`${NS}.disputes.job`)}: <span className="font-mono">{dispute.job_id}</span></>}
                      </p>
                      {dispute.description && <p className="mt-1 text-[11px] leading-4 text-gray-500 line-clamp-2">{dispute.description}</p>}
                    </div>
                    <ToneBadge tone={OPEN_DISPUTE_STATUSES.has(String(dispute.status).toLowerCase()) ? 'red' : 'amber'}>{humanize(dispute.status)}</ToneBadge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Fraud cases ── */}
      {tab === 'fraud' && (
        <Section
          title={t(`${NS}.fraud.title`)}
          subtitle={t(`${NS}.fraud.subtitle`)}
          count={fraudCases.length}
          error={sectionError('fraud')}
          onRetry={reloadAux}
        >
          {!fraudCases.length ? <EmptyState message={t(`${NS}.fraud.empty`)} /> : (
            <div className="space-y-3">
              {fraudCases.map((fraudCase) => (
                <FraudCaseCard key={fraudCase.id} fraudCase={fraudCase} />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Incidents ── */}
      {tab === 'incidents' && (
        <Section
          title={t(`${NS}.incidents.title`)}
          subtitle={t(`${NS}.incidents.subtitle`)}
          count={incidents.length}
          error={sectionError('incidents')}
          onRetry={reloadAux}
        >
          {!incidents.length ? <EmptyState message={t(`${NS}.incidents.empty`)} /> : (
            <div className="space-y-2">
              {incidents.map((incident) => (
                <div key={incident.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{humanize(incident.reason) || t(`${NS}.incidents.reason`)}</p>
                      <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                        {t(`${NS}.incidents.reportedAt`)}: {adminDateTime(incident.created_at)}
                      </p>
                      {incident.resolution && (
                        <p className="mt-1 text-[11px] leading-4 text-emerald-600 dark:text-emerald-300/90">{t(`${NS}.incidents.resolution`)}: {incident.resolution}</p>
                      )}
                    </div>
                    <ToneBadge tone={String(incident.status).toLowerCase() === 'resolved' ? 'emerald' : 'amber'}>
                      {humanize(incident.status)}
                    </ToneBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Case notes ── */}
      {tab === 'notes' && (
        <Section
          title={t(`${NS}.notes.title`)}
          subtitle={t(`${NS}.notes.subtitle`)}
          count={notes.length}
          error={sectionError('notes')}
          onRetry={reloadAux}
        >
          <div className="space-y-3">
            <div>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={t(`${NS}.notes.placeholder`)}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
              {noteError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">{noteError}</p>}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={addNote}
                  disabled={!noteDraft.trim() || noteBusy}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {noteBusy && <Loader2 size={12} className="animate-spin" />}
                  {t(`${NS}.notes.add`)}
                </button>
              </div>
            </div>
            {!notes.length ? <EmptyState message={t(`${NS}.notes.empty`)} /> : (
              <div className="space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-3">
                    <p className="text-xs leading-5 text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{note.note_text}</p>
                    <p className="mt-2 text-[10px] text-gray-500">
                      {note.author_name || note.author_email || t(`${NS}.audit.system`)}
                      {' · '}{adminDateTime(note.created_at)}
                      {note.updated_at && note.updated_at !== note.created_at && ` (${t(`${NS}.notes.edited`)})`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Investigation (E13 gated) ── */}
      {tab === 'investigation' && (
        <Section
          title={t(`${NS}.investigation.title`)}
          subtitle={t(`${NS}.investigation.subtitle`)}
          action={investigation.data && (
            <button
              type="button"
              onClick={loadInvestigation}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <RefreshCw size={11} />{t(`${NS}.refresh`)}
            </button>
          )}
        >
          {investigation.loading && (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-6 justify-center">
              <Loader2 size={14} className="animate-spin" />{t(`${NS}.loading`)}
            </div>
          )}
          {investigation.error && (
            <SectionError message={investigation.error} retryLabel={t(`${NS}.retry`)} onRetry={loadInvestigation} />
          )}
          {investigation.needsGrant && !grantRequested && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-700 dark:text-amber-300">
                <Eye size={14} className="shrink-0 mt-0.5" />
                <p>{t(`${NS}.investigation.needGrant`)}</p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  {t(`${NS}.investigation.purposeLabel`)}
                </label>
                <textarea
                  value={grantPurpose}
                  onChange={(e) => setGrantPurpose(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={t(`${NS}.investigation.purposePlaceholder`)}
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
                {grantError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">{grantError}</p>}
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={requestGrant}
                    disabled={!grantPurpose.trim() || grantBusy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                  >
                    {grantBusy && <Loader2 size={12} className="animate-spin" />}
                    {t(`${NS}.investigation.requestGrant`)}
                  </button>
                </div>
              </div>
            </div>
          )}
          {grantRequested && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-700 dark:text-emerald-300">
              <BadgeCheck size={14} className="shrink-0 mt-0.5" />
              <p>{t(`${NS}.investigation.grantRequested`)}</p>
            </div>
          )}
          {investigation.data && (
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                [t(`${NS}.investigation.colEmail`), investigation.data.email],
                [t(`${NS}.investigation.colPhone`), investigation.data.phone],
                [t(`${NS}.investigation.colLocation`), [investigation.data.city, investigation.data.state, investigation.data.country].filter(Boolean).join(', ')],
                [t(`${NS}.investigation.colDidit`), investigation.data.didit_status ? `${humanize(investigation.data.didit_status)}${investigation.data.didit_verified_at ? ` · ${adminDate(investigation.data.didit_verified_at, { dateStyle: 'medium' })}` : ''}` : null],
                [t(`${NS}.investigation.colIdentity`), investigation.data.identity_verified ? t(`${NS}.risk.verified`) : t(`${NS}.risk.unverified`)],
                [t(`${NS}.investigation.colBackground`), investigation.data.background_check_status ? humanize(investigation.data.background_check_status) : null],
                [t(`${NS}.investigation.colTier`), investigation.data.membership_tier ? humanize(investigation.data.membership_tier) : null],
                [t(`${NS}.investigation.colSubscription`), investigation.data.subscription_status ? humanize(investigation.data.subscription_status) : null],
                [t(`${NS}.investigation.colOnboarding`), investigation.data.onboarding_status ? humanize(investigation.data.onboarding_status) : null],
                [t(`${NS}.investigation.colLastLogin`), investigation.data.last_login_at ? adminDateTime(investigation.data.last_login_at) : null],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-gray-200 dark:border-gray-800/60 pb-2">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="text-xs text-gray-700 dark:text-gray-200 text-right">{value || t(`${NS}.overview.notAvailable`)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      )}

      {/* ── Audit trail ── */}
      {tab === 'audit' && (
        <div className="space-y-6">
          <Section
            title={t(`${NS}.audit.userActivity`)}
            count={activity.length}
            error={sectionError('activity')}
            onRetry={reloadAux}
          >
            {!activity.length ? <EmptyState message={t(`${NS}.audit.empty`)} /> : (
              <div className="space-y-2">
                {activity.slice(0, 50).map((event) => (
                  <div key={`${event.source}-${event.id}`} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-orange-600 dark:text-orange-300">{event.event_type || event.action_type || event.source}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {event.actor_name || event.actor_email || t(`${NS}.audit.system`)}
                        {event.notes ? ` · ${event.notes}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] text-gray-600 dark:text-gray-500">{adminDateTime(event.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section
            title={t(`${NS}.audit.adminActions`)}
            count={adminAudit.length}
            error={sectionError('adminAudit')}
            onRetry={reloadAux}
          >
            {!adminAudit.length ? <EmptyState message={t(`${NS}.audit.empty`)} /> : (
              <div className="space-y-2">
                {adminAudit.slice(0, 50).map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-orange-600 dark:text-orange-300">{entry.action}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {t(`${NS}.audit.actor`)}: {entry.admin_name || entry.admin_email || t(`${NS}.audit.system`)}
                        {entry.notes || entry.description ? ` · ${entry.notes || entry.description}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] text-gray-600 dark:text-gray-500">{adminDateTime(entry.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ── Message modal ── */}
      {messageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111318] border border-gray-200 dark:border-gray-800 p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <MessageSquare size={14} />{t(`${NS}.actions.messageTitle`, { name })}
            </h3>
            {messageSent ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-700 dark:text-emerald-300">
                <BadgeCheck size={14} className="shrink-0 mt-0.5" />
                <p>{t(`${NS}.actions.messageSent`)}</p>
              </div>
            ) : (
              <div className="mt-4">
                <textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder={t(`${NS}.actions.messagePlaceholder`)}
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950/60 px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
                {messageError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-300">{messageError}</p>}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMessageOpen(false)}
                className="rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {messageSent ? t(`${NS}.actions.close`) : t(`${NS}.actions.cancel`)}
              </button>
              {!messageSent && (
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={!messageBody.trim() || messageBusy}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {messageBusy && <Loader2 size={12} className="animate-spin" />}
                  {t(`${NS}.actions.messageSend`)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Privileged action confirm ── */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmConfig?.title || ''}
        message={confirmConfig?.message || ''}
        confirmLabel={confirmConfig?.confirmLabel}
        danger={confirmConfig?.danger}
        requireReason={confirmConfig?.requireReason}
        reasonLabel={t(`${NS}.actions.reasonLabel`)}
        reasonPlaceholder={t(`${NS}.actions.reasonPlaceholder`)}
        onClose={() => setConfirmAction(null)}
        onConfirm={(reason) => runPrivilegedAction(confirmAction, reason)}
      />

      {/* ── Related: reviews ── */}
      {tab === 'overview' && recentReviews.length > 0 && (
        <Section title={t(`${NS}.reviews.title`)} subtitle={t(`${NS}.reviews.subtitle`)} count={recentReviews.length}>
          <div className="space-y-2">
            {recentReviews.map((review, i) => (
              <div key={`${review.created_at}-${i}`} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/55 dark:bg-gray-950/55 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">
                    {t(`${NS}.reviews.rating`, { rating: review.rating })} · {review.reviewer_name || t(`${NS}.common.unknown`)}
                  </p>
                  <span className="text-[10px] text-gray-500">{adminDateTime(review.created_at)}</span>
                </div>
                {review.comment && <p className="mt-1 text-[11px] leading-4 text-gray-600 dark:text-gray-400">{review.comment}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
