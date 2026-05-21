// client/src/pages/ToolOwnerDashboard.jsx
//
// First-screen experience for users in the `tool_owner` mode. Operator view
// over the tool-rental listings you own and the bookings they generate.
//
// Backend endpoints used (all already in /api/tool-rentals):
//   GET  /tool-rentals/me                    listings I own
//   GET  /tool-rentals/bookings/owner        bookings on listings I own
//   GET  /tool-rentals/:id/analytics         per-tool views/conversions
//
// Pending booking requests, upcoming pickups/returns this week, last-30-day
// gross earnings, and average rating are all derived client-side from the
// bookings list to avoid needing new server endpoints.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import {
  Wrench, Package, Clock, DollarSign, Star, TrendingUp,
  CheckCircle2, AlertCircle, Plus, ArrowRight,
} from 'lucide-react';

function fmtCurrency(cents, currency = 'USD') {
  if (cents == null || isNaN(cents)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function withinNextDays(iso, days) {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  const now = Date.now();
  return d >= now && d <= now + days * 24 * 60 * 60 * 1000;
}

function StatTile({ icon, label, value, hint, accent = false }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: accent ? 'rgba(249,115,22,0.4)' : 'var(--color-border, #1f2937)',
        background: accent ? 'rgba(249,115,22,0.08)' : 'var(--color-surface, rgba(17,24,39,0.6))',
      }}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold" style={{ color: 'var(--color-text, #f3f4f6)' }}>{value}</div>
      {hint && <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{hint}</div>}
    </div>
  );
}

