/**
 * FranchiseTerritoryOpsPage.jsx
 *
 * Territory command center for launched / approved franchise operators.
 * Shows territory KPIs, helper roster, compliance status, and quick actions.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, Hammer, DollarSign, ShieldCheck, Star,
  MapPin, RefreshCw, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, TrendingUp, Building2,
} from 'lucide-react';
import api from '../api/axios';
import PageShell from '../components/PageShell';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtCents = (c) => {
  const d = (c ?? 0) / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(0)}`;
};
const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (n) => n != null ? `${n}%` : '—';

// ── Sub-components ────────────────────────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-xl bg-gray-800 ${className}`} />;
}

function KpiTile({ icon: Icon, label, value, sub, accent = 'emerald', loading }) {
  const colors = {
    emerald: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/8',
    orange:  'text-orange-400  border-orange-500/20  bg-orange-500/8',
    blue:    'text-blue-400    border-blue-500/20    bg-blue-500/8',
    purple:  'text-purple-400  border-purple-500/20  bg-purple-500/8',
    rose:    'text-rose-400    border-rose-500/20    bg-rose-500/8',
  };
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-1.5 ${colors[accent]}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
        <Icon size={14} />
      </div>
      {loading ? <Skeleton className="h-7 w-20" /> : <p className="text-xl font-bold text-white">{value}</p>}
      {!loading && sub && <p className="text-xs opacity-60">{sub}</p>}
    </div>
  );
}

const STATUS_COLOR = {
  pending:   'bg-yellow-500/15 text-yellow-400',
  approved:  'bg-emerald-500/15 text-emerald-400',
  launched:  'bg-purple-500/15 text-purple-400',
  inquiry:   'bg-gray-500/15 text-gray-400',
  diligence: 'bg-blue-500/15 text-blue-400',
  rejected:  'bg-red-500/15 text-red-400',
};

const TRAINING_LABEL_KEYS = {
  not_started: 'trainingLabels.notStarted',
  scheduled:   'trainingLabels.scheduled',
  in_progress: 'trainingLabels.inProgress',
  completed:   'trainingLabels.completed',
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function FranchiseTerritoryOpsPage() {
  const { t } = useTranslation('franchiseTerritoryPage');
  const [stats, setStats]     = useState(null);
  const [helpers, setHelpers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, hRes] = await Promise.all([
        api.get('/franchise/territory-stats'),
        api.get('/franchise/territory-helpers'),
      ]);
      setStats(sRes.data);
      setHelpers(hRes.data?.helpers ?? []);
    } catch (e) {
      setError(t('errors.loadFailure'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const app      = stats?.application ?? {};
  const kpis     = stats?.territory_kpis ?? {};
  const territory = [app.city, app.region, app.country].filter(Boolean).join(', ');
  const trainingLabel = app.training_status && TRAINING_LABEL_KEYS[app.training_status]
    ? t(TRAINING_LABEL_KEYS[app.training_status])
    : app.training_status || '—';

  // ── Not launched yet ─────────────────────────────────────────
  if (!loading && stats && !stats.has_territory) {
    return (
      <PageShell>
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
          <div className="max-w-lg text-center space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <Building2 size={13} />
              {t('noTerritory.badge')}
            </div>
            <h1 className="text-2xl font-bold">{t('noTerritory.title')}</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              {t('noTerritory.description')}
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Link to="/franchise/status" className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition">
                {t('noTerritory.viewApplication')} <ArrowRight size={14} />
              </Link>
              <Link to="/franchise/apply" className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-gray-700 text-sm font-semibold hover:bg-gray-800 transition">
                {t('noTerritory.applyNow')}
              </Link>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="min-h-screen bg-gray-950 text-white px-4 py-8 md:px-8">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <MapPin size={14} className="text-orange-400" />
                <p className="text-xs text-orange-400 font-semibold uppercase tracking-wide">
                  {loading ? '…' : territory || t('header.territoryFallback')}
                </p>
              </div>
              <h1 className="text-2xl font-bold">{t('header.title')}</h1>
            </div>
            <button
              onClick={load}
              className="self-start flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-800 bg-gray-900 text-gray-400 hover:text-white text-sm transition"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {t('actions.refresh')}
            </button>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {/* ── Status strip ───────────────────────────────────────── */}
          {!loading && app.status && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 flex flex-wrap items-center gap-3">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLOR[app.status] ?? 'bg-gray-700 text-gray-300'}`}>
                {app.status}
              </span>
              {app.brand_name && (
                <span className="text-sm font-semibold text-white">{app.brand_name}</span>
              )}
              <span className="text-xs text-gray-500 ml-auto">
                {t('status.agreementLabel')}: <span className="text-gray-300 capitalize">{app.agreement_status ?? '—'}</span>
                {'  ·  '}
                {t('status.trainingLabel')}: <span className="text-gray-300">{trainingLabel}</span>
              </span>
            </div>
          )}

          {/* ── KPI grid ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiTile icon={Users}      label={t('kpis.helpers')} loading={loading}
              value={fmt(kpis.helpers_total)}   sub={t('kpis.helpersVerified', { count: fmt(kpis.helpers_verified) })} accent="blue" />
            <KpiTile icon={Star}       label={t('kpis.avgRating')}    loading={loading}
              value={kpis.avg_rating ? kpis.avg_rating.toFixed(2) : '—'} accent="orange" />
            <KpiTile icon={Hammer}     label={t('kpis.jobsPosted')}    loading={loading}
              value={fmt(kpis.jobs_posted_30d)} sub={t('kpis.jobsActive', { count: fmt(kpis.jobs_active) })} accent="emerald" />
            <KpiTile icon={CheckCircle2} label={t('kpis.completionRate')}    loading={loading}
              value={pct(kpis.completion_rate)} sub={t('kpis.completedJobs', { count: fmt(kpis.jobs_completed) })} accent="emerald" />
            <KpiTile icon={DollarSign} label={t('kpis.revenue')}        loading={loading}
              value={fmtCents(kpis.revenue_30d_cents)} sub={t('kpis.revenueTotal', { amount: fmtCents(kpis.revenue_total_cents) })} accent="purple" />
            <KpiTile icon={ShieldCheck} label={t('kpis.compliance')}          loading={loading}
              value={pct(app.compliance_pct)} sub={t('compliance.stepsComplete', {
                done: app.checklist_done ?? 0,
                total: app.checklist_all ?? 0,
              })} accent="emerald" />
          </div>

          {/* ── Compliance + quick actions ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Compliance card */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                <ShieldCheck size={14} className="text-emerald-400" /> {t('compliance.title')}
              </h2>
              {loading
                ? <Skeleton className="h-3 w-full" />
                : (
                  <>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                      <span>{t('compliance.stepsComplete', {
                        done: app.checklist_done ?? 0,
                        total: app.checklist_all ?? 0,
                      })}</span>
                      <span className="font-bold text-white">{pct(app.compliance_pct)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                        style={{ width: `${app.compliance_pct ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs text-gray-400">
                      {[
                        [t('compliance.labels.agreement'),      app.agreement_status === 'signed',   app.agreement_status],
                        [t('compliance.labels.training'),       app.training_status === 'completed',  trainingLabel],
                        [t('compliance.labels.launchReadiness'), app.launch_readiness_status === 'launched' || app.launch_readiness_status === 'ready', app.launch_readiness_status],
                      ].map(([label, done, val]) => (
                        <div key={label} className="flex items-center gap-2">
                          {done
                            ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                            : <Clock size={12} className="text-yellow-400 shrink-0" />
                          }
                          <span className="flex-1">{label}</span>
                          <span className={done ? 'text-emerald-400' : 'text-yellow-300'}>{val ?? '—'}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )
              }
            </div>

            {/* Quick actions */}
            <div className="lg:col-span-2 rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="text-orange-400" /> {t('actionsCard.title')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { to: '/franchise/status', icon: Building2, label: t('actionsCard.viewApplication.title'), sub: t('actionsCard.viewApplication.sub'), color: 'text-orange-400' },
                  { to: '/growth',           icon: TrendingUp, label: t('actionsCard.growth.title'),       sub: t('actionsCard.growth.sub'),       color: 'text-emerald-400' },
                  { to: '/learn',            icon: Star,       label: t('actionsCard.training.title'),     sub: t('actionsCard.training.sub'),     color: 'text-blue-400' },
                  { to: '/jobs',             icon: Hammer,     label: t('actionsCard.jobs.title'),        sub: t('actionsCard.jobs.sub'),        color: 'text-purple-400' },
                ].map(({ to, icon: Icon, label, sub, color }) => (
                  <Link key={to} to={to} className="flex items-center gap-3 p-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-gray-600 transition group">
                    <Icon size={16} className={`${color} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-gray-500">{sub}</p>
                    </div>
                    <ArrowRight size={12} className="text-gray-600 group-hover:text-gray-400 transition" />
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* ── Helper roster ───────────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                <Users size={14} className="text-blue-400" /> {t('helpersSection.title')}
              </h2>
              <span className="text-xs text-gray-500">{t('helpersSection.found', { count: helpers.length })}</span>
            </div>
            {loading
              ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
              : helpers.length === 0
                ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500">{t('helpersSection.emptyTitle')}</p>
                    <p className="text-xs text-gray-600 mt-1">{t('helpersSection.emptyDescription')}</p>
                  </div>
                )
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-gray-800">
                          <th className="text-left pb-2 font-normal">{t('helpersSection.table.helper')}</th>
                          <th className="text-left pb-2 font-normal">{t('helpersSection.table.location')}</th>
                          <th className="text-right pb-2 font-normal">{t('helpersSection.table.rating')}</th>
                          <th className="text-right pb-2 font-normal">{t('helpersSection.table.reviews')}</th>
                          <th className="text-right pb-2 font-normal">{t('helpersSection.table.verified')}</th>
                          <th className="text-right pb-2 font-normal">{t('helpersSection.table.available')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {helpers.slice(0, 20).map((h) => (
                          <tr key={h.user_id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                            <td className="py-2 font-medium text-gray-200">
                              {h.first_name} {h.last_name}
                              <span className="block text-xs text-gray-500">{h.email}</span>
                            </td>
                            <td className="py-2 text-gray-400 text-xs">{[h.city, h.state].filter(Boolean).join(', ') || '—'}</td>
                            <td className="py-2 text-right text-orange-400">{h.avg_rating ? Number(h.avg_rating).toFixed(2) : '—'}</td>
                            <td className="py-2 text-right text-gray-400">{h.total_reviews ?? 0}</td>
                            <td className="py-2 text-right">
                              {h.is_identity_verified || h.is_background_checked
                                ? <CheckCircle2 size={13} className="text-emerald-400 ml-auto" />
                                : <Clock size={13} className="text-gray-600 ml-auto" />
                              }
                            </td>
                            <td className="py-2 text-right">
                              <span className={`inline-block w-2 h-2 rounded-full ${h.is_available_now ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {helpers.length > 20 && (
                      <p className="text-xs text-gray-500 text-center mt-3">{t('helpersSection.showingTop', { count: helpers.length })}</p>
                    )}
                  </div>
                )
            }
          </div>

        </div>
      </div>
    </PageShell>
  );
}
