import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Briefcase, DollarSign, TrendingUp, AlertTriangle, Flag,
  Activity, ArrowUpRight, Shield, Clock, MessageSquare, CheckCircle,
  XCircle, UserX, BarChart2, Zap, MapPin, UserCheck, CreditCard,
  Loader2, RefreshCw, ChevronRight,
} from 'lucide-react';
import RevenueChart from '../../components/RevenueChart';
import StatCard     from '../../components/StatCard';
import adminApi     from '../../../lib/adminApi';
import { useAuth }  from '../../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import ConfirmDialog from '../../lib/ConfirmDialog';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt$(cents) {
  if (!cents) return '$0.00';
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function fmtRelative(d, t) {
  if (!d) return '';
  const diffM = (Date.now() - new Date(d)) / 60000;
  if (diffM < 60)  return t('superDashboard.minutesAgo', { count: Math.floor(diffM) });
  const diffH = diffM / 60;
  if (diffH < 24)  return t('superDashboard.hoursAgo', { count: Math.floor(diffH) });
  return t('superDashboard.daysAgo', { count: Math.floor(diffH / 24) });
}

const EVENT_META = {
  user_registered:  { labelKey: 'superDashboard.eventUserRegistered', color: 'text-blue-400',   icon: Users },
  published_job:    { labelKey: 'superDashboard.eventPublishedJob',    color: 'text-yellow-400', icon: Briefcase },
  in_progress_job:  { labelKey: 'superDashboard.eventInProgressJob',   color: 'text-orange-400', icon: Activity },
  completed_job:    { labelKey: 'superDashboard.eventCompletedJob',    color: 'text-emerald-400',icon: CheckCircle },
  cancelled_job:    { labelKey: 'superDashboard.eventCancelledJob',    color: 'text-red-400',    icon: XCircle },
  support_ticket:   { labelKey: 'superDashboard.eventSupportTicket',   color: 'text-indigo-400', icon: MessageSquare },
};

// ─── sub-components ───────────────────────────────────────────────────────────

function SectionHeading({ children }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{children}</h2>;
}

function AlertCard({ icon: Icon, title, detail, to, color = 'red' }) {
  const { t } = useTranslation();
  const colors = {
    red:    { bg: 'bg-red-500/10',    border: 'border-red-500/25',    icon: 'text-red-400',    link: 'text-red-400 hover:text-red-300'    },
    yellow: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/25', icon: 'text-yellow-400', link: 'text-yellow-400 hover:text-yellow-300' },
    indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/25', icon: 'text-indigo-400', link: 'text-indigo-400 hover:text-indigo-300' },
    orange: { bg: 'bg-orange-500/10', border: 'border-orange-500/25', icon: 'text-orange-400', link: 'text-orange-400 hover:text-orange-300' },
  };
  const c = colors[color] || colors.red;
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4 flex items-center justify-between gap-3`}>
      <div className="flex items-center gap-3 min-w-0">
        <Icon size={16} className={`${c.icon} shrink-0`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{title}</p>
          {detail && <p className={`text-xs mt-0.5 ${c.icon}`}>{detail}</p>}
        </div>
      </div>
      {to && (
        <Link to={to} className={`${c.link} flex items-center gap-1 text-xs font-medium shrink-0 transition`}>
          {t('superDashboard.viewLink')} <ArrowUpRight size={12} />
        </Link>
      )}
    </div>
  );
}

function ActivityFeed({ events, loading }) {
  const { t } = useTranslation();
  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={18} className="animate-spin text-gray-600" />
    </div>
  );
  if (!events.length) return <p className="text-gray-600 text-sm py-4 text-center">{t('superDashboard.activityEmpty')}</p>;
  return (
    <div className="space-y-1">
      {events.map((evt, i) => {
        const meta = EVENT_META[evt.type] || { labelKey: null, color: 'text-gray-400', icon: Activity };
        const Icon = meta.icon;
        return (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-800/60 last:border-0">
            <Icon size={13} className={`${meta.color} shrink-0`} />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-gray-300 truncate">{evt.label || t('superDashboard.entityRef', { id: evt.entity_id })}</span>
              <span className={`text-xs ${meta.color} ml-1.5`}>{meta.labelKey ? t(meta.labelKey) : evt.type}</span>
            </div>
            <span className="text-xs text-gray-600 shrink-0">{fmtRelative(evt.occurred_at, t)}</span>
          </div>
        );
      })}
    </div>
  );
}

function GeoTable({ rows, loading, label }) {
  const { t } = useTranslation();
  if (loading) return <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-gray-600" /></div>;
  if (!rows.length) return <p className="text-gray-600 text-xs py-3 text-center">{t('superDashboard.geoNoData')}</p>;
  const max = parseInt(rows[0]?.count, 10) || 1;
  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((r, i) => {
        const count = parseInt(r.count, 10);
        const pct   = Math.round((count / max) * 100);
        const loc   = [r.city, r.state].filter(Boolean).join(', ');
        return (
          <div key={i}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-300 truncate max-w-[60%]">{loc || t('superDashboard.geoUnknown')}</span>
              <span className="text-gray-500">{count.toLocaleString()} {label}</span>
            </div>
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500/60 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HealthDot({ status }) {
  const colors = { ok: 'bg-emerald-500', warn: 'bg-yellow-500', error: 'bg-red-500', unknown: 'bg-gray-600' };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status] || colors.unknown}`} />;
}

