import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Briefcase,
  Building2,
  CalendarRange,
  ClipboardList,
  MessageSquare,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import api from '../api/axios';
import { getMyBusinesses } from '../api/vortex';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const ROLE_CONFIG = {
  business_manager: {
    membershipRole: 'manager',
    translationKey: 'businessRoleDashboard.businessManager',
    badge: 'Business manager',
    title: 'Manager workspace',
    subtitle: 'Run day-to-day operations across the businesses where you manage scheduling, staffing, and service health.',
    primaryCta: 'Open operations workspace',
    primaryTab: 'overview',
    accent: '#f97316',
    icon: ShieldCheck,
    checklistTitle: 'Manager priorities',
    checklist: [
      'Review open jobs and scheduling pressure.',
      'Check unread conversations that need a team response.',
      'Open the workspace to coordinate calendar, staffing, and operations tabs.',
    ],
  },
  business_representative: {
    membershipRole: 'representative',
    translationKey: 'businessRoleDashboard.businessRepresentative',
    badge: 'Business representative',
    title: 'Representative workspace',
    subtitle: 'Stay close to customers, leads, and follow-up work for the businesses that assigned you.',
    primaryCta: 'Open communication workspace',
    primaryTab: 'messages',
    accent: '#38bdf8',
    icon: MessageSquare,
    checklistTitle: 'Representative priorities',
    checklist: [
      'Check unread customer threads first.',
      'Open the workspace messages and client tabs to keep follow-up moving.',
      'Watch open jobs so handoffs back to the operations team stay tight.',
    ],
  },
  business_employee: {
    membershipRole: 'employee',
    translationKey: 'businessRoleDashboard.businessEmployee',
    badge: 'Business employee',
    title: 'Employee workspace',
    subtitle: 'See the businesses you are assigned to and jump straight into the shared workspace for schedules, tasks, and updates.',
    primaryCta: 'Open assigned workspace',
    primaryTab: 'calendar',
    accent: '#34d399',
    icon: ClipboardList,
    checklistTitle: 'Employee priorities',
    checklist: [
      'Check your assigned workspace and calendar first.',
      'Review messages or updates from the team before starting work.',
      'Use the shared workspace to stay aligned on schedules and next steps.',
    ],
  },
};

function fmtCurrency(cents, currency = 'USD') {
  if (cents == null || Number.isNaN(Number(cents))) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(cents) / 100);
}

function MetricCard({ icon: Icon, label, value, accent }) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'rgba(148,163,184,0.14)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
        <Icon size={13} style={{ color: accent }} />
        {label}
      </div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}

