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
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { getMyBusinesses } from '../api/vortex';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import {
  Building2, Plus, DollarSign, Users, Calendar, MessageSquare,
  TrendingUp, ArrowRight, AlertCircle, BarChart3,
} from 'lucide-react';

function fmtCurrency(cents, currency = 'USD') {
  if (cents == null || isNaN(cents)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function colorFromName(name) {
  // Deterministic accent color so each business card has a stable identity.
  const palette = ['#F97316', '#10B981', '#3B82F6', '#A855F7', '#EC4899', '#F59E0B', '#06B6D4'];
  let hash = 0;
  for (const c of String(name || '')) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function BusinessCard({ biz, currency, t }) {
  const accent = colorFromName(biz.business_name);
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
          <Link
            to={`/business/${biz.business_id || biz.id}/workspace`}
            className="text-base font-semibold truncate block hover:text-orange-400 transition"
          >
            {biz.business_name}
          </Link>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {biz.role && (
              <span className="px-1.5 py-0.5 rounded-md uppercase tracking-wider" style={{ background: 'rgba(148,163,184,0.1)' }}>
                {biz.role === 'owner' ? t('dashboards.businessOwner.owner', { defaultValue: 'Owner' }) : biz.role}
              </span>
            )}
            {biz.is_primary && (
              <span className="text-orange-400">{t('dashboards.businessOwner.primary', { defaultValue: 'Primary' })}</span>
            )}
          </div>
        </div>
      </header>

      <div className="px-5 py-4 flex-1 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <DollarSign size={11} /> {t('dashboards.businessOwner.mtdRevenue', { defaultValue: 'MTD revenue' })}
          </div>
          <div className="text-lg font-semibold mt-0.5">{fmtCurrency(biz.mtd_revenue_cents, currency)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <Calendar size={11} /> {t('dashboards.businessOwner.openJobs', { defaultValue: 'Open jobs' })}
          </div>
          <div className="text-lg font-semibold mt-0.5">{biz.open_jobs ?? '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <MessageSquare size={11} /> {t('dashboards.businessOwner.unread', { defaultValue: 'Unread inbox' })}
          </div>
          <div className="text-lg font-semibold mt-0.5">
            {biz.unread_messages ?? '—'}
            {biz.unread_messages > 0 && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <Users size={11} /> {t('dashboards.businessOwner.team', { defaultValue: 'Team' })}
          </div>
          <div className="text-lg font-semibold mt-0.5">{biz.member_count ?? '—'}</div>
        </div>
      </div>

      <footer className="px-5 py-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid var(--color-border)', background: 'rgba(148,163,184,0.03)' }}>
        <Link
          to={`/business/${biz.business_id || biz.id}/workspace`}
          className="text-xs font-semibold inline-flex items-center gap-1 hover:text-orange-400 transition"
          style={{ color: accent }}
        >
          {t('dashboards.businessOwner.open', { defaultValue: 'Open workspace' })} <ArrowRight size={12} />
        </Link>
        <Link
          to={`/business/${biz.business_id || biz.id}/workspace/analytics`}
          className="text-xs text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
        >
          <BarChart3 size={12} /> {t('dashboards.businessOwner.analytics', { defaultValue: 'Analytics' })}
        </Link>
      </footer>
    </article>
  );
}

export default function BusinessOwnerDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [businesses, setBusinesses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);

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
  useEffect(() => {
    if (!businesses.length || enrichLoading) return;
    setEnrichLoading(true);
    let cancelled = false;
    Promise.all(
      businesses.map(b =>
        api.get(`/businesses/${b.business_id || b.id}/analytics`)
          .then(r => ({ id: b.business_id || b.id, data: r.data }))
          .catch(() => ({ id: b.business_id || b.id, data: null })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setBusinesses(prev => prev.map(b => {
        const found = results.find(r => r.id === (b.business_id || b.id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businesses.length]);

  const totals = useMemo(() => {
    const mtd = businesses.reduce((s, b) => s + (Number(b.mtd_revenue_cents) || 0), 0);
    const open = businesses.reduce((s, b) => s + (Number(b.open_jobs) || 0), 0);
    const unread = businesses.reduce((s, b) => s + (Number(b.unread_messages) || 0), 0);
    return { mtd, open, unread, count: businesses.length };
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
              to="/consulting-intake"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
            >
              {t('dashboards.businessOwner.createFirst', { defaultValue: 'Create a business' })} <ArrowRight size={16} />
            </Link>
            <Link
              to="/vortex"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-semibold transition hover:bg-orange-500/5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {t('dashboards.businessOwner.joinExisting', { defaultValue: 'Join with a code' })}
            </Link>
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
            to="/consulting-intake"
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
              <DollarSign size={11} /> {t('dashboards.businessOwner.totalMtd', { defaultValue: 'Total MTD' })}
            </div>
            <div className="text-2xl font-bold mt-1">{fmtCurrency(totals.mtd, 'USD')}</div>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <Calendar size={11} /> {t('dashboards.businessOwner.totalOpen', { defaultValue: 'Open jobs' })}
            </div>
            <div className="text-2xl font-bold mt-1">{totals.open}</div>
          </div>
          <div
            className="rounded-xl border p-4"
            style={{
              borderColor: totals.unread > 0 ? 'rgba(249,115,22,0.4)' : 'var(--color-border)',
              background: totals.unread > 0 ? 'rgba(249,115,22,0.08)' : 'var(--color-surface)',
            }}
          >
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <AlertCircle size={11} /> {t('dashboards.businessOwner.unreadTotal', { defaultValue: 'Unread inbox' })}
            </div>
            <div className="text-2xl font-bold mt-1">{totals.unread}</div>
          </div>
        </section>

        {/* Per-business cards */}
        <section className={`grid gap-4 ${businesses.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
          {businesses.map((b) => (
            <BusinessCard
              key={b.business_id || b.id}
              biz={b}
              currency={'USD'}
              t={t}
            />
          ))}
        </section>

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
      </main>
      <Footer />
    </div>
  );
}