// ─── main component ───────────────────────────────────────────────────────────

export default function SuperDashboard() {
  const { user }  = useAuth();
  const { t } = useTranslation();
  const isSuper   = user?.role === 'super_admin';

  const [period,   setPeriod]   = useState('30d');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [incidentActionId, setIncidentActionId] = useState(null);
  const [incidentActionError, setIncidentActionError] = useState(null);
  const [resolveTarget, setResolveTarget] = useState(null);

  // Main stats (re-runs on period change)
  const { data: stats, loading, error: statsError, reload: reloadStats } = useAbortableFetch(async (signal) => {
    const endpoint = isSuper ? `/admin/super/dashboard?period=${period}` : '/admin/dashboard';
    const { data } = await adminApi.get(endpoint, { signal });
    return data.stats;
  }, [period, isSuper]);
  const error = !loading && statsError ? t('superDashboard.errorLoadStats') : null;

  useEffect(() => { if (stats) setLastUpdated(new Date()); }, [stats]);

  // Secondary panels: activity, geo, health, incidents (one-time, super only)
  const { data: aux, loading: auxLoading, reload: reloadAux } = useAbortableFetch(async (signal) => {
    const empty = { activity: [], geo: { userGeo: [], jobGeo: [] }, health: null, incidents: [], incidentError: null };
    if (!isSuper) return empty;
    const settled = await Promise.allSettled([
      adminApi.get('/admin/super/dashboard/activity?limit=20', { signal }),
      adminApi.get('/admin/super/dashboard/geo', { signal }),
      adminApi.get('/monitoring/health', { signal }),
      adminApi.get('/monitoring/security-events?hours=24', { signal }),
    ]);
    const [actRes, geoRes, healthRes, incRes] = settled;
    let incidents = [];
    let incidentError = null;
    if (incRes.status === 'fulfilled') {
      const grouped = incRes.value?.data?.byType || {};
      incidents = Object.values(grouped)
        .flat()
        .filter((incident) => incident.source === 'durable' && !incident.resolvedAt)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } else if (incRes.reason?.name !== 'AbortError' && incRes.reason?.code !== 'ERR_CANCELED') {
      incidentError = t('superDashboard.incidentUnavailable');
    }
    return {
      activity: actRes.status === 'fulfilled' ? (actRes.value?.data?.activity || []) : [],
      geo: geoRes.status === 'fulfilled' ? (geoRes.value?.data || empty.geo) : empty.geo,
      health: healthRes.status === 'fulfilled' ? (healthRes.value?.data || null) : null,
      incidents,
      incidentError,
    };
  }, [isSuper]);
  const activity        = aux?.activity || [];
  const actLoading      = auxLoading;
  const geo             = aux?.geo || { userGeo: [], jobGeo: [] };
  const geoLoading      = auxLoading;
  const health          = aux?.health ?? null;
  const incidents       = aux?.incidents || [];
  const incidentLoading = auxLoading;
  const incidentError   = aux?.incidentError || incidentActionError || null;

  const acknowledgeIncident = async (incidentId) => {
    setIncidentActionId(incidentId);
    setIncidentActionError(null);
    try {
      await adminApi.post(`/monitoring/incidents/${incidentId}/acknowledge`);
      reloadAux();
    } catch (err) {
      setIncidentActionError(err?.response?.data?.error || t('superDashboard.incidentUpdateFailed'));
    } finally {
      setIncidentActionId(null);
    }
  };

  // Resolving requires a resolution note; the hardcoded placeholder is gone.
  const doResolveIncident = async (note) => {
    setIncidentActionId(resolveTarget);
    setIncidentActionError(null);
    try {
      await adminApi.post(`/monitoring/incidents/${resolveTarget}/resolve`, { resolutionNotes: note });
      reloadAux();
    } catch (err) {
      throw new Error(err?.response?.data?.error || t('superDashboard.incidentUpdateFailed'));
    } finally {
      setIncidentActionId(null);
    }
  };

  const handlePeriod = (p) => { if (p !== period) setPeriod(p); };

  const refreshAll = () => {
    reloadStats();
    reloadAux();
  };
  const busy = loading || auxLoading;

  const pl = t('superDashboard.period' + period);
  const s  = stats;

  // ── Alerts: items that need immediate attention ─────────────────────────
  const alerts = s ? [
    s.open_disputes      > 0 && { icon: AlertTriangle, title: t('superDashboard.alertOpenDisputes', { count: s.open_disputes }), detail: t('superDashboard.alertOpenDisputesDetail'), to: '/admin/disputes',    color: 'red'    },
    s.open_support_tickets > 0 && { icon: MessageSquare, title: t('superDashboard.alertOpenTickets', { count: s.open_support_tickets }), detail: t('superDashboard.alertOpenTicketsDetail'), to: '/admin/support', color: 'indigo' },
    s.pending_reports    > 0 && { icon: Flag,          title: t('superDashboard.alertPendingReports', { count: s.pending_reports }), detail: t('superDashboard.alertPendingReportsDetail'), to: '/admin/reports',     color: 'yellow' },
    s.unverified_helpers > 0 && { icon: UserCheck,     title: t('superDashboard.alertUnverifiedHelpers', { count: s.unverified_helpers }), detail: t('superDashboard.alertUnverifiedHelpersDetail'), to: '/admin/users?role=helper', color: 'orange' },
  ].filter(Boolean) : [];

  // ─── render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-8 max-w-7xl space-y-8" style={{ minHeight: '100vh', background: 'transparent' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('superDashboard.title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isSuper && (
            <div className="flex gap-1 bg-[#111318] border border-gray-800 rounded-xl p-1">
              {['1d', '7d', '30d', '90d', '1y'].map(p => (
                <button
                  key={p}
                  onClick={() => handlePeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    period === p
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={refreshAll}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[#111318] border border-gray-800 px-3 py-2 text-xs font-semibold text-gray-400 hover:text-gray-200 transition disabled:opacity-40"
            title={t('superDashboard.refresh')}
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            {busy ? t('superDashboard.refreshing') : t('superDashboard.refresh')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-800 bg-[#111318] px-2.5 py-1">
          <span className={`h-1.5 w-1.5 rounded-full ${loading ? 'bg-yellow-400' : error ? 'bg-red-400' : 'bg-emerald-400'}`} />
          {loading ? t('superDashboard.statusLoading') : error ? t('superDashboard.statusAttention') : t('superDashboard.statusCurrent')}
        </span>
        {lastUpdated && <span>{t('superDashboard.updatedAt', { time: lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}</span>}
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
          <span>{error}</span>
          <button type="button" onClick={refreshAll} disabled={busy} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-50">{t('superDashboard.tryAgain')}</button>
        </div>
      )}

      {/* ── Needs Attention (P1 — only show when there are alerts) ──────── */}
      {alerts.length > 0 && (
        <section>
          <SectionHeading>{t('superDashboard.needsAttention')}</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {alerts.map((a, i) => <AlertCard key={i} {...a} />)}
          </div>
        </section>
      )}

      {/* ── Revenue highlight (super only) ──────────────────────────────── */}
      {isSuper && (
        <section>
          <SectionHeading>{t('superDashboard.revenueHeading', { period: pl })}</SectionHeading>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label={t('superDashboard.statTotalRevenue')}
              value={s?.total_revenue_cents ?? null}
              format="currency"
              icon={DollarSign}
              color="text-orange-400"
              highlight
            />
            <StatCard
              label={t('superDashboard.statRevenuePeriod', { period: pl })}
              value={s?.revenue_period_cents ?? null}
              format="currency"
              icon={TrendingUp}
              color="text-emerald-400"
              delta={s?.revenue_delta_cents}
              deltaLabel={t('superDashboard.vsPrevPeriod')}
              subtitle={s ? t('superDashboard.subRevenue', { amount: fmt$(s.subscription_revenue_period_cents) }) : undefined}
            />
            <StatCard
              label={t('superDashboard.statRevenueMtd')}
              value={s?.revenue_mtd_cents ?? null}
              format="currency"
              icon={BarChart2}
              color="text-blue-400"
              subtitle={s ? t('superDashboard.subRevenue', { amount: fmt$(s.subscription_revenue_mtd_cents) }) : undefined}
            />
            <StatCard
              label={t('superDashboard.statActiveSubscribers')}
              value={s?.active_subscriptions ?? null}
              icon={CreditCard}
              color="text-purple-400"
              subtitle={s?.refunds_period_cents ? t('superDashboard.refundsLabel', { period: pl, amount: fmt$(s.refunds_period_cents) }) : undefined}
            />
          </div>
        </section>
      )}

      {/* ── User health ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeading>{t('superDashboard.usersSection')}</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('superDashboard.statTotalUsers')}    value={s?.total_users     ?? null} icon={Users}     color="text-blue-400" />
          <StatCard label={t('superDashboard.statTotalCustomers')} value={s?.total_customers ?? null} icon={Users}     color="text-sky-400" />
          <StatCard
            label={t('superDashboard.statNewUsers', { period: pl })}
            value={s?.new_users_period ?? null}
            icon={TrendingUp}
            color="text-emerald-400"
            delta={s?.new_users_delta}
            deltaLabel={t('superDashboard.vsPrev')}
            subtitle={s?.new_users_today ? t('superDashboard.todayCount', { count: s.new_users_today }) : undefined}
          />
          <StatCard label={t('superDashboard.statBrokers')}        value={s?.total_brokers   ?? null} icon={Users}     color="text-purple-400" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label={t('superDashboard.statTotalHelpers')}       value={s?.total_helpers      ?? null} icon={Shield}  color="text-orange-400" />
          <StatCard label={t('superDashboard.statVerifiedHelpers')}    value={s?.verified_helpers   ?? null} icon={UserCheck} color="text-emerald-400" href="/admin/users?role=helper" />
          <StatCard label={t('superDashboard.statUnverifiedHelpers')}  value={s?.unverified_helpers ?? null} icon={UserCheck} color="text-yellow-400" href="/admin/users?role=helper" />
          <StatCard label={t('superDashboard.statSuspendedBanned')}  value={s?.suspended_users    ?? null} icon={UserX}   color="text-red-400" href="/admin/users?status=banned" />
        </div>
      </section>

      {/* ── Jobs & Activity ─────────────────────────────────────────────── */}
      <section>
        <SectionHeading>{t('superDashboard.jobsActivity')}</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('superDashboard.statOpenJobs')}     value={s?.open_jobs      ?? null} icon={Briefcase} color="text-yellow-400" href="/admin/jobs?status=published" />
          <StatCard label={t('superDashboard.statActiveJobs')}   value={s?.active_jobs    ?? null} icon={Activity}  color="text-orange-400" href="/admin/jobs?status=in_progress" />
          <StatCard label={t('superDashboard.statCompleted')}     value={s?.completed_jobs ?? null} icon={CheckCircle} color="text-emerald-400" />
          <StatCard label={t('superDashboard.statOpenDisputes')} value={s?.open_disputes  ?? null} icon={AlertTriangle} color="text-red-400" href="/admin/disputes" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard
            label={t('superDashboard.statNewJobs', { period: pl })}
            value={s?.new_jobs_period ?? null}
            icon={Briefcase}
            color="text-blue-400"
            delta={s?.new_jobs_delta}
            deltaLabel={t('superDashboard.vsPrev')}
            subtitle={s?.new_jobs_today ? t('superDashboard.todayCount', { count: s.new_jobs_today }) : undefined}
          />
          <StatCard label={t('superDashboard.statCancelledJobs')}     value={s?.cancelled_jobs   ?? null} icon={XCircle}   color="text-red-400" />
          <StatCard label={t('superDashboard.statAvgBids')}   value={s?.avg_bids_per_job != null ? String(s.avg_bids_per_job) : null} icon={BarChart2}  color="text-indigo-400" />
          <StatCard label={t('superDashboard.statCompletionRate')} value={s?.completion_rate  ?? null} format="percent"                                    icon={TrendingUp} color="text-emerald-400" />
        </div>
      </section>

      {/* ── Support & Moderation ────────────────────────────────────────── */}
      <section>
        <SectionHeading>{t('superDashboard.supportModeration')}</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={t('superDashboard.statOpenTickets')} value={s?.open_support_tickets ?? null} icon={MessageSquare} color="text-indigo-400" href="/admin/support" />
          <StatCard label={t('superDashboard.statPendingReports')}       value={s?.pending_reports      ?? null} icon={Flag}          color="text-yellow-400" href="/admin/reports" />
          <StatCard label={t('superDashboard.statActiveSubs')}  value={s?.active_subscriptions ?? null} icon={CreditCard}    color="text-purple-400" />
          <StatCard label={t('superDashboard.statPendingPayouts')}   value={s?.pending_payouts ? Math.round(s.pending_payouts) * 100 : null} format="currency" icon={DollarSign} color="text-orange-400" />
        </div>
      </section>

      {/* ── Platform health ─────────────────────────────────────────────── */}
      {isSuper && (
        <section>
          <SectionHeading>{t('superDashboard.platformHealth')}</SectionHeading>
          <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              {[
                { label: t('superDashboard.healthApi'), status: health ? 'ok' : 'unknown', note: health ? t('superDashboard.healthApiOk') : t('superDashboard.healthApiDown') },
                { label: t('superDashboard.healthDatabase'), status: health?.database?.totalSize > 0 ? 'ok' : health ? 'warn' : 'unknown', note: health?.database?.totalSize > 0 ? t('superDashboard.healthDbOk') : t('superDashboard.healthDbWarn') },
                { label: t('superDashboard.healthAuditChain'), status: health?.auditIntegrity?.status === 'healthy' ? 'ok' : health ? 'error' : 'unknown', note: health?.auditIntegrity?.status === 'healthy' ? t('superDashboard.healthAuditOk', { count: health.auditIntegrity.checkedCount || 0 }) : health?.auditIntegrity?.status || t('superDashboard.healthNotChecked') },
                { label: t('superDashboard.healthUploadScanning'), status: health?.uploadSecurity?.configured ? 'ok' : health?.uploadSecurity?.required ? 'error' : health ? 'warn' : 'unknown', note: health?.uploadSecurity?.configured ? t('superDashboard.healthUploadOk') : health?.uploadSecurity?.required ? t('superDashboard.healthUploadRequired') : health ? t('superDashboard.healthUploadStatic') : t('superDashboard.healthNotChecked') },
                { label: t('superDashboard.healthSecurityPosture'), status: health?.securityPosture?.status === 'healthy' ? 'ok' : health?.securityPosture?.status === 'critical' ? 'error' : health ? 'warn' : 'unknown', note: health?.securityPosture?.summary || t('superDashboard.healthNotChecked') },
                { label: t('superDashboard.healthBackups'), status: health?.backup?.backupHealthy ? 'ok' : health ? 'error' : 'unknown', note: health?.backup?.lastBackupTime ? t('superDashboard.healthBackupLast', { relative: fmtRelative(health.backup.lastBackupTime, t) }) : t('superDashboard.healthBackupNone') },
              ].map(({ label, status, note }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <HealthDot status={status} />
                  <div>
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="text-xs text-gray-500">{note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Durable security incidents ─────────────────────────────────── */}
      {isSuper && (
        <section>
          <div className="flex items-center justify-between gap-3">
            <SectionHeading>{t('superDashboard.securityIncidents')}</SectionHeading>
            {incidents.length > 0 && <span className="mb-3 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300">{t('superDashboard.incidentsOpen', { count: incidents.length })}</span>}
          </div>
          <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5">
            {incidentLoading && <div className="flex items-center justify-center py-6"><Loader2 size={18} className="animate-spin text-gray-600" /></div>}
            {!incidentLoading && incidentError && <p className="py-3 text-sm text-red-300">{incidentError}</p>}
            {!incidentLoading && !incidentError && incidents.length === 0 && <p className="py-3 text-sm text-gray-600">{t('superDashboard.incidentsEmpty')}</p>}
            {!incidentLoading && incidents.length > 0 && (
              <div className="space-y-3">
                {incidents.slice(0, 10).map((incident) => (
                  <div key={incident.id} className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-400" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">{incident.type}</p>
                          <p className="mt-1 text-sm text-gray-300">{incident.message}</p>
                          <p className="mt-1 text-xs text-gray-500">{t('superDashboard.occurrences', { count: incident.occurrenceCount || 1 })} · {t('superDashboard.lastSeen', { relative: fmtRelative(incident.timestamp, t) })}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2 sm:pt-0.5">
                        {!incident.acknowledgedAt && <button type="button" onClick={() => acknowledgeIncident(incident.id)} disabled={incidentActionId === incident.id} className="rounded-lg border border-yellow-500/30 px-2.5 py-1.5 text-xs font-semibold text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50">{t('superDashboard.acknowledge')}</button>}
                        <button type="button" onClick={() => setResolveTarget(incident.id)} disabled={incidentActionId === incident.id} className="rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">{t('superDashboard.resolve')}</button>
                      </div>
                    </div>
                  </div>
                ))}
                {incidents.length > 10 && <p className="pt-1 text-xs text-gray-500">{t('superDashboard.incidentsMore')}</p>}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Revenue chart ───────────────────────────────────────────────── */}
      {isSuper && (
        <section>
          <SectionHeading>{t('superDashboard.revenueChart')}</SectionHeading>
          <RevenueChart period={period} />
        </section>
      )}

      {/* ── Bottom: Activity feed + Geographic distribution ─────────────── */}
      {isSuper && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Recent Activity */}
          <section>
            <SectionHeading>{t('superDashboard.recentActivity')}</SectionHeading>
            <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5">
              <ActivityFeed events={activity} loading={actLoading} />
            </div>
          </section>

          {/* Geographic Distribution */}
          <section>
            <SectionHeading>{t('superDashboard.geoDistribution')}</SectionHeading>
            <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5 space-y-5">
              <div>
                <p className="text-xs font-medium text-gray-400 mb-3">{t('superDashboard.topCitiesUsers')}</p>
                <GeoTable rows={geo.userGeo} loading={geoLoading} label={t('superDashboard.geoUsers')} />
              </div>
              {geo.jobGeo?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-3">{t('superDashboard.topCitiesJobs')}</p>
                  <GeoTable rows={geo.jobGeo} loading={geoLoading} label={t('superDashboard.geoJobs')} />
                </div>
              )}
            </div>
          </section>

        </div>
      )}

      <ConfirmDialog
        open={resolveTarget !== null}
        title="Resolve incident"
        message="Describe how this incident was resolved. This note is required."
        requireReason
        reasonLabel="Resolution note"
        reasonPlaceholder="What was done to resolve this incident?"
        confirmLabel={t('superDashboard.resolve')}
        onConfirm={doResolveIncident}
        onClose={() => setResolveTarget(null)}
      />

    </div>
  );
}