export default function ToolOwnerDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currency = user?.preferred_currency || 'USD';

  const [listings, setListings] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const safe = (url) => api.get(url).then(r => r.data).catch(() => null);
    Promise.all([
      safe('/tool-rentals/me'),
      safe('/tool-rentals/bookings/owner'),
    ]).then(([l, b]) => {
      if (cancelled) return;
      setListings(Array.isArray(l?.tools) ? l.tools : (Array.isArray(l) ? l : []));
      setBookings(Array.isArray(b?.bookings) ? b.bookings : (Array.isArray(b) ? b : []));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const activeListings = listings.filter(l => l.is_active !== false).length;
    const pending = bookings.filter(b => b.status === 'pending' || b.status === 'requested').length;
    // Pickups/returns in the next 7 days
    const upcomingPickups = bookings.filter(b => b.status === 'confirmed' && withinNextDays(b.start_date || b.start_at, 7)).length;
    const upcomingReturns = bookings.filter(b => b.status === 'in_progress' && withinNextDays(b.end_date || b.end_at, 7)).length;
    // Last 30 days completed bookings → gross earnings in cents
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const earnings30 = bookings
      .filter(b => (b.status === 'completed' || b.status === 'paid') && new Date(b.completed_at || b.end_date || b.created_at).getTime() >= thirtyDaysAgo)
      .reduce((sum, b) => sum + (Number(b.amount_cents) || Math.round((Number(b.total_amount) || 0) * 100)), 0);
    // Avg rating across listings (server side calc on each tool row)
    const rated = listings.filter(l => l.avg_rating != null && l.review_count > 0);
    const avgRating = rated.length === 0
      ? null
      : (rated.reduce((s, l) => s + (Number(l.avg_rating) || 0) * (Number(l.review_count) || 0), 0) /
         rated.reduce((s, l) => s + (Number(l.review_count) || 0), 0));
    return { activeListings, pending, upcomingPickups, upcomingReturns, earnings30, avgRating };
  }, [listings, bookings]);

  const pendingRequests = useMemo(
    () => bookings.filter(b => b.status === 'pending' || b.status === 'requested').slice(0, 5),
    [bookings],
  );
  const upcomingHandoffs = useMemo(() => {
    return bookings
      .filter(b => (b.status === 'confirmed' && withinNextDays(b.start_date || b.start_at, 7))
                || (b.status === 'in_progress' && withinNextDays(b.end_date || b.end_at, 7)))
      .sort((a, b) => new Date(a.start_date || a.start_at) - new Date(b.start_date || b.start_at))
      .slice(0, 6);
  }, [bookings]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
      <Navbar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <section className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t('dashboards.toolOwner.title', { defaultValue: 'Tool rentals' })}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
              {t('dashboards.toolOwner.subtitle', { defaultValue: 'Manage your listings, approve bookings, track pickups & returns.' })}
            </p>
          </div>
          <Link
            to="/profile/tool-rentals/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
          >
            <Plus size={16} /> {t('dashboards.toolOwner.listTool', { defaultValue: 'List a new tool' })}
          </Link>
        </section>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={<Package size={14} />} label={t('dashboards.toolOwner.activeListings', { defaultValue: 'Active listings' })} value={stats.activeListings} />
          <StatTile
            icon={<AlertCircle size={14} />}
            label={t('dashboards.toolOwner.pending', { defaultValue: 'Pending requests' })}
            value={stats.pending}
            accent={stats.pending > 0}
            hint={stats.pending > 0 ? t('dashboards.toolOwner.pendingHint', { defaultValue: 'Approve or decline' }) : null}
          />
          <StatTile
            icon={<Clock size={14} />}
            label={t('dashboards.toolOwner.thisWeek', { defaultValue: 'This week' })}
            value={stats.upcomingPickups + stats.upcomingReturns}
            hint={`${stats.upcomingPickups} pickups · ${stats.upcomingReturns} returns`}
          />
          <StatTile
            icon={<DollarSign size={14} />}
            label={t('dashboards.toolOwner.earnings30', { defaultValue: '30-day earnings' })}
            value={fmtCurrency(stats.earnings30, currency)}
            hint={t('dashboards.toolOwner.earningsHint', { defaultValue: 'Gross, before fees' })}
          />
        </div>

        {stats.avgRating != null && (
          <div className="rounded-xl border p-4 flex items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <Star size={20} className="text-orange-500" />
            <div className="flex-1">
              <div className="text-sm font-semibold">{stats.avgRating.toFixed(1)} / 5</div>
              <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('dashboards.toolOwner.avgRating', { defaultValue: 'Average rating across your listings' })}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <header className="px-5 pt-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-orange-500" />
                <h3 className="text-sm font-semibold">{t('dashboards.toolOwner.pendingRequests', { defaultValue: 'Pending requests' })}</h3>
              </div>
              {bookings.filter(b => b.status === 'pending').length > 0 && (
                <Link to="/profile/tool-rentals/bookings" className="text-xs text-orange-400 hover:text-orange-300">
                  {t('common.viewAll', { defaultValue: 'View all' })}
                </Link>
              )}
            </header>
            <div className="px-5 pb-5">
              {pendingRequests.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {loaded
                    ? t('dashboards.toolOwner.noPending', { defaultValue: 'No pending requests right now.' })
                    : t('common.loading', { defaultValue: 'Loading...' })}
                </div>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {pendingRequests.map((b) => (
                    <li key={b.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{b.tool_name || b.tool_title || `Booking #${b.id}`}</div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {b.start_date ? new Date(b.start_date).toLocaleDateString() : ''}
                          {b.end_date ? ` → ${new Date(b.end_date).toLocaleDateString()}` : ''}
                          {b.renter_name ? ` · ${b.renter_name}` : ''}
                        </div>
                      </div>
                      <Link
                        to={`/profile/tool-rentals/bookings/${b.id}`}
                        className="text-xs px-2.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold flex-shrink-0"
                      >
                        {t('common.review', { defaultValue: 'Review' })}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <header className="px-5 pt-4 pb-2 flex items-center gap-2">
              <Clock size={16} className="text-orange-500" />
              <h3 className="text-sm font-semibold">{t('dashboards.toolOwner.upcomingHandoffs', { defaultValue: 'Upcoming pickups & returns' })}</h3>
            </header>
            <div className="px-5 pb-5">
              {upcomingHandoffs.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {loaded
                    ? t('dashboards.toolOwner.noHandoffs', { defaultValue: 'Nothing scheduled in the next 7 days.' })
                    : t('common.loading', { defaultValue: 'Loading...' })}
                </div>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {upcomingHandoffs.map((b) => {
                    const isReturn = b.status === 'in_progress';
                    const when = isReturn ? (b.end_date || b.end_at) : (b.start_date || b.start_at);
                    return (
                      <li key={b.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">
                            <span className={`text-[10px] uppercase tracking-wider mr-2 ${isReturn ? 'text-blue-400' : 'text-green-400'}`}>
                              {isReturn ? t('dashboards.toolOwner.return', { defaultValue: 'Return' }) : t('dashboards.toolOwner.pickup', { defaultValue: 'Pickup' })}
                            </span>
                            {b.tool_name || b.tool_title || `#${b.id}`}
                          </div>
                          <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                            {when ? new Date(when).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                            {b.renter_name ? ` · ${b.renter_name}` : ''}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <header className="px-5 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench size={16} className="text-orange-500" />
              <h3 className="text-sm font-semibold">{t('dashboards.toolOwner.yourListings', { defaultValue: 'Your listings' })}</h3>
            </div>
            <Link to="/profile/tool-rentals" className="text-xs text-orange-400 hover:text-orange-300">
              {t('common.manage', { defaultValue: 'Manage' })}
            </Link>
          </header>
          <div className="px-5 pb-5">
            {listings.length === 0 ? (
              <div className="text-xs flex items-center gap-3 py-4" style={{ color: 'var(--color-text-muted)' }}>
                <span>{loaded ? t('dashboards.toolOwner.noListings', { defaultValue: "You haven't listed any tools yet." }) : t('common.loading', { defaultValue: 'Loading...' })}</span>
                <Link to="/profile/tool-rentals/new" className="text-orange-400 hover:text-orange-300 inline-flex items-center gap-1">
                  {t('dashboards.toolOwner.listFirst', { defaultValue: 'List your first tool' })} <ArrowRight size={12} />
                </Link>
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {listings.slice(0, 6).map((l) => (
                  <li key={l.id} className="rounded-lg border p-3 hover:bg-orange-500/5 transition" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="text-sm font-semibold truncate">{l.title || l.name}</div>
                    <div className="text-[11px] mt-1 flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
                      {l.daily_rate_cents != null && <span>{fmtCurrency(l.daily_rate_cents, currency)} / day</span>}
                      {l.avg_rating != null && l.review_count > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Star size={11} className="text-orange-400" />
                          {Number(l.avg_rating).toFixed(1)}
                        </span>
                      )}
                    </div>
                    <Link to={`/profile/tool-rentals/${l.id}`} className="text-[11px] text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 mt-2">
                      {t('common.edit', { defaultValue: 'Edit' })} <ArrowRight size={11} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