function WorkspaceCard({ business, config, tx }) {
  const workspaceId = business.business_id || business.id;
  const workspaceBase = `/business/${workspaceId}/workspace`;
  const primaryHref = config.primaryTab ? `${workspaceBase}/${config.primaryTab}` : workspaceBase;

  return (
    <article
      className="rounded-[24px] border overflow-hidden flex flex-col"
      style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.88)' }}
    >
      <header className="px-5 pt-4 pb-3 flex items-start justify-between gap-4" style={{ borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: config.accent }}>
            {tx(`${config.translationKey}.badge`)}
          </div>
          <div className="text-lg font-semibold mt-1 truncate">{business.business_name}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {tx('businessRoleDashboard.roleLabel')} {business.role}
          </div>
        </div>
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${config.accent}22`, color: config.accent }}
        >
          <config.icon size={18} />
        </div>
      </header>

      <div className="px-5 py-4 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
            {tx('businessRoleDashboard.metricOpenJobs')}
          </div>
          <div className="text-lg font-semibold mt-1">{business.open_jobs ?? '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
            {tx('businessRoleDashboard.metricUnreadInbox')}
          </div>
          <div className="text-lg font-semibold mt-1">{business.unread_messages ?? '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
            {tx('businessRoleDashboard.metricTeamSize')}
          </div>
          <div className="text-lg font-semibold mt-1">{business.member_count ?? '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
            {tx('businessRoleDashboard.metricMtdRevenue')}
          </div>
          <div className="text-lg font-semibold mt-1">{fmtCurrency(business.mtd_revenue_cents, 'USD')}</div>
        </div>
      </div>

      <footer
        className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ borderTop: '1px solid rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}
      >
        <Link to={primaryHref} className="inline-flex items-center gap-1.5 text-sm font-semibold hover:opacity-90" style={{ color: config.accent }}>
          {tx(`${config.translationKey}.primaryCta`, config.primaryCta)} <ArrowRight size={14} />
        </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <Link to={`${workspaceBase}/overview`} className="text-xs text-orange-400 hover:text-orange-300">
            {tx('businessRoleDashboard.tabs.overview')}
          </Link>
            <Link to={`${workspaceBase}/messages`} className="text-xs text-orange-400 hover:text-orange-300">
            {tx('businessRoleDashboard.tabs.messages')}
          </Link>
            <Link to={`${workspaceBase}/calendar`} className="text-xs text-orange-400 hover:text-orange-300">
            {tx('businessRoleDashboard.tabs.calendar')}
          </Link>
        </div>
      </footer>
    </article>
  );
}

export default function BusinessRoleDashboardBase({ mode }) {
  const { t } = useTranslation();
  const config = ROLE_CONFIG[mode];
  const tx = (key, fallback, options = {}) => t(key, { defaultValue: fallback, ...options });
  const [businesses, setBusinesses] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyBusinesses()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setBusinesses(items.filter((item) => item.status === 'active' && item.role === config.membershipRole));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setBusinesses([]);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [config.membershipRole]);

  useEffect(() => {
    if (!businesses.length) return;
    let cancelled = false;
    Promise.all(
      businesses.map((business) =>
        api.get(`/businesses/${business.business_id || business.id}/analytics`)
          .then((response) => ({ id: business.business_id || business.id, data: response.data }))
          .catch(() => ({ id: business.business_id || business.id, data: null }))
      )
    ).then((results) => {
      if (cancelled) return;
      setBusinesses((previous) => previous.map((business) => {
        const found = results.find((result) => result.id === (business.business_id || business.id));
        if (!found?.data) return business;
        const analytics = found.data.analytics || found.data;
        return {
          ...business,
          mtd_revenue_cents: analytics.mtd_revenue_cents ?? analytics.month_revenue_cents ?? analytics.revenue_cents,
          open_jobs: analytics.open_jobs ?? analytics.active_jobs ?? analytics.pending_jobs,
          unread_messages: analytics.unread_messages ?? analytics.unread_inbox,
          member_count: analytics.member_count ?? analytics.team_size,
        };
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [businesses.length]);

  const totals = useMemo(() => {
    const workspaces = businesses.length;
    const openJobs = businesses.reduce((sum, business) => sum + (Number(business.open_jobs) || 0), 0);
    const unread = businesses.reduce((sum, business) => sum + (Number(business.unread_messages) || 0), 0);
    const team = businesses.reduce((sum, business) => sum + (Number(business.member_count) || 0), 0);
    return { workspaces, openJobs, unread, team };
  }, [businesses]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#020617' }}>
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'radial-gradient(circle at top left, rgba(249,115,22,0.12), transparent 30%), #020617', color: 'var(--color-text, #f8fafc)' }}>
      <Navbar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <section className="rounded-[30px] border p-6 lg:p-8" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(15,23,42,0.88))' }}>
          <div className="flex items-start justify-between gap-5 flex-wrap">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-[0.18em]" style={{ background: `${config.accent}22`, color: config.accent }}>
                <config.icon size={14} />
                {tx(`${config.translationKey}.badge`)}
              </div>
              <h1 className="text-4xl font-bold tracking-tight mt-4">{tx(`${config.translationKey}.title`)}</h1>
              <p className="text-sm mt-3" style={{ color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.75 }}>
                {tx(`${config.translationKey}.subtitle`)}
              </p>
            </div>
            <Link
                  to="/vortex"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-semibold transition hover:bg-white/5"
              style={{ borderColor: 'rgba(148,163,184,0.16)' }}
            >
              <Building2 size={15} />
              {tx('businessRoleDashboard.viewAllWorkspaces')}
              </Link>
            </div>
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={Building2} label={tx('businessRoleDashboard.metricAssignedWorkspaces')} value={totals.workspaces} accent={config.accent} />
          <MetricCard icon={Briefcase} label={tx('businessRoleDashboard.metricOpenJobs')} value={totals.openJobs} accent={config.accent} />
          <MetricCard icon={BellRing} label={tx('businessRoleDashboard.metricUnreadInbox')} value={totals.unread} accent={config.accent} />
          <MetricCard icon={Users} label={tx('businessRoleDashboard.metricTeamSize')} value={totals.team} accent={config.accent} />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[1.25fr,0.75fr] gap-4">
          <div className="grid gap-4">
            {businesses.length === 0 ? (
              <div className="rounded-[28px] border p-8" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.88)' }}>
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full" style={{ background: `${config.accent}22`, color: config.accent }}>
                  <config.icon size={28} />
                </div>
                <h2 className="text-2xl font-semibold mt-5">
                  {tx('businessRoleDashboard.noAssignedWorkspaces')}
                </h2>
                <p className="text-sm mt-3 max-w-2xl" style={{ color: 'var(--color-text-muted)', lineHeight: 1.75 }}>
                  {tx(
                    'businessRoleDashboard.noAssignedWorkspacesDescription',
                    { roleName: tx(`${config.translationKey}.badge`).toLowerCase() }
                  )}
                </p>
                <div className="flex gap-3 flex-wrap mt-6">
                  <Link to="/vortex" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition">
                    {tx('businessRoleDashboard.joinWithCode')} <ArrowRight size={15} />
                  </Link>
                  <Link to="/settings" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-semibold transition hover:bg-white/5" style={{ borderColor: 'rgba(148,163,184,0.16)' }}>
                    {tx('businessRoleDashboard.reviewAccountSettings')}
                  </Link>
                </div>
              </div>
            ) : (
              businesses.map((business) => (
                <WorkspaceCard key={business.business_id || business.id} business={business} config={config} tx={tx} />
              ))
            )}
          </div>

          <aside className="rounded-[28px] border p-6" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.88)' }}>
            <div className="text-sm font-semibold flex items-center gap-2">
              <CalendarRange size={16} style={{ color: config.accent }} />
              {tx(`${config.translationKey}.checklistTitle`)}
            </div>
            <ol className="mt-4 grid gap-3 text-sm">
              {config.checklist.map((_, index) => (
                <li key={`${config.translationKey}.checklist.${index}`} className="rounded-2xl border p-3 flex items-start gap-3" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: `${config.accent}22`, color: config.accent }}
                  >
                    {index + 1}
                  </div>
                  <span style={{ color: 'var(--color-text-muted)', lineHeight: 1.65 }}>
                    {tx(`${config.translationKey}.checklist.${index}`)}
                  </span>
                </li>
              ))}
            </ol>

            <div className="rounded-2xl border p-4 mt-5" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}>
              <div className="text-sm font-semibold flex items-center gap-2">
                <UserCheck size={15} style={{ color: config.accent }} />
                {tx('businessRoleDashboard.roleContextTitle')}
              </div>
              <p className="text-sm mt-3" style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                {tx(
                  'businessRoleDashboard.roleContextBody',
                  'This dashboard only shows businesses where your membership role is {{role}}. Open any workspace below to continue into the full Business Hub tools for that business.',
                  { role: config.badge.toLowerCase() }
                )}
              </p>
              <Link to="/settings" className="inline-flex items-center gap-2 text-sm font-semibold mt-4 hover:opacity-90" style={{ color: config.accent }}>
                {tx('businessRoleDashboard.roleContextCta')} <ArrowRight size={14} />
              </Link>
            </div>

            {businesses.length > 0 && (
              <div className="rounded-2xl border p-4 mt-5" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 size={15} style={{ color: config.accent }} />
                  {tx('businessRoleDashboard.quickJump')}
                </div>
                <div className="grid gap-2 mt-3">
                  {businesses.slice(0, 3).map((business) => (
                    <Link
                      key={business.business_id || business.id}
                      to={`/business/${business.business_id || business.id}/workspace/${config.primaryTab}`}
                      className="text-sm hover:opacity-90"
                      style={{ color: config.accent }}
                    >
                      {business.business_name} →
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </section>
      </main>
      <Footer />
    </div>
  );
}
