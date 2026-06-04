/**
 * AffiliateDashboardPage.jsx
 *
 * Full affiliate earnings & analytics dashboard.
 * Surfaces the existing affiliate backend for guide contributors,
 * helpers, and business owners who earn commission on referrals.
 *
 * Sections:
 *  1. Overview stat tiles (lifetime, pending, paid, conversions)
 *  2. 30-day earnings sparkline (clicks + commission)
 *  3. Conversion funnel (click → purchase waterfall)
 *  4. Top products table
 *  5. Payout history + request payout CTA
 *  6. Referral link generator per program
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { formatCents, formatNumber } from '../lib/format';

// ── Icons ─────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoDollar    = (p) => <Ico {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>;
const IcoTrend     = (p) => <Ico {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></Ico>;
const IcoCheck     = (p) => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoLink      = (p) => <Ico {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></Ico>;
const IcoCopy      = (p) => <Ico {...p}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></Ico>;
const IcoArrowR    = (p) => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Ico>;
const IcoZap       = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;
const IcoPackage   = (p) => <Ico {...p}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></Ico>;
const IcoAward     = (p) => <Ico {...p}><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></Ico>;
const IcoX         = (p) => <Ico {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;
const IcoPlus      = (p) => <Ico {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Ico>;

// ── Shared UI ─────────────────────────────────────────────────────────────
const Card = ({ children, className = '' }) => (
  <div className={`bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 ${className}`}>{children}</div>
);
const CardHeader = ({ icon: IconComp, title, right }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2.5">
      {IconComp && <IconComp size={16} cls="text-orange-400" />}
      <h3 className="font-semibold text-white text-sm">{title}</h3>
    </div>
    {right}
  </div>
);
const StatTile = ({ label, value, sub, icon: IconComp, color = 'text-orange-400' }) => (
  <Card>
    <div className="flex items-start justify-between mb-3">
      <div className={`p-2 rounded-xl bg-current/10 ${color}`}>
        {IconComp && <IconComp size={16} cls={color} />}
      </div>
    </div>
    <p className={`text-2xl font-black ${color} mb-0.5`}>{value}</p>
    <p className="text-xs text-gray-400 font-medium">{label}</p>
    {sub && <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>}
  </Card>
);
const Btn = ({ children, onClick, variant = 'primary', className = '', disabled = false, ...rest }) => {
  const v = {
    primary: 'bg-orange-500 hover:bg-orange-600 text-white',
    secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-300',
    ghost: 'bg-transparent hover:bg-gray-800 text-gray-400 border border-gray-700',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed ${v[variant]} ${className}`}
      {...rest}>{children}</button>
  );
};
const Badge = ({ text, color = 'orange' }) => {
  const m = { orange: 'bg-orange-500/15 text-orange-400', green: 'bg-emerald-500/15 text-emerald-400', gray: 'bg-gray-700/40 text-gray-400', yellow: 'bg-yellow-500/15 text-yellow-400', red: 'bg-red-500/15 text-red-400', blue: 'bg-blue-500/15 text-blue-400' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${m[color] || m.gray}`}>{text}</span>;
};

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt$ = (cents) => {
  return formatCents(cents || 0);
};
const fmtPct = (v) => `${parseFloat(v || 0).toFixed(1)}%`;
const fmtNum = (v) => formatNumber(parseInt(v || 0));

const payoutStatusColor = (s) => ({ pending: 'yellow', processing: 'blue', completed: 'green', failed: 'red' }[s] || 'gray');

// ── Sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ data, valueKey, color = '#f97316', height = 48, noDataText = 'No data yet' }) {
  if (!data?.length) return <div className="h-12 flex items-center justify-center text-gray-700 text-xs">{noDataText}</div>;
  const vals = data.map((d) => parseFloat(d[valueKey] || 0));
  const max = Math.max(...vals, 0.01);
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * 300;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 300 ${height}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} 300,${height}`} fill="url(#spark-fill)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Funnel bar ────────────────────────────────────────────────────────────
function FunnelBar({ label, count, pct, color }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 text-xs text-gray-400 shrink-0 capitalize">{label.replace(/_/g, ' ')}</span>
      <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }} />
      </div>
      <span className="w-14 text-xs text-white text-right shrink-0">{fmtNum(count)}</span>
      <span className="w-12 text-[10px] text-gray-500 text-right shrink-0">{fmtPct(pct)}</span>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', h); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white">{title}</h3>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white transition rounded-lg hover:bg-gray-800"><IcoX size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function AffiliateDashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats]             = useState(null);
  const [programs, setPrograms]       = useState([]);
  const [selectedProgram, setSelected] = useState(null);
  const [metrics, setMetrics]         = useState([]);
  const [funnel, setFunnel]           = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [payouts, setPayouts]         = useState([]);
  const [sources, setSources]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [analyticsLoading, setALoad]  = useState(false);
  const [days, setDays]               = useState(30);
  const [showCreateModal, setCreate]  = useState(false);
  const [showPayoutModal, setPayout]  = useState(false);
  const [createForm, setCreateForm]   = useState({ program_type: 'amazon_affiliate', commission_rate: '' });
  const [creating, setCreating]       = useState(false);
  const [requestingPayout, setReqPayout] = useState(false);

  // ── Load overview ──────────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, progsRes, payoutsRes] = await Promise.all([
        api.get('/affiliate/stats/all'),
        api.get('/affiliate'),
        api.get('/affiliate/schedule'),
      ]);
      setStats(statsRes.data.data);
      setPrograms(progsRes.data.data || []);
      setPayouts(payoutsRes.data.data || []);
      if (progsRes.data.data?.length) setSelected(progsRes.data.data[0]);
    } catch (err) {
      toast.error(t('affiliateDashboard.errors.loadAffiliateData'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // ── Load program analytics when selection or days changes ──────────────
  useEffect(() => {
    if (!selectedProgram) return;
    const id = selectedProgram.id;
    setALoad(true);
    Promise.all([
      api.get(`/affiliate/${id}/analytics/metrics`, { params: { days } }),
      api.get(`/affiliate/${id}/analytics/funnel`, { params: { days } }),
      api.get(`/affiliate/${id}/analytics/products`, { params: { days, limit: 8 } }),
      api.get(`/affiliate/${id}/analytics/sources`, { params: { days } }),
    ]).then(([m, f, p, s]) => {
      setMetrics(m.data.metrics || []);
      setFunnel(f.data);
      setTopProducts(p.data.top_products || []);
      setSources(s.data);
    }).catch(() => {
      toast.error(t('affiliateDashboard.errors.loadAnalytics'));
    }).finally(() => setALoad(false));
  }, [selectedProgram, days]);

  // ── Create program ─────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!createForm.commission_rate) return toast.error(t('affiliateDashboard.form.commissionRateRequired'));
    setCreating(true);
    try {
      await api.post('/affiliate', createForm);
      toast.success(t('affiliateDashboard.toasts.programCreated'));
      setCreate(false);
      setCreateForm({ program_type: 'amazon_affiliate', commission_rate: '' });
      loadOverview();
    } catch (err) {
      toast.error(err?.response?.data?.message || t('affiliateDashboard.errors.createProgram'));
    } finally {
      setCreating(false);
    }
  };

  // ── Request payout ─────────────────────────────────────────────────────
  const handleRequestPayout = async () => {
    if (!selectedProgram) return;
    setReqPayout(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      await api.post('/affiliate/calculate', {
        programId: selectedProgram.id,
        periodStart: monthStart,
        periodEnd: now.toISOString(),
      });
      toast.success(t('affiliateDashboard.toasts.payoutCalculated'));
      setPayout(false);
      loadOverview();
    } catch (err) {
      toast.error(err?.response?.data?.message || t('affiliateDashboard.errors.calculatePayout'));
    } finally {
      setReqPayout(false);
    }
  };

  // ── Copy referral link ─────────────────────────────────────────────────
  const copyLink = (programId, affiliateId) => {
    const base = window.location.origin;
    const link = `${base}/marketplace?ref=${affiliateId || programId}`;
    navigator.clipboard.writeText(link).then(() => toast.success(t('affiliateDashboard.toasts.linkCopied')));
  };

  // ── Funnel data ────────────────────────────────────────────────────────
  const currentFunnel = funnel?.current_funnel;
  const funnelStages = currentFunnel ? [
    { label: t('affiliateDashboard.funnel.labels.click'),       count: currentFunnel.stage_click_count,        pct: 100,                                  color: '#f97316' },
    { label: t('affiliateDashboard.funnel.labels.landing'),     count: currentFunnel.stage_landing_count,      pct: currentFunnel.landing_rate || 0,      color: '#fb923c' },
    { label: t('affiliateDashboard.funnel.labels.productView'),  count: currentFunnel.stage_product_view_count, pct: currentFunnel.product_rate || 0,      color: '#fdba74' },
    { label: t('affiliateDashboard.funnel.labels.addToCart'),   count: currentFunnel.stage_add_to_cart_count,  pct: currentFunnel.cart_rate || 0,         color: '#10b981' },
    { label: t('affiliateDashboard.funnel.labels.checkout'),    count: currentFunnel.stage_checkout_count,     pct: currentFunnel.checkout_rate || 0,     color: '#34d399' },
    { label: t('affiliateDashboard.funnel.labels.purchase'),    count: currentFunnel.stage_purchase_count,     pct: currentFunnel.purchase_rate || 0,     color: '#6ee7b7' },
  ] : [];

  if (loading) {
    return (
      <PageShell>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-gray-500 text-sm">{t('affiliateDashboard.loading')}</div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('affiliateDashboard.pageTitle')} noIndex />
      <div className="min-h-screen text-white">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* ── Header ────────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight mb-1">{t('affiliateDashboard.title')}</h1>
              <p className="text-gray-400 text-sm">{t('affiliateDashboard.subtitle')}</p>
            </div>
            <div className="flex gap-2">
              {programs.length > 0 && (
                <Btn variant="secondary" onClick={() => setPayout(true)}>{t('affiliateDashboard.actions.requestPayout')}</Btn>
              )}
              <Btn onClick={() => setCreate(true)}>
                <span className="flex items-center gap-1.5"><IcoPlus size={14} cls="text-white" /> {t('affiliateDashboard.actions.newProgram')}</span>
              </Btn>
            </div>
          </div>

          {/* ── No programs empty state ──────────────────────────────── */}
          {programs.length === 0 && (
            <Card className="text-center py-16">
              <IcoAward size={40} cls="text-orange-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">{t('affiliateDashboard.empty.title')}</h2>
              <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
                {t('affiliateDashboard.empty.description')}
              </p>
              <p className="text-xs text-gray-500 mb-6">
                {t('affiliateDashboard.empty.verification')}
              </p>
              <div className="flex gap-3 justify-center">
                <Link to="/verify-identity" className="text-xs font-semibold px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition">{t('affiliateDashboard.empty.verifyIdentity')}</Link>
                <Btn onClick={() => setCreate(true)}>{t('affiliateDashboard.empty.createProgram')}</Btn>
              </div>
            </Card>
          )}

          {programs.length > 0 && (
            <>
              {/* ── Overview stat tiles ──────────────────────────────── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatTile label={t('affiliateDashboard.stats.lifetimeEarnings')}  value={fmt$(stats?.lifetime_commission_cents)} icon={IcoDollar} color="text-orange-400" />
                <StatTile label={t('affiliateDashboard.stats.pendingPayout')}     value={fmt$(stats?.pending_cents)} icon={IcoZap} color="text-yellow-400" sub={t('affiliateDashboard.stats.availableToRequest')} />
                <StatTile label={t('affiliateDashboard.stats.totalPaidOut')}     value={fmt$(stats?.total_paid_cents)} icon={IcoCheck} color="text-emerald-400" />
                <StatTile label={t('affiliateDashboard.stats.totalConversions')}  value={fmtNum(stats?.total_conversions)} icon={IcoTrend} color="text-blue-400" sub={`${fmtNum(stats?.total_programs)} ${stats?.total_programs === 1 ? t('affiliateDashboard.stats.programSingle') : t('affiliateDashboard.stats.programPlural')}`} />
              </div>

              {/* ── Program selector + period picker ─────────────────── */}
              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="flex-1">
                  <select
                    value={selectedProgram?.id || ''}
                    onChange={(e) => setSelected(programs.find((p) => String(p.id) === e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                  >
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.program_type} — {fmt$(p.total_commission_cents)} lifetime
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                  {[7, 30, 90].map((d) => (
                    <button key={d} onClick={() => setDays(d)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${days === d ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'}`}>
                      {t('affiliateDashboard.chart.periodButton', { days: d })}
                    </button>
                  ))}
                </div>
              </div>

              {analyticsLoading && (
                <div className="text-center py-8 text-gray-600 text-sm">{t('affiliateDashboard.loadingAnalytics')}</div>
              )}

              {!analyticsLoading && (
                <>
                  {/* ── Earnings sparkline ──────────────────────────── */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                    <Card>
                      <CardHeader icon={IcoDollar} title={t('affiliateDashboard.chart.commissionEarned', { days })}
                        right={<span className="text-orange-400 text-sm font-bold">
                          {fmt$(metrics.reduce((s, r) => s + parseFloat(r.commission_earned || 0) * 100, 0))}
                        </span>}
                      />
                      <Sparkline data={metrics} valueKey="commission_earned" color="#f97316" noDataText={t('affiliateDashboard.sparklineNoData')} />
                      <div className="flex justify-between mt-3 text-xs text-gray-500">
                        <span>{metrics[0]?.metric_date?.slice(0, 10)}</span>
                        <span>{metrics[metrics.length - 1]?.metric_date?.slice(0, 10)}</span>
                      </div>
                    </Card>

                    <Card>
                      <CardHeader icon={IcoTrend} title={t('affiliateDashboard.chart.clicks', { days })}
                        right={<span className="text-blue-400 text-sm font-bold">
                          {fmtNum(metrics.reduce((s, r) => s + parseInt(r.total_clicks || 0), 0))}
                        </span>}
                      />
                      <Sparkline data={metrics} valueKey="total_clicks" color="#60a5fa" noDataText={t('affiliateDashboard.sparklineNoData')} />
                      <div className="flex justify-between mt-3 text-xs text-gray-500">
                        <span>{metrics[0]?.metric_date?.slice(0, 10)}</span>
                        <span>{metrics[metrics.length - 1]?.metric_date?.slice(0, 10)}</span>
                      </div>
                    </Card>
                  </div>

                  {/* ── Conversion funnel + Top products ───────────── */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                    <Card>
                      <CardHeader icon={IcoZap} title={t('affiliateDashboard.funnel.title')} />
                      {funnelStages.length === 0 ? (
                        <p className="text-gray-600 text-xs py-4">{t('affiliateDashboard.funnel.noData')}</p>
                      ) : (
                        <div className="space-y-2.5">
                          {funnelStages.map((s) => (
                            <FunnelBar key={s.label} {...s} />
                          ))}
                        </div>
                      )}
                      {funnel?.averages && (
                        <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-2 gap-3">
                          {Object.entries(funnel.averages).map(([k, v]) => (
                            <div key={k}>
                              <p className="text-[10px] text-gray-600 uppercase tracking-wide">{t(`affiliateDashboard.funnel.averageLabels.${k}`, { defaultValue: k.replace('avg_', '').replace('_rate', '') })}</p>
                              <p className="text-sm font-semibold text-white">{fmtPct(v)}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>

                    <Card>
                      <CardHeader icon={IcoPackage} title={t('affiliateDashboard.topProducts.title')} />
                      {topProducts.length === 0 ? (
                        <p className="text-gray-600 text-xs py-4">{t('affiliateDashboard.topProducts.noData')}</p>
                      ) : (
                        <div className="space-y-2">
                          {topProducts.map((p, i) => (
                            <div key={p.product_id || i} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                              <span className="text-[11px] text-gray-600 w-4 shrink-0">{p.rank || i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-white font-medium truncate">{p.title || `Product ${p.product_id}`}</p>
                                <p className="text-[10px] text-gray-500">{fmtNum(p.total_clicks_30d)} clicks · {fmtNum(p.total_conversions_30d)} {t('affiliateDashboard.metrics.convAbbrev')}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-semibold text-emerald-400">{fmt$(p.total_commission_30d * 100)}</p>
                                <p className="text-[10px] text-gray-500">{fmtPct(p.conversion_rate_30d)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>

                  {/* ── Source breakdown ────────────────────────────── */}
                  {sources && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                      <Card>
                        <CardHeader icon={IcoTrend} title={t('affiliateDashboard.sources.deviceBreakdown')} />
                        <div className="space-y-3">
                          {sources.device_breakdown?.map((d) => {
                            const total = sources.device_breakdown.reduce((s, x) => s + parseInt(x.total_clicks || 0), 0) || 1;
                            const pct = (parseInt(d.total_clicks || 0) / total) * 100;
                            return (
                              <div key={d.device_type} className="flex items-center gap-3">
                                <span className="w-14 text-xs text-gray-400 capitalize shrink-0">{d.device_type}</span>
                                <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-orange-500/70 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-white w-10 text-right shrink-0">{fmtNum(d.total_clicks)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                      <Card>
                        <CardHeader icon={IcoLink} title={t('affiliateDashboard.sources.topReferrers')} />
                        {sources.top_referrers?.length === 0 ? (
                          <p className="text-gray-600 text-xs py-4">{t('affiliateDashboard.sources.noReferrers')}</p>
                        ) : (
                          <div className="space-y-2">
                            {sources.top_referrers?.map((r, i) => (
                              <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0">
                                <span className="text-xs text-white truncate max-w-[55%]">{r.referrer_source}</span>
                                <div className="flex items-center gap-3">
                                  <span className="text-[10px] text-gray-500">{fmtNum(r.session_count)} {t('affiliateDashboard.sources.sessionLabel')}</span>
                                  <Badge text={`${fmtPct(r.conversion_rate)} ${t('affiliateDashboard.metrics.convAbbrev')}`} color="green" />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                  )}

                  {/* ── Referral links ───────────────────────────────── */}
                  <Card className="mb-4">
                    <CardHeader icon={IcoLink} title={t('affiliateDashboard.referral.title')}
                      right={<span className="text-[11px] text-gray-500">{t('affiliateDashboard.referral.helper')}</span>}
                    />
                    <div className="space-y-3">
                      {programs.map((p) => {
                        const link = `${window.location.origin}/marketplace?ref=${p.affiliate_id || p.id}`;
                        return (
                          <div key={p.id} className="flex items-center gap-3 bg-gray-800/60 rounded-xl px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{p.program_type}</p>
                              <p className="text-xs text-gray-300 truncate font-mono">{link}</p>
                            </div>
                            <button
                              onClick={() => copyLink(p.id, p.affiliate_id)}
                              className="p-2 text-gray-500 hover:text-orange-400 transition rounded-lg hover:bg-gray-700"
                              title={t('affiliateDashboard.referral.copyLink')}
                            >
                              <IcoCopy size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </>
              )}

              {/* ── Payout history ───────────────────────────────────── */}
              <Card>
                <CardHeader icon={IcoDollar} title={t('affiliateDashboard.payout.title')}
                  right={<Btn variant="ghost" onClick={() => setPayout(true)}>{t('affiliateDashboard.actions.requestPayout')}</Btn>}
                />
                {payouts.length === 0 ? (
                  <p className="text-gray-600 text-xs py-4">{t('affiliateDashboard.payout.emptyState')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-600 uppercase tracking-wide text-[10px]">
                          <th className="text-left py-2 pr-4">{t('affiliateDashboard.payout.table.period')}</th>
                          <th className="text-left py-2 pr-4">{t('affiliateDashboard.payout.table.amount')}</th>
                          <th className="text-left py-2 pr-4">{t('affiliateDashboard.payout.table.method')}</th>
                          <th className="text-left py-2 pr-4">{t('affiliateDashboard.payout.table.status')}</th>
                          <th className="text-left py-2">{t('affiliateDashboard.payout.table.sent')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {payouts.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 pr-4 text-gray-300">
                              {p.period_start?.slice(0, 10)} → {p.period_end?.slice(0, 10)}
                            </td>
                            <td className="py-2.5 pr-4 font-semibold text-white">{fmt$(p.total_commission_cents)}</td>
                            <td className="py-2.5 pr-4 text-gray-400 capitalize">{p.payout_method || '—'}</td>
                            <td className="py-2.5 pr-4"><Badge text={p.status} color={payoutStatusColor(p.status)} /></td>
                            <td className="py-2.5 text-gray-500">{p.sent_at ? new Date(p.sent_at).toLocaleDateString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}

        </main>
      </div>

      {/* ── Create program modal ──────────────────────────────────────── */}
      <Modal open={showCreateModal} onClose={() => setCreate(false)} title={t('affiliateDashboard.create.title')}>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('affiliateDashboard.create.programTypeLabel')}</label>
            <select
              value={createForm.program_type}
              onChange={(e) => setCreateForm((f) => ({ ...f, program_type: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
            >
              <option value="amazon_affiliate">{t('affiliateDashboard.create.programTypes.amazonAffiliate')}</option>
              <option value="oxsteed_referral">{t('affiliateDashboard.create.programTypes.oxsteedReferral')}</option>
              <option value="marketplace_products">{t('affiliateDashboard.create.programTypes.marketplaceProducts')}</option>
              <option value="custom">{t('affiliateDashboard.create.programTypes.custom')}</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('affiliateDashboard.create.affiliateIdLabel')}</label>
            <input
              value={createForm.affiliate_id || ''}
              onChange={(e) => setCreateForm((f) => ({ ...f, affiliate_id: e.target.value }))}
              placeholder={t('affiliateDashboard.create.affiliateIdPlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('affiliateDashboard.create.commissionRateLabel')}</label>
            <input
              type="number" min="0" max="100" step="0.1"
              value={createForm.commission_rate}
              onChange={(e) => setCreateForm((f) => ({ ...f, commission_rate: e.target.value }))}
              placeholder={t('affiliateDashboard.create.commissionRatePlaceholder')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Btn variant="secondary" onClick={() => setCreate(false)} className="flex-1">{t('affiliateDashboard.actions.cancel')}</Btn>
            <Btn onClick={handleCreate} disabled={creating} className="flex-1">{creating ? t('affiliateDashboard.create.creating') : t('affiliateDashboard.create.submit')}</Btn>
          </div>
        </div>
      </Modal>

      {/* ── Request payout modal ──────────────────────────────────────── */}
      <Modal open={showPayoutModal} onClose={() => setPayout(false)} title={t('affiliateDashboard.payout.requestTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            {t('affiliateDashboard.payout.description')}
          </p>
          {selectedProgram && (
            <div className="bg-gray-800/60 rounded-xl p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('affiliateDashboard.payout.selectedProgram')}</p>
              <p className="text-sm text-white font-semibold">{selectedProgram.program_type}</p>
              <p className="text-xs text-yellow-400 mt-1">{`${t('affiliateDashboard.payout.pendingLabel')}: ${fmt$(selectedProgram.pending_cents)}`}</p>
            </div>
          )}
          <p className="text-xs text-gray-600">{t('affiliateDashboard.payout.note')}</p>
          <div className="flex gap-3 pt-2">
            <Btn variant="secondary" onClick={() => setPayout(false)} className="flex-1">{t('affiliateDashboard.actions.cancel')}</Btn>
            <Btn onClick={handleRequestPayout} disabled={requestingPayout} className="flex-1">{requestingPayout ? t('affiliateDashboard.payout.calculating') : t('affiliateDashboard.actions.requestPayout')}</Btn>
          </div>
        </div>
      </Modal>

    </PageShell>
  );
}
