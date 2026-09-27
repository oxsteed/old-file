import { useAuth } from '../hooks/useAuth';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import toast from 'react-hot-toast';
import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import useLifeDashboard from '../hooks/useLifeDashboard';
import PageShell from '../components/PageShell';
import TrialBanner from '../components/TrialBanner';
import PulseScoreSettings from '../components/PulseScoreSettings';
import RecommendationFeed from '../components/RecommendationFeed';
import { formatDate, formatMoney } from '../lib/format';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';
import { formatFoodMoney, listMyFoodOrders, listMyFoodRestaurantWallets } from '../api/food';
import '../styles/Dashboard.css';

// ── Icons ─────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoBriefcase = (p) => <Ico {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></Ico>;
const IcoPlus      = (p) => <Ico {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Ico>;
const IcoSearch    = (p) => <Ico {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Ico>;
const IcoChat      = (p) => <Ico {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></Ico>;
const IcoBell      = (p) => <Ico {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></Ico>;
const IcoSettings  = (p) => <Ico {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></Ico>;
const IcoShield    = (p) => <Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ico>;
const IcoScale     = (p) => <Ico {...p}><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></Ico>;
const IcoUsers     = (p) => <Ico {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Ico>;
const IcoStar      = (p) => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;
const IcoZap       = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;
const IcoClock     = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>;
const IcoArrowR    = (p) => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Ico>;
const IcoDollar    = (p) => <Ico {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></Ico>;
const IcoHome      = (p) => <Ico {...p}><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></Ico>;
const IcoTarget    = (p) => <Ico {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Ico>;
const IcoCheck     = (p) => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoTrash     = (p) => <Ico {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></Ico>;
const IcoX         = (p) => <Ico {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;
const IcoHeart     = (p) => <Ico {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></Ico>;
const IcoCar       = (p) => <Ico {...p}><rect x="1" y="11" width="22" height="9" rx="2"/><path d="M3 11l2.5-7h13L21 11"/><circle cx="7" cy="20" r="2"/><circle cx="17" cy="20" r="2"/></Ico>;
const IcoCalendar  = (p) => <Ico {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Ico>;
const IcoQrCode    = (p) => <Ico {...p}><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><path d="M15 15h3v3h-3zM18 18h3M15 21h3M21 15v3M11 3v3M11 11h3M3 11h3M11 18h2"/></Ico>;
const IcoWrench    = (p) => <Ico {...p}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></Ico>;
const IcoFork      = (p) => <Ico {...p}><path d="M3 2v7a3 3 0 003 3V2M9 2v7a3 3 0 01-3 3v10M15 2v20M15 2c4 2 6 5 6 9h-6"/></Ico>;
const IcoWallet    = (p) => <Ico {...p}><path d="M20 7V5a2 2 0 00-2-2H5a3 3 0 000 6h15v12H5a3 3 0 01-3-3V6"/><path d="M16 13h4"/></Ico>;
const SHOW_LEGACY_CUSTOMER_RECOMMENDATIONS = LAUNCH_VISIBILITY.personalLifeDashboard;
const SHOW_LEGACY_CUSTOMER_DASHBOARD_TABS = LAUNCH_VISIBILITY.personalLifeDashboard;
const SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS = LAUNCH_VISIBILITY.personalLifeDashboard;
const DASHBOARD_TABS = new Set(SHOW_LEGACY_CUSTOMER_DASHBOARD_TABS
  ? ['pulse', 'money', 'home', 'goals', 'personalcare', 'carcare', 'skills']
  : ['pulse']);
const VISIBLE_CUSTOMER_DASHBOARD_TABS = ['pulse'];

// ── Shared UI ─────────────────────────────────────────────────────────────
const Tag = ({ text, color = 'orange' }) => {
  const m = { orange:'bg-orange-500/15 text-orange-400', green:'bg-emerald-500/15 text-emerald-400', red:'bg-red-500/15 text-red-400', gray:'bg-gray-700/40 text-gray-400', blue:'bg-blue-500/15 text-blue-400', purple:'bg-purple-500/15 text-purple-400' };
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${m[color]||m.orange}`}>{text}</span>;
};
const ProgressBar = ({ pct, color = 'bg-orange-500' }) => (
  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width:`${Math.min(pct,100)}%` }}/>
  </div>
);
const Card = ({ children, className = '' }) => (
  <div className={`bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 ${className}`}>{children}</div>
);
const CardHeader = ({ icon: IconComp, title, right }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2.5">
      {IconComp && <IconComp size={18} cls="text-orange-400"/>}
      <h3 className="font-semibold text-white text-sm">{title}</h3>
    </div>
    {right}
  </div>
);
const Btn = ({ children, onClick, variant = 'primary', className = '', ...rest }) => {
  const v = { primary:'bg-action hover:bg-action-hover text-on-action', secondary:'bg-gray-800 hover:bg-gray-700 text-gray-300', danger:'bg-red-500/20 hover:bg-red-500/30 text-red-400' };
  return <button onClick={onClick} className={`text-xs font-semibold px-4 py-2 rounded-lg transition ${v[variant]} ${className}`} {...rest}>{children}</button>;
};
const Input = ({ label, ...rest }) => (
  <div>
    {label && <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}
    <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition" {...rest}/>
  </div>
);
const Select = ({ label, children, ...rest }) => (
  <div>
    {label && <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{label}</label>}
    <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition" {...rest}>{children}</select>
  </div>
);

// ── Modal Wrapper ─────────────────────────────────────────────────────────
const Modal = ({ open, onClose, title, children }) => {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"/>
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 text-gray-500 hover:text-white transition rounded-lg hover:bg-gray-800"><IcoX size={18}/></button>
        </div>
        {children}
      </div>
    </div>
  );
};

const ACTIVE_FOOD_ORDER_STATUSES = new Set([
  'pending', 'received', 'accepted', 'preparing', 'ready', 'out_for_delivery',
]);
const ACTIVE_CUSTOMER_JOB_STATUSES = new Set([
  'open', 'published', 'negotiating', 'matched', 'accepted', 'in_progress',
]);

function LaunchCustomerDashboard({
  t,
  loading,
  activeJobs,
  foodOrders,
  wallets,
  unreadMsgs,
  unreadNotifs,
  error,
  onRetry,
}) {
  const activeOrders = foodOrders.filter((order) =>
    ACTIVE_FOOD_ORDER_STATUSES.has(String(order.status || '').toLowerCase()));
  const recentItems = [
    ...activeJobs.slice(0, 2).map((job) => ({
      id: `job-${job.id}`,
      to: `/jobs/${job.id}`,
      kind: t('dashboard.customer.jobLabel'),
      title: job.title,
      detail: job.category_name || job.category || job.location_city || '',
      status: job.status,
      icon: IcoBriefcase,
      tone: 'text-orange-400',
    })),
    ...activeOrders.slice(0, 2).map((order) => ({
      id: `order-${order.id}`,
      to: `/food/orders/${order.id}`,
      kind: t('dashboard.customer.orderLabel'),
      title: order.restaurant_name || t('dashboard.customer.restaurantOrder'),
      detail: (order.items || []).slice(0, 2).map((item) => item.itemName).filter(Boolean).join(', '),
      status: order.status,
      icon: IcoFork,
      tone: 'text-emerald-400',
    })),
  ].slice(0, 4);

  const summaryCards = [
    { to: '/my-jobs', label: t('dashboard.customer.activeJobs'), value: activeJobs.length, icon: IcoBriefcase, tone: 'text-orange-400' },
    { to: '/orders', label: t('dashboard.customer.activeOrders'), value: activeOrders.length, icon: IcoFork, tone: 'text-emerald-400' },
    { to: '/messages', label: t('dashboard.customer.unreadMessages'), value: unreadMsgs, icon: IcoChat, tone: 'text-sky-400' },
    { to: '/activity', label: t('dashboard.customer.newUpdates'), value: unreadNotifs, icon: IcoBell, tone: 'text-amber-400' },
  ];

  return (
    <div className="customer-launch-dashboard space-y-6">
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>{t('dashboard.pulse.loadError')}</span>
          <button type="button" onClick={onRetry} className="font-bold text-amber-300 underline underline-offset-4 hover:text-amber-200">{t('dashboard.pulse.retry')}</button>
        </div>
      )}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="customer-dashboard-hero customer-dashboard-hero--skills relative overflow-hidden rounded-3xl border border-orange-400/20 bg-gradient-to-br from-orange-500/20 via-gray-900 to-gray-950 p-6 sm:p-8">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-orange-400/10 blur-2xl" />
          <p className="relative text-[11px] font-bold uppercase tracking-[0.22em] text-orange-300">{t('dashboard.customer.skillsEyebrow')}</p>
          <h2 className="customer-dashboard-hero-title relative mt-3 max-w-md text-2xl sm:text-3xl font-black tracking-tight text-white">{t('dashboard.customer.skillsTitle')}</h2>
          <p className="customer-dashboard-hero-copy relative mt-3 max-w-lg text-sm leading-6 text-gray-400">{t('dashboard.customer.skillsText')}</p>
          <div className="relative mt-6 flex flex-wrap gap-3">
            <Link to="/post-job" className="inline-flex items-center gap-2 rounded-xl bg-action px-4 py-2.5 text-sm font-bold text-on-action transition hover:bg-action-hover">
              <IcoPlus size={16} cls="text-on-action" /> {t('dashboard.postJob')}
            </Link>
            <Link to="/helpers" className="customer-dashboard-hero-secondary inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-white/10">
              <IcoSearch size={16} cls="text-gray-200" /> {t('dashboard.browseHelpers')}
            </Link>
          </div>
        </div>

        <div className="customer-dashboard-hero customer-dashboard-hero--food relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 via-gray-900 to-gray-950 p-6 sm:p-8">
          <div className="absolute -bottom-16 -right-10 h-44 w-44 rounded-full bg-emerald-400/10 blur-2xl" />
          <p className="relative text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300">{t('dashboard.customer.foodEyebrow')}</p>
          <h2 className="customer-dashboard-hero-title relative mt-3 max-w-md text-2xl sm:text-3xl font-black tracking-tight text-white">{t('dashboard.customer.foodTitle')}</h2>
          <p className="customer-dashboard-hero-copy relative mt-3 max-w-lg text-sm leading-6 text-gray-400">{t('dashboard.customer.foodText')}</p>
          <div className="relative mt-6 flex flex-wrap gap-3">
            <Link to="/restaurants" className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-gray-950 transition hover:bg-emerald-400">
              <IcoFork size={16} cls="text-gray-950" /> {t('dashboard.customer.browseRestaurants')}
            </Link>
            <Link to="/orders" className="customer-dashboard-hero-secondary inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-white/10">
              <IcoClock size={16} cls="text-gray-200" /> {t('dashboard.customer.viewOrders')}
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label={t('dashboard.customer.statusSummary')}>
        {summaryCards.map(({ to, label, value, icon: Icon, tone }) => (
          <Link key={to} to={to} className="customer-dashboard-summary-card group rounded-2xl border border-gray-700/40 bg-gray-900/60 p-4 transition hover:-translate-y-0.5 hover:border-gray-600">
            <div className="flex items-center justify-between gap-3">
              <Icon size={18} cls={tone} />
              <IcoArrowR size={14} cls="text-gray-700 transition group-hover:text-gray-400" />
            </div>
            {loading ? <div className="customer-dashboard-summary-loading mt-4 h-8 w-12 animate-pulse rounded bg-gray-800" /> : <p className="customer-dashboard-summary-value mt-3 text-2xl font-black text-white">{value}</p>}
            <p className="customer-dashboard-summary-label mt-1 text-xs font-medium text-gray-500">{label}</p>
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[1.25fr_0.75fr] gap-4">
        <Card className="customer-dashboard-panel min-h-[280px]">
          <CardHeader
            icon={IcoZap}
            title={t('dashboard.customer.happeningTitle')}
            right={<Link to="/activity" className="text-xs font-semibold text-orange-400 hover:text-orange-300">{t('dashboard.customer.viewActivity')}</Link>}
          />
          {loading ? (
            <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-gray-800/60" />)}</div>
          ) : recentItems.length ? (
            <div className="space-y-2">
              {recentItems.map((item) => (
                <Link key={item.id} to={item.to} className="customer-dashboard-item group flex items-center gap-3 rounded-xl bg-gray-800/35 p-3 transition hover:bg-gray-800/70">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-950/70"><item.icon size={18} cls={item.tone} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">{item.kind}</p>
                    <p className="truncate text-sm font-semibold text-white group-hover:text-orange-300">{item.title}</p>
                    {item.detail && <p className="truncate text-xs text-gray-500">{item.detail}</p>}
                  </div>
                  <Tag
                    text={t(`orders.statusLabels.${item.status}`, {
                      defaultValue: String(item.status || '').replace(/_/g, ' '),
                    })}
                    color={item.id.startsWith('order-') ? 'green' : 'orange'}
                  />
                </Link>
              ))}
            </div>
          ) : (
            <div className="customer-dashboard-empty-state flex min-h-[190px] flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-800/70"><IcoCheck size={24} cls="text-emerald-400" /></div>
              <h3 className="mt-4 font-bold text-white">{t('dashboard.customer.noActiveItems')}</h3>
              <p className="mt-1 max-w-sm text-sm text-gray-500">{t('dashboard.customer.noActiveItemsText')}</p>
            </div>
          )}
        </Card>

        <Card className="customer-dashboard-panel min-h-[280px]">
          <CardHeader
            icon={IcoWallet}
            title={t('dashboard.customer.restaurantCreditTitle')}
            right={<Link to="/restaurant-credit" className="text-xs font-semibold text-emerald-400 hover:text-emerald-300">{t('dashboard.customer.manageCredit')}</Link>}
          />
          {loading ? (
            <div className="space-y-3">{[0, 1].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-gray-800/60" />)}</div>
          ) : wallets.length ? (
            <div className="space-y-2">
              {wallets.slice(0, 3).map((wallet) => (
                <Link key={wallet.accountId || wallet.restaurantId} to={`/restaurant-credit?restaurantId=${wallet.restaurantId}`} className="customer-dashboard-item flex items-center gap-3 rounded-xl bg-gray-800/35 p-3 transition hover:bg-gray-800/70">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-emerald-500/10">
                    {wallet.restaurantLogoUrl ? <img src={wallet.restaurantLogoUrl} alt="" className="h-full w-full object-cover" /> : <IcoFork size={18} cls="text-emerald-400" />}
                  </div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{wallet.restaurantName}</p><p className="text-xs text-gray-500">{t('dashboard.customer.creditAvailable')}</p></div>
                  <strong className="text-sm text-emerald-400">{formatFoodMoney(wallet.availableBalanceCents, wallet.currencyCode)}</strong>
                </Link>
              ))}
              <p className="pt-2 text-xs leading-5 text-gray-600">{t('dashboard.customer.creditScope')}</p>
            </div>
          ) : (
            <div className="customer-dashboard-empty-state flex min-h-[190px] flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10"><IcoWallet size={24} cls="text-emerald-400" /></div>
              <h3 className="mt-4 font-bold text-white">{t('dashboard.customer.noCredit')}</h3>
              <p className="mt-1 max-w-xs text-sm text-gray-500">{t('dashboard.customer.noCreditText')}</p>
              <Link to="/restaurants" className="mt-4 text-xs font-bold text-emerald-400 hover:text-emerald-300">{t('dashboard.customer.browseRestaurants')} →</Link>
            </div>
          )}
        </Card>
      </section>

      <nav className="customer-dashboard-quick-links flex flex-wrap items-center gap-2 rounded-2xl border border-gray-800 bg-gray-950/40 p-3" aria-label={t('dashboard.customer.quickLinks')}>
        <span className="px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">{t('dashboard.customer.quickLinks')}</span>
        {[
          { to: '/calendar', label: t('dashboard.customer.calendar'), icon: IcoCalendar },
          { to: '/activity', label: t('dashboard.recentActivity'), icon: IcoBell },
          { to: '/qr-generator', label: t('nav.qrGenerator'), icon: IcoQrCode, pro: true },
          { to: '/settings', label: t('dashboard.customer.accountSettings'), icon: IcoSettings },
        ].map(({ to, label, icon: Icon, pro }) => (
          <Link key={to} to={to} className="customer-dashboard-quick-link inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-gray-400 transition hover:bg-gray-800 hover:text-white"><Icon size={14} cls="text-gray-500" />{label}{pro && <span className="customer-dashboard-quick-link__badge" aria-label={t('dashboard.customer.quickLinksPro', { defaultValue: 'Pro' })}>{t('dashboard.customer.quickLinksPro', { defaultValue: 'Pro' })}</span>}</Link>
        ))}
      </nav>
    </div>
  );
}

// Format a Date as YYYY-MM-DD in local time (avoids UTC-shift from toISOString())
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const monthYearLabel = () => formatDate(new Date(), { month: 'long', year: 'numeric', day: undefined });
const shortDateLabel = (value) => formatDate(value, { month: 'short', day: 'numeric', year: undefined });
const fullShortDateLabel = (value) => formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });

// ═══════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const life = useLifeDashboard();

  const [myJobs, setMyJobs] = useState([]);
  const [foodOrders, setFoodOrders] = useState([]);
  const [restaurantWallets, setRestaurantWallets] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState(() => {
    const urlTab = searchParams.get('tab');
    return DASHBOARD_TABS.has(urlTab) ? urlTab : 'pulse';
  });
  const [showPulseSettings, setShowPulseSettings] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const selectTab = useCallback((nextTab, extraParams = {}) => {
    if (!DASHBOARD_TABS.has(nextTab)) return;
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (DASHBOARD_TABS.has(urlTab) && urlTab !== tab) {
      setTab(urlTab);
    }
  }, [searchParams, tab]);

  // Modal state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showHomeTaskModal, setShowHomeTaskModal] = useState(false);
  const [showChecklistModal, setShowChecklistModal] = useState(false);

  // ── Skills & Tools state ──────────────────────────────────────────────────
  const [mySkills, setMySkills] = useState([]);
  const [myTools, setMyTools] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [editingTool, setEditingTool] = useState(null);
  const [skillLookup,    setSkillLookup]    = useState([]);
  const [skillSearch,    setSkillSearch]    = useState('');
  const [catLookup,      setCatLookup]      = useState([]);
  const [toolCatLookup,  setToolCatLookup]  = useState([]);
  const [skillForm, setSkillForm] = useState({ skill_name:'', category:'', hourly_rate:'', description:'', years_exp:'', is_available:true });
  const [toolForm, setToolForm] = useState({ name:'', category:'', description:'', daily_rate:'', hourly_rate:'', deposit_amount:'', condition:'good', brand:'', model:'', is_available:true, requires_deposit:false, delivery_available:false, pickup_only:true, location_city:'', location_state:'' });

  // Budget modal (replaces prompt)
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ category:'', period_amount:'', period:'monthly' });

  // Goal update modal (replaces prompt)
  const [showGoalUpdateModal, setShowGoalUpdateModal] = useState(false);
  const [updatingGoal, setUpdatingGoal] = useState(null);
  const [goalUpdateValue, setGoalUpdateValue] = useState('');

  // Personal Care
  const [personalCareTasks, setPersonalCareTasks] = useState([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [showPcModal, setShowPcModal] = useState(false);
  const [pcForm, setPcForm] = useState({ title:'', category:'Medical', due_date:'', urgency:'medium', recurrence_days:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'' });

  // Car Care
  const [carCareTasks, setCarCareTasks] = useState([]);
  const [ccLoading, setCcLoading] = useState(false);
  const [showCcModal, setShowCcModal] = useState(false);
  const [ccForm, setCcForm] = useState({ title:'', category:'Oil Change', due_date:'', urgency:'medium', recurrence_days:'', description:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', vehicle_id:'' });

  // My Garage (NHTSA vehicle data)
  const [garage,        setGarage]        = useState([]);
  const [garageLoading, setGarageLoading] = useState(false);
  const [garageFetched, setGarageFetched] = useState(false);
  const [allMakes,      setAllMakes]      = useState([]);
  const [makesFetched,  setMakesFetched]  = useState(false);
  const [garageModels,  setGarageModels]  = useState([]);
  const [garageModelsLoading, setGarageModelsLoading] = useState(false);
  const [garageForm,    setGarageForm]    = useState({ makeSearch:'', selectedMake:null, modelSearch:'', selectedModel:null, year:'', nickname:'' });
  const [showMakeDD,    setShowMakeDD]    = useState(false);
  const [showModelDD,   setShowModelDD]   = useState(false);
  const [garageAdding,  setGarageAdding]  = useState(false);
  const [garageDeleteTarget, setGarageDeleteTarget] = useState(null);
  const [garageMode,     setGarageMode]     = useState('search'); // 'search' | 'vin'

  // My Properties (house lookup)
  const [homes,          setHomes]          = useState([]);
  const [homesLoaded,    setHomesLoaded]    = useState(false);
  const [homeAddrInput,  setHomeAddrInput]  = useState('');
  const [homeLookup,     setHomeLookup]     = useState(null);   // decoded result
  const [homeLookupLoading, setHomeLookupLoading] = useState(false);
  const [homeLookupError,   setHomeLookupError]   = useState('');
  const [homeNickname,   setHomeNickname]   = useState('');
  const [homeAdding,     setHomeAdding]     = useState(false);
  const [homeDeleteTarget, setHomeDeleteTarget] = useState(null);
  const [vinInput,       setVinInput]        = useState('');
  const [vinDecoding,    setVinDecoding]     = useState(false);
  const [vinResult,      setVinResult]       = useState(null);   // decoded data
  const [vinError,       setVinError]        = useState('');

  // Money tab - individual planned needs for sinking fund card
  const [moneyPlannedNeeds, setMoneyPlannedNeeds] = useState([]);

  // My Jobs filter
  const [jobsFilter, setJobsFilter] = useState('all');

  const fetchMySkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const res = await api.get('/user-skills/me');
      setMySkills(res.data?.skills || []);
    } catch { /* silent */ }
    finally { setSkillsLoading(false); }
  }, []);

  const fetchMyTools = useCallback(async () => {
    setToolsLoading(true);
    try {
      const res = await api.get('/tool-rentals/me');
      setMyTools(res.data?.tools || []);
    } catch { /* silent */ }
    finally { setToolsLoading(false); }
  }, []);

  const searchSkillLookup = useCallback(async (q) => {
    try {
      const res = await api.get('/user-skills/lookup', { params: { q, limit: 15 } });
      setSkillLookup(res.data?.skills || []);
    } catch { setSkillLookup([]); }
  }, []);

  const searchCatLookup = useCallback(async (q) => {
    if (!q || q.length < 1) { setCatLookup([]); return; }
    try {
      const res = await api.get('/user-skills/categories', { params: { q, limit: 10 } });
      setCatLookup(res.data?.categories || []);
    } catch { setCatLookup([]); }
  }, []);

  const searchToolCatLookup = useCallback(async (q) => {
    if (!q || q.length < 1) { setToolCatLookup([]); return; }
    try {
      const res = await api.get('/tool-rentals/categories', { params: { q, limit: 10 } });
      setToolCatLookup(res.data?.categories || []);
    } catch { setToolCatLookup([]); }
  }, []);

  const fetchPersonalCareTasks = useCallback(async () => {
    setPcLoading(true);
    try {
      const res = await api.get('/life/home-tasks', { params: { section: 'personal_care', completed: 'false' } });
      setPersonalCareTasks(res.data?.home_tasks || []);
    } catch { /* silent */ }
    finally { setPcLoading(false); }
  }, []);

  const fetchCarCareTasks = useCallback(async () => {
    setCcLoading(true);
    try {
      const res = await api.get('/life/home-tasks', { params: { section: 'car_care', completed: 'false' } });
      setCarCareTasks(res.data?.home_tasks || []);
    } catch { /* silent */ }
    finally { setCcLoading(false); }
  }, []);

  // Fetch tab-specific data when tab opens
  useEffect(() => {
    if (tab === 'skills') { fetchMySkills(); fetchMyTools(); }
    if (tab === 'personalcare') fetchPersonalCareTasks();
    if (tab === 'carcare') { fetchCarCareTasks(); if (!garageFetched) fetchGarage(); }
    if (tab === 'money') {
      api.get('/planned-needs', { params: { status: 'planned,funding,activating_soon', limit: 10 } })
        .then(r => setMoneyPlannedNeeds(r.data?.planned_needs || []))
        .catch(() => {});
    }
  }, [tab]);

  const openAddSkill = () => {
    setEditingSkill(null);
    setSkillSearch('');
    setSkillLookup([]);
    setCatLookup([]);
    setSkillForm({ skill_name:'', category:'', hourly_rate:'', description:'', years_exp:'', is_available:true });
    setShowSkillModal(true);
  };
  const openEditSkill = (s) => {
    setEditingSkill(s);
    setSkillSearch(s.skill_name);
    setSkillLookup([]);
    setSkillForm({ skill_name:s.skill_name, category:s.category||'', hourly_rate:s.hourly_rate||'', description:s.description||'', years_exp:s.years_exp||'', is_available:s.is_available });
    setShowSkillModal(true);
  };
  const handleSaveSkill = async (e) => {
    e.preventDefault();
    try {
      if (editingSkill) {
        await api.put(`/user-skills/${editingSkill.id}`, skillForm);
        toast.success(t('dashboard.skillsTools.skillUpdated'));
      } else {
        await api.post('/user-skills', skillForm);
        toast.success(t('dashboard.skillsTools.skillAdded'));
      }
      setShowSkillModal(false);
      fetchMySkills();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('dashboard.skillsTools.skillSaveFailed'));
    }
  };
  const handleDeleteSkill = async (id) => {
    if (!confirm(t('dashboard.skillsTools.removeSkillConfirm'))) return;
    try {
      await api.delete(`/user-skills/${id}`);
      toast.success(t('dashboard.skillsTools.skillRemoved'));
      fetchMySkills();
    } catch { toast.error(t('dashboard.skillsTools.skillRemoveFailed')); }
  };

  const openAddTool = () => {
    setEditingTool(null);
    setToolCatLookup([]);
    setToolForm({ name:'', category:'', description:'', daily_rate:'', hourly_rate:'', deposit_amount:'', condition:'good', brand:'', model:'', is_available:true, requires_deposit:false, delivery_available:false, pickup_only:true, location_city:'', location_state:'' });
    setShowToolModal(true);
  };
  const openEditTool = (tool) => {
    setEditingTool(tool);
    setToolForm({ name:tool.name, category:tool.category||'', description:tool.description||'', daily_rate:tool.daily_rate||'', hourly_rate:tool.hourly_rate||'', deposit_amount:tool.deposit_amount||'', condition:tool.condition||'good', brand:tool.brand||'', model:tool.model||'', is_available:tool.is_available, requires_deposit:tool.requires_deposit, delivery_available:tool.delivery_available, pickup_only:tool.pickup_only, location_city:tool.location_city||'', location_state:tool.location_state||'' });
    setShowToolModal(true);
  };
  const handleSaveTool = async (e) => {
    e.preventDefault();
    try {
      if (editingTool) {
        await api.put(`/tool-rentals/${editingTool.id}`, toolForm);
        toast.success(t('dashboard.skillsTools.toolUpdated'));
      } else {
        await api.post('/tool-rentals', toolForm);
        toast.success(t('dashboard.skillsTools.toolListed'));
      }
      setShowToolModal(false);
      fetchMyTools();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('dashboard.skillsTools.toolSaveFailed'));
    }
  };
  const handleDeleteTool = async (id) => {
    if (!confirm(t('dashboard.skillsTools.removeToolConfirm'))) return;
    try {
      await api.delete(`/tool-rentals/${id}`);
      toast.success(t('dashboard.skillsTools.toolRemoved'));
      fetchMyTools();
    } catch { toast.error(t('dashboard.skillsTools.toolRemoveFailed')); }
  };

  // ── Personal Care handlers ────────────────────────────────────────────────
  const addPcTask = async (e) => {
    e.preventDefault();
    try {
      await api.post('/life/home-tasks', {
        title: pcForm.title,
        description: pcForm.category,
        due_date: pcForm.due_date || null,
        urgency: pcForm.urgency,
        recurrence_days: pcForm.recurrence_days ? parseInt(pcForm.recurrence_days) : null,
        section: 'personal_care',
        frequency: pcForm.frequency || null,
        is_recurring: pcForm.is_recurring,
        estimated_cost: pcForm.estimated_cost ? parseFloat(pcForm.estimated_cost) : null,
        recurring_start_date: pcForm.is_recurring && pcForm.recurring_start_date ? pcForm.recurring_start_date : null,
        recurring_end_date: pcForm.is_recurring && pcForm.recurring_end_date ? pcForm.recurring_end_date : null,
      });
      toast.success(t('dashboard.personalCare.appointmentAdded'));
      setPcForm({ title:'', category:'Medical', due_date:'', urgency:'medium', recurrence_days:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'' });
      setShowPcModal(false);
      fetchPersonalCareTasks();
    } catch { toast.error(t('dashboard.personalCare.saveFailed')); }
  };
  const togglePcTask = async (task) => {
    try {
      await api.put(`/life/home-tasks/${task.id}`, { is_completed: !task.is_completed });
      fetchPersonalCareTasks();
    } catch { toast.error(t('dashboard.personalCare.updateFailed')); }
  };
  const deletePcTask = async (id) => {
    try {
      await api.delete(`/life/home-tasks/${id}`);
      setPersonalCareTasks(prev => prev.filter(t => t.id !== id));
      toast.success(t('dashboard.personalCare.removed'));
    } catch { toast.error(t('dashboard.personalCare.removeFailed')); }
  };
  const quickAddPcTask = async (template) => {
    try {
      const due = new Date();
      due.setDate(due.getDate() + (template.recurrence_days || 30));
      await api.post('/life/home-tasks', { title: template.title, description: template.category, urgency: template.urgency, recurrence_days: template.recurrence_days, due_date: localDateStr(due), section: 'personal_care' });
      toast.success(t('dashboard.personalCare.quickAdded', { title: template.title }));
      fetchPersonalCareTasks();
    } catch { toast.error(t('dashboard.personalCare.addFailed')); }
  };

  // ── Car Care handlers ─────────────────────────────────────────────────────
  const addCcTask = async (e) => {
    e.preventDefault();
    try {
      const vehiclePayload = ccForm.vehicle_id ? (() => {
        const v = garage.find(g=>String(g.id)===String(ccForm.vehicle_id));
        return v ? { vehicle_id: v.id, vehicle_label: v.nickname || `${v.make_name} ${v.model_name}` } : {};
      })() : {};
      await api.post('/life/home-tasks', {
        title: ccForm.title,
        description: [ccForm.category, ccForm.description, vehiclePayload.vehicle_label].filter(Boolean).join(' · '),
        due_date: ccForm.due_date || null,
        urgency: ccForm.urgency,
        recurrence_days: ccForm.recurrence_days ? parseInt(ccForm.recurrence_days) : null,
        section: 'car_care',
        frequency: ccForm.frequency || null,
        is_recurring: ccForm.is_recurring,
        estimated_cost: ccForm.estimated_cost ? parseFloat(ccForm.estimated_cost) : null,
        recurring_start_date: ccForm.is_recurring && ccForm.recurring_start_date ? ccForm.recurring_start_date : null,
        recurring_end_date: ccForm.is_recurring && ccForm.recurring_end_date ? ccForm.recurring_end_date : null,
        vehicle_id: vehiclePayload.vehicle_id || null,
      });
      toast.success(t('dashboard.carCare.serviceAdded'));
      setCcForm({ title:'', category:'Oil Change', due_date:'', urgency:'medium', recurrence_days:'', description:'', frequency:'', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', vehicle_id:'' });
      setShowCcModal(false);
      fetchCarCareTasks();
    } catch { toast.error(t('dashboard.carCare.saveFailed')); }
  };
  const toggleCcTask = async (task) => {
    try {
      await api.put(`/life/home-tasks/${task.id}`, { is_completed: !task.is_completed });
      fetchCarCareTasks();
    } catch { toast.error(t('dashboard.carCare.updateFailed')); }
  };
  const deleteCcTask = async (id) => {
    try {
      await api.delete(`/life/home-tasks/${id}`);
      setCarCareTasks(prev => prev.filter(t => t.id !== id));
      toast.success(t('dashboard.carCare.removed'));
    } catch { toast.error(t('dashboard.carCare.removeFailed')); }
  };
  const quickAddCcTask = async (template) => {
    try {
      const due = new Date();
      due.setDate(due.getDate() + (template.recurrence_days || 90));
      await api.post('/life/home-tasks', { title: template.title, description: template.category, urgency: template.urgency, recurrence_days: template.recurrence_days, due_date: localDateStr(due), section: 'car_care' });
      toast.success(t('dashboard.carCare.quickAdded', { title: template.title }));
      fetchCarCareTasks();
    } catch { toast.error(t('dashboard.carCare.addFailed')); }
  };

  // Garage handlers
  const fetchGarage = useCallback(async () => {
    setGarageLoading(true);
    try {
      const res = await api.get('/vehicles/my');
      setGarage(res.data || []);
      setGarageFetched(true);
    } catch { /* silent */ }
    finally { setGarageLoading(false); }
  }, []);

  const loadMakesForGarage = useCallback(async () => {
    if (makesFetched) return;
    try {
      const res = await api.get('/vehicles/makes');
      setAllMakes(res.data || []);
      setMakesFetched(true);
    } catch { /* silent */ }
  }, [makesFetched]);

  const loadModelsForGarage = useCallback(async (makeName) => {
    if (!makeName) { setGarageModels([]); return; }
    setGarageModelsLoading(true);
    try {
      const res = await api.get('/vehicles/models', { params: { make: makeName } });
      setGarageModels(res.data || []);
    } catch { setGarageModels([]); }
    finally { setGarageModelsLoading(false); }
  }, []);

  const addToGarage = async () => {
    const { selectedMake, selectedModel, year, nickname } = garageForm;
    if (!selectedMake || !selectedModel) return;
    setGarageAdding(true);
    try {
      const res = await api.post('/vehicles/my', {
        make_id:    selectedMake.id,
        make_name:  selectedMake.name,
        model_id:   selectedModel.modelId,
        model_name: selectedModel.modelName,
        year:       year || undefined,
        nickname:   nickname.trim() || undefined,
      });
      setGarage(prev => [res.data, ...prev]);
      setGarageForm({ makeSearch:'', selectedMake:null, modelSearch:'', selectedModel:null, year:'', nickname:'' });
      setGarageModels([]);
      toast.success(t('dashboard.carCare.vehicleAdded'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('dashboard.carCare.vehicleAddFailed'));
    } finally { setGarageAdding(false); }
  };

  const deleteFromGarage = async (id) => {
    try {
      await api.delete(`/vehicles/my/${id}`);
      setGarage(prev => prev.filter(v => v.id !== id));
      setGarageDeleteTarget(null);
      toast.success(t('dashboard.carCare.removed'));
    } catch { toast.error(t('dashboard.carCare.removeFailed')); }
  };

  const decodeVin = async () => {
    const vin = vinInput.trim().toUpperCase();
    if (!vin) return;
    setVinDecoding(true);
    setVinResult(null);
    setVinError('');
    try {
      const res = await api.get(`/vehicles/vin/${vin}`);
      setVinResult(res.data);
    } catch (err) {
      setVinError(err.response?.data?.error || t('dashboard.carCare.vinDecodeError'));
    } finally { setVinDecoding(false); }
  };

  const addVinVehicle = async () => {
    if (!vinResult?.make) return;
    setGarageAdding(true);
    try {
      // We need make_id - look it up from allMakes, or fall back to 0
      await loadMakesForGarage();
      const matchedMake = allMakes.find(m => m.name.toLowerCase() === vinResult.make.toLowerCase());
      const res = await api.post('/vehicles/my', {
        make_id:    matchedMake?.id || 0,
        make_name:  vinResult.make,
        model_id:   0,
        model_name: vinResult.model || t('dashboard.carCare.unknownModel'),
        year:       vinResult.year  || undefined,
        nickname:   garageForm.nickname.trim() || undefined,
        notes:      vinResult.vin,
      });
      setGarage(prev => [res.data, ...prev]);
      setVinInput('');
      setVinResult(null);
      setGarageForm(p => ({...p, nickname:''}));
      toast.success(t('dashboard.carCare.vehicleAddedVin'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('dashboard.carCare.vehicleAddFailed'));
    } finally { setGarageAdding(false); }
  };

  const lookupHomeAddress = async () => {
    const addr = homeAddrInput.trim();
    if (!addr) return;
    setHomeLookupLoading(true);
    setHomeLookup(null);
    setHomeLookupError('');
    try {
      const res = await api.get('/house/lookup', { params: { address: addr } });
      setHomeLookup(res.data);
    } catch (err) {
      setHomeLookupError(err.response?.data?.error || t('dashboard.home.addressNotFound'));
    } finally { setHomeLookupLoading(false); }
  };

  const addHome = async () => {
    if (!homeLookup) return;
    setHomeAdding(true);
    try {
      const payload = {
        address:    homeLookup.matchedAddress,
        city:       homeLookup.city,
        state:      homeLookup.state,
        zip:        homeLookup.zip,
        lat:        homeLookup.lat,
        lng:        homeLookup.lng,
        year_built: homeLookup.building?.yearBuilt ? parseInt(homeLookup.building.yearBuilt) : undefined,
        flood_zone: homeLookup.flood?.zone || undefined,
        osm_building_levels: homeLookup.building?.levels ? parseInt(homeLookup.building.levels) : undefined,
        nickname:   homeNickname.trim() || undefined,
      };
      const res = await api.post('/house/my', payload);
      setHomes(prev => [res.data, ...prev]);
      setHomeLookup(null);
      setHomeAddrInput('');
      setHomeNickname('');
      toast.success(t('dashboard.home.homeAdded'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('dashboard.home.homeAddFailed'));
    } finally { setHomeAdding(false); }
  };

  const deleteHome = async (id) => {
    try {
      await api.delete(`/house/my/${id}`);
      setHomes(prev => prev.filter(h => h.id !== id));
      setHomeDeleteTarget(null);
      toast.success(t('dashboard.home.removed'));
    } catch { toast.error(t('dashboard.home.removeFailed')); }
  };

  // Form state
  const [expenseForm, setExpenseForm] = useState({ type:'expense', amount:'', category:'', description:'', frequency:'one_time', is_recurring:false, recurring_start_date:'', recurring_end_date:'' });
  const [goalForm, setGoalForm] = useState({ title:'', goal_type:'financial', target_value:'', icon:'🎯' });
  const [homeTaskForm, setHomeTaskForm] = useState({ title:'', due_date:'', urgency:'low', frequency:'one_time', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', home_id:'' });
  const [checklistForm, setChecklistForm] = useState({ title:'', due_date:'' });

  const retryLoad = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [jobsRes, notifRes, msgRes, foodOrdersRes, walletsRes] = await Promise.allSettled([
        api.get('/jobs/me/list'),
        api.get('/notifications'),
        api.get('/messages/conversations'),
        listMyFoodOrders(),
        listMyFoodRestaurantWallets(),
      ]);
      const anyFailed = [jobsRes, notifRes, msgRes, foodOrdersRes, walletsRes].some(r => r.status === 'rejected');
      if (anyFailed) setError(true);
      if (jobsRes.status === 'fulfilled') setMyJobs(jobsRes.value.data?.jobs || jobsRes.value.data || []);
      if (notifRes.status === 'fulfilled') setNotifications(notifRes.value.data?.notifications || notifRes.value.data || []);
      if (msgRes.status === 'fulfilled') setConversations(msgRes.value.data?.conversations || msgRes.value.data || []);
      if (foodOrdersRes.status === 'fulfilled') setFoodOrders(foodOrdersRes.value || []);
      if (walletsRes.status === 'fulfilled') setRestaurantWallets(walletsRes.value || []);
    } catch (e) { console.error(e); setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    retryLoad();
    if (SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS) {
      life.fetchSummary();
      life.fetchFinancialPulse('1m');
      life.fetchCommunity(undefined, user?.role === 'customer' ? 'customer' : undefined);
      life.fetchExpenses();
      life.fetchBudgets();
      life.fetchGoals();
      life.fetchHomeTasks({ completed: 'false', section: 'home' });
      if (!homesLoaded) {
        api.get('/house/my').then(r => { setHomes(r.data||[]); setHomesLoaded(true); }).catch(()=>{});
      }
      life.fetchChecklist();
      life.fetchSavedHelpers();
    }
  }, []);

  // ── Derived ───────────────────────────────────────────────────────
  const displayName = (() => {
    const pref = user?.display_name_preference || 'first_name';
    if (pref === 'full_name') return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
    if (pref === 'business_name') return user?.business_name || user?.first_name || '';
    return user?.first_name || '';
  })();
  const hr = new Date().getHours();
  const greeting =
    hr < 12
      ? t('dashboard.greeting', { time: t('dashboard.morning'), name: displayName })
      : hr < 17
        ? t('dashboard.greeting', { time: t('dashboard.afternoon'), name: displayName })
        : t('dashboard.greeting', { time: t('dashboard.evening'), name: displayName });
  const unreadNotifs = Array.isArray(notifications) ? notifications.filter(n => !n.read && !n.read_at).length : 0;
  const unreadMsgs = Array.isArray(conversations) ? conversations.filter(c => c.unread_count > 0).length : 0;
  const activeJobs = Array.isArray(myJobs)
    ? myJobs.filter((job) => ACTIVE_CUSTOMER_JOB_STATUSES.has(String(job.status || '').toLowerCase()))
    : [];
  const isFreeTier = !user?.tier || user?.tier === 'free';
  const s = life.summary;

  const openMoneyTransaction = useCallback((type = 'expense') => {
    setExpenseForm(p => ({ ...p, type }));
    selectTab('money');
    setShowExpenseModal(true);
  }, [selectTab]);

  const openHomeTask = useCallback(() => {
    selectTab('home');
    setShowHomeTaskModal(true);
  }, [selectTab]);

  const openGoal = useCallback(() => {
    selectTab('goals');
    setShowGoalModal(true);
  }, [selectTab]);

  // ── Form handlers ─────────────────────────────────────────────────
  const handleAddExpense = async (e) => {
    e.preventDefault();
    try {
      await life.createExpense({
        ...expenseForm,
        amount: parseFloat(expenseForm.amount),
        is_recurring: expenseForm.is_recurring,
        recurring_start_date: expenseForm.is_recurring && expenseForm.recurring_start_date ? expenseForm.recurring_start_date : null,
        recurring_end_date: expenseForm.is_recurring && expenseForm.recurring_end_date ? expenseForm.recurring_end_date : null,
      });
      toast.success(expenseForm.type === 'income' ? t('dashboard.money.incomeLogged') : t('dashboard.money.expenseLogged'));
      setExpenseForm({ type:'expense', amount:'', category:'', description:'', frequency:'one_time', is_recurring:false, recurring_start_date:'', recurring_end_date:'' });
      setShowExpenseModal(false);
      life.fetchSummary();
      life.fetchExpenses();
    } catch { toast.error(t('dashboard.money.saveFailed')); }
  };
  const handleAddGoal = async (e) => {
    e.preventDefault();
    try {
      await life.createGoal({ ...goalForm, target_value: goalForm.target_value ? parseFloat(goalForm.target_value) : null });
      toast.success(t('dashboard.goals.goalCreated'));
      setGoalForm({ title:'', goal_type:'financial', target_value:'', icon:'🎯' });
      setShowGoalModal(false);
      life.fetchSummary();
    } catch { toast.error(t('dashboard.goals.saveFailed')); }
  };
  const handleAddHomeTask = async (e) => {
    e.preventDefault();
    try {
      await life.createHomeTask({
        ...homeTaskForm,
        frequency: homeTaskForm.frequency || null,
        estimated_cost: homeTaskForm.estimated_cost ? parseFloat(homeTaskForm.estimated_cost) : null,
        recurring_start_date: homeTaskForm.is_recurring && homeTaskForm.recurring_start_date ? homeTaskForm.recurring_start_date : null,
        recurring_end_date: homeTaskForm.is_recurring && homeTaskForm.recurring_end_date ? homeTaskForm.recurring_end_date : null,
        home_id: homeTaskForm.home_id ? parseInt(homeTaskForm.home_id) : null,
      });
      toast.success(t('dashboard.home.taskAdded'));
      setHomeTaskForm({ title:'', due_date:'', urgency:'low', frequency:'one_time', is_recurring:false, estimated_cost:'', recurring_start_date:'', recurring_end_date:'', home_id:'' });
      setShowHomeTaskModal(false);
      life.fetchSummary();
    } catch { toast.error(t('dashboard.home.saveFailed')); }
  };
  const handleAddChecklist = async (e) => {
    e.preventDefault();
    try {
      await life.createChecklistItem(checklistForm);
      toast.success(t('dashboard.goals.itemAdded'));
      setChecklistForm({ title:'', due_date:'' });
      setShowChecklistModal(false);
      life.fetchSummary();
    } catch { toast.error(t('dashboard.goals.saveFailed')); }
  };
  const toggleChecklist = async (item) => {
    try {
      await life.updateChecklistItem(item.id, { is_completed: !item.is_completed });
      life.fetchSummary();
    } catch { toast.error(t('dashboard.goals.updateFailed')); }
  };
  const toggleHomeTask = async (task) => {
    try {
      await life.updateHomeTask(task.id, { is_completed: !task.is_completed });
      life.fetchSummary();
      life.fetchHomeTasks({ completed: 'false', section: 'home' });
    } catch { toast.error(t('dashboard.home.updateFailed')); }
  };
  const updateGoalProgress = async (goal, newValue) => {
    try {
      const val = parseFloat(newValue);
      if (isNaN(val)) return;
      await life.updateGoal(goal.id, { current_value: val, is_completed: goal.target_value && val >= goal.target_value });
      life.fetchSummary();
      toast.success(t('dashboard.goals.progressUpdated'));
    } catch { toast.error(t('dashboard.goals.updateFailed')); }
  };

  return (
    <PageShell>
    <div className="dashboard-page min-h-screen text-white">
      <PageMeta title={t('dashboard.metaTitle')} description={t('dashboard.metaDesc')} noIndex={true} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="dashboard-page-title text-4xl font-black text-white tracking-tight mb-2">
              {t('dashboard.welcome', { name: user?.first_name || 'there' })}
            </h1>
            <p className="dashboard-page-subtitle text-gray-400 font-medium">
              {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS ? t('dashboard.atAGlance') : t('dashboard.customer.subtitle')}
            </p>
          </div>
          {LAUNCH_VISIBILITY.subscriptions && <TrialBanner />}
        </div>

        {SHOW_LEGACY_CUSTOMER_RECOMMENDATIONS && <RecommendationFeed title="What to do next" />}

        {SHOW_LEGACY_CUSTOMER_DASHBOARD_TABS && (
        <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-8 border-b border-gray-800" style={{
          WebkitOverflowScrolling: 'touch',
          scrollBehavior: 'smooth',
        }}>
          <div className="dashboard-tabs flex items-center gap-1 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900" style={{ minWidth: 'min-content' }}>
            {[
              { id: 'pulse',        label: t('dashboard.tabs.pulse'),        icon: IcoZap },
              { id: 'money',        label: t('dashboard.tabs.money'),        icon: IcoDollar },
              { id: 'home',         label: t('dashboard.tabs.home'),         icon: IcoHome },
              { id: 'goals',        label: t('dashboard.tabs.goals'),        icon: IcoTarget },
              { id: 'personalcare', label: t('dashboard.tabs.personalCare'), icon: IcoHeart },
              { id: 'carcare',      label: t('dashboard.tabs.carCare'),      icon: IcoCar },
              { id: 'skills',       label: t('dashboard.tabs.skillsTools'),  icon: IcoBriefcase },
            ].filter((tabDef) => VISIBLE_CUSTOMER_DASHBOARD_TABS.includes(tabDef.id)).map(tabDef => (
              <button
                key={tabDef.id}
                onClick={() => selectTab(tabDef.id)}
                className={`flex items-center gap-2 px-5 py-3 rounded-t-xl text-xs font-bold uppercase tracking-wider transition-all flex-shrink-0 ${
                  tab === tabDef.id
                    ? 'bg-gray-800/80 text-orange-500 border-b-2 border-orange-500'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
                }`}
                style={{ whiteSpace: 'nowrap' }}
              >
                <tabDef.icon size={14} cls={tab === tabDef.id ? 'text-orange-500' : 'text-gray-500'} />
                {tabDef.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* ═══════ PULSE ═══════ */}
        {tab === 'pulse' && !SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && (
          <LaunchCustomerDashboard
            t={t}
            loading={loading}
            activeJobs={activeJobs}
            foodOrders={foodOrders}
            wallets={restaurantWallets}
            unreadMsgs={unreadMsgs}
            unreadNotifs={unreadNotifs}
            error={error}
            onRetry={retryLoad}
          />
        )}

        {tab==='pulse' && SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && (<>
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-2">
              <span>⚠</span>
              <span>{t('dashboard.pulse.loadError')} <button onClick={retryLoad} className="underline hover:text-red-300">{t('dashboard.pulse.retry')}</button></span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && (
            <button type="button" onClick={() => selectTab('money')} className="text-left group">
              <Card className="flex flex-col justify-between h-full group-hover:border-orange-500/50 transition-colors">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">{t('dashboard.summary.netThisMonth')}</p>
                  <p className={`text-2xl font-black tracking-tight ${life.summary?.net_this_month >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ${life.summary?.net_this_month?.toLocaleString() || '0'}
                  </p>
                </div>
                <p className="text-[10px] text-gray-600 font-medium mt-2 group-hover:text-orange-400 transition-colors">
                  {t('dashboard.summary.inOut', { in: life.summary?.total_in?.toLocaleString() || '0', out: life.summary?.total_out?.toLocaleString() || '0' })}
                </p>
              </Card>
            </button>
            )}

            <Link to="/messages" className="group">
              <Card className="flex flex-col justify-between h-full group-hover:border-orange-500/50 transition-colors">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">{t('messages.title')}</p>
                  <p className="text-2xl font-black text-white tracking-tight">
                    {unreadMsgs}
                  </p>
                </div>
                <p className="text-[10px] text-gray-600 font-medium mt-2 group-hover:text-orange-400 transition-colors">
                  {unreadMsgs > 0
                    ? t('dashboard.summary.unreadMessages', { count: unreadMsgs })
                    : t('dashboard.summary.allCaughtUp')}
                </p>
              </Card>
            </Link>

            {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && (
            <>
            <button type="button" onClick={openHomeTask} className="text-left group">
              <Card className="flex flex-col justify-between h-full group-hover:border-orange-500/50 transition-colors">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">{t('dashboard.summary.thisWeek')}</p>
                  <p className="text-2xl font-black text-white tracking-tight">
                    {life.summary?.overdue_tasks || 0}
                  </p>
                </div>
                <p className="text-[10px] text-gray-600 font-medium mt-2 group-hover:text-orange-400 transition-colors">
                  {life.summary?.overdue_tasks > 0 
                    ? t('dashboard.summary.overdueTasks', { count: life.summary.overdue_tasks })
                    : t('dashboard.summary.allOnTrack')}
                </p>
              </Card>
            </button>

            <button type="button" onClick={openGoal} className="text-left group">
              <Card className="flex flex-col justify-between h-full group-hover:border-orange-500/50 transition-colors">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">{t('dashboard.summary.goalsProgress')}</p>
                  <p className="text-2xl font-black text-white tracking-tight">
                    {life.summary?.active_goals || 0}
                  </p>
                </div>
                <p className="text-[10px] text-gray-600 font-medium mt-2 group-hover:text-orange-400 transition-colors">
                  {t('dashboard.summary.activeGoals', { count: life.summary?.active_goals || 0 })}
                </p>
              </Card>
            </button>
            </>
            )}
          </div>

          {/* Life Pulse Score - powered by the unified engine (30-day horizon) */}
          {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && life.financialPulse && (() => {
            const fp = life.financialPulse;
            // No data entered yet - show onboarding prompt instead of a fabricated score
            if (fp.no_data) {
              return (
                <div className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 border border-gray-700/40 rounded-2xl p-6 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold">{t('dashboard.pulse.next30Days')}</p>
                    <button onClick={() => setShowPulseSettings(true)} className="text-[11px] text-gray-600 hover:text-gray-400 transition flex items-center gap-1">
                      <IcoSettings size={13} cls="text-gray-600" /> {t('dashboard.pulse.configure')}
                    </button>
                  </div>
                  {showPulseSettings && (
                    <PulseScoreSettings onClose={() => setShowPulseSettings(false)} onSaved={() => life.fetchFinancialPulse('1m')} />
                  )}
                  <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center">
                      <span className="text-2xl font-bold text-gray-700">-</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-400">{t('dashboard.pulse.noData')}</p>
                    <p className="text-xs text-gray-600 max-w-xs">
                      {t('dashboard.pulse.noDataSub')}
                    </p>
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => openMoneyTransaction('expense')} className="text-xs text-orange-400 hover:text-orange-300 underline underline-offset-2">
                        {t('dashboard.pulse.logTransaction')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            const score = fp?.pulse_score ?? 0;
            const scoreColor = score >= 80 ? '#34d399' : score >= 60 ? '#F97316' : score >= 40 ? '#facc15' : '#f87171';
            const breakdown = fp?.score_breakdown ?? {};
            const sources   = fp?.sources ?? {};
            const activeCount = fp?.settings
              ? Object.values(fp.settings).filter(Boolean).length
              : null;
            const totalCount = fp?.settings ? Object.keys(fp.settings).length : null;

            const SOURCE_LABELS = [
              { key: 'manual_income_90d',         label: t('plannedNeeds.srcManualIncome'),       dir: '+' },
              { key: 'recurring_income_monthly',   label: t('plannedNeeds.srcRecurringIncome'),    dir: '+' },
              { key: 'oxsteed_income_90d',         label: t('plannedNeeds.srcOxsteedIncome'),      dir: '+' },
              { key: 'tool_rental_income_90d',     label: t('plannedNeeds.srcToolRentalIncome'),   dir: '+' },
              { key: 'invoice_income_90d',         label: t('plannedNeeds.srcInvoiceIncome'),      dir: '+' },
              { key: 'predicted_jobs',             label: t('plannedNeeds.srcPredictedJobs'),      dir: '+' },
              { key: 'predicted_invoices',         label: t('plannedNeeds.srcPredictedInvoices'),  dir: '+' },
              { key: 'manual_expense_90d',         label: t('plannedNeeds.srcManualExpense'),      dir: '−' },
              { key: 'recurring_expense_monthly',  label: t('plannedNeeds.srcRecurringExpense'),   dir: '−' },
              { key: 'debt_monthly',               label: t('plannedNeeds.srcDebt'),               dir: '−' },
              { key: 'home_maintenance_monthly',   label: t('plannedNeeds.srcHomeMaint'),          dir: '−' },
              { key: 'car_care_monthly',           label: t('plannedNeeds.srcCarCare'),            dir: '−' },
              { key: 'personal_care_monthly',      label: t('plannedNeeds.srcPersonalCare'),       dir: '−' },
              { key: 'tax_obligations_window',     label: t('plannedNeeds.srcTax'),                dir: '−' },
              { key: 'sinking_fund_window',        label: t('plannedNeeds.srcSinkingFund'),        dir: '−' },
            ].filter(s => (sources[s.key] ?? 0) !== 0);

            return (
              <>
                {showPulseSettings && (
                  <PulseScoreSettings
                    onClose={() => setShowPulseSettings(false)}
                    onSaved={() => life.fetchFinancialPulse('1m')}
                  />
                )}
                <div className="bg-gradient-to-r from-gray-900/80 to-gray-900/40 border border-gray-700/40 rounded-2xl p-6 mb-6">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold">{t('dashboard.pulse.next30Days')}</p>
                    <button
                      onClick={() => setShowPulseSettings(true)}
                      className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition"
                      title={t('dashboard.pulse.configure')}
                    >
                      <IcoSettings size={13} cls="text-gray-500" />
                      {activeCount !== null && (
                        <span>{t('dashboard.pulse.sourcesCount', { active: activeCount, total: totalCount })}</span>
                      )}
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                    {/* Score ring + description */}
                    <div className="flex items-center gap-6">
                      <div className="relative w-20 h-20 shrink-0">
                        <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
                          <circle cx="40" cy="40" r="34" fill="none" stroke="#1f2937" strokeWidth="6"/>
                          <circle cx="40" cy="40" r="34" fill="none" stroke={scoreColor} strokeWidth="6"
                            strokeDasharray={`${(score / 100) * 213.6} 213.6`} strokeLinecap="round"
                            className="transition-all duration-1000"/>
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-2xl font-bold" style={{ color: scoreColor }}>{score}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-gray-400 max-w-xs">
                          {score >= 80 ? t('dashboard.pulse.strong') :
                           score >= 60 ? t('dashboard.pulse.good') :
                           score >= 40 ? t('dashboard.pulse.someGaps') :
                           t('dashboard.pulse.needsAttention')}
                        </p>
                        <button
                          onClick={() => setShowSources(v => !v)}
                          className="text-[11px] text-gray-600 hover:text-orange-400 transition mt-1.5 underline underline-offset-2"
                        >
                          {showSources ? t('dashboard.pulse.hideSources') : t('dashboard.pulse.whatsIncluded')}
                        </button>
                      </div>
                    </div>
                    {/* Breakdown */}
                    <div className="grid grid-cols-4 gap-3 shrink-0">
                      {[
                        { l: t('dashboard.pulse.coverage'),    v: breakdown.coverage,    c: 'text-emerald-400' },
                        { l: t('dashboard.pulse.buffer'),      v: breakdown.buffer,      c: 'text-blue-400'    },
                        { l: t('dashboard.pulse.reliability'), v: breakdown.reliability, c: 'text-purple-400'  },
                        { l: t('dashboard.pulse.obligations'), v: breakdown.obligations, c: 'text-orange-400'  },
                      ].map((d, i) => (
                        <div key={i} className="text-center">
                          <p className={`text-lg font-bold ${d.c}`}>{d.v ?? '-'}</p>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider">{d.l}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Source breakdown (expandable) */}
                  {showSources && SOURCE_LABELS.length > 0 && (
                    <div className="mt-4 border-t border-gray-700/40 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {SOURCE_LABELS.map(s => (
                        <div key={s.key} className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500">{s.label}</span>
                          <span className={s.dir === '+' ? 'text-emerald-400' : 'text-red-400'}>
                            {s.dir}${(sources[s.key] || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Alerts */}
                  {fp.alerts?.length > 0 && (
                    <div className="mt-4 space-y-1.5 border-t border-gray-700/40 pt-4">
                      {fp.alerts.map((alert, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
                          <span className="shrink-0 mt-0.5">⚠</span>
                          <span>{alert}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t('dashboard.jobs.inProgress')}</p>
              {loading
                ? <div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1" />
                : <p className="text-2xl font-bold text-orange-400">{activeJobs.length}</p>
              }
              <p className="text-xs text-gray-500 mt-1">{unreadMsgs>0 ? t('dashboard.summary.unreadMessages', { count: unreadMsgs }) : t('dashboard.summary.allCaughtUp')}</p>
            </Card>
            {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t('dashboard.summary.goalsProgress')}</p>
              {loading
                ? <div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1" />
                : <p className="text-2xl font-bold text-purple-400">{s?.goals?.avg_progress||0}%</p>
              }
              <p className="text-xs text-gray-500 mt-1">{t('dashboard.summary.activeGoals', { count: s?.goals?.active||0 })}</p>
            </Card>}
            {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && <Card><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{t('dashboard.home.maintenance')}</p>
              {loading
                ? <div className="h-8 w-16 bg-gray-800 rounded animate-pulse mt-1" />
                : <p className={`text-2xl font-bold ${(s?.home?.overdue||0)>0?'text-red-400':'text-emerald-400'}`}>{s?.home?.overdue||0}</p>
              }
              <p className="text-xs text-gray-500 mt-1">{(s?.home?.overdue||0)>0 ? t('dashboard.summary.overdueTasks', { count: s?.home?.overdue||0 }) : t('dashboard.summary.allOnTrack')} · {t('dashboard.summary.dueThisWeek', { count: s?.home?.due_this_week||0 })}</p>
            </Card>}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {[
              {to:'/post-job',       Ic:IcoPlus,        l:t('dashboard.postJob'),               c:'text-orange-400'},
              {to:'/my-jobs',        Ic:IcoBriefcase,   l:t('dashboard.myJobs'),                c:'text-yellow-400',
                badge: myJobs.length > 0 ? myJobs.length : 0},
              {to:'/helpers',        Ic:IcoSearch,      l:t('dashboard.browseHelpers'),          c:'text-blue-400'},
              {to:'/messages',       Ic:IcoChat,        l:t('messages.title'),                   c:'text-emerald-400', badge:unreadMsgs},
              {to:'/planned-needs',  Ic:IcoClock,       l:t('dashboard.plannedNeeds.title'),     c:'text-purple-400',
                badge: s?.planned_needs?.activating_soon_count || 0},
              {to:'/tool-rentals',   Ic:IcoSearch,      l:t('toolRentals.browsePage'),           c:'text-indigo-400'},
            ].filter((a) => SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS || !['/planned-needs', '/tool-rentals'].includes(a.to)).map((a,i)=>(
              <Link key={i} to={a.to} className="relative bg-gray-900/50 border border-gray-700/40 rounded-2xl p-4 hover:border-gray-600 hover:-translate-y-0.5 transition-all group flex items-center gap-3">
                <a.Ic size={18} cls={a.c}/><span className="text-sm font-medium text-gray-300 group-hover:text-white transition">{a.l}</span>
                {a.badge>0&&<span className="absolute top-2 right-2 bg-action text-on-action text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold">{a.badge}</span>}
              </Link>
            ))}
          </div>

          {/* Planned Needs snapshot */}
          {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && (s?.planned_needs?.active_count > 0 || !loading) && (
            <Card className="mb-6">
              <CardHeader
                icon={IcoClock}
                title={t('dashboard.plannedNeeds.title')}
                right={
                  <Link to="/planned-needs" className="text-xs text-orange-400 hover:text-orange-300 font-medium">
                    {t('dashboard.plannedNeeds.manage')}
                  </Link>
                }
              />
              {loading ? (
                <div className="h-12 bg-gray-800 rounded-xl animate-pulse" />
              ) : s?.planned_needs?.active_count > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className="text-xl font-bold text-purple-400">{s.planned_needs.active_count}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.plannedNeeds.active')}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className={`text-xl font-bold ${s.planned_needs.activating_soon_count > 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                      {s.planned_needs.activating_soon_count}
                    </p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.plannedNeeds.publishingSoon')}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className="text-xl font-bold text-emerald-400">
                      {formatMoney(parseFloat(s.planned_needs.total_planned_cost || 0), { maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.plannedNeeds.totalPlanned')}</p>
                  </div>
                  <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                    <p className="text-sm font-bold text-gray-300">
                      {s.planned_needs.next_due_date
                        ? shortDateLabel(`${s.planned_needs.next_due_date}T00:00:00`)
                        : '-'}
                    </p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.plannedNeeds.nextDue')}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl">
                  <p className="text-sm text-gray-400">{t('dashboard.plannedNeeds.noPlannedNeeds')}</p>
                  <Link to="/planned-needs" className="text-xs bg-action hover:bg-action-hover text-on-action font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap ml-3">
                    {t('dashboard.plannedNeeds.addOne')}
                  </Link>
                </div>
              )}
            </Card>
          )}

          {/* Active jobs preview */}
          {activeJobs.length > 0 && (
            <Card className="mb-6">
              <CardHeader icon={IcoBriefcase} title={t('dashboard.jobs.inProgress')} right={<Link to="/post-job" className="text-xs text-orange-400 hover:text-orange-300 font-medium">{t('dashboard.postJob')}</Link>}/>
              <div className="space-y-2">
                {activeJobs.slice(0,3).map(job=>(
                  <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl hover:bg-gray-800/60 transition group">
                    <div className="min-w-0 flex-1"><p className="text-white text-sm font-medium group-hover:text-orange-400 transition truncate">{job.title}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}</p></div>
                    <Tag text={job.status==='open'||job.status==='published'?t('dashboard.jobs.open'):t('dashboard.jobs.inProgress')} color={job.status==='open'||job.status==='published'?'green':'blue'}/>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {/* Community Pulse */}
          {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && life.community && (
            <Card className="mb-6">
              {life.community.view === 'customer' ? (
                <>
                  <CardHeader icon={IcoUsers} title={t('dashboard.community.title')} right={<Link to="/helpers" className="text-xs text-orange-400 font-medium">{t('dashboard.community.findHelpers', { defaultValue: 'Find Helpers' })}</Link>}/>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-emerald-400">{life.community.new_helpers_this_week}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.newHelpersThisWeek', { defaultValue: 'New Helpers This Week' })}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-orange-400">{life.community.active_helpers}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.activeHelpers')}</p>
                    </div>
                    {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && (
                    <>
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-blue-400">{life.community.tools_for_rent}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.toolsForRent', { defaultValue: 'Tools for Rent' })}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-purple-400">{life.community.products_for_sale}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.productsForSale', { defaultValue: 'Products for Sale' })}</p>
                    </div>
                    </>
                    )}
                  </div>
                  {life.community.top_categories?.length > 0 && (
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">{t('dashboard.community.topServices', { defaultValue: 'Top services:' })}</span>
                      {life.community.top_categories.slice(0,3).map((c,i) => (
                        <Tag key={i} text={c.category_name} color={['orange','green','blue'][i]}/>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <CardHeader icon={IcoUsers} title={t('dashboard.community.title')} right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">{t('dashboard.community.browseJobs')}</Link>}/>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-orange-400">{life.community.jobs_this_week}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.jobsThisWeek')}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-emerald-400">{life.community.open_jobs}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.openNow')}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-blue-400">{life.community.active_helpers}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.activeHelpers')}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-800/30 rounded-xl">
                      <p className="text-xl font-bold text-purple-400">{life.community.active_seekers}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('dashboard.community.seekersThisWeek')}</p>
                    </div>
                  </div>
                  {life.community.top_categories?.length > 0 && (
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">{t('dashboard.community.trending')}</span>
                      {life.community.top_categories.slice(0,3).map((c,i) => (
                        <Tag key={i} text={`${c.category_name} (${c.job_count})`} color={['orange','green','blue'][i]}/>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Card>
          )}

          {/* Upgrade CTA */}
          {SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS && isFreeTier && (
            <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div><div className="flex items-center gap-2 mb-1"><IcoZap size={18} cls="text-orange-400"/><h3 className="text-lg font-bold text-white">{t('dashboard.upgrade.title')}</h3></div><p className="text-sm text-gray-400">{t('dashboard.upgrade.subtitle')}</p></div>
              <Link to="/upgrade" className="bg-action hover:bg-action-hover text-on-action font-semibold px-6 py-2.5 rounded-xl transition whitespace-nowrap text-sm">{t('dashboard.upgrade.viewPlans')}</Link>
            </div>
          )}
        </>)}

        {/* ═══════ MONEY TAB ═══════ */}
        {tab==='money' && (<>
          {/* Monthly summary */}
          <Card className="mb-6">
            <CardHeader icon={IcoDollar} title={monthYearLabel()} right={<Btn onClick={()=>setShowExpenseModal(true)}>{t('dashboard.money.logTransaction')}</Btn>}/>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.income')}</p><p className="text-xl font-bold text-emerald-400">{formatMoney(life.expenseSummary?.total_income || 0)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.expenses')}</p><p className="text-xl font-bold text-red-400">{formatMoney(life.expenseSummary?.total_expenses || 0)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.net')}</p><p className={`text-xl font-bold ${(life.expenseSummary?.net||0)>=0?'text-emerald-400':'text-red-400'}`}>{formatMoney(life.expenseSummary?.net || 0)}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{t('dashboard.money.savingsRate')}</p>
                {(() => {
                  const income = life.expenseSummary?.total_income ?? 0;
                  const net = life.expenseSummary?.net ?? 0;
                  if (income <= 0) return <p className="text-xl font-bold text-gray-600">-</p>;
                  const rate = (net / income) * 100;
                  return <p className={`text-xl font-bold ${rate >= 20 ? 'text-emerald-400' : rate >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{Math.round(rate)}%</p>;
                })()}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Recent transactions */}
            <Card>
              <CardHeader icon={IcoDollar} title={t('dashboard.money.recentTransactions')}/>
              {life.expenses.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.money.noTransactions')}</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {(life.expenses ?? []).slice(0,15).map(e=>(
                    <div key={e.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition group">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{e.description||e.category}</p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {e.category} · {new Date(e.occurred_at).toLocaleDateString()}
                          {e.is_recurring && e.frequency && e.frequency !== 'one_time' && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-400">
                              {e.frequency.replace('_','-')}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${e.type==='income'?'text-emerald-400':'text-red-400'}`}>{e.type==='income'?'+':'-'}${parseFloat(e.amount).toFixed(2)}</span>
                        <button onClick={async()=>{await life.deleteExpense(e.id);life.fetchSummary();life.fetchExpenses();toast.success(t('dashboard.money.deleteTransaction'));}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Budgets */}
            <Card>
              <CardHeader icon={IcoTarget} title={t('dashboard.money.budgets')} right={<Btn variant="secondary" onClick={()=>setShowBudgetModal(true)}>{t('dashboard.money.addBudget')}</Btn>}/>
              {life.budgets.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.money.noBudgets')}</p>
              ) : (
                <div className="space-y-4">
                  {(life.budgets ?? []).map(b=>{
                    const spent = parseFloat(b?.spent ?? 0);
                    const limit = parseFloat(b?.monthly_limit ?? 0);
                    const pct = limit > 0 ? (spent / limit) * 100 : 0;
                    const periodLabel = b.period && b.period !== 'monthly' ? ` /mo (${b.period.replace('_','-')})` : '/mo';
                    return (
                      <div key={b.id}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-white">{b.category}</span>
                          <span className="text-gray-500">${spent.toFixed(0)} / ${limit.toFixed(0)}{periodLabel}</span>
                        </div>
                        <ProgressBar pct={pct} color={pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-emerald-500'}/>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Planned Needs – sinking funds */}
          <Card className="mb-6">
            <CardHeader icon={IcoClock} title={t('dashboard.money.sinkingFunds')} right={
              <Link to="/planned-needs" className="text-xs text-orange-400 hover:text-orange-300 font-medium">{t('dashboard.plannedNeeds.manage')}</Link>
            }/>
            {moneyPlannedNeeds.length === 0 ? (
              <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-xl">
                <p className="text-sm text-gray-500">{t('dashboard.plannedNeeds.noPlannedNeeds')}</p>
                <Link to="/planned-needs" className="text-xs bg-action hover:bg-action-hover text-on-action font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap ml-3">{t('dashboard.plannedNeeds.addOne')}</Link>
              </div>
            ) : (
              <div className="space-y-4">
                {(moneyPlannedNeeds ?? []).slice(0,5).map(pn => {
                  const cost = parseFloat(pn?.estimated_cost ?? 0);
                  const saved = parseFloat(pn?.reserved_amount ?? 0);
                  const pct = cost > 0 ? Math.min(100, (saved / cost) * 100) : 0;
                  const perMonth = parseFloat(pn?.sinking_fund_per_month ?? 0);
                  return (
                    <div key={pn.id}>
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span className="font-medium text-white">{pn.title || pn.category}</span>
                        <div className="flex items-center gap-3">
                          {perMonth > 0 && <span className="text-[10px] text-purple-400">{t('dashboard.money.needed', { amount: perMonth.toFixed(0) })}</span>}
                          <span className="text-gray-500 text-xs">${saved.toFixed(0)} / ${cost.toFixed(0)}</span>
                        </div>
                      </div>
                      <ProgressBar pct={pct} color={pct>=100?'bg-emerald-500':pct>=50?'bg-blue-500':'bg-orange-500'}/>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>)}

        {/* ═══════ HOME TAB ═══════ */}
        {tab==='home' && (<>
          {/* My Properties */}
          <Card className="mb-5">
            <CardHeader icon={IcoHome} title={t('dashboard.home.myProperties')}
              right={<span className="text-[10px] text-gray-600">Census · OSM · FEMA</span>}/>

            {/* Address lookup input */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder={t('dashboard.home.addrPlaceholder')}
                value={homeAddrInput}
                onChange={e => { setHomeAddrInput(e.target.value); setHomeLookup(null); setHomeLookupError(''); }}
                onKeyDown={e => e.key==='Enter' && !homeLookupLoading && homeAddrInput.length>5 && lookupHomeAddress()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              />
              <button onClick={lookupHomeAddress}
                disabled={homeLookupLoading || homeAddrInput.trim().length < 5}
                className="bg-action hover:bg-action-hover disabled:opacity-50 text-on-action text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                {homeLookupLoading ? t('dashboard.home.lookingUp') : t('dashboard.home.lookUp')}
              </button>
            </div>

            {homeLookupError && <p className="text-xs text-red-400 mb-2">{homeLookupError}</p>}

            {/* Lookup result */}
            {homeLookup && (
              <div className="bg-gray-800/80 border border-orange-500/30 rounded-xl p-3 mb-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-white leading-tight">{homeLookup.matchedAddress}</p>
                  <span className="text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">{t('dashboard.home.censusVerified')}</span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
                  {homeLookup.building?.yearBuilt  && <span>🏠 {t('dashboard.home.built', { year: homeLookup.building.yearBuilt })}</span>}
                  {homeLookup.building?.levels      && <span>📐 {homeLookup.building.levels} {parseInt(homeLookup.building.levels)===1?t('dashboard.home.stories_one',{count:1}):t('dashboard.home.stories_other',{count:parseInt(homeLookup.building.levels)})}</span>}
                  {homeLookup.building?.roofShape   && <span>🔺 {homeLookup.building.roofShape} {t('dashboard.home.roofSuffix')}</span>}
                  {homeLookup.building?.buildingType && <span>🏗️ {homeLookup.building.buildingType}</span>}
                  {homeLookup.flood && (
                    <span className={homeLookup.flood.zone&&['A','AE','V','VE','AH','AO'].includes(homeLookup.flood.zone)?'text-red-400 font-semibold':'text-emerald-400'}>
                      💧 {homeLookup.flood.label || t('dashboard.home.floodZone', { zone: homeLookup.flood.zone })}
                    </span>
                  )}
                  {!homeLookup.building && !homeLookup.flood && (
                    <span className="text-gray-600">{t('dashboard.home.noOsmData')}</span>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <input type="text" placeholder={t('dashboard.home.nicknamePlaceholder')}
                    value={homeNickname} maxLength={80}
                    onChange={e=>setHomeNickname(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                  <button onClick={addHome} disabled={homeAdding}
                    className="bg-action hover:bg-action-hover disabled:opacity-50 text-on-action text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">
                    {homeAdding ? t('common.saving') : t('dashboard.home.saveProperty')}
                  </button>
                </div>
              </div>
            )}

            {/* Saved homes */}
            {homes.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-2">{t('dashboard.home.noProperties')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {homes.map(h=>(
                  <div key={h.id} className="flex items-center gap-2 bg-gray-800/70 border border-gray-700 rounded-xl px-3 py-2 max-w-full">
                    <IcoHome size={13} cls="text-orange-400 flex-shrink-0"/>
                    <div className="leading-tight min-w-0">
                      <span className="text-sm text-white font-medium truncate block">{h.nickname || h.address}</span>
                      {h.nickname && <span className="text-[10px] text-gray-500 truncate block">{h.address}</span>}
                      <div className="flex gap-2 flex-wrap">
                        {h.year_built && <span className="text-[10px] text-orange-400">{h.year_built}</span>}
                        {h.flood_zone && <span className={`text-[10px] ${['A','AE','V','VE'].includes(h.flood_zone)?'text-red-400':'text-emerald-400'}`}>Zone {h.flood_zone}</span>}
                        {h.osm_building_levels && <span className="text-[10px] text-gray-500">{h.osm_building_levels}fl</span>}
                      </div>
                    </div>
                    <button onClick={()=>setHomeDeleteTarget(h)} className="text-gray-700 hover:text-red-400 transition ml-1 flex-shrink-0"><IcoX size={12}/></button>
                  </div>
                ))}
              </div>
            )}

            {homeDeleteTarget && (
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between gap-3">
                <p className="text-sm text-red-300">{t('dashboard.home.removeConfirm', { name: homeDeleteTarget.nickname||homeDeleteTarget.address })}</p>
                <div className="flex gap-2">
                  <button onClick={()=>setHomeDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white transition px-2 py-1 rounded-lg">{t('common.cancel')}</button>
                  <button onClick={()=>deleteHome(homeDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">{t('common.remove')}</button>
                </div>
              </div>
            )}
          </Card>

          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card className="!p-3 text-center">
              <p className={`text-2xl font-bold ${(s?.home?.overdue||0)>0?'text-red-400':'text-emerald-400'}`}>{s?.home?.overdue||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{t('common.overdue')}</p>
            </Card>
            <Card className="!p-3 text-center">
              <p className="text-2xl font-bold text-orange-400">{s?.home?.due_this_week||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{t('common.dueThisWeek')}</p>
            </Card>
            <Card className="!p-3 text-center">
              <p className="text-2xl font-bold text-gray-300">{s?.home?.total_pending||0}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{t('dashboard.summary.totalPending')}</p>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Home maintenance */}
            <Card>
              <CardHeader icon={IcoHome} title={t('dashboard.home.maintenance')} right={<Btn onClick={()=>setShowHomeTaskModal(true)}>{t('dashboard.home.addTask')}</Btn>}/>
              {life.homeTasks.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.home.noTasks')}</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {(life.homeTasks ?? []).map(homeTask=>{
                    const overdue = homeTask?.due_date && new Date(homeTask.due_date) < new Date() && !homeTask?.is_completed;
                    return (
                      <div key={homeTask.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${homeTask.is_completed?'opacity-40 border-gray-800':overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>toggleHomeTask(homeTask)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${homeTask.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {homeTask.is_completed && <IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${homeTask.is_completed?'line-through text-gray-600':'text-white'}`}>{homeTask.title}</p>
                          <p className={`text-xs mt-0.5 ${overdue?'text-red-400':'text-gray-600'}`}>
                            {homeTask.due_date ? (overdue ? t('common.overdue') + ' · ' : '') + new Date(homeTask.due_date).toLocaleDateString() : t('dashboard.home.noDueDate')}
                            {homeTask.recurrence_days ? ` · ${t('dashboard.home.everyNDays', { n: homeTask.recurrence_days })}` : ''}
                            {homeTask.home_name ? ` · ${homeTask.home_name}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Tag text={homeTask.urgency} color={homeTask.urgency==='high'?'red':homeTask.urgency==='medium'?'orange':'gray'}/>
                          <Link to="/post-job" className="text-[10px] text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap">{t('dashboard.home.findHelp')}</Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Saved helpers */}
            <Card>
              <CardHeader icon={IcoUsers} title={t('dashboard.home.savedHelpers')} right={<Link to="/jobs" className="text-xs text-orange-400 font-medium">{t('dashboard.home.findHelp')}</Link>}/>
              {life.savedHelpers.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.home.noSavedHelpers')}</p>
              ) : (
                <div className="space-y-2">
                  {life.savedHelpers.map(h=>(
                    <div key={h.id} className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-xl group">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/30 to-purple-500/30 flex items-center justify-center font-bold text-sm flex-shrink-0">{(h.first_name||'?')[0]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{h.display_name || h.first_name}</p>
                        <p className="text-xs text-gray-500 truncate">{h.categories || t('dashboard.home.savedHelperFallback')} · {h.avg_rating?`${h.avg_rating}★`:t('dashboard.home.newHelper')} · {h.completed_jobs||0} {t('dashboard.home.jobsLabel')}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Link to={`/helpers/public/${h.helper_id}`} className="text-xs text-orange-400 font-medium">{t('common.viewAll')}</Link>
                        <button onClick={async()=>{await life.removeSavedHelper(h.id);toast.success(t('dashboard.home.removed'));}} className="opacity-0 group-hover:opacity-100 transition"><IcoTrash size={13} cls="text-gray-600 hover:text-red-400"/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>)}

        {/* ═══════ GOALS TAB ═══════ */}
        {tab==='goals' && (<>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Goals */}
            <Card>
              <CardHeader icon={IcoTarget} title={t('dashboard.goals.title')} right={<Btn onClick={()=>setShowGoalModal(true)}>{t('dashboard.goals.newGoal')}</Btn>}/>
              {life.goals.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.goals.noGoals')}</p>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {life.goals.map(g=>{
                    const pct = g.target_value > 0 ? Math.min((parseFloat(g.current_value)/parseFloat(g.target_value))*100, 100) : 0;
                    return (
                      <div key={g.id} className={`p-4 border rounded-xl transition ${g.is_completed?'border-emerald-500/30 bg-emerald-500/5 opacity-60':'border-gray-800'}`}>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-lg">{g.icon||'🎯'}</span>
                          <span className="font-semibold text-sm text-white flex-1">{g.title}</span>
                          <Tag text={g.goal_type||'financial'} color={g.goal_type==='task'?'blue':g.goal_type==='career'?'purple':'green'}/>
                          {g.is_completed ? <Tag text={t('dashboard.goals.doneBadge')} color="green"/> : g.target_value > 0 ? <span className="text-sm font-bold text-orange-400">{Math.round(pct)}%</span> : null}
                        </div>
                        {g.due_date && !g.is_completed && (() => {
                          const days = Math.ceil((new Date(g.due_date) - new Date()) / 86400000);
                          return <p className={`text-[10px] mb-2 ${days < 0 ? 'text-red-400' : days <= 7 ? 'text-orange-400' : 'text-gray-600'}`}>{days < 0 ? t('dashboard.goals.dOverdue', { n: Math.abs(days) }) : days === 0 ? t('dashboard.goals.dueToday') : t('dashboard.goals.dRemaining', { n: days })}</p>;
                        })()}
                        {g.target_value > 0 && !g.is_completed && (
                          <>
                            <ProgressBar pct={pct} color="bg-orange-500"/>
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-xs text-gray-500">${parseFloat(g.current_value).toLocaleString()} of ${parseFloat(g.target_value).toLocaleString()}</span>
                              <button onClick={()=>{setUpdatingGoal(g);setGoalUpdateValue(String(g.current_value||''));setShowGoalUpdateModal(true);}} className="text-[10px] text-orange-400 font-semibold">{t('dashboard.goals.updateProgress')}</button>
                            </div>
                          </>
                        )}
                        {!g.is_completed && !g.target_value && (
                          <button onClick={()=>life.updateGoal(g.id,{is_completed:true}).then(()=>{life.fetchSummary();toast.success(t('dashboard.goals.goalComplete'));})} className="text-[10px] text-emerald-400 font-semibold mt-1">{t('dashboard.goals.markComplete')}</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Checklist */}
            <Card>
              <CardHeader icon={IcoCheck} title={t('dashboard.goals.checklist')} right={<Btn onClick={()=>setShowChecklistModal(true)}>{t('common.add')}</Btn>}/>
              <p className="text-xs text-gray-600 mb-3">{t('dashboard.goals.completedOf', { completed: (life.checklist || []).filter(i=>i.is_completed).length, total: (life.checklist || []).length })}</p>
              {(life.checklist || []).length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">{t('dashboard.goals.noChecklist')}</p>
              ) : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {(life.checklist || []).map(item=>(
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition group">
                      <button onClick={()=>toggleChecklist(item)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${item.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                        {item.is_completed && <IcoCheck size={12} cls="text-gray-950"/>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${item.is_completed?'line-through text-gray-600':'text-white'}`}>{item.title}</p>
                        {item.due_date && <p className={`text-xs mt-0.5 ${new Date(item.due_date)<new Date()&&!item.is_completed?'text-red-400':'text-gray-600'}`}>{new Date(item.due_date).toLocaleDateString()}</p>}
                      </div>
                      <button onClick={async()=>{await life.deleteChecklistItem(item.id);life.fetchSummary();toast.success(t('dashboard.goals.itemRemoved'));}} className="opacity-0 group-hover:opacity-100"><IcoTrash size={14} cls="text-gray-600 hover:text-red-400"/></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>)}

        {/* ═══════ JOBS TAB ═══════ */}
        {tab==='jobs' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white text-lg">{t('dashboard.myJobs')}</h3>
              <Link to="/post-job" className="text-sm bg-action hover:bg-action-hover text-on-action font-semibold px-4 py-2 rounded-xl transition">{t('dashboard.postJob')}</Link>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                {label:t('dashboard.jobs.total'),      value:myJobs.length,                                                                  color:'text-white'},
                {label:t('dashboard.jobs.open'),       value:myJobs.filter(j=>['open','published'].includes(j.status)).length,               color:'text-emerald-400'},
                {label:t('dashboard.jobs.inProgress'), value:myJobs.filter(j=>j.status==='in_progress').length,                              color:'text-blue-400'},
                {label:t('dashboard.jobs.completed'),  value:myJobs.filter(j=>['completed','closed'].includes(j.status)).length,             color:'text-gray-400'},
              ].map((s,i)=>(
                <Card key={i} className="!p-3 text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{s.label}</p>
                </Card>
              ))}
            </div>
            {/* Filter buttons */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {[
                {id:'all',          label:t('dashboard.jobs.all')},
                {id:'open',         label:t('dashboard.jobs.open')},
                {id:'in_progress',  label:t('dashboard.jobs.inProgress')},
                {id:'completed',    label:t('dashboard.jobs.completed')},
                {id:'cancelled',    label:t('jobs.cancelled')},
              ].map(f=>(
                <button key={f.id} onClick={()=>setJobsFilter(f.id)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${jobsFilter===f.id?'bg-action text-on-action':'bg-gray-800 text-gray-400 hover:text-gray-300'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl animate-pulse">
                    <div className="space-y-2 flex-1 mr-4">
                      <div className="h-4 bg-gray-800 rounded w-3/4" />
                      <div className="h-3 bg-gray-800 rounded w-1/2" />
                    </div>
                    <div className="h-5 w-16 bg-gray-800 rounded-full" />
                  </div>
                ))}
              </div>
            ) : !Array.isArray(myJobs)||myJobs.length===0 ? (
              <Card className="p-16 text-center"><IcoBriefcase size={36} cls="text-gray-700 mx-auto mb-4"/><p className="text-gray-500 mb-4">{t('dashboard.jobs.noJobs')}</p>
                <Link to="/post-job" className="bg-action hover:bg-action-hover text-on-action font-semibold px-5 py-2.5 rounded-xl transition text-sm inline-block">{t('dashboard.jobs.postFirst')}</Link></Card>
            ) : (
              <div className="space-y-2">{myJobs.filter(job=>{
                if(jobsFilter==='all') return true;
                if(jobsFilter==='open') return ['open','published'].includes(job.status);
                if(jobsFilter==='completed') return ['completed','closed'].includes(job.status);
                return job.status===jobsFilter;
              }).map(job=>(
                <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-5 bg-gray-900/60 border border-gray-700/40 rounded-2xl hover:border-gray-600 transition group">
                  <div className="min-w-0 flex-1 mr-4"><p className="text-white font-medium group-hover:text-orange-400 transition truncate">{job.title}</p>
                    <p className="text-xs text-gray-500 mt-1 truncate">{job.category_name||job.category}{job.location_city?` · ${job.location_city}`:''}{job.budget_min||job.budget_max?` · $${job.budget_min||'?'}–$${job.budget_max||'?'}`:''}</p></div>
                  <div className="flex items-center gap-3 flex-shrink-0">{job.bid_count>0&&<span className="text-xs text-gray-500">{job.bid_count} bid{job.bid_count!==1?'s':''}</span>}
                    <Tag text={(job.status||'').replace(/_/g,' ')} color={job.status==='open'||job.status==='published'?'green':job.status==='in_progress'?'blue':job.status==='completed'||job.status==='closed'?'gray':'red'}/></div>
                </Link>
              ))}</div>
            )}
          </div>
        )}

        {/* ═══════ SKILLS & TOOLS ═══════ */}
        {tab==='skills' && (
          <div className="space-y-8">

            {/* ── Affiliate CTA ── */}
            <Link to="/affiliate" className="flex items-center justify-between bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 hover:bg-orange-500/15 transition group">
              <div>
                <p className="text-orange-400 font-semibold text-sm mb-0.5">Earn affiliate commissions</p>
                <p className="text-gray-400 text-xs">Share guide links and earn revenue from product referrals</p>
              </div>
              <IcoArrowR size={16} cls="text-orange-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
            </Link>

            {/* ── My Skills ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white text-lg">{t('dashboard.skillsTools.skillsTitle')}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{t('dashboard.skillsTools.skillsSub')}</p>
                </div>
                <Btn onClick={openAddSkill}><IcoPlus size={14} cls="text-white inline mr-1"/>{t('dashboard.skillsTools.addSkill')}</Btn>
              </div>

              {skillsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[1,2,3,4].map(i=>(
                    <div key={i} className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-4 animate-pulse">
                      <div className="h-4 bg-gray-800 rounded w-2/3 mb-2"/><div className="h-3 bg-gray-800 rounded w-1/2"/>
                    </div>
                  ))}
                </div>
              ) : mySkills.length === 0 ? (
                <Card className="p-12 text-center">
                  <IcoZap size={36} cls="text-gray-700 mx-auto mb-3"/>
                  <p className="text-gray-500 mb-1 font-medium">{t('dashboard.skillsTools.noSkills')}</p>
                  <p className="text-xs text-gray-600 mb-4">{t('dashboard.skillsTools.noSkillsSub')}</p>
                  <Btn onClick={openAddSkill}>{t('dashboard.skillsTools.listFirstSkill')}</Btn>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {mySkills.map(s => (
                    <Card key={s.id} className="relative group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-white text-sm truncate">{s.skill_name}</p>
                            {s.category && <span className="text-[10px] font-semibold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">{s.category}</span>}
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.is_available ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700/40 text-gray-500'}`}>
                              {s.is_available ? t('dashboard.skillsTools.available') : t('dashboard.skillsTools.unavailable')}
                            </span>
                          </div>
                          {s.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.description}</p>}
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            {s.hourly_rate && <span className="text-xs text-emerald-400 font-semibold">${parseFloat(s.hourly_rate).toFixed(0)}/hr</span>}
                            {s.years_exp !== null && s.years_exp !== undefined && <span className="text-xs text-gray-500">{s.years_exp} yr{s.years_exp!==1?'s':''} exp</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={()=>openEditSkill(s)} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700/50 transition"><IcoSettings size={14}/></button>
                          <button onClick={()=>handleDeleteSkill(s.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"><IcoTrash size={14}/></button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* ── My Tools for Rental ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white text-lg">{t('dashboard.skillsTools.toolsTitle')}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{t('dashboard.skillsTools.toolsSub')}</p>
                </div>
                <Btn onClick={openAddTool}><IcoPlus size={14} cls="text-white inline mr-1"/>{t('dashboard.skillsTools.addTool')}</Btn>
              </div>

              {toolsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[1,2,3].map(i=>(
                    <div key={i} className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-4 animate-pulse">
                      <div className="h-4 bg-gray-800 rounded w-3/4 mb-2"/><div className="h-3 bg-gray-800 rounded w-1/2 mb-2"/><div className="h-3 bg-gray-800 rounded w-1/3"/>
                    </div>
                  ))}
                </div>
              ) : myTools.length === 0 ? (
                <Card className="p-12 text-center">
                  <IcoSettings size={36} cls="text-gray-700 mx-auto mb-3"/>
                  <p className="text-gray-500 mb-1 font-medium">{t('dashboard.skillsTools.noTools')}</p>
                  <p className="text-xs text-gray-600 mb-4">{t('dashboard.skillsTools.noToolsSub')}</p>
                  <Btn onClick={openAddTool}>{t('dashboard.skillsTools.listFirstTool')}</Btn>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {myTools.map(tool => (
                    <Card key={tool.id}>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-white text-sm truncate">{tool.name}</p>
                          {(tool.brand||tool.model) && <p className="text-[11px] text-gray-500 truncate">{[tool.brand,tool.model].filter(Boolean).join(' · ')}</p>}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={()=>openEditTool(tool)} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700/50 transition"><IcoSettings size={14}/></button>
                          <button onClick={()=>handleDeleteTool(tool.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"><IcoTrash size={14}/></button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {tool.category && <span className="text-[10px] font-semibold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">{tool.category}</span>}
                        {tool.condition && <span className="text-[10px] font-semibold text-gray-400 bg-gray-800/60 px-2 py-0.5 rounded-full capitalize">{tool.condition}</span>}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tool.is_available ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700/40 text-gray-500'}`}>
                          {tool.is_available ? t('dashboard.skillsTools.available') : t('dashboard.skillsTools.unavailable')}
                        </span>
                      </div>

                      {tool.description && <p className="text-xs text-gray-500 mb-3 line-clamp-2">{tool.description}</p>}

                      <div className="flex items-center gap-3 flex-wrap text-sm">
                        {tool.daily_rate  && <span className="text-emerald-400 font-semibold">${parseFloat(tool.daily_rate).toFixed(0)}/day</span>}
                        {tool.hourly_rate && <span className="text-emerald-400 font-semibold">${parseFloat(tool.hourly_rate).toFixed(0)}/hr</span>}
                        {!tool.daily_rate && !tool.hourly_rate && <span className="text-gray-600 text-xs">{t('dashboard.skillsTools.contactForPricing')}</span>}
                      </div>

                      {(tool.location_city||tool.location_state) && (
                        <p className="text-[10px] text-gray-600 mt-2">{[tool.location_city,tool.location_state].filter(Boolean).join(', ')}</p>
                      )}

                      <div className="flex gap-2 mt-2 flex-wrap">
                        {tool.delivery_available && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">{t('dashboard.skillsTools.deliveryAvailable')}</span>}
                        {tool.requires_deposit  && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">{t('dashboard.skillsTools.depositRequired')}</span>}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

                {tab==='personalcare' && (
          <div className="space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {label:t('dashboard.personalCare.overdue'),      value:personalCareTasks.filter(task=>task.due_date&&task.due_date<localDateStr()&&!task.is_completed).length, color:'text-red-400'},
                {label:t('dashboard.personalCare.thisWeek'),     value:personalCareTasks.filter(task=>{if(!task.due_date||task.is_completed)return false;const end=localDateStr(new Date(Date.now()+7*864e5));return task.due_date>=localDateStr()&&task.due_date<=end;}).length, color:'text-orange-400'},
                {label:t('dashboard.personalCare.totalPending'), value:personalCareTasks.length, color:'text-blue-400'},
                {label:t('dashboard.personalCare.recurring'),    value:personalCareTasks.filter(task=>task.recurrence_days).length, color:'text-purple-400'},
              ].map((s,i)=>(
                <Card key={i} className="!p-3 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{s.label}</p>
                </Card>
              ))}
            </div>


            {/* Quick templates */}
            <Card>
              <CardHeader icon={IcoCalendar} title={t('dashboard.personalCare.quickAdd')}/>
              <div className="flex flex-wrap gap-2">
                {[
                  {title:'Annual Physical',     category:'Medical',       recurrence_days:365, urgency:'medium'},
                  {title:'Dentist Checkup',     category:'Dental',        recurrence_days:180, urgency:'medium'},
                  {title:'Eye Exam',            category:'Vision',        recurrence_days:365, urgency:'low'},
                  {title:'Therapy Session',     category:'Mental Health', recurrence_days:7,   urgency:'medium'},
                  {title:'Haircut',             category:'Grooming',      recurrence_days:30,  urgency:'low'},
                  {title:'Prescription Refill', category:'Pharmacy',      recurrence_days:30,  urgency:'high'},
                  {title:'Dermatologist',       category:'Medical',       recurrence_days:365, urgency:'low'},
                  {title:'Gym / Workout',       category:'Fitness',       recurrence_days:3,   urgency:'low'},
                ].map((t,i)=>(
                  <button key={i} onClick={()=>quickAddPcTask(t)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition">
                    {t.category==='Medical'?'🩺':t.category==='Dental'?'🦷':t.category==='Vision'?'👁️':t.category==='Mental Health'?'🧠':t.category==='Grooming'?'💇':t.category==='Pharmacy'?'💊':t.category==='Fitness'?'💪':'✨'} {t.title}
                  </button>
                ))}
              </div>
            </Card>

            {/* Appointment list */}
            <Card>
              <CardHeader icon={IcoHeart} title={t('dashboard.personalCare.title')} right={<Btn onClick={()=>setShowPcModal(true)}>{t('dashboard.personalCare.addAppointment')}</Btn>}/>
              {pcLoading ? (
                <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-800 rounded-xl animate-pulse"/>)}</div>
              ) : personalCareTasks.length===0 ? (
                <div className="text-center py-10">
                  <p className="text-4xl mb-3">💆</p>
                  <p className="text-gray-500 text-sm mb-1">{t('dashboard.personalCare.noAppointments')}</p>
                  <p className="text-xs text-gray-600">{t('dashboard.personalCare.noAppointmentsSub')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {personalCareTasks.map(pcTask=>{
                    const overdue=pcTask.due_date&&pcTask.due_date<localDateStr()&&!pcTask.is_completed;
                    const recLabel=pcTask.recurrence_days===7?t('dashboard.carCare.recWeekly'):pcTask.recurrence_days===30?t('dashboard.carCare.recMonthly'):pcTask.recurrence_days===180?t('dashboard.carCare.recEvery6mo'):pcTask.recurrence_days===365?t('dashboard.carCare.recAnnually'):pcTask.recurrence_days?t('dashboard.carCare.recEveryNDays',{n:pcTask.recurrence_days}):null;
                    return (
                      <div key={pcTask.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>togglePcTask(pcTask)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${pcTask.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {pcTask.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{pcTask.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {pcTask.description&&<span className="text-[10px] bg-gray-800/60 text-gray-400 px-1.5 py-0.5 rounded-full">{pcTask.description}</span>}
                            {pcTask.due_date&&<span className={`text-[10px] ${overdue?'text-red-400 font-semibold':'text-gray-600'}`}>{overdue?t('dashboard.personalCare.overdueDot'):''}{fullShortDateLabel(`${pcTask.due_date}T00:00:00`)}</span>}
                            {recLabel&&<span className="text-[10px] text-purple-400">↻ {recLabel}</span>}
                            {pcTask.home_name&&<span className="text-[10px] text-blue-400">🏠 {pcTask.home_name}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Tag text={pcTask.urgency} color={pcTask.urgency==='high'?'red':pcTask.urgency==='medium'?'orange':'gray'}/>
                          <Link to="/post-job" className="text-[10px] text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap">{t('dashboard.personalCare.book')}</Link>
                          <button onClick={()=>deletePcTask(pcTask.id)} className="text-gray-700 hover:text-red-400 transition"><IcoTrash size={13}/></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
        {tab==='carcare' && (
          <div className="space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {label:t('dashboard.carCare.overdue'),      value:carCareTasks.filter(task=>task.due_date&&task.due_date<localDateStr()&&!task.is_completed).length, color:'text-red-400'},
                {label:t('dashboard.carCare.thisWeek'),     value:carCareTasks.filter(task=>{if(!task.due_date||task.is_completed)return false;const end=localDateStr(new Date(Date.now()+7*864e5));return task.due_date>=localDateStr()&&task.due_date<=end;}).length, color:'text-orange-400'},
                {label:t('dashboard.carCare.totalPending'), value:carCareTasks.length, color:'text-blue-400'},
                {label:t('dashboard.carCare.recurring'),    value:carCareTasks.filter(task=>task.recurrence_days).length, color:'text-purple-400'},
              ].map((s,i)=>(
                <Card key={i} className="!p-3 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">{s.label}</p>
                </Card>
              ))}
            </div>

            {/* My Garage */}
            <Card>
              <CardHeader icon={IcoCar} title={t('dashboard.carCare.myGarage')}
                right={<span className="text-[10px] text-gray-600">{t('dashboard.carCare.nhtsaData')}</span>}/>

              {/* Mode tabs */}
              <div className="flex gap-1 mb-3 bg-gray-900 rounded-lg p-0.5 w-fit">
                <button onClick={()=>{setGarageMode('search');setVinResult(null);setVinError('');}}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${garageMode==='search'?'bg-gray-700 text-white':'text-gray-500 hover:text-gray-300'}`}>
                  {t('dashboard.carCare.search')}
                </button>
                <button onClick={()=>setGarageMode('vin')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${garageMode==='vin'?'bg-gray-700 text-white':'text-gray-500 hover:text-gray-300'}`}>
                  {t('dashboard.carCare.vin')}
                </button>
              </div>

              {garageMode === 'search' ? (
                /* ── Search mode: make → model typeahead ─────────────── */
                <div className="flex flex-wrap gap-2 mb-3">
                  <div className="relative flex-1 min-w-[140px]">
                    <input type="text" placeholder={t('dashboard.carCare.makePlaceholder')}
                      value={garageForm.makeSearch}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
                      onFocus={() => { loadMakesForGarage(); setShowMakeDD(true); }}
                      onChange={e => { setGarageForm(p=>({...p, makeSearch:e.target.value, selectedMake:null})); setShowMakeDD(true); }}
                      onBlur={() => setTimeout(()=>setShowMakeDD(false), 150)}
                      autoComplete="off"/>
                    {showMakeDD && allMakes.filter(m=>!garageForm.makeSearch||m.name.toLowerCase().includes(garageForm.makeSearch.toLowerCase())).slice(0,60).length > 0 && (
                      <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg max-h-48 overflow-y-auto shadow-xl text-sm">
                        {allMakes.filter(m=>!garageForm.makeSearch||m.name.toLowerCase().includes(garageForm.makeSearch.toLowerCase())).slice(0,60).map(m=>(
                          <li key={m.id} onMouseDown={()=>{ setGarageForm(p=>({...p,makeSearch:m.name,selectedMake:m,modelSearch:'',selectedModel:null})); setShowMakeDD(false); loadModelsForGarage(m.name); }}
                            className="px-3 py-2 hover:bg-gray-800 cursor-pointer text-gray-200 truncate">{m.name}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="relative flex-1 min-w-[140px]">
                    <input type="text"
                      placeholder={!garageForm.selectedMake ? t('dashboard.carCare.selectMakeFirst') : garageModelsLoading ? t('common.loading') : t('dashboard.carCare.modelPlaceholder')}
                      value={garageForm.modelSearch}
                      disabled={!garageForm.selectedMake || garageModelsLoading}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition disabled:opacity-50"
                      onFocus={() => garageForm.selectedMake && setShowModelDD(true)}
                      onChange={e => { setGarageForm(p=>({...p, modelSearch:e.target.value, selectedModel:null})); setShowModelDD(true); }}
                      onBlur={() => setTimeout(()=>setShowModelDD(false), 150)}
                      autoComplete="off"/>
                    {showModelDD && garageModels.filter(m=>!garageForm.modelSearch||m.modelName.toLowerCase().includes(garageForm.modelSearch.toLowerCase())).length > 0 && (
                      <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg max-h-48 overflow-y-auto shadow-xl text-sm">
                        {garageModels.filter(m=>!garageForm.modelSearch||m.modelName.toLowerCase().includes(garageForm.modelSearch.toLowerCase())).map(m=>(
                          <li key={m.modelId} onMouseDown={()=>{ setGarageForm(p=>({...p,modelSearch:m.modelName,selectedModel:m})); setShowModelDD(false); }}
                            className="px-3 py-2 hover:bg-gray-800 cursor-pointer text-gray-200 truncate">{m.modelName}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <select value={garageForm.year} onChange={e=>setGarageForm(p=>({...p,year:e.target.value}))}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition w-24">
                    <option value="">{t('dashboard.carCare.year')}</option>
                    {Array.from({length: new Date().getFullYear()-1885},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={y}>{y}</option>)}
                  </select>
                  <input type="text" placeholder={t('dashboard.carCare.nickname')} value={garageForm.nickname} maxLength={80}
                    onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition flex-1 min-w-[120px]"/>
                  <button onClick={addToGarage} disabled={garageAdding||!garageForm.selectedMake||!garageForm.selectedModel}
                    className="bg-action hover:bg-action-hover disabled:opacity-50 text-on-action text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                    {garageAdding ? t('dashboard.carCare.adding') : t('dashboard.carCare.addToGarage')}
                  </button>
                </div>
              ) : (
                /* ── VIN mode ────────────────────────────────────────── */
                <div className="mb-3 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={t('dashboard.carCare.vinPlaceholder')}
                      value={vinInput}
                      maxLength={17}
                      onChange={e => { setVinInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'')); setVinResult(null); setVinError(''); }}
                      onKeyDown={e => e.key==='Enter' && vinInput.length===17 && decodeVin()}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition font-mono tracking-widest uppercase"
                    />
                    <button onClick={decodeVin}
                      disabled={vinDecoding || vinInput.length !== 17}
                      className="bg-action hover:bg-action-hover disabled:opacity-50 text-on-action text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                      {vinDecoding ? t('dashboard.carCare.decoding') : t('dashboard.carCare.decode')}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-600">
                    {t('dashboard.carCare.vinHelp')}
                    {typeof BarcodeDetector !== 'undefined' && t('dashboard.carCare.cameraSupport')}
                  </p>
                  {vinError && <p className="text-xs text-red-400">{vinError}</p>}
                  {vinResult && vinResult.make && (
                    <div className="bg-gray-800/80 border border-orange-500/30 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">
                          {[vinResult.year, vinResult.make, vinResult.model].filter(Boolean).join(' ')}
                        </p>
                        <span className="text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">{t('dashboard.carCare.nhtsaVerified')}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
                        {vinResult.bodyClass    && <span>{t('dashboard.carCare.vinBodyLabel')} {vinResult.bodyClass}</span>}
                        {vinResult.cylinders    && <span>{t('dashboard.carCare.vinCylindersLabel')} {vinResult.cylinders}</span>}
                        {vinResult.displacement && <span>{t('dashboard.carCare.vinEngineLabel')} {vinResult.displacement}L</span>}
                        {vinResult.fuelType     && <span>{t('dashboard.carCare.vinFuelLabel')} {vinResult.fuelType}</span>}
                        {vinResult.driveType    && <span>{t('dashboard.carCare.vinDriveLabel')} {vinResult.driveType}</span>}
                        {vinResult.trim         && <span>{t('dashboard.carCare.vinTrimLabel')} {vinResult.trim}</span>}
                      </div>
                      <p className="text-[10px] text-gray-600 font-mono">{vinResult.vin}</p>
                      <div className="flex gap-2 pt-1">
                        <input type="text" placeholder={t('dashboard.carCare.nickname')} value={garageForm.nickname} maxLength={80}
                          onChange={e=>setGarageForm(p=>({...p,nickname:e.target.value}))}
                          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"/>
                        <button onClick={addVinVehicle} disabled={garageAdding}
                          className="bg-action hover:bg-action-hover disabled:opacity-50 text-on-action text-sm font-semibold px-4 py-1.5 rounded-lg transition whitespace-nowrap">
                          {garageAdding ? t('dashboard.carCare.adding') : t('dashboard.carCare.addToGarageBtn')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Saved vehicles */}
              {garageLoading ? (
                <div className="space-y-2">{[1,2].map(i=><div key={i} className="h-10 bg-gray-800 rounded-xl animate-pulse"/>)}</div>
              ) : garage.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-3">{t('dashboard.carCare.noVehicles')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {garage.map(v=>(
                    <div key={v.id} className="flex items-center gap-2 bg-gray-800/70 border border-gray-700 rounded-xl px-3 py-2">
                      <IcoCar size={13} cls="text-orange-400"/>
                      <div className="leading-tight">
                        <span className="text-sm text-white font-medium">{v.nickname || `${v.make_name} ${v.model_name}`}</span>
                        {v.nickname && <span className="text-[10px] text-gray-500 ml-1.5">{v.make_name} {v.model_name}</span>}
                        {v.year && <span className="text-[10px] text-orange-400 ml-1.5">{v.year}</span>}
                      </div>
                      <button onClick={()=>setGarageDeleteTarget(v)} className="text-gray-700 hover:text-red-400 transition ml-1"><IcoX size={12}/></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Delete confirm inline */}
              {garageDeleteTarget && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between gap-3">
                  <p className="text-sm text-red-300">{t('dashboard.carCare.removeConfirm', { name: garageDeleteTarget.nickname||`${garageDeleteTarget.make_name} ${garageDeleteTarget.model_name}` })}</p>
                  <div className="flex gap-2">
                    <button onClick={()=>setGarageDeleteTarget(null)} className="text-xs text-gray-400 hover:text-white transition px-2 py-1 rounded-lg">{t('dashboard.carCare.keepIt')}</button>
                    <button onClick={()=>deleteFromGarage(garageDeleteTarget.id)} className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition">{t('dashboard.carCare.removeBtn')}</button>
                  </div>
                </div>
              )}
            </Card>
            {/* Quick templates */}
            <Card>
              <CardHeader icon={IcoCalendar} title={t('dashboard.personalCare.quickAdd')}/>
              <div className="flex flex-wrap gap-2">
                {[
                  {title:'Oil Change',           category:'Oil Change',  recurrence_days:90,  urgency:'medium'},
                  {title:'Tire Rotation',         category:'Tires',       recurrence_days:180, urgency:'medium'},
                  {title:'Registration Renewal',  category:'Registration',recurrence_days:365, urgency:'high'},
                  {title:'State Inspection',      category:'Inspection',  recurrence_days:365, urgency:'high'},
                  {title:'Car Wash',              category:'Detailing',   recurrence_days:14,  urgency:'low'},
                  {title:'Battery Check',         category:'Battery',     recurrence_days:365, urgency:'medium'},
                  {title:'Brake Inspection',      category:'Brakes',      recurrence_days:365, urgency:'high'},
                  {title:'Check Tire Pressure',   category:'Tires',       recurrence_days:30,  urgency:'low'},
                ].map((t,i)=>(
                  <button key={i} onClick={()=>quickAddCcTask(t)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition">
                    {t.category==='Oil Change'?'🛢️':t.category==='Tires'?'🔄':t.category==='Registration'?'📋':t.category==='Inspection'?'🔍':t.category==='Detailing'?'🧼':t.category==='Battery'?'🔋':t.category==='Brakes'?'🔧':'🚗'} {t.title}
                  </button>
                ))}
              </div>
            </Card>

            {/* Maintenance log */}
            <Card>
              <CardHeader icon={IcoWrench} title={t('dashboard.carCare.maintenanceLog')} right={<Btn onClick={()=>setShowCcModal(true)}>{t('dashboard.carCare.addService')}</Btn>}/>
              {ccLoading ? (
                <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-800 rounded-xl animate-pulse"/>)}</div>
              ) : carCareTasks.length===0 ? (
                <div className="text-center py-10">
                  <p className="text-4xl mb-3">🚗</p>
                  <p className="text-gray-500 text-sm mb-1">{t('dashboard.carCare.noServices')}</p>
                  <p className="text-xs text-gray-600">{t('dashboard.carCare.noServicesSub')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {carCareTasks.map(ccTask=>{
                    const overdue=ccTask.due_date&&ccTask.due_date<localDateStr()&&!ccTask.is_completed;
                    const recLabel=ccTask.recurrence_days===90?t('dashboard.carCare.recQuarterly'):ccTask.recurrence_days===180?t('dashboard.carCare.recEvery6mo'):ccTask.recurrence_days===365?t('dashboard.carCare.recAnnually'):ccTask.recurrence_days===14?t('dashboard.carCare.recBiweekly'):ccTask.recurrence_days===30?t('dashboard.carCare.recMonthly'):ccTask.recurrence_days?t('dashboard.carCare.recEveryNDays',{n:ccTask.recurrence_days}):null;
                    return (
                      <div key={ccTask.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${overdue?'border-red-500/30 bg-red-500/5':'border-gray-800 hover:border-gray-700'}`}>
                        <button onClick={()=>toggleCcTask(ccTask)} className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border transition ${ccTask.is_completed?'bg-emerald-500 border-emerald-500':'border-gray-600 hover:border-orange-500'}`}>
                          {ccTask.is_completed&&<IcoCheck size={12} cls="text-gray-950"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{ccTask.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {ccTask.description&&<span className="text-[10px] bg-gray-800/60 text-gray-400 px-1.5 py-0.5 rounded-full">{ccTask.description}</span>}
                            {ccTask.due_date&&<span className={`text-[10px] ${overdue?'text-red-400 font-semibold':'text-gray-600'}`}>{overdue?t('dashboard.carCare.overdueDot'):''}{fullShortDateLabel(`${ccTask.due_date}T00:00:00`)}</span>}
                            {recLabel&&<span className="text-[10px] text-purple-400">↻ {recLabel}</span>}
                            {ccTask.vehicle_name&&<span className="text-[10px] text-yellow-400">🚗 {ccTask.vehicle_name}</span>}
                            {ccTask.home_name&&<span className="text-[10px] text-blue-400">🏠 {ccTask.home_name}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Tag text={ccTask.urgency} color={ccTask.urgency==='high'?'red':ccTask.urgency==='medium'?'orange':'gray'}/>
                          <Link to="/post-job" className="text-[10px] text-orange-400 hover:text-orange-300 font-semibold whitespace-nowrap">{t('dashboard.carCare.getHelp')}</Link>
                          <button onClick={()=>deleteCcTask(ccTask.id)} className="text-gray-700 hover:text-red-400 transition"><IcoTrash size={13}/></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}
        </main>
      

      {/* ── MODALS ──────────────────────────────────────────────── */}
      <Modal open={showExpenseModal} onClose={()=>setShowExpenseModal(false)} title={t('dashboard.money.modalLogTransaction')}>
        <form onSubmit={handleAddExpense} className="space-y-4">
          <Select label={t('dashboard.money.typeLabel')} value={expenseForm.type} onChange={e=>setExpenseForm(p=>({...p,type:e.target.value}))}>
            <option value="expense">{t('dashboard.money.expenseOption')}</option><option value="income">{t('dashboard.money.incomeOption')}</option>
          </Select>
          <Input label={t('dashboard.money.amountLabel')} type="number" step="0.01" min="0.01" required placeholder="0.00" value={expenseForm.amount} onChange={e=>setExpenseForm(p=>({...p,amount:e.target.value}))}/>
          <Input label={t('dashboard.money.categoryLabel')} required placeholder={t('dashboard.money.categoryPlaceholder')} value={expenseForm.category} onChange={e=>setExpenseForm(p=>({...p,category:e.target.value}))}/>
          <Input label={t('dashboard.money.descriptionOptLabel')} placeholder={t('dashboard.money.quickNotePlaceholder')} value={expenseForm.description} onChange={e=>setExpenseForm(p=>({...p,description:e.target.value}))}/>
          <Select label={t('dashboard.money.frequencyLabel')} value={expenseForm.frequency} onChange={e=>setExpenseForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!=='one_time'}))}>
            <option value="one_time">{t('dashboard.money.freqOneTime')}</option>
            <option value="daily">{t('dashboard.money.freqDaily')}</option>
            <option value="weekly">{t('dashboard.money.freqWeekly')}</option>
            <option value="bi_weekly">{t('dashboard.money.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.money.freqMonthly')}</option>
            <option value="quarterly">{t('dashboard.money.freqQuarterly')}</option>
            <option value="yearly">{t('dashboard.money.freqYearly')}</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.money.recurringLabel')}</label>
            <button type="button" onClick={()=>setExpenseForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&p.frequency==='one_time'?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${expenseForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${expenseForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{expenseForm.is_recurring?t('common.yes'):t('common.no')}</span>
          </div>
          {expenseForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('dashboard.money.startDateLabel')} type="date" value={expenseForm.recurring_start_date} onChange={e=>setExpenseForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label={t('dashboard.money.endDateLabel')} type="date" value={expenseForm.recurring_end_date} onChange={e=>setExpenseForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Btn className="w-full py-3" type="submit">{t('dashboard.money.saveTransaction')}</Btn>
        </form>
      </Modal>

      <Modal open={showGoalModal} onClose={()=>setShowGoalModal(false)} title={t('dashboard.goals.modalNewGoal')}>
        <form onSubmit={handleAddGoal} className="space-y-4">
          <Input label={t('dashboard.goals.goalTitleLabel')} required placeholder={t('dashboard.goals.goalTitlePlaceholder')} value={goalForm.title} onChange={e=>setGoalForm(p=>({...p,title:e.target.value}))}/>
          <Select label={t('dashboard.goals.goalTypeLabel')} value={goalForm.goal_type} onChange={e=>setGoalForm(p=>({...p,goal_type:e.target.value}))}>
            <option value="financial">{t('dashboard.goals.goalTypeFinancial')}</option><option value="task">{t('dashboard.goals.goalTypeTask')}</option><option value="career">{t('dashboard.goals.goalTypeCareer')}</option>
          </Select>
          {goalForm.goal_type==='financial' && <Input label={t('dashboard.goals.targetAmountLabel')} type="number" step="0.01" placeholder="1000" value={goalForm.target_value} onChange={e=>setGoalForm(p=>({...p,target_value:e.target.value}))}/>}
          <Input label={t('dashboard.goals.iconLabel')} placeholder="🎯" value={goalForm.icon} onChange={e=>setGoalForm(p=>({...p,icon:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">{t('dashboard.goals.createGoal')}</Btn>
        </form>
      </Modal>

      <Modal open={showHomeTaskModal} onClose={()=>setShowHomeTaskModal(false)} title={t('dashboard.goals.addHomeTaskModal')}>
        <form onSubmit={handleAddHomeTask} className="space-y-4">
          <Input label={t('dashboard.goals.taskLabel')} required placeholder={t('dashboard.goals.taskPlaceholder')} value={homeTaskForm.title} onChange={e=>setHomeTaskForm(p=>({...p,title:e.target.value}))}/>
          <Input label={t('dashboard.goals.dueDateLabel')} type="date" value={homeTaskForm.due_date} onChange={e=>setHomeTaskForm(p=>({...p,due_date:e.target.value}))}/>
          <Select label={t('dashboard.goals.urgencyLabel')} value={homeTaskForm.urgency} onChange={e=>setHomeTaskForm(p=>({...p,urgency:e.target.value}))}>
            <option value="low">{t('dashboard.goals.urgencyLow')}</option><option value="medium">{t('dashboard.goals.urgencyMedium')}</option><option value="high">{t('dashboard.goals.urgencyHigh')}</option>
          </Select>
          <Select label={t('dashboard.goals.freqLabel')} value={homeTaskForm.frequency} onChange={e=>setHomeTaskForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!=='one_time'}))}>
            <option value="one_time">{t('dashboard.goals.freqOneTime')}</option>
            <option value="weekly">{t('dashboard.goals.freqWeekly')}</option>
            <option value="bi_weekly">{t('dashboard.goals.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.goals.freqMonthly')}</option>
            <option value="quarterly">{t('dashboard.goals.freqQuarterly')}</option>
            <option value="yearly">{t('dashboard.goals.freqYearly')}</option>
          </Select>
          {homeTaskForm.is_recurring && (<>
            <Input label={t('dashboard.goals.repeatStartLabel')} type="date" value={homeTaskForm.recurring_start_date} onChange={e=>setHomeTaskForm(p=>({...p,recurring_start_date:e.target.value}))}/>
            <Input label={t('dashboard.goals.repeatEndLabel')} type="date" value={homeTaskForm.recurring_end_date} onChange={e=>setHomeTaskForm(p=>({...p,recurring_end_date:e.target.value}))}/>
          </>)}
          <Input label={t('dashboard.goals.estimatedCostLabel')} type="number" min="0" step="0.01" placeholder={t('dashboard.goals.estimatedCostPlaceholder')} value={homeTaskForm.estimated_cost} onChange={e=>setHomeTaskForm(p=>({...p,estimated_cost:e.target.value}))}/>
          {homes.length > 0 && (
            <Select label={t('dashboard.goals.propertyOptLabel')} value={homeTaskForm.home_id} onChange={e=>setHomeTaskForm(p=>({...p,home_id:e.target.value}))}>
              <option value="">{t('dashboard.goals.noSpecificProperty')}</option>
              {homes.map(h=><option key={h.id} value={h.id}>{h.nickname || h.address}</option>)}
            </Select>
          )}
          <Btn className="w-full py-3" type="submit">{t('dashboard.goals.addTaskBtn')}</Btn>
        </form>
      </Modal>

      <Modal open={showChecklistModal} onClose={()=>setShowChecklistModal(false)} title={t('dashboard.goals.addChecklistModal')}>
        <form onSubmit={handleAddChecklist} className="space-y-4">
          <Input label={t('dashboard.goals.checklistItemLabel')} required placeholder={t('dashboard.goals.checklistItemPlaceholder')} value={checklistForm.title} onChange={e=>setChecklistForm(p=>({...p,title:e.target.value}))}/>
          <Input label={t('dashboard.goals.dueDateOptLabel')} type="date" value={checklistForm.due_date} onChange={e=>setChecklistForm(p=>({...p,due_date:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">{t('dashboard.goals.addItemBtn')}</Btn>
        </form>
      </Modal>

      {/* ── Budget Modal ── */}
      <Modal open={showBudgetModal} onClose={()=>{setShowBudgetModal(false);setBudgetForm({category:'',period_amount:'',period:'monthly'})}} title={t('dashboard.money.modalSetBudget')}>
        <form onSubmit={async(e)=>{e.preventDefault();try{await life.upsertBudget({category:budgetForm.category,period_amount:parseFloat(budgetForm.period_amount),period:budgetForm.period});life.fetchBudgets();toast.success(t('dashboard.money.budgetSaved'));setShowBudgetModal(false);setBudgetForm({category:'',period_amount:'',period:'monthly'});}catch{toast.error(t('dashboard.money.budgetSaveFailed'));}}} className="space-y-4">
          <Select label={t('dashboard.money.categoryLabel')} required value={budgetForm.category} onChange={e=>setBudgetForm(p=>({...p,category:e.target.value}))}>
            <option value="">{t('dashboard.money.selectCategoryPlaceholder')}</option>
            {['Housing / Rent','Food & Dining','Transportation','Utilities','Healthcare','Entertainment','Shopping','Personal Care','Auto','Education','Subscriptions','Savings','Other'].map(c=><option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.money.amountLabel')} type="number" step="0.01" min="0.01" required placeholder="0.00" value={budgetForm.period_amount} onChange={e=>setBudgetForm(p=>({...p,period_amount:e.target.value}))}/>
            <Select label={t('dashboard.money.frequencyLabel')} value={budgetForm.period} onChange={e=>setBudgetForm(p=>({...p,period:e.target.value}))}>
              <option value="daily">{t('dashboard.money.freqDaily')}</option>
              <option value="weekly">{t('dashboard.money.freqWeekly')}</option>
              <option value="bi_weekly">{t('dashboard.money.freqBiweekly')}</option>
              <option value="monthly">{t('dashboard.money.freqMonthly')}</option>
              <option value="quarterly">{t('dashboard.money.freqQuarterly')}</option>
              <option value="yearly">{t('dashboard.money.freqYearly')}</option>
            </Select>
          </div>
          {budgetForm.period_amount && budgetForm.period !== 'monthly' && (
            <p className="text-xs text-gray-500">
              ≈ ${(parseFloat(budgetForm.period_amount||0) * ({daily:30,weekly:30/7,bi_weekly:30/14,monthly:1,quarterly:1/3,yearly:1/12}[budgetForm.period]||1)).toFixed(2)}/month
            </p>
          )}
          <Btn className="w-full py-3" type="submit">{t('dashboard.money.saveBudget')}</Btn>
        </form>
      </Modal>

      {/* ── Goal Update Modal ── */}
      <Modal open={showGoalUpdateModal} onClose={()=>{setShowGoalUpdateModal(false);setUpdatingGoal(null);}} title={t('dashboard.goals.modalUpdateProgress')}>
        {updatingGoal&&(
          <form onSubmit={async(e)=>{e.preventDefault();await updateGoalProgress(updatingGoal,goalUpdateValue);setShowGoalUpdateModal(false);setUpdatingGoal(null);}} className="space-y-4">
            <p className="text-sm text-gray-400 bg-gray-800/50 px-3 py-2 rounded-lg">{updatingGoal.icon} {updatingGoal.title}</p>
            <Input label={t('dashboard.goals.currentAmountLabel')} type="number" step="0.01" min="0" required autoFocus value={goalUpdateValue} onChange={e=>setGoalUpdateValue(e.target.value)} placeholder={`Was: $${parseFloat(updatingGoal.current_value||0).toLocaleString()}`}/>
            {updatingGoal.target_value&&<p className="text-xs text-gray-500">{t('dashboard.goals.targetProgress',{target:parseFloat(updatingGoal.target_value).toLocaleString(),pct:Math.round(Math.min((parseFloat(goalUpdateValue||0)/parseFloat(updatingGoal.target_value))*100,100))})}</p>}
            <div className="flex gap-2">
              <Btn className="flex-1 py-3" type="submit">{t('dashboard.money.saveProgress')}</Btn>
              <Btn variant="secondary" className="py-3" type="button" onClick={async()=>{await life.updateGoal(updatingGoal.id,{is_completed:true});life.fetchSummary();toast.success(t('dashboard.money.goalComplete'));setShowGoalUpdateModal(false);setUpdatingGoal(null);}}>{t('dashboard.money.markDone')}</Btn>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Personal Care Task Modal ── */}
      <Modal open={showPcModal} onClose={()=>setShowPcModal(false)} title={t('dashboard.personalCare.addModal')}>
        <form onSubmit={addPcTask} className="space-y-4">
          <Input label={t('dashboard.personalCare.apptServiceLabel')} required placeholder={t('dashboard.personalCare.apptServicePlaceholder')} value={pcForm.title} onChange={e=>setPcForm(p=>({...p,title:e.target.value}))}/>
          <Select label={t('dashboard.personalCare.categoryLabel')} value={pcForm.category} onChange={e=>setPcForm(p=>({...p,category:e.target.value}))}>
            <option value="Medical">{t('dashboard.personalCare.catMedical')}</option><option value="Dental">{t('dashboard.personalCare.catDental')}</option><option value="Vision">{t('dashboard.personalCare.catVision')}</option><option value="Mental Health">{t('dashboard.personalCare.catMentalHealth')}</option><option value="Grooming">{t('dashboard.personalCare.catGrooming')}</option><option value="Fitness">{t('dashboard.personalCare.catFitness')}</option><option value="Pharmacy">{t('dashboard.personalCare.catPharmacy')}</option><option value="Other">{t('dashboard.personalCare.catOther')}</option>
          </Select>
          <Input label={t('dashboard.personalCare.dateDueLabel')} type="date" value={pcForm.due_date} onChange={e=>setPcForm(p=>({...p,due_date:e.target.value}))}/>
          <Select label={t('dashboard.personalCare.priorityLabel')} value={pcForm.urgency} onChange={e=>setPcForm(p=>({...p,urgency:e.target.value}))}>
            <option value="low">{t('dashboard.goals.urgencyLow')}</option><option value="medium">{t('dashboard.goals.urgencyMedium')}</option><option value="high">{t('dashboard.goals.urgencyHigh')}</option>
          </Select>
          <Select label={t('dashboard.personalCare.freqLabel')} value={pcForm.frequency} onChange={e=>setPcForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!==''&&e.target.value!=='one_time'}))}>
            <option value="">{t('dashboard.personalCare.freqOneTimeUnspecified')}</option>
            <option value="daily">{t('dashboard.personalCare.freqDaily')}</option>
            <option value="weekly">{t('dashboard.personalCare.freqWeekly')}</option>
            <option value="bi_weekly">{t('dashboard.personalCare.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.personalCare.freqMonthly')}</option>
            <option value="quarterly">{t('dashboard.personalCare.freqQuarterly')}</option>
            <option value="yearly">{t('dashboard.personalCare.freqYearly')}</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.personalCare.recurringLabel')}</label>
            <button type="button" onClick={()=>setPcForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&!p.frequency?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${pcForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pcForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{pcForm.is_recurring?t('common.yes'):t('common.no')}</span>
          </div>
          {pcForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('dashboard.personalCare.startDateLabel')} type="date" value={pcForm.recurring_start_date} onChange={e=>setPcForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label={t('dashboard.personalCare.endDateLabel')} type="date" value={pcForm.recurring_end_date} onChange={e=>setPcForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Input label={t('dashboard.personalCare.estimatedCostLabel')} type="number" step="0.01" min="0" placeholder={t('dashboard.personalCare.estimatedCostPlaceholder')} value={pcForm.estimated_cost} onChange={e=>setPcForm(p=>({...p,estimated_cost:e.target.value}))}/>
          <Btn className="w-full py-3" type="submit">{t('dashboard.personalCare.addApptBtn')}</Btn>
        </form>
      </Modal>

      {/* ── Car Care Task Modal ── */}
      <Modal open={showCcModal} onClose={()=>setShowCcModal(false)} title={t('dashboard.carCare.addModal')}>
        <form onSubmit={addCcTask} className="space-y-4">
          {/* Link to a vehicle */}
          {garage.length > 0 && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.carCare.vehicleOptLabel')}</label>
              <select value={ccForm.vehicle_id} onChange={e=>setCcForm(p=>({...p,vehicle_id:e.target.value}))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none transition">
                <option value="">{t('dashboard.carCare.allVehicles')}</option>
                {garage.map(v=>(
                  <option key={v.id} value={v.id}>{v.nickname || `${v.make_name} ${v.model_name}`}{v.year ? ` (${v.year})` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <Input label={t('dashboard.carCare.serviceNameLabel')} required placeholder={t('dashboard.carCare.serviceNamePlaceholder')} value={ccForm.title} onChange={e=>setCcForm(p=>({...p,title:e.target.value}))}/>
          <Select label={t('dashboard.carCare.categoryLabel')} value={ccForm.category} onChange={e=>setCcForm(p=>({...p,category:e.target.value}))}>
            <option value="Oil Change">{t('dashboard.carCare.catOilChange')}</option><option value="Tires">{t('dashboard.carCare.catTires')}</option><option value="Brakes">{t('dashboard.carCare.catBrakes')}</option><option value="Inspection">{t('dashboard.carCare.catInspection')}</option><option value="Registration">{t('dashboard.carCare.catRegistration')}</option><option value="Detailing">{t('dashboard.carCare.catDetailing')}</option><option value="Battery">{t('dashboard.carCare.catBattery')}</option><option value="Fluids">{t('dashboard.carCare.catFluids')}</option><option value="AC / Heating">{t('dashboard.carCare.catAcHeating')}</option><option value="Other">{t('dashboard.carCare.catOther')}</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.carCare.dueDateLabel')} type="date" value={ccForm.due_date} onChange={e=>setCcForm(p=>({...p,due_date:e.target.value}))}/>
            <Select label={t('dashboard.carCare.priorityLabel')} value={ccForm.urgency} onChange={e=>setCcForm(p=>({...p,urgency:e.target.value}))}>
              <option value="low">{t('dashboard.goals.urgencyLow')}</option><option value="medium">{t('dashboard.goals.urgencyMedium')}</option><option value="high">{t('dashboard.goals.urgencyHigh')}</option>
            </Select>
          </div>
          <Select label={t('dashboard.carCare.freqLabel')} value={ccForm.frequency} onChange={e=>setCcForm(p=>({...p,frequency:e.target.value,is_recurring:e.target.value!==''&&e.target.value!=='one_time'}))}>
            <option value="">{t('dashboard.carCare.freqOneTimeUnspecified')}</option>
            <option value="daily">{t('dashboard.carCare.freqDaily')}</option>
            <option value="weekly">{t('dashboard.carCare.freqWeekly')}</option>
            <option value="bi_weekly">{t('dashboard.carCare.freqBiweekly')}</option>
            <option value="monthly">{t('dashboard.carCare.freqMonthly')}</option>
            <option value="quarterly">{t('dashboard.carCare.freqQuarterly')}</option>
            <option value="yearly">{t('dashboard.carCare.freqYearly')}</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{t('dashboard.carCare.recurringLabel')}</label>
            <button type="button" onClick={()=>setCcForm(p=>({...p,is_recurring:!p.is_recurring,frequency:!p.is_recurring&&!p.frequency?'monthly':p.frequency}))}
              className={`w-10 h-5 rounded-full transition-colors relative ${ccForm.is_recurring?'bg-orange-500':'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${ccForm.is_recurring?'translate-x-5':'translate-x-0.5'}`}/>
            </button>
            <span className="text-xs text-gray-400">{ccForm.is_recurring?t('common.yes'):t('common.no')}</span>
          </div>
          {ccForm.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('dashboard.carCare.startDateLabel')} type="date" value={ccForm.recurring_start_date} onChange={e=>setCcForm(p=>({...p,recurring_start_date:e.target.value}))}/>
              <Input label={t('dashboard.carCare.endDateLabel')} type="date" value={ccForm.recurring_end_date} onChange={e=>setCcForm(p=>({...p,recurring_end_date:e.target.value}))}/>
            </div>
          )}
          <Input label={t('dashboard.carCare.estimatedCostLabel')} type="number" step="0.01" min="0" placeholder={t('dashboard.carCare.estimatedCostPlaceholder')} value={ccForm.estimated_cost} onChange={e=>setCcForm(p=>({...p,estimated_cost:e.target.value}))}/>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.carCare.notesOptLabel')}</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.carCare.notesPlaceholder')} value={ccForm.description} onChange={e=>setCcForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <Btn className="w-full py-3" type="submit">{t('dashboard.carCare.addServiceBtn')}</Btn>
        </form>
      </Modal>

      {/* ── Add / Edit Skill Modal ── */}
      <Modal open={showSkillModal} onClose={()=>setShowSkillModal(false)} title={editingSkill ? t('dashboard.skillsTools.modalEditSkill') : t('dashboard.skillsTools.modalAddSkill')}>
        <form onSubmit={handleSaveSkill} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.skillNameLabel')}</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder={t('dashboard.skillsTools.skillNamePlaceholder')}
              required
              value={skillForm.skill_name}
              onChange={e => {
                setSkillForm(p => ({ ...p, skill_name: e.target.value }));
                setSkillSearch(e.target.value);
                if (e.target.value.length >= 2) searchSkillLookup(e.target.value);
                else setSkillLookup([]);
              }}
            />
            {skillLookup.length > 0 && (
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {skillLookup.map(s => (
                  <button key={s.id} type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition"
                    onClick={() => {
                      setSkillForm(p => ({ ...p, skill_name: s.name, category: s.category || p.category }));
                      setSkillSearch(s.name);
                      setSkillLookup([]);
                    }}
                  >
                    <span className="font-medium">{s.name}</span>
                    {s.category && <span className="text-[10px] text-gray-500 ml-2">{s.category}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.categoryLabel')}</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder={t('dashboard.skillsTools.skillCategoryPlaceholder')}
              value={skillForm.category}
              onChange={e => {
                setSkillForm(p => ({ ...p, category: e.target.value }));
                searchCatLookup(e.target.value);
              }}
              onBlur={() => setTimeout(() => setCatLookup([]), 150)}
            />
            {catLookup.length > 0 && (
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {catLookup.map(c => (
                  <button key={c} type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition"
                    onClick={() => { setSkillForm(p => ({ ...p, category: c })); setCatLookup([]); }}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.hourlyRateLabel')} type="number" step="0.01" min="0" placeholder="0.00" value={skillForm.hourly_rate} onChange={e=>setSkillForm(p=>({...p,hourly_rate:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.yearsExpLabel')} type="number" min="0" max="99" placeholder="0" value={skillForm.years_exp} onChange={e=>setSkillForm(p=>({...p,years_exp:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.descriptionOptLabel')}</label>
            <textarea rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.skillsTools.descriptionPlaceholder')} value={skillForm.description} onChange={e=>setSkillForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={skillForm.is_available} onChange={e=>setSkillForm(p=>({...p,is_available:e.target.checked}))} className="accent-orange-500"/>
            <span className="text-sm text-gray-400">{t('dashboard.skillsTools.availableForHire')}</span>
          </label>
          <Btn className="w-full py-3" type="submit">{editingSkill ? t('dashboard.skillsTools.saveChanges') : t('dashboard.skillsTools.addSkillBtn')}</Btn>
        </form>
      </Modal>

      {/* ── Add / Edit Tool Modal ── */}
      <Modal open={showToolModal} onClose={()=>setShowToolModal(false)} title={editingTool ? t('dashboard.skillsTools.modalEditTool') : t('dashboard.skillsTools.modalAddTool')}>
        <form onSubmit={handleSaveTool} className="space-y-4">
          <Input label={t('dashboard.skillsTools.toolNameLabel')} required placeholder={t('dashboard.skillsTools.toolNamePlaceholder')} value={toolForm.name} onChange={e=>setToolForm(p=>({...p,name:e.target.value}))}/>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.brandLabel')} placeholder={t('dashboard.skillsTools.brandPlaceholder')} value={toolForm.brand} onChange={e=>setToolForm(p=>({...p,brand:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.modelLabel')} placeholder={t('dashboard.skillsTools.modelPlaceholder')} value={toolForm.model} onChange={e=>setToolForm(p=>({...p,model:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.categoryLabel')}</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition"
              placeholder={t('dashboard.skillsTools.toolCategoryPlaceholder')}
              value={toolForm.category}
              onChange={e => {
                setToolForm(p => ({ ...p, category: e.target.value }));
                searchToolCatLookup(e.target.value);
              }}
              onBlur={() => setTimeout(() => setToolCatLookup([]), 150)}
            />
            {toolCatLookup.length > 0 && (
              <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {toolCatLookup.map(c => (
                  <button key={c} type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/60 hover:text-white transition"
                    onClick={() => { setToolForm(p => ({ ...p, category: c })); setToolCatLookup([]); }}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.dailyRateLabel')} type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.daily_rate} onChange={e=>setToolForm(p=>({...p,daily_rate:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.hourlyRateToolLabel')} type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.hourly_rate} onChange={e=>setToolForm(p=>({...p,hourly_rate:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('dashboard.skillsTools.conditionLabel')} value={toolForm.condition} onChange={e=>setToolForm(p=>({...p,condition:e.target.value}))}>
              <option value="excellent">{t('dashboard.skillsTools.conditionExcellent')}</option>
              <option value="good">{t('dashboard.skillsTools.conditionGood')}</option>
              <option value="fair">{t('dashboard.skillsTools.conditionFair')}</option>
              <option value="poor">{t('dashboard.skillsTools.conditionPoor')}</option>
            </Select>
            <Input label={t('dashboard.skillsTools.depositAmountLabel')} type="number" step="0.01" min="0" placeholder="0.00" value={toolForm.deposit_amount} onChange={e=>setToolForm(p=>({...p,deposit_amount:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dashboard.skillsTools.cityLabel')} placeholder={t('dashboard.skillsTools.cityPlaceholder')} value={toolForm.location_city} onChange={e=>setToolForm(p=>({...p,location_city:e.target.value}))}/>
            <Input label={t('dashboard.skillsTools.stateLabel')} placeholder={t('dashboard.skillsTools.statePlaceholder')} value={toolForm.location_state} onChange={e=>setToolForm(p=>({...p,location_state:e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">{t('dashboard.skillsTools.toolDescLabel')}</label>
            <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none transition resize-none" placeholder={t('dashboard.skillsTools.toolDescPlaceholder')} value={toolForm.description} onChange={e=>setToolForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.is_available} onChange={e=>setToolForm(p=>({...p,is_available:e.target.checked}))} className="accent-orange-500"/><span className="text-sm text-gray-400">{t('dashboard.skillsTools.availableForRental')}</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.requires_deposit} onChange={e=>setToolForm(p=>({...p,requires_deposit:e.target.checked}))} className="accent-orange-500"/><span className="text-sm text-gray-400">{t('dashboard.skillsTools.requireDeposit')}</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={toolForm.delivery_available} onChange={e=>setToolForm(p=>({...p,delivery_available:e.target.checked}))} className="accent-orange-500"/><span className="text-sm text-gray-400">{t('dashboard.skillsTools.offerDelivery')}</span></label>
          </div>
          <Btn className="w-full py-3" type="submit">{editingTool ? t('dashboard.skillsTools.saveChanges') : t('dashboard.skillsTools.listTool')}</Btn>
        </form>
      </Modal>
    </div>
    </PageShell>
  );
}
