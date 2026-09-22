// client/src/pages/LifeDashboard.jsx
//
// First-screen experience for users in the `life_only` mode. Pulls together
// the personal-life surfaces that the OxSteed backend has been quietly
// shipping for the customer side:
//
//   /api/life-pulse                       financial health score + timeline
//   /api/planned-needs                    recurring jobs (auto-publish)
//   /api/planned-needs/projection         next-90-day cost outlook
//   /api/planned-needs/suggestions        "you should plan for X"
//   /api/life-dashboard/summary           expenses/budgets/goals roll-up
//   /api/life-dashboard/expenses          recent expense feed
//   /api/life-dashboard/goals             goal progress
//   /api/life-dashboard/home-tasks        open home tasks
//   /api/vehicles                         garage count
//   /api/house                            properties count
//
// Everything is best-effort — if one endpoint is down or missing, that card
// shows an empty/loading state but the page still renders.

import { useEffect, useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import DashboardQuickLinks, { DASHBOARD_QUICK_LINKS } from '../components/DashboardQuickLinks';
import {
  HeartPulse, Car, Home, Wallet, Target, ListChecks,
  CalendarClock, Lightbulb, ArrowRight, Wrench, Hammer, Sparkles,
} from 'lucide-react';

function Card({ title, icon, action, children }) {
  return (
    <section
      className="rounded-xl border bg-gray-900/40 backdrop-blur"
      style={{
        borderColor: 'var(--color-border, #1f2937)',
        background: 'var(--color-surface, rgba(17,24,39,0.6))',
      }}
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--color-text, #e5e7eb)' }}>
            {title}
          </h3>
        </div>
        {action}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function StatRow({ label, value, hint }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{label}</span>
      <div className="text-right">
        <div className="text-base font-semibold" style={{ color: 'var(--color-text, #f3f4f6)' }}>{value}</div>
        {hint && <div className="text-[10px]" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{hint}</div>}
      </div>
    </div>
  );
}

function fmtCurrency(cents, currency = 'USD') {
  if (cents == null || isNaN(cents)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function PulseRing({ score }) {
  // score 0..100
  if (score == null) {
    return <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>—</div>;
  }
  const radius = 36;
  const stroke = 6;
  const c = 2 * Math.PI * radius;
  const offset = c - (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} stroke="rgba(148,163,184,0.2)" strokeWidth={stroke} fill="none" />
        <circle
          cx="48" cy="48" r={radius}
          stroke="#F97316" strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold" style={{ color: 'var(--color-text, #f3f4f6)' }}>{Math.round(score)}</span>
      </div>
    </div>
  );
}

// ── Cross-sell engine ──────────────────────────────────────────────────────────
// Generates contextual OxSteed suggestions from pillar data already on the page.
function buildCrossSells({ vehicles, homes, goals, expenses, summary }) {
  const suggestions = [];

  // Car pillar → car maintenance helpers
  if (vehicles.length > 0) {
    suggestions.push({
      id: 'car_maintenance',
      icon: <Car size={16} className="text-yellow-400" />,
      title: 'Schedule car maintenance',
      subtitle: `You have ${vehicles.length} vehicle${vehicles.length > 1 ? 's' : ''} in your garage. Stay ahead of service.`,
      href: '/helpers?categories=Automotive',
      cta: 'Find a mechanic',
      color: 'yellow',
    });
  }

  // Home pillar → home repair helpers
  if (homes.length > 0) {
    suggestions.push({
      id: 'home_repair',
      icon: <Home size={16} className="text-blue-400" />,
      title: 'Home maintenance on demand',
      subtitle: `You own ${homes.length} propert${homes.length > 1 ? 'ies' : 'y'}. Keep it in top shape.`,
      href: '/helpers?categories=Home+Repair',
      cta: 'Find a helper',
      color: 'blue',
    });
  }

  // Goals shortfall → suggest side income (rent tools)
  const shortfallGoal = goals.find(g =>
    g.target_amount > 0 &&
    (g.current_amount / g.target_amount) < 0.5 &&
    g.status !== 'completed'
  );
  if (shortfallGoal) {
    suggestions.push({
      id: 'tool_rental',
      icon: <Hammer size={16} className="text-orange-400" />,
      title: 'Earn side income with your tools',
      subtitle: `"${shortfallGoal.title}" is less than halfway there. List idle tools and earn while you sleep.`,
      href: '/tool-rentals/list',
      cta: 'List your tools',
      color: 'orange',
    });
  }

  // Negative monthly net → suggest posting skills as a helper
  const net = summary ? (summary.total_income || 0) - (summary.total_expenses || 0) : null;
  if (net !== null && net < 0) {
    suggestions.push({
      id: 'become_helper',
      icon: <Wrench size={16} className="text-green-400" />,
      title: 'Turn your skills into income',
      subtitle: 'You spent more than you earned this month. Helpers on OxSteed earn on their own schedule.',
      href: '/register/helper',
      cta: 'Become a helper',
      color: 'green',
    });
  }

  // High home-category expenses → suggest planning ahead
  const homeExpenses = (expenses || []).filter(e =>
    /home|rent|mortgage|repair|maintenance/i.test(e.category || '')
  );
  if (homeExpenses.length >= 2 && !suggestions.find(s => s.id === 'home_repair')) {
    suggestions.push({
      id: 'planned_needs',
      icon: <CalendarClock size={16} className="text-purple-400" />,
      title: 'Plan your home expenses',
      subtitle: "You've logged several home costs. Set up planned needs to stay ahead.",
      href: '/planned-needs',
      cta: 'Set up a plan',
      color: 'purple',
    });
  }

  // Always offer consulting if any business/financial goal exists
  const businessGoal = goals.find(g => /business|revenue|income|profit/i.test(g.title || ''));
  if (businessGoal) {
    suggestions.push({
      id: 'consulting',
      icon: <Sparkles size={16} className="text-pink-400" />,
      title: 'Get a business consultant',
      subtitle: `Working toward "${businessGoal.title}"? OxSteed consultants can accelerate it.`,
      href: '/consulting',
      cta: 'Find a consultant',
      color: 'pink',
    });
  }

  return suggestions.slice(0, 4); // cap at 4 cards
}

const COLOR_MAP = {
  yellow:  { bg: 'rgba(234,179,8,0.08)',   border: 'rgba(234,179,8,0.25)',   text: '#facc15' },
  blue:    { bg: 'rgba(59,130,246,0.08)',   border: 'rgba(59,130,246,0.25)', text: '#60a5fa' },
  orange:  { bg: 'rgba(249,115,22,0.08)',   border: 'rgba(249,115,22,0.25)', text: '#f97316' },
  green:   { bg: 'rgba(34,197,94,0.08)',    border: 'rgba(34,197,94,0.25)',  text: '#4ade80' },
  purple:  { bg: 'rgba(168,85,247,0.08)',   border: 'rgba(168,85,247,0.25)', text: '#c084fc' },
  pink:    { bg: 'rgba(236,72,153,0.08)',   border: 'rgba(236,72,153,0.25)', text: '#f472b6' },
};

function CrossSellPanel({ vehicles, homes, goals, expenses, summary, loaded }) {
  const suggestions = useMemo(
    () => buildCrossSells({ vehicles, homes, goals, expenses, summary }),
    [vehicles, homes, goals, expenses, summary],
  );
  if (!loaded || suggestions.length === 0) return null;
  return (
    <Card title="Tailored for your life" icon={<Sparkles size={16} className="text-orange-500" />}>
      <div className="grid sm:grid-cols-2 gap-3 pt-1">
        {suggestions.map((s) => {
          const c = COLOR_MAP[s.color] || COLOR_MAP.orange;
          return (
            <a
              key={s.id}
              href={s.href}
              className="flex flex-col gap-2 rounded-xl p-3 transition hover:opacity-90"
              style={{ background: c.bg, border: `1px solid ${c.border}` }}
            >
              <div className="flex items-center gap-2">
                {s.icon}
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text, #f3f4f6)' }}>{s.title}</span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{s.subtitle}</p>
              <span className="text-xs font-semibold mt-auto flex items-center gap-1" style={{ color: c.text }}>
                {s.cta} <ArrowRight size={11} />
              </span>
            </a>
          );
        })}
      </div>
    </Card>
  );
}

export default function LifeDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currency = user?.preferred_currency || 'USD';

  const [pulse, setPulse] = useState(null);
  const [needs, setNeeds] = useState([]);
  const [projection, setProjection] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [goals, setGoals] = useState([]);
  const [homeTasks, setHomeTasks] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [homes, setHomes] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const safeGet = (url) => api.get(url).then(r => r.data).catch(() => null);
    Promise.all([
      safeGet('/life-pulse'),
      safeGet('/planned-needs?status=active'),
      safeGet('/planned-needs/projection?days=90'),
      safeGet('/planned-needs/suggestions'),
      safeGet('/life-dashboard/summary'),
      safeGet('/life-dashboard/expenses?limit=5'),
      safeGet('/life-dashboard/goals'),
      safeGet('/life-dashboard/home-tasks?status=open&limit=5'),
      safeGet('/vehicles'),
      safeGet('/house'),
    ]).then((all) => {
      if (cancelled) return;
      const [p, n, pr, s, sm, ex, g, ht, v, h] = all;
      setPulse(p);
      setNeeds(Array.isArray(n?.items) ? n.items : (Array.isArray(n) ? n : []));
      setProjection(pr);
      setSuggestions(Array.isArray(s?.items) ? s.items : (Array.isArray(s) ? s : []));
      setSummary(sm?.summary || sm);
      setExpenses(Array.isArray(ex?.expenses) ? ex.expenses : []);
      setGoals(Array.isArray(g?.goals) ? g.goals : (Array.isArray(g) ? g : []));
      setHomeTasks(Array.isArray(ht?.tasks) ? ht.tasks : (Array.isArray(ht) ? ht : []));
      setVehicles(Array.isArray(v?.vehicles) ? v.vehicles : (Array.isArray(v) ? v : []));
      setHomes(Array.isArray(h?.homes) ? h.homes : (Array.isArray(h) ? h : []));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const next30Need = useMemo(() => {
    if (!needs.length) return null;
    return [...needs]
      .filter(n => n.due_date && !n.is_paused)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0] || null;
  }, [needs]);

  const monthlyNet = summary
    ? ((summary.total_income || 0) - (summary.total_expenses || 0))
    : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <section>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('dashboards.life.title', { defaultValue: 'Your life, at a glance' })}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
            {t('dashboards.life.subtitle', { defaultValue: 'Track your finances, plan ahead, and stay on top of home and car.' })}
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card
            title={t('dashboards.life.pulse', { defaultValue: 'Life Pulse' })}
            icon={<HeartPulse size={16} className="text-orange-500" />}
          >
            <div className="flex items-center gap-4">
              <PulseRing score={pulse?.score?.overall} />
              <div className="flex-1">
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {pulse?.score?.label || t('dashboards.life.pulseHint', { defaultValue: 'How healthy your money is right now' })}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>Coverage</div>
                    <div className="font-semibold">{pulse?.score?.coverage ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>Buffer</div>
                    <div className="font-semibold">{pulse?.score?.buffer ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>Reliability</div>
                    <div className="font-semibold">{pulse?.score?.reliability ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>Obligations</div>
                    <div className="font-semibold">{pulse?.score?.obligations ?? '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card
            title={t('dashboards.life.thisMonth', { defaultValue: 'This month' })}
            icon={<Wallet size={16} className="text-orange-500" />}
            action={<Link to="/life-dashboard/expenses" className="text-xs text-orange-400 hover:text-orange-300">{t('common.viewAll', { defaultValue: 'View all' })}</Link>}
          >
            <StatRow label={t('dashboards.life.income', { defaultValue: 'Income' })} value={fmtCurrency(summary?.total_income, currency)} />
            <StatRow label={t('dashboards.life.expenses', { defaultValue: 'Expenses' })} value={fmtCurrency(summary?.total_expenses, currency)} />
            <StatRow
              label={t('dashboards.life.net', { defaultValue: 'Net' })}
              value={monthlyNet == null ? '—' : fmtCurrency(monthlyNet, currency)}
              hint={monthlyNet != null && monthlyNet < 0 ? t('dashboards.life.netNegative', { defaultValue: 'You spent more than you earned' }) : null}
            />
          </Card>

          <Card
            title={t('dashboards.life.next30', { defaultValue: 'Next 90 days' })}
            icon={<CalendarClock size={16} className="text-orange-500" />}
            action={<Link to="/planned-needs" className="text-xs text-orange-400 hover:text-orange-300">{t('dashboards.life.planAhead', { defaultValue: 'Plan ahead' })}</Link>}
          >
            <StatRow
              label={t('dashboards.life.expectedSpend', { defaultValue: 'Expected spend' })}
              value={fmtCurrency(projection?.total_cents, currency)}
            />
            <StatRow
              label={t('dashboards.life.upcomingNeeds', { defaultValue: 'Active needs' })}
              value={needs.length}
            />
            {next30Need && (
              <div className="mt-3 p-3 rounded-lg" style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}>
                <div className="text-[11px] uppercase tracking-wide" style={{ color: '#F97316' }}>Next up</div>
                <div className="text-sm font-semibold mt-0.5">{next30Need.title}</div>
                <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  {next30Need.due_date ? new Date(next30Need.due_date).toLocaleDateString() : ''}
                  {next30Need.estimated_cost ? ` · ${fmtCurrency((next30Need.estimated_cost || 0) * 100, currency)}` : ''}
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card
            title={t('dashboards.life.recentExpenses', { defaultValue: 'Recent activity' })}
            icon={<Wallet size={16} className="text-orange-500" />}
            action={<Link to="/life-dashboard/expenses" className="text-xs text-orange-400 hover:text-orange-300">{t('common.viewAll', { defaultValue: 'View all' })}</Link>}
          >
            {expenses.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {loaded ? t('dashboards.life.noExpenses', { defaultValue: 'Nothing logged yet. Start by adding an expense.' }) : t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {expenses.map((e) => (
                  <li key={e.id} className="py-2 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-sm truncate">{e.description || e.category}</div>
                      <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {new Date(e.occurred_at).toLocaleDateString()} · {e.category}
                      </div>
                    </div>
                    <div className={`text-sm font-semibold ${e.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                      {e.type === 'income' ? '+' : '-'}{fmtCurrency(Math.round(parseFloat(e.amount || 0) * 100), currency)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title={t('dashboards.life.goals', { defaultValue: 'Goals' })}
            icon={<Target size={16} className="text-orange-500" />}
            action={<Link to="/life-dashboard/goals" className="text-xs text-orange-400 hover:text-orange-300">{t('common.viewAll', { defaultValue: 'View all' })}</Link>}
          >
            {goals.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {loaded ? t('dashboards.life.noGoals', { defaultValue: 'Set your first savings goal to start tracking progress.' }) : t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {goals.slice(0, 4).map((g) => {
                  const pct = g.target_amount > 0 ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100)) : 0;
                  return (
                    <li key={g.id}>
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm font-medium">{g.title}</span>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,0.15)' }}>
                        <div className="h-full" style={{ width: `${pct}%`, background: '#F97316' }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card
            title={t('dashboards.life.homeTasks', { defaultValue: 'Home tasks' })}
            icon={<ListChecks size={16} className="text-orange-500" />}
            action={<Link to="/life-dashboard/home-tasks" className="text-xs text-orange-400 hover:text-orange-300">{t('common.viewAll', { defaultValue: 'View all' })}</Link>}
          >
            {homeTasks.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {loaded ? t('dashboards.life.noHomeTasks', { defaultValue: 'No open tasks. Add one to keep track.' }) : t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {homeTasks.slice(0, 5).map((tk) => (
                  <li key={tk.id} className="text-sm flex items-center justify-between">
                    <span className="truncate pr-2">{tk.title}</span>
                    {tk.due_date && (
                      <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                        {new Date(tk.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title={t('dashboards.life.suggestions', { defaultValue: 'Suggestions for you' })}
            icon={<Lightbulb size={16} className="text-orange-500" />}
          >
            {suggestions.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {loaded ? t('dashboards.life.noSuggestions', { defaultValue: 'You\'re all caught up. Nice work.' }) : t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {suggestions.slice(0, 5).map((s, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <ArrowRight size={14} className="mt-0.5 text-orange-400 flex-shrink-0" />
                    <span>{s.title || s.message || s}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <CrossSellPanel
          vehicles={vehicles}
          homes={homes}
          goals={goals}
          expenses={expenses}
          summary={summary}
          loaded={loaded}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link to="/vehicles" className="rounded-lg border p-4 hover:bg-orange-500/5 transition flex items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
            <Car size={20} className="text-orange-500" />
            <div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dashboards.life.garage', { defaultValue: 'Garage' })}</div>
              <div className="text-lg font-semibold">{vehicles.length}</div>
            </div>
          </Link>
          <Link to="/house" className="rounded-lg border p-4 hover:bg-orange-500/5 transition flex items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
            <Home size={20} className="text-orange-500" />
            <div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dashboards.life.properties', { defaultValue: 'Properties' })}</div>
              <div className="text-lg font-semibold">{homes.length}</div>
            </div>
          </Link>
          <Link to="/planned-needs" className="rounded-lg border p-4 hover:bg-orange-500/5 transition flex items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
            <CalendarClock size={20} className="text-orange-500" />
            <div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dashboards.life.plannedNeeds', { defaultValue: 'Planned needs' })}</div>
              <div className="text-lg font-semibold">{needs.length}</div>
            </div>
          </Link>
          <Link to="/post-job" className="rounded-lg border p-4 hover:bg-orange-500/5 transition flex items-center gap-3 bg-orange-500/10" style={{ borderColor: 'rgba(249,115,22,0.4)' }}>
            <ArrowRight size={20} className="text-orange-500" />
            <div>
              <div className="text-xs text-orange-300">{t('dashboards.life.needHelp', { defaultValue: 'Need help today?' })}</div>
              <div className="text-sm font-semibold">{t('dashboards.life.postJob', { defaultValue: 'Post a job' })}</div>
            </div>
          </Link>
        </div>
      </main>

      <div className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6 lg:px-8">
        <DashboardQuickLinks items={DASHBOARD_QUICK_LINKS.life} />
      </div>

      <Footer />
    </div>
  );
}
