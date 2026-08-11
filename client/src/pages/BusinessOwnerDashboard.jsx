// client/src/pages/BusinessOwnerDashboard.jsx
//
// First-screen experience for users in the `business_owner` mode. This is
// the *portfolio* view — distinct from BusinessHubPage which is a single
// workspace. An owner with 3 businesses lands here, sees all 3 side-by-side
// with their KPIs, and drills into the one they want to operate.
//
// Pulls from:
//   GET /me/businesses                      (unified owned + member list)
//   GET /businesses/:id/analytics           (per-business KPI snapshot)
//
// For users with exactly one business, we still render the portfolio shell
// (so the experience is consistent and the "Add another business" CTA is
// always visible) but it's a single card occupying the full row.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { getMyBusinesses } from '../api/vortex';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';
import {
  Building2, Plus, Users, Calendar, MessageSquare, UtensilsCrossed,
  Wrench, ArrowRight, AlertCircle, BarChart3, ClipboardList, Store,
  Settings2, Monitor,
} from 'lucide-react';

function colorFromName(name) {
  // Deterministic accent color so each business card has a stable identity.
  const palette = ['#F97316', '#10B981', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#06B6D4'];
  let hash = 0;
  for (const c of String(name || '')) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function getBusinessId(biz) {
  return biz.business_id || biz.id;
}

function getBusinessKind(biz) {
  return biz.business_kind || (biz.business_mode === 'food' ? 'restaurant' : 'service');
}

function restaurantWorkspacePath(biz, tab = 'home') {
  const params = new URLSearchParams({ business: String(getBusinessId(biz)) });
  if (tab !== 'home') params.set('tab', tab);
  return `/restaurants/merchant?${params.toString()}`;
}

function hasPermission(biz, requested) {
  if (biz.role === 'owner' || biz.permissions?.includes('*')) return true;
  return requested.some((permission) => biz.permissions?.includes(permission));
}

function getRestaurantReadiness(biz) {
  if (biz.setup_status !== 'active' || !biz.restaurant_id || biz.restaurant_status === 'draft') {
    return { key: 'setupNeeded', color: '#f59e0b' };
  }
  if (biz.restaurant_status === 'paused') return { key: 'paused', color: '#f97316' };
  if (biz.restaurant_status !== 'active') return { key: 'setupNeeded', color: '#f59e0b' };
  if (!biz.is_listed || biz.restaurant_discovery_status !== 'visible') {
    return { key: 'hidden', color: '#94a3b8' };
  }
  if (biz.restaurant_accepts_online_orders === false || biz.restaurant_is_accepting_orders_now === false) {
    return { key: 'ordersPaused', color: '#38bdf8' };
  }
  return { key: 'live', color: '#34d399' };
}

function BusinessCard({ biz, currency, t }) {
  const accent = colorFromName(biz.business_name);
  const businessId = getBusinessId(biz);
  const kind = getBusinessKind(biz);
  const isRestaurant = kind === 'restaurant';
  const workspaceHref = isRestaurant
    ? restaurantWorkspacePath(biz)
    : `/business/${businessId}/workspace`;
  const readiness = isRestaurant
    ? getRestaurantReadiness(biz)
    : { key: biz.setup_status === 'active' ? 'live' : 'setupNeeded', color: biz.setup_status === 'active' ? '#34d399' : '#f59e0b' };
  const roleKeys = {
    owner: 'owner',
    manager: 'roleManager',
    representative: 'roleRepresentative',
    employee: 'roleEmployee',
    support_agent: 'roleSupportAgent',
    member: 'member',
  };
  const roleLabel = t(`dashboards.businessOwner.${roleKeys[biz.role] || 'member'}`);
  const actionLinks = (isRestaurant ? [
    [restaurantWorkspacePath(biz, 'orders'), ClipboardList, t('dashboards.businessOwner.orders', { defaultValue: 'Orders' }), ['orders.view', 'orders.manage', 'kitchen.view', 'kitchen.update']],
    [restaurantWorkspacePath(biz, 'menu'), UtensilsCrossed, t('dashboards.businessOwner.menu', { defaultValue: 'Menu' }), ['menu.view', 'menu.manage']],
    [restaurantWorkspacePath(biz, 'store'), Settings2, t('dashboards.businessOwner.storeDevices', { defaultValue: 'Store & devices' }), ['settings.view', 'settings.manage', 'credit.manage', 'display.manage']],
    [biz.restaurant_id ? `/restaurants/queue/${biz.restaurant_id}` : restaurantWorkspacePath(biz, 'store'), Monitor, t('dashboards.businessOwner.queueBoard', { defaultValue: 'Queue board' }), ['display.view', 'display.manage']],
  ] : [
    [`/business/${businessId}/workspace/services`, Wrench, t('dashboards.businessOwner.services', { defaultValue: 'Services' }), ['business.view', 'business.edit_profile']],
    [`/business/${businessId}/workspace/clients`, Users, t('dashboards.businessOwner.clients', { defaultValue: 'Clients' }), ['clients.view', 'clients.manage', 'business.view']],
    [`/business/${businessId}/workspace/calendar`, Calendar, t('dashboards.businessOwner.schedule', { defaultValue: 'Schedule' }), ['calendar.view_all', 'calendar.view_self', 'calendar.manage_all', 'calendar.manage_self']],
    [`/business/${businessId}/workspace/messages`, MessageSquare, t('dashboards.businessOwner.messages', { defaultValue: 'Messages' }), ['messages.view_all', 'messages.view_assigned', 'messages.reply']],
  ]).filter(([, , , permissions]) => hasPermission(biz, permissions));
  const initials = String(biz.business_name || '?')
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <article
      className="rounded-xl border overflow-hidden flex flex-col"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <header className="px-5 pt-4 pb-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
          style={{ background: `${accent}22`, color: accent }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          {actionLinks.length > 0 ? (
            <Link
              to={workspaceHref}
              className="text-base font-semibold truncate block hover:text-orange-400 transition"
            >
              {biz.business_name}
            </Link>
          ) : (
            <span className="text-base font-semibold truncate block">{biz.business_name}</span>
          )}
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: accent }}>
              {isRestaurant ? <UtensilsCrossed size={11} /> : <Wrench size={11} />}
              {isRestaurant
                ? t('dashboards.businessOwner.restaurant', { defaultValue: 'Restaurant' })
                : t('dashboards.businessOwner.serviceBusiness', { defaultValue: 'Service business' })}
            </span>
            {biz.role && (
              <span className="px-1.5 py-0.5 rounded-md uppercase tracking-wider" style={{ background: 'rgba(148,163,184,0.1)' }}>
                {roleLabel}
              </span>
            )}
            {biz.is_primary && (
              <span className="text-orange-400">{t('dashboards.businessOwner.primary', { defaultValue: 'Primary' })}</span>
            )}
          </div>
        </div>
      </header>

      <div className="px-5 pt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <AlertCircle size={11} /> {t('dashboards.businessOwner.readiness', { defaultValue: 'Readiness' })}
          </div>
          <div className="text-sm font-semibold mt-1" style={{ color: readiness.color }}>
            {t(`dashboards.businessOwner.${readiness.key}`)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <Calendar size={11} /> {isRestaurant
              ? t('dashboards.businessOwner.currency', { defaultValue: 'Currency' })
              : t('dashboards.businessOwner.openJobs', { defaultValue: 'Open work' })}
          </div>
          <div className="text-lg font-semibold mt-0.5">{isRestaurant ? currency : (biz.open_jobs ?? '—')}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            {isRestaurant ? <Store size={11} /> : <MessageSquare size={11} />} {isRestaurant
              ? t('dashboards.businessOwner.customerStore', { defaultValue: 'Customer store' })
              : t('dashboards.businessOwner.unread', { defaultValue: 'Unread inbox' })}
          </div>
          {isRestaurant ? (
            <div className="text-sm font-semibold mt-1" style={{ color: readiness.color }}>
              {t(`dashboards.businessOwner.${readiness.key}`)}
            </div>
          ) : (
            <div className="text-lg font-semibold mt-0.5">
              {biz.unread_messages ?? '—'}
              {biz.unread_messages > 0 && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <Users size={11} /> {t('dashboards.businessOwner.team', { defaultValue: 'Team' })}
          </div>
          <div className="text-lg font-semibold mt-0.5">{biz.member_count ?? '—'}</div>
        </div>
      </div>

      <div className="px-5 py-4 grid grid-cols-2 gap-2 flex-1">
        {actionLinks.map(([to, Icon, label]) => (
          <Link
            key={label}
            to={to}
            className="min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold inline-flex items-center gap-2 transition hover:bg-orange-500/5"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <Icon size={14} style={{ color: accent }} /> {label}
          </Link>
        ))}
        {actionLinks.length === 0 && (
          <p className="col-span-2 text-xs py-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('dashboards.businessOwner.noAuthorizedActions')}
          </p>
        )}
      </div>

      <footer className="px-5 py-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid var(--color-border)', background: 'rgba(148,163,184,0.03)' }}>
        {actionLinks.length > 0 ? (
          <Link
            to={workspaceHref}
            className="text-xs font-semibold inline-flex items-center gap-1 hover:text-orange-400 transition"
            style={{ color: accent }}
          >
            {isRestaurant
              ? t('dashboards.businessOwner.manageRestaurant', { defaultValue: 'Manage restaurant' })
              : t('dashboards.businessOwner.openServiceWorkspace', { defaultValue: 'Open service workspace' })} <ArrowRight size={12} />
          </Link>
        ) : <span />}
        {isRestaurant && biz.restaurant_id && biz.is_listed && biz.restaurant_discovery_status === 'visible' ? (
          <Link
            to={`/restaurants/r/${biz.restaurant_id}`}
            className="text-xs hover:text-orange-300 inline-flex items-center gap-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Store size={12} /> {t('dashboards.businessOwner.viewStore', { defaultValue: 'View store' })}
          </Link>
        ) : LAUNCH_VISIBILITY.businessHubGrowthTools ? (
          <Link
            to={`/business/${businessId}/workspace/analytics`}
            className="text-xs text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
          >
            <BarChart3 size={12} /> {t('dashboards.businessOwner.analytics', { defaultValue: 'Analytics' })}
          </Link>
        ) : null}
      </footer>
    </article>
  );
}

export default function BusinessOwnerDashboard() {
  const { t } = useTranslation();

  const [businesses, setBusinesses] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // 1. Load the unified business list (cheap — one round-trip).
  useEffect(() => {
    let cancelled = false;
    getMyBusinesses()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setBusinesses(items.filter(b => b.status === 'active'));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setBusinesses([]);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // 2. Lazy-enrich each business with its analytics snapshot. Fail silent
  //    per business so one bad workspace doesn't poison the portfolio view.
  const serviceBusinessIds = useMemo(
    () => businesses.filter((b) => getBusinessKind(b) === 'service').map(getBusinessId).join(','),
    [businesses],
  );

  useEffect(() => {
    if (!serviceBusinessIds) return undefined;
    let cancelled = false;
    Promise.all(
      serviceBusinessIds.split(',').map((id) =>
        api.get(`/businesses/${id}/analytics`)
          .then(r => ({ id: String(id), data: r.data }))
          .catch(() => ({ id: String(id), data: null })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setBusinesses(prev => prev.map(b => {
        const found = results.find(r => r.id === String(getBusinessId(b)));
        if (!found?.data) return b;
        const a = found.data.analytics || found.data;
        return {
          ...b,
          mtd_revenue_cents: a.mtd_revenue_cents ?? a.month_revenue_cents ?? a.revenue_cents,
          open_jobs: a.open_jobs ?? a.active_jobs ?? a.pending_jobs,
          unread_messages: a.unread_messages ?? a.unread_inbox,
          member_count: a.member_count ?? a.team_size,
        };
      }));
    });
    return () => { cancelled = true; };
  }, [serviceBusinessIds]);

  const totals = useMemo(() => {
    const restaurants = businesses.filter((b) => getBusinessKind(b) === 'restaurant').length;
    const services = businesses.filter((b) => getBusinessKind(b) === 'service').length;
    const attention = businesses.filter((b) => (
      getBusinessKind(b) === 'restaurant'
        ? getRestaurantReadiness(b).key !== 'live'
        : b.setup_status !== 'active'
    )).length;
    return { restaurants, services, attention, count: businesses.length };
  }, [businesses]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)' }}>
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
        </main>
        <Footer />
      </div>
    );
  }

  // Empty state — owner hasn't created their first business yet.
  if (businesses.length === 0) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
        <Navbar />
        <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-16 flex flex-col gap-6 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mx-auto" style={{ background: 'rgba(249,115,22,0.12)' }}>
            <Building2 size={32} className="text-orange-500" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('dashboards.businessOwner.emptyTitle', { defaultValue: "Let's launch your first business" })}
          </h1>
          <p className="text-base" style={{ color: 'var(--color-text-muted)' }}>
            {t('dashboards.businessOwner.emptySubtitle', { defaultValue: 'Set up a workspace to run your operations, manage clients and team, and track finances.' })}
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link
              to="/business-hub"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
            >
              {t('dashboards.businessOwner.createFirst', { defaultValue: 'Create a business' })} <ArrowRight size={16} />
            </Link>
            {LAUNCH_VISIBILITY.vortexWorkspaceEntry && (
              <Link
                to="/vortex"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-semibold transition hover:bg-orange-500/5"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {t('dashboards.businessOwner.joinExisting', { defaultValue: 'Join with a code' })}
              </Link>
            )}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
      <Navbar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <section className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t('dashboards.businessOwner.title', { defaultValue: 'Your businesses' })}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
              {totals.count === 1
                ? t('dashboards.businessOwner.subtitleSingular', { defaultValue: 'Operate your workspace and track performance.' })
                : t('dashboards.businessOwner.subtitlePlural', { count: totals.count, defaultValue: `${totals.count} workspaces. Switch between them or open the one that needs you.` })}
            </p>
          </div>
          <Link
            to="/business-hub"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
          >
            <Plus size={16} /> {t('dashboards.businessOwner.addBusiness', { defaultValue: 'Add a business' })}
          </Link>
        </section>

        {/* Portfolio rollup */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <Building2 size={11} /> {t('dashboards.businessOwner.workspaces', { defaultValue: 'Workspaces' })}
            </div>
            <div className="text-2xl font-bold mt-1">{totals.count}</div>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <UtensilsCrossed size={11} /> {t('dashboards.businessOwner.restaurants', { defaultValue: 'Restaurants' })}
            </div>
            <div className="text-2xl font-bold mt-1">{totals.restaurants}</div>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <Wrench size={11} /> {t('dashboards.businessOwner.serviceBusinesses', { defaultValue: 'Service businesses' })}
            </div>
            <div className="text-2xl font-bold mt-1">{totals.services}</div>
          </div>
          <div
            className="rounded-xl border p-4"
            style={{
              borderColor: totals.attention > 0 ? 'rgba(249,115,22,0.4)' : 'var(--color-border)',
              background: totals.attention > 0 ? 'rgba(249,115,22,0.08)' : 'var(--color-surface)',
            }}
          >
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <AlertCircle size={11} /> {t('dashboards.businessOwner.needsAttention', { defaultValue: 'Needs setup' })}
            </div>
            <div className="text-2xl font-bold mt-1">{totals.attention}</div>
          </div>
        </section>

        {/* Per-business cards */}
        <section className={`grid gap-4 ${businesses.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
          {businesses.map((b) => (
            <BusinessCard
              key={b.business_id || b.id}
              biz={b}
              currency={b.currency_code || 'USD'}
              t={t}
            />
          ))}
        </section>

        {LAUNCH_VISIBILITY.businessHubGrowthTools && (
          <section className="rounded-xl border p-5 flex items-center gap-4 flex-wrap" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <TrendingUp size={20} className="text-orange-500" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                {t('dashboards.businessOwner.growHero', { defaultValue: 'Looking to grow?' })}
              </div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('dashboards.businessOwner.growSubtitle', { defaultValue: 'Connect with a consultant, open a new market, or apply to franchise OxSteed.' })}
              </div>
            </div>
            <Link
              to="/consulting"
              className="text-xs font-semibold px-3 py-2 rounded-md border hover:bg-orange-500/5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {t('dashboards.businessOwner.talkConsultant', { defaultValue: 'Talk to a consultant' })}
            </Link>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
