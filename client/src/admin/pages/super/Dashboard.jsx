import { useEffect, useState, useCallback } from 'react';
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt$(cents) {
  if (!cents) return '$0.00';
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function fmtRelative(d) {
  if (!d) return '';
  const diffM = (Date.now() - new Date(d)) / 60000;
  if (diffM < 60)  return `${Math.floor(diffM)}m ago`;
  const diffH = diffM / 60;
  if (diffH < 24)  return `${Math.floor(diffH)}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const PERIOD_LABEL = { '1d': '24h', '7d': '7d', '30d': '30d', '90d': '90d', '1y': '1y' };

const EVENT_META = {
  user_registered:  { label: 'New signup',       color: 'text-blue-400',   icon: Users },
  published_job:    { label: 'Job posted',        color: 'text-yellow-400', icon: Briefcase },
  in_progress_job:  { label: 'Job started',       color: 'text-orange-400', icon: Activity },
  completed_job:    { label: 'Job completed',     color: 'text-emerald-400',icon: CheckCircle },
  cancelled_job:    { label: 'Job cancelled',     color: 'text-red-400',    icon: XCircle },
  support_ticket:   { label: 'Support ticket',    color: 'text-indigo-400', icon: MessageSquare },
};

// ─── sub-components ───────────────────────────────────────────────────────────

function SectionHeading({ children }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{children}</h2>;
}

function AlertCard({ icon: Icon, title, detail, to, color = 'red' }) {
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
          View <ArrowUpRight size={12} />
        </Link>
      )}
    </div>
  );
}

function ActivityFeed({ events, loading }) {
  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={18} className="animate-spin text-gray-600" />
    </div>
  );
  if (!events.length) return <p className="text-gray-600 text-sm py-4 text-center">No recent activity.</p>;
  return (
    <div className="space-y-1">
      {events.map((evt, i) => {
        const meta = EVENT_META[evt.type] || { label: evt.type, color: 'text-gray-400', icon: Activity };
        const Icon = meta.icon;
        return (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-800/60 last:border-0">
            <Icon size={13} className={`${meta.color} shrink-0`} />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-gray-300 truncate">{evt.label || `Entity #${evt.entity_id}`}</span>
              <span className={`text-xs ${meta.color} ml-1.5`}>{meta.label}</span>
            </div>
            <span className="text-xs text-gray-600 shrink-0">{fmtRelative(evt.occurred_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

function GeoTable({ rows, loading, label }) {
  if (loading) return <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-gray-600" /></div>;
  if (!rows.length) return <p className="text-gray-600 text-xs py-3 text-center">No data yet.</p>;
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
              <span className="text-gray-300 truncate max-w-[60%]">{loc || 'Unknown'}</span>
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
  const isSuper   = user?.role === 'super_admin';

  const [stats,    setStats]    = useState(null);
  const [period,   setPeriod]   = useState('30d');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [activity,    setActivity]    = useState([]);
  const [actLoading,  setActLoading]  = useState(true);

  const [geo,         setGeo]         = useState({ userGeo: [], jobGeo: [] });
  const [geoLoading,  setGeoLoading]  = useState(true);
  const [health,      setHealth]      = useState(null);
  const [incidents,   setIncidents]   = useState([]);
  const [incidentLoading, setIncidentLoading] = useState(true);
  const [incidentError, setIncidentError] = useState(null);
  const [incidentActionId, setIncidentActionId] = useState(null);

  // Fetch main stats (re-runs on period change)
  const fetchStats = useCallback(async (p) => {
    setLoading(true); setError(null);
    try {
      const endpoint = isSuper ? `/admin/super/dashboard?period=${p}` : '/admin/dashboard';
      const { data } = await adminApi.get(endpoint);
      setStats(data.stats);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Failed to load dashboard stats.');
    } finally {
      setLoading(false);
    }
  }, [isSuper]);

  // Fetch activity feed (one-time, not period-dependent)
  const fetchActivity = useCallback(async () => {
    if (!isSuper) return;
    setActLoading(true);
    try {
      const { data } = await adminApi.get('/admin/super/dashboard/activity?limit=20');
      setActivity(data.activity || []);
    } catch (_) {}
    finally { setActLoading(false); }
  }, [isSuper]);

  // Fetch geo data (one-time)
  const fetchGeo = useCallback(async () => {
    if (!isSuper) return;
    setGeoLoading(true);
    try {
      const { data } = await adminApi.get('/admin/super/dashboard/geo');
      setGeo(data);
    } catch (_) {}
    finally { setGeoLoading(false); }
  }, [isSuper]);

  const fetchHealth = useCallback(async () => {
    if (!isSuper) return;
    try {
      const { data } = await adminApi.get('/monitoring/health');
      setHealth(data);
    } catch (_) {
      setHealth(null);
    }
  }, [isSuper]);

  const fetchIncidents = useCallback(async () => {
    if (!isSuper) return;
    setIncidentLoading(true);
    setIncidentError(null);
    try {
      const { data } = await adminApi.get('/monitoring/security-events?hours=24');
      const grouped = data?.byType || {};
      const openIncidents = Object.values(grouped)
        .flat()
        .filter((incident) => incident.source === 'durable' && !incident.resolvedAt)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setIncidents(openIncidents);
    } catch (_) {
      setIncidentError('Security incident data is temporarily unavailable.');
    } finally {
      setIncidentLoading(false);
    }
  }, [isSuper]);

  const updateIncident = async (incidentId, action) => {
    setIncidentActionId(incidentId);
    try {
      const body = action === 'resolve'
        ? { resolutionNotes: 'Resolved from the Super Admin dashboard.' }
        : undefined;
      await adminApi.post(`/monitoring/incidents/${incidentId}/${action}`, body);
      await Promise.all([fetchIncidents(), fetchHealth()]);
    } catch (err) {
      setIncidentError(err?.response?.data?.error || 'Could not update this incident.');
    } finally {
      setIncidentActionId(null);
    }
  };

  useEffect(() => { fetchStats(period); }, [period, fetchStats]);
  useEffect(() => { fetchActivity(); fetchGeo(); fetchHealth(); fetchIncidents(); }, [fetchActivity, fetchGeo, fetchHealth, fetchIncidents]);

  const handlePeriod = (p) => { if (p !== period) setPeriod(p); };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchStats(period), fetchActivity(), fetchGeo(), fetchHealth(), fetchIncidents()]);
    } finally {
      setRefreshing(false);
    }
  };

  const pl = PERIOD_LABEL[period] || period;
  const s  = stats;

  // ── Alerts: items that need immediate attention ─────────────────────────
  const alerts = s ? [
    s.open_disputes      > 0 && { icon: AlertTriangle, title: `${s.open_disputes} Open Dispute${s.open_disputes !== 1 ? 's' : ''}`,        detail: 'Requires attention',          to: '/admin/disputes',    color: 'red'    },
    s.open_support_tickets > 0 && { icon: MessageSquare, title: `${s.open_support_tickets} Open Support Ticket${s.open_support_tickets !== 1 ? 's' : ''}`, detail: 'Users waiting for help', to: '/admin/support/tickets', color: 'indigo' },
    s.pending_reports    > 0 && { icon: Flag,          title: `${s.pending_reports} Pending Content Report${s.pending_reports !== 1 ? 's' : ''}`,     detail: 'Awaiting moderation',         to: '/admin/reports',     color: 'yellow' },
    s.unverified_helpers > 0 && { icon: UserCheck,     title: `${s.unverified_helpers} Unverified Helper${s.unverified_helpers !== 1 ? 's' : ''}`,     detail: 'Pending ID or background check', to: '/admin/users?role=helper', color: 'orange' },
  ].filter(Boolean) : [];

  // ─── render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-8 max-w-7xl space-y-8" style={{ minHeight: '100vh', background: 'transparent' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
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
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-[#111318] border border-gray-800 px-3 py-2 text-xs font-semibold text-gray-400 hover:text-gray-200 transition disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-800 bg-[#111318] px-2.5 py-1">
          <span className={`h-1.5 w-1.5 rounded-full ${loading ? 'bg-yellow-400' : error ? 'bg-red-400' : 'bg-emerald-400'}`} />
          {loading ? 'Loading dashboard data' : error ? 'Dashboard needs attention' : 'Dashboard data current'}
        </span>
        {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
          <span>{error}</span>
          <button type="button" onClick={refreshAll} disabled={refreshing} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-50">Try again</button>
        </div>
      )}

      {/* ── Needs Attention (P1 — only show when there are alerts) ──────── */}
      {alerts.length > 0 && (
        <section>
          <SectionHeading>Needs Attention</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {alerts.map((a, i) => <AlertCard key={i} {...a} />)}
          </div>
        </section>
      )}

      {/* ── Revenue highlight (super only) ──────────────────────────────── */}
      {isSuper && (
        <section>
          <SectionHeading>Revenue: {pl}</SectionHeading>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Total Revenue"
              value={s?.total_revenue_cents ?? null}
              format="currency"
              icon={DollarSign}
              color="text-orange-400"
              highlight
            />
            <StatCard
              label={`Revenue (${pl})`}
              value={s?.revenue_period_cents ?? null}
              format="currency"
              icon={TrendingUp}
              color="text-emerald-400"
              delta={s?.revenue_delta_cents}
              deltaLabel="vs prev period"
              subtitle={s ? `Sub: ${fmt$(s.subscription_revenue_period_cents)}` : undefined}
            />
            <StatCard
              label="Revenue MTD"
              value={s?.revenue_mtd_cents ?? null}
              format="currency"
              icon={BarChart2}
              color="text-blue-400"
              subtitle={s ? `Sub: ${fmt$(s.subscription_revenue_mtd_cents)}` : undefined}
            />
            <StatCard
              label="Active Subscribers"
              value={s?.active_subscriptions ?? null}
              icon={CreditCard}
              color="text-purple-400"
              subtitle={s?.refunds_period_cents ? `Refunds (${pl}): ${fmt$(s.refunds_period_cents)}` : undefined}
            />
          </div>
        </section>
      )}

      {/* ── User health ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeading>Users</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Users"    value={s?.total_users     ?? null} icon={Users}     color="text-blue-400" />
          <StatCard label="Total Customers" value={s?.total_customers ?? null} icon={Users}     color="text-sky-400" />
          <StatCard
            label={`New Users (${pl})`}
            value={s?.new_users_period ?? null}
            icon={TrendingUp}
            color="text-emerald-400"
            delta={s?.new_users_delta}
            deltaLabel="vs prev"
            subtitle={s?.new_users_today ? `Today: ${s.new_users_today}` : undefined}
          />
          <StatCard label="Brokers"        value={s?.total_brokers   ?? null} icon={Users}     color="text-purple-400" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Total Helpers"       value={s?.total_helpers      ?? null} icon={Shield}  color="text-orange-400" />
          <StatCard label="Verified Helpers"    value={s?.verified_helpers   ?? null} icon={UserCheck} color="text-emerald-400" href="/admin/users?role=helper" />
          <StatCard label="Unverified Helpers"  value={s?.unverified_helpers ?? null} icon={UserCheck} color="text-yellow-400" href="/admin/users?role=helper" />
          <StatCard label="Suspended / Banned"  value={s?.suspended_users    ?? null} icon={UserX}   color="text-red-400" href="/admin/users?status=banned" />
        </div>
      </section>

      {/* ── Jobs & Activity ─────────────────────────────────────────────── */}
      <section>
        <SectionHeading>Jobs &amp; Activity</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Open Jobs"     value={s?.open_jobs      ?? null} icon={Briefcase} color="text-yellow-400" href="/admin/jobs?status=published" />
          <StatCard label="Active Jobs"   value={s?.active_jobs    ?? null} icon={Activity}  color="text-orange-400" href="/admin/jobs?status=in_progress" />
          <StatCard label="Completed"     value={s?.completed_jobs ?? null} icon={CheckCircle} color="text-emerald-400" />
          <StatCard label="Open Disputes" value={s?.open_disputes  ?? null} icon={AlertTriangle} color="text-red-400" href="/admin/disputes" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard
            label={`New Jobs (${pl})`}
            value={s?.new_jobs_period ?? null}
            icon={Briefcase}
            color="text-blue-400"
            delta={s?.new_jobs_delta}
            deltaLabel="vs prev"
            subtitle={s?.new_jobs_today ? `Today: ${s.new_jobs_today}` : undefined}
          />
          <StatCard label="Cancelled Jobs"     value={s?.cancelled_jobs   ?? null} icon={XCircle}   color="text-red-400" />
          <StatCard label="Avg Bids / Job"   value={s?.avg_bids_per_job != null ? String(s.avg_bids_per_job) : null} icon={BarChart2}  color="text-indigo-400" />
          <StatCard label="Completion Rate" value={s?.completion_rate  ?? null} format="percent"                                    icon={TrendingUp} color="text-emerald-400" />
        </div>
      </section>

      {/* ── Support & Moderation ────────────────────────────────────────── */}
      <section>
        <SectionHeading>Support &amp; Moderation</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Open Support Tickets" value={s?.open_support_tickets ?? null} icon={MessageSquare} color="text-indigo-400" href="/admin/support/tickets" />
          <StatCard label="Pending Reports"       value={s?.pending_reports      ?? null} icon={Flag}          color="text-yellow-400" href="/admin/reports" />
          <StatCard label="Active Subscriptions"  value={s?.active_subscriptions ?? null} icon={CreditCard}    color="text-purple-400" />
          <StatCard label="Pending Payouts ($)"   value={s?.pending_payouts ? Math.round(s.pending_payouts) * 100 : null} format="currency" icon={DollarSign} color="text-orange-400" />
        </div>
      </section>

      {/* ── Platform health ─────────────────────────────────────────────── */}
      {isSuper && (
        <section>
          <SectionHeading>Platform Health</SectionHeading>
          <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              {[
                { label: 'API', status: health ? 'ok' : 'unknown', note: health ? 'Monitoring endpoint responding' : 'Health data unavailable' },
                { label: 'Database', status: health?.database?.totalSize > 0 ? 'ok' : health ? 'warn' : 'unknown', note: health?.database?.totalSize > 0 ? 'Connection pool active' : 'Check database health' },
                { label: 'Audit chain', status: health?.auditIntegrity?.status === 'healthy' ? 'ok' : health ? 'error' : 'unknown', note: health?.auditIntegrity?.status === 'healthy' ? `${health.auditIntegrity.checkedCount || 0} entries verified` : health?.auditIntegrity?.status || 'Not checked' },
                { label: 'Upload scanning', status: health?.uploadSecurity?.configured ? 'ok' : health?.uploadSecurity?.required ? 'error' : health ? 'warn' : 'unknown', note: health?.uploadSecurity?.configured ? 'Malware scanner configured' : health?.uploadSecurity?.required ? 'Required but unavailable' : health ? 'Static validation only' : 'Not checked' },
                { label: 'Security posture', status: health?.securityPosture?.status === 'healthy' ? 'ok' : health?.securityPosture?.status === 'critical' ? 'error' : health ? 'warn' : 'unknown', note: health?.securityPosture?.summary || 'Not checked' },
                { label: 'Backups', status: health?.backup?.backupHealthy ? 'ok' : health ? 'error' : 'unknown', note: health?.backup?.lastBackupTime ? `Last backup ${fmtRelative(health.backup.lastBackupTime)}` : 'No successful backup recorded' },
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
            <SectionHeading>Security Incidents</SectionHeading>
            {incidents.length > 0 && <span className="mb-3 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300">{incidents.length} open</span>}
          </div>
          <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5">
            {incidentLoading && <div className="flex items-center justify-center py-6"><Loader2 size={18} className="animate-spin text-gray-600" /></div>}
            {!incidentLoading && incidentError && <p className="py-3 text-sm text-red-300">{incidentError}</p>}
            {!incidentLoading && !incidentError && incidents.length === 0 && <p className="py-3 text-sm text-gray-600">No open durable security incidents.</p>}
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
                          <p className="mt-1 text-xs text-gray-500">{incident.occurrenceCount || 1} occurrence{Number(incident.occurrenceCount || 1) === 1 ? '' : 's'} · last seen {fmtRelative(incident.timestamp)}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2 sm:pt-0.5">
                        {!incident.acknowledgedAt && <button type="button" onClick={() => updateIncident(incident.id, 'acknowledge')} disabled={incidentActionId === incident.id} className="rounded-lg border border-yellow-500/30 px-2.5 py-1.5 text-xs font-semibold text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50">Acknowledge</button>}
                        <button type="button" onClick={() => updateIncident(incident.id, 'resolve')} disabled={incidentActionId === incident.id} className="rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">{incidentActionId === incident.id ? 'Updating…' : 'Resolve'}</button>
                      </div>
                    </div>
                  </div>
                ))}
                {incidents.length > 10 && <p className="pt-1 text-xs text-gray-500">Showing the 10 most recent incidents. Use monitoring tools for the complete history.</p>}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Revenue chart ───────────────────────────────────────────────── */}
      {isSuper && (
        <section>
          <SectionHeading>Revenue Chart</SectionHeading>
          <RevenueChart period={period} />
        </section>
      )}

      {/* ── Bottom: Activity feed + Geographic distribution ─────────────── */}
      {isSuper && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Recent Activity */}
          <section>
            <SectionHeading>Recent Activity</SectionHeading>
            <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5">
              <ActivityFeed events={activity} loading={actLoading} />
            </div>
          </section>

          {/* Geographic Distribution */}
          <section>
            <SectionHeading>Geographic Distribution</SectionHeading>
            <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 sm:p-5 space-y-5">
              <div>
                <p className="text-xs font-medium text-gray-400 mb-3">Top Cities: Users</p>
                <GeoTable rows={geo.userGeo} loading={geoLoading} label="users" />
              </div>
              {geo.jobGeo?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-3">Top Cities: Jobs</p>
                  <GeoTable rows={geo.jobGeo} loading={geoLoading} label="jobs" />
                </div>
              )}
            </div>
          </section>

        </div>
      )}

    </div>
  );
}
