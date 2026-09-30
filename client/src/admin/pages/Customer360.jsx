import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Briefcase, Calendar, ChevronLeft, FileWarning, Gavel, History,
  LayoutDashboard, Loader2, Mail, MapPin, Phone, RefreshCw,
  ShieldAlert, Ticket, Wallet,
} from 'lucide-react';
import adminApi from '../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import { adminDateTime, adminMoney } from '../lib/formatters';
import AdminErrorState from '../lib/AdminErrorState';

const DISPUTE_STATUSES = ['open', 'under_review', 'resolved'];

const NS = 'adminCustomer360';

function humanize(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function toneClass(tone) {
  switch (tone) {
    case 'red':     return 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30';
    case 'amber':   return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30';
    case 'emerald': return 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30';
    case 'sky':     return 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30';
    default:        return 'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/30';
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
    <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">
      {message}
    </p>
  );
}

function SectionError({ message, retryLabel, onRetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-3 text-xs text-red-300">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-red-400/30 px-3 py-1.5 text-red-200 hover:bg-red-500/10"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function Section({ title, subtitle, count, error, onRetry, children }) {
  const { t } = useTranslation();
  return (
    <div className="bg-[#111318] border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {typeof count === 'number' && (
          <span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">
            {t(`${NS}.common.records`, { count })}
          </span>
        )}
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
          ? 'border-orange-500/50 bg-orange-500/10 text-orange-200'
          : 'border-gray-800 bg-[#111318] text-gray-400 hover:border-gray-600 hover:text-gray-200'
      }`}
    >
      <Icon size={13} />
      {label}
      {typeof count === 'number' && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-orange-500/20 text-orange-200' : 'bg-gray-800 text-gray-500'}`}>
          {count}
        </span>
      )}
    </button>
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
    <div className="rounded-lg border border-gray-800 bg-gray-950/55 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">
            {t(`${NS}.fraud.caseId`)} <span className="font-mono text-xs text-gray-400">#{shortId || fraudCase.id}</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t(`${NS}.fraud.category`)}: <span className="text-gray-300">{humanize(fraudCase.category) || t(`${NS}.common.unknown`)}</span>
            {' · '}{t(`${NS}.fraud.source`)}: <span className="text-gray-300">{humanize(fraudCase.source) || t(`${NS}.common.unknown`)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ToneBadge tone={severity.tone}>{severity.label}</ToneBadge>
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        </div>
      </div>
      {fraudCase.summary && (
        <p className="mt-2 text-xs leading-5 text-gray-400">{fraudCase.summary}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
        <span>{t(`${NS}.fraud.openedAt`)}: {adminDateTime(fraudCase.created_at)}</span>
        {fraudCase.resolved_at && <span>{t(`${NS}.fraud.resolvedAt`)}: {adminDateTime(fraudCase.resolved_at)}</span>}
        {fraudCase.owner_admin_id && (
          <span>{t(`${NS}.fraud.owner`)}: <span className="font-mono">{String(fraudCase.owner_admin_id).slice(0, 8)}</span></span>
        )}
      </div>
      {fraudCase.evidence && (
        <details className="mt-2 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-gray-400 hover:text-gray-200">
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

export default function Customer360() {
  const { t } = useTranslation();
  const { userId } = useParams();
  const [tab, setTab] = useState('overview');

  // Profile: same endpoint the admin user detail page uses.
  const { data: profileRes, loading: profileLoading, error: profileError, reload } =
    useAbortableFetch(async (signal) => {
      const { data } = await adminApi.get(`/admin/users/${userId}`, { signal });
      return data ?? null;
    }, [userId]);

  const user = profileRes?.user ?? null;
  const recentJobs = profileRes?.recentJobs ?? [];
  const recentPayouts = profileRes?.recentPayouts ?? [];

  const jobIdSet = useMemo(
    () => new Set(recentJobs.map((job) => String(job?.id))),
    [recentJobs],
  );
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
        adminApi.get('/admin/audit-log', { signal, params: { target_type: 'user', limit: 100 } }),
        (d) => (d?.log ?? []).filter((entry) => String(entry?.target_id) === String(userId)),
      ),
      ...DISPUTE_STATUSES.map((status) => run(
        `disputes:${status}`,
        adminApi.get('/disputes/admin/all', { signal, params: { status, limit: 100 } }),
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

  const disputeSectionError = DISPUTE_STATUSES.map((s) => sectionError(`disputes:${s}`)).find(Boolean) || null;
  const disputes = useMemo(() => {
    if (!aux || !user) return [];
    const email = String(user.email || '').toLowerCase();
    const seen = new Set();
    const out = [];
    for (const status of DISPUTE_STATUSES) {
      const list = sectionValue(`disputes:${status}`);
      for (const dispute of list) {
        if (!dispute || seen.has(dispute.id)) continue;
        seen.add(dispute.id);
        const byEmail = dispute.opened_by_email && String(dispute.opened_by_email).toLowerCase() === email;
        const byJob = dispute.job_id != null && jobIdSet.has(String(dispute.job_id));
        if (byEmail || byJob) out.push(dispute);
      }
    }
    return out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aux, user, jobIdSet]);

  const paidOutCents = useMemo(
    () => recentPayouts.reduce((sum, p) => sum + (Number(p.net_to_helper_cents) || 0), 0),
    [recentPayouts],
  );

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
        <Link to="/admin/users" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition mb-4">
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

  const tabs = [
    { id: 'overview', icon: LayoutDashboard, label: t(`${NS}.tabs.overview`) },
    { id: 'bookings', icon: Briefcase, label: t(`${NS}.tabs.bookings`), count: recentJobs.length },
    { id: 'payments', icon: Wallet, label: t(`${NS}.tabs.payments`), count: recentPayouts.length },
    { id: 'tickets', icon: Ticket, label: t(`${NS}.tabs.tickets`), count: tickets.length },
    { id: 'disputes', icon: Gavel, label: t(`${NS}.tabs.disputes`), count: disputes.length },
    { id: 'fraud', icon: ShieldAlert, label: t(`${NS}.tabs.fraud`), count: fraudCases.length },
    { id: 'incidents', icon: FileWarning, label: t(`${NS}.tabs.incidents`), count: incidents.length },
    { id: 'audit', icon: History, label: t(`${NS}.tabs.audit`) },
  ];

  const refreshAll = () => { reload(); reloadAux(); };

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <Link to={`/admin/users/${userId}`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition">
        <ChevronLeft size={14} />{t(`${NS}.backToCustomer`)}
      </Link>

      {/* Header */}
      <div className="bg-[#111318] border border-gray-800 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <img
            src={user.avatar_url || '/default-avatar.png'}
            alt=""
            className="w-16 h-16 rounded-full object-cover ring-2 ring-gray-600 ring-offset-2 ring-offset-[#111318] shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">{t(`${NS}.title`)}</p>
            <h1 className="mt-1 text-2xl font-bold text-white leading-tight">
              {user.first_name} {user.last_name}
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-400">{t(`${NS}.subtitle`)}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-gray-500">
              {user.email && <span className="flex items-center gap-1.5"><Mail size={12} className="text-gray-600" />{user.email}</span>}
              {user.phone && <span className="flex items-center gap-1.5"><Phone size={12} className="text-gray-600" />{user.phone}</span>}
              {(user.city || user.state) && (
                <span className="flex items-center gap-1.5"><MapPin size={12} className="text-gray-600" />{[user.city, user.state, user.country].filter(Boolean).join(', ')}</span>
              )}
              {user.created_at && (
                <span className="flex items-center gap-1.5"><Calendar size={12} className="text-gray-600" />{t(`${NS}.overview.memberSince`)} {adminDateTime(user.created_at)}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {user.role && <ToneBadge tone="sky">{humanize(user.role)}</ToneBadge>}
              <ToneBadge tone={statusTone}>{accountStatusLabel}</ToneBadge>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950/60 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800"
          >
            <RefreshCw size={13} className={profileLoading || auxLoading ? 'animate-spin' : ''} />
            {t(`${NS}.refresh`)}
          </button>
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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: t(`${NS}.overview.statBookings`), value: recentJobs.length },
              { label: t(`${NS}.overview.statPaidOut`), value: adminMoney(paidOutCents / 100) },
              { label: t(`${NS}.overview.statTickets`), value: tickets.length },
              { label: t(`${NS}.overview.statDisputes`), value: disputes.length },
              { label: t(`${NS}.overview.statFraudCases`), value: fraudCases.length },
            ].map(({ label, value }) => (
              <div key={label} className="bg-[#111318] border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</p>
                <p className="font-bold text-white text-xl sm:text-2xl">{value}</p>
              </div>
            ))}
          </div>
          <Section title={t(`${NS}.overview.profile`)}>
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                [t(`${NS}.overview.email`), user.email],
                [t(`${NS}.overview.phone`), user.phone],
                [t(`${NS}.overview.location`), [user.city, user.state, user.country].filter(Boolean).join(', ')],
                [t(`${NS}.overview.role`), humanize(user.role)],
                [t(`${NS}.overview.status`), accountStatusLabel],
                [t(`${NS}.overview.memberSince`), user.created_at ? adminDateTime(user.created_at) : null],
                [t(`${NS}.overview.lastLogin`), user.last_login_at ? adminDateTime(user.last_login_at) : null],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-gray-800/60 pb-2">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="text-xs text-gray-200 text-right">{value || t(`${NS}.overview.notAvailable`)}</dd>
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
                <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{job.title || t(`${NS}.bookings.job`)}</p>
                    <p className="mt-1 text-[11px] text-gray-600">
                      {t(`${NS}.bookings.created`)}: {adminDateTime(job.created_at)}
                      {job.final_price != null && <> · {t(`${NS}.bookings.value`)}: {adminMoney(Number(job.final_price))}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ToneBadge tone="gray">{humanize(job.status)}</ToneBadge>
                    <Link to={`/admin/jobs/${job.id}`} className="text-xs text-sky-400 hover:text-sky-300 hover:underline">
                      {t(`${NS}.bookings.viewJob`)}
                    </Link>
                  </div>
                </div>
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
                <div key={`${payout.job_title}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{payout.job_title || t(`${NS}.payments.job`)}</p>
                    <p className="mt-1 text-[11px] text-gray-600">{t(`${NS}.payments.paidAt`)}: {adminDateTime(payout.completed_at)}</p>
                  </div>
                  <strong className="text-sm text-emerald-300">{adminMoney(Number(payout.net_to_helper_cents || 0) / 100)}</strong>
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
                <div key={ticket.id} className="rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        <span className="font-mono text-xs text-gray-500">#{ticket.ticket_number || ticket.id}</span>{' '}
                        {ticket.title || t(`${NS}.tickets.subject`)}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-600">
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
                <div key={dispute.id} className="rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{humanize(dispute.reason) || t(`${NS}.disputes.reason`)}</p>
                      <p className="mt-1 text-[11px] text-gray-600">
                        {t(`${NS}.disputes.openedAt`)}: {adminDateTime(dispute.created_at)}
                        {dispute.resolved_at && <> · {t(`${NS}.disputes.resolvedAt`)}: {adminDateTime(dispute.resolved_at)}</>}
                        {dispute.job_id && <> · {t(`${NS}.disputes.job`)}: <span className="font-mono">{dispute.job_id}</span></>}
                      </p>
                      {dispute.description && <p className="mt-1 text-[11px] leading-4 text-gray-500 line-clamp-2">{dispute.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <ToneBadge tone="amber">{humanize(dispute.status)}</ToneBadge>
                      <Link to={`/admin/disputes/${dispute.id}`} className="text-xs text-sky-400 hover:text-sky-300 hover:underline">
                        {t(`${NS}.disputes.viewDispute`)}
                      </Link>
                    </div>
                  </div>
                </div>
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
                <div key={incident.id} className="rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{humanize(incident.reason) || t(`${NS}.incidents.reason`)}</p>
                      <p className="mt-1 text-[11px] text-gray-600">
                        {t(`${NS}.incidents.reportedAt`)}: {adminDateTime(incident.created_at)}
                      </p>
                      {incident.resolution && (
                        <p className="mt-1 text-[11px] leading-4 text-emerald-300/90">{t(`${NS}.incidents.resolution`)}: {incident.resolution}</p>
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
                  <div key={`${event.source}-${event.id}`} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-orange-300">{event.event_type || event.action_type || event.source}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {event.actor_name || event.actor_email || t(`${NS}.audit.system`)}
                        {event.notes ? ` · ${event.notes}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] text-gray-600">{adminDateTime(event.created_at)}</span>
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
                  <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-orange-300">{entry.action}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {t(`${NS}.audit.actor`)}: {entry.admin_name || entry.admin_email || t(`${NS}.audit.system`)}
                        {entry.notes || entry.description ? ` · ${entry.notes || entry.description}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] text-gray-600">{adminDateTime(entry.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
