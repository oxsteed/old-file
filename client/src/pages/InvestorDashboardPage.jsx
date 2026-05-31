/**
 * InvestorDashboardPage.jsx
 *
 * Live investor dashboard — platform health KPIs, revenue time-series,
 * franchise pipeline, and supply/demand data sourced from /api/investor/*.
 *
 * Accessible only to users with role investor | admin | super_admin.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Briefcase, DollarSign, TrendingUp, TrendingDown,
  Activity, BarChart2, GitBranch, Zap, RefreshCw, Star,
  CheckCircle, XCircle, Clock, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import PageShell from '../components/PageShell';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n) => (n ?? 0).toLocaleString();
const fmtK = (cents) => {
  const d = (cents ?? 0) / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(0)}`;
};
const pct  = (v) => (v == null ? '—' : `${v}%`);
const delta = (cur, prev) => {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
};

// ── Sub-components ────────────────────────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-gray-800 ${className}`} />;
}

function DeltaBadge({ value }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full
      ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
      {up ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      {Math.abs(value)}%
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, sub, deltaPct, loading, accent = 'emerald' }) {
  const colors = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    orange:  'text-orange-400  bg-orange-500/10  border-orange-500/20',
    blue:    'text-blue-400    bg-blue-500/10    border-blue-500/20',
    purple:  'text-purple-400  bg-purple-500/10  border-purple-500/20',
    rose:    'text-rose-400    bg-rose-500/10    border-rose-500/20',
  };
  const c = colors[accent] ?? colors.emerald;
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 ${c}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
        <Icon size={15} />
      </div>
      {loading
        ? <Skeleton className="h-7 w-24" />
        : <p className="text-2xl font-bold text-white">{value}</p>
      }
      {!loading && (
        <div className="flex items-center gap-2">
          {sub && <p className="text-xs opacity-60">{sub}</p>}
          <DeltaBadge value={deltaPct} />
        </div>
      )}
    </div>
  );
}

// Simple SVG bar chart (no deps)
function MiniBarChart({ data = [], height = 64 }) {
  if (!data.length) return <p className="text-xs text-gray-600 text-center py-4">No data</p>;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  return (
    <svg viewBox={`0 0 ${data.length * 24} ${height}`} className="w-full" preserveAspectRatio="none">
      {data.map((d, i) => {
        const barH = Math.max(2, (d.value / maxVal) * (height - 8));
        return (
          <g key={i}>
            <rect
              x={i * 24 + 2} y={height - barH}
              width={20} height={barH}
              rx={3}
              fill={d.color ?? '#10b981'}
              opacity={0.85}
            />
          </g>
        );
      })}
    </svg>
  );
}

// Multi-series area chart (SVG, no deps)
function AreaChart({ rows = [], height = 120 }) {
  if (!rows.length) return <p className="text-xs text-gray-600 text-center py-4">No data</p>;
  const w = 600; const h = height;
  const series = [
    { key: 'job_fee_cents',      color: '#f97316', label: 'Job fees' },
    { key: 'subscription_cents', color: '#818cf8', label: 'Subscriptions' },
  ];
  const maxVal = Math.max(...rows.flatMap(r => series.map(s => Number(r[s.key] ?? 0))), 1);
  const xStep = w / Math.max(rows.length - 1, 1);
  const toY = (v) => h - 8 - ((v / maxVal) * (h - 16));
  const toX = (i) => i * xStep;

  const polyline = (key) =>
    rows.map((r, i) => `${toX(i).toFixed(1)},${toY(Number(r[key] ?? 0)).toFixed(1)}`).join(' ');

  const area = (key, color) => {
    const pts = rows.map((r, i) => [toX(i), toY(Number(r[key] ?? 0))]);
    const d = `M${pts[0][0]},${pts[0][1]} ` +
      pts.slice(1).map(p => `L${p[0]},${p[1]}`).join(' ') +
      ` L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
    return <path key={key} d={d} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1.5} />;
  };

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        {/* grid */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={0} x2={w} y1={toY(maxVal * f)} y2={toY(maxVal * f)}
            stroke="#374151" strokeWidth={0.5} strokeDasharray="4 4" />
        ))}
        {series.map(s => area(s.key, s.color))}
        {series.map(s => (
          <polyline key={s.key} points={polyline(s.key)}
            fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
      </svg>
      <div className="flex gap-4 mt-1">
        {series.map(s => (
          <span key={s.key} className="flex items-center gap-1 text-xs text-gray-400">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Pipeline stage row
function PipelineRow({ status, count, total }) {
  const cfg = {
    pending:   { label: 'Pending',   color: 'bg-yellow-500', icon: Clock },
    reviewing: { label: 'Reviewing', color: 'bg-blue-500',   icon: Activity },
    approved:  { label: 'Approved',  color: 'bg-emerald-500', icon: CheckCircle },
    activated: { label: 'Activated', color: 'bg-purple-500', icon: Zap },
    rejected:  { label: 'Rejected',  color: 'bg-red-500',    icon: XCircle },
  };
  const c = cfg[status] ?? { label: status, color: 'bg-gray-600', icon: GitBranch };
  const Icon = c.icon;
  const barW = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-gray-400 shrink-0" />
      <p className="text-sm text-gray-300 w-24 shrink-0">{c.label}</p>
      <div className="flex-1 h-1.5 rounded-full bg-gray-800">
        <div className={`h-full rounded-full ${c.color}`} style={{ width: `${barW}%` }} />
      </div>
      <p className="text-sm font-semibold text-white w-6 text-right">{count}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const PERIODS = [
  { key: '7d',  label: '7 days'  },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '1y',  label: '1 year'  },
];

export default function InvestorDashboardPage() {
  const { user, switchRole } = useAuth();
  const navigate = useNavigate();

  const [period, setPeriod]       = useState('30d');
  const [kpis, setKpis]           = useState(null);
  const [chart, setChart]         = useState([]);
  const [franchise, setFranchise] = useState(null);
  const [supDem, setSupDem]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  // Ensure investor role
  useEffect(() => {
    if (!user) return;
    if (!['investor', 'admin', 'super_admin'].includes(user.role ?? user.default_mode)) {
      switchRole('investor').catch(() => navigate('/dashboard', { replace: true }));
    }
  }, [user, switchRole, navigate]);

  const load = useCallback(async (p = period) => {
    setLoading(true);
    setError(null);
    try {
      const [k, c, f, s] = await Promise.all([
        fetch(`/api/investor/kpis?period=${p}`,          { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/investor/revenue-chart?period=${p}`, { credentials: 'include' }).then(r => r.json()),
        fetch('/api/investor/franchise',                 { credentials: 'include' }).then(r => r.json()),
        fetch('/api/investor/supply-demand',             { credentials: 'include' }).then(r => r.json()),
      ]);
      if (k.error) throw new Error(k.error);
      setKpis(k.kpis);
      setChart(c.chart ?? []);
      setFranchise(f);
      setSupDem(s);
    } catch (e) {
      setError(e.message ?? 'Failed to load investor data');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(period); }, [period]);

  // Supply/demand weekly bar data
  const weeklyBars = (supDem?.weekly ?? []).map(w => ({
    value: Number(w.jobs_posted ?? 0),
    color: '#f97316',
  }));

  const k = kpis ?? {};
  const revDelta   = delta(k.revenue_cur_cents,  k.revenue_prev_cents);
  const userDelta  = delta(k.new_users_cur,       k.new_users_prev);
  const jobDelta   = delta(k.new_jobs_cur,        k.new_jobs_prev);

  return (
    <PageShell>
      <div className="min-h-screen bg-gray-950 text-white px-4 py-8 md:px-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-emerald-400">Investor Mode</p>
              <h1 className="text-2xl font-bold mt-0.5">Platform Overview</h1>
            </div>
            <div className="flex items-center gap-2">
              {/* Period selector */}
              <div className="flex rounded-xl bg-gray-900 border border-gray-800 overflow-hidden text-sm">
                {PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={`px-3 py-1.5 transition-colors ${
                      period === p.key
                        ? 'bg-emerald-600 text-white font-semibold'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => load(period)}
                className="p-2 rounded-xl bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
                title="Refresh"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3">
              {error}
            </div>
          )}

          {/* ── KPI grid ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard icon={DollarSign}  label="Revenue (period)"  loading={loading}
              value={fmtK(k.revenue_cur_cents)}  sub={`MTD ${fmtK(k.revenue_mtd_cents)}`}
              deltaPct={revDelta}  accent="emerald" />
            <KpiCard icon={Users}       label="New users"         loading={loading}
              value={fmt(k.new_users_cur)}        sub={`Total ${fmt(k.total_users)}`}
              deltaPct={userDelta} accent="blue" />
            <KpiCard icon={Briefcase}   label="New jobs"          loading={loading}
              value={fmt(k.new_jobs_cur)}         sub={`${pct(k.completion_rate)} completion`}
              deltaPct={jobDelta}  accent="orange" />
            <KpiCard icon={Activity}    label="Active subs"       loading={loading}
              value={fmt(k.active_subscriptions)} sub={`Sub rev ${fmtK(k.sub_revenue_cur_cents)}`}
              accent="purple" />
            <KpiCard icon={Star}        label="Avg helper rating" loading={loading}
              value={k.avg_helper_rating ? k.avg_helper_rating.toFixed(2) : '—'}
              sub={`${fmt(k.verified_helpers)} verified`} accent="orange" />
            <KpiCard icon={TrendingDown} label="Refunds (period)" loading={loading}
              value={fmtK(k.refunds_cur_cents)}   sub={`Pending payouts ${fmtK(k.pending_payouts_cents)}`}
              accent="rose" />
          </div>

          {/* ── Revenue chart + franchise pipeline ─────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Revenue chart */}
            <div className="lg:col-span-2 rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-sm text-gray-200">Revenue by source</h2>
                <BarChart2 size={15} className="text-gray-500" />
              </div>
              {loading
                ? <Skeleton className="h-28 w-full" />
                : <AreaChart rows={chart} height={110} />
              }
            </div>

            {/* Franchise pipeline */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-sm text-gray-200">Franchise pipeline</h2>
                <GitBranch size={15} className="text-gray-500" />
              </div>
              {loading
                ? <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-4" />)}</div>
                : franchise?.pipeline?.length
                  ? (
                    <div className="space-y-3">
                      {franchise.pipeline.map(row => (
                        <PipelineRow
                          key={row.status}
                          status={row.status}
                          count={Number(row.count)}
                          total={franchise.total}
                        />
                      ))}
                      <p className="text-xs text-gray-500 pt-1">Total: {franchise.total} applications</p>
                    </div>
                  )
                  : <p className="text-xs text-gray-600">No franchise applications yet</p>
              }
            </div>
          </div>

          {/* ── Supply / demand + user breakdown ───────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Weekly job trend */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-sm text-gray-200">Weekly job postings</h2>
                <TrendingUp size={15} className="text-gray-500" />
              </div>
              {loading
                ? <Skeleton className="h-16 w-full" />
                : <MiniBarChart data={weeklyBars} height={64} />
              }
              {!loading && (
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>{fmt(supDem?.helpers_available)} helpers available now</span>
                  <span>{fmt(supDem?.helpers_listed)} listed</span>
                </div>
              )}
            </div>

            {/* Top categories */}
            <div className="lg:col-span-2 rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-sm text-gray-200">Top job categories (90d)</h2>
                <Zap size={15} className="text-gray-500" />
              </div>
              {loading
                ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-4" />)}</div>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-gray-800">
                          <th className="text-left pb-2 font-normal">Category</th>
                          <th className="text-right pb-2 font-normal">Jobs</th>
                          <th className="text-right pb-2 font-normal">Completed</th>
                          <th className="text-right pb-2 font-normal">Avg bids</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(supDem?.categories ?? []).slice(0, 8).map(cat => (
                          <tr key={cat.category} className="border-b border-gray-800/50">
                            <td className="py-1.5 text-gray-200">{cat.category}</td>
                            <td className="py-1.5 text-right text-gray-300">{fmt(cat.total)}</td>
                            <td className="py-1.5 text-right text-emerald-400">{fmt(cat.completed)}</td>
                            <td className="py-1.5 text-right text-gray-400">{cat.avg_bids ?? '—'}</td>
                          </tr>
                        ))}
                        {!(supDem?.categories?.length) && (
                          <tr><td colSpan={4} className="py-4 text-center text-xs text-gray-600">No category data</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              }
            </div>
          </div>

          {/* ── User health summary ─────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="font-semibold text-sm text-gray-200 mb-4">Platform user health</h2>
            {loading
              ? <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12" />)}</div>
              : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  {[
                    { label: 'Total users',     value: fmt(k.total_users) },
                    { label: 'Customers',        value: fmt(k.total_customers) },
                    { label: 'Helpers',          value: fmt(k.total_helpers) },
                    { label: 'Verified users',   value: fmt(k.verified_users) },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl bg-gray-800/50 p-3">
                      <p className="text-xs text-gray-500 mb-0.5">{item.label}</p>
                      <p className="text-lg font-bold text-white">{item.value}</p>
                    </div>
                  ))}
                </div>
              )
            }
          </div>

        </div>
      </div>
    </PageShell>
  );
}
