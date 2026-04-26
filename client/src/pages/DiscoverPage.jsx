import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  Briefcase,
  Building2,
  Hammer,
  Package,
  Search,
  User,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const RECENT_KEY = 'oxs:discoverRecent';
const MAX_RECENT = 8;

const TYPE_KEYS = {
  helper: 'discover.typeHelper',
  job: 'discover.typeJob',
  business: 'discover.typeBusiness',
  tool: 'discover.typeTool',
  product: 'discover.typeProduct',
};

const REASON_KEYS = {
  skill: 'discover.match.skill',
  name: 'discover.match.name',
  profile: 'discover.match.profile',
  title: 'discover.match.title',
  description: 'discover.match.description',
  category: 'discover.match.category',
};

const ACTION_KEYS = {
  view: 'discover.actionView',
  bid: 'discover.actionBid',
  rent: 'discover.actionRent',
};

const TYPE_ICONS = {
  helper: User,
  job: Briefcase,
  business: Building2,
  tool: Hammer,
  product: Package,
};

function readRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(q) {
  const t = q.trim();
  if (!t) return;
  const prev = readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase());
  const next = [t, ...prev].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text, terms) {
  const t = String(text || '');
  if (!t || !terms.length) return t;
  const safe = terms.filter(Boolean).slice(0, 8).map((x) => escapeReg(String(x).toLowerCase()));
  if (!safe.length) return t;
  const re = new RegExp(`(${safe.join('|')})`, 'gi');
  const parts = t.split(re).slice(0, 100).filter(p => p);
  return parts.map((part, i) => {
    const low = part.toLowerCase();
    if (terms.some((term) => term && low === term.toLowerCase())) {
      return (
        <mark key={i} className="bg-orange-500/25 text-orange-100 rounded px-0.5">
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function DiscoverPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const radiusParam = searchParams.get('radius');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [expandedTerms, setExpandedTerms] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [alertRadius, setAlertRadius] = useState(25);
  const [savingAlert, setSavingAlert] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [popular, setPopular] = useState([]);
  const [popularLoading, setPopularLoading] = useState(false);
  const [recent, setRecent] = useState(() => readRecent());

  const radius = Math.min(150, Math.max(5, parseInt(radiusParam || '60', 10) || 60));
  const limit = 20;

  const highlightTerms = useMemo(() => {
    const base = [q.trim(), ...expandedTerms].filter(Boolean);
    const seen = new Set();
    return base.filter((x) => {
      const k = x.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [q, expandedTerms]);

  const loadPopular = useCallback(async () => {
    setPopularLoading(true);
    try {
      const params = { radius: 60 };
      if (lat && lng) {
        params.lat = lat;
        params.lng = lng;
      }
      const { data } = await api.get('/discover/popular', { params });
      setPopular(data.results || []);
    } catch {
      setPopular([]);
    } finally {
      setPopularLoading(false);
    }
  }, [lat, lng]);

  const load = useCallback(async (nextOffset = 0, append = false) => {
    if (!q.trim()) {
      setResults([]);
      setExpandedTerms([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    if (!append) setLoading(true);
    setError(null);
    try {
      const params = { q: q.trim(), radius, limit, offset: nextOffset };
      if (lat && lng) {
        params.lat = lat;
        params.lng = lng;
      }
      const { data } = await api.get('/discover', { params });
      const rows = data.results || [];
      setExpandedTerms(data.expandedTerms || []);
      setTotal(data.total ?? rows.length);
      setHasMore(!!data.hasMore);
      setOffset(nextOffset);
      if (append) {
        setResults((prev) => [...prev, ...rows]);
      } else {
        setResults(rows);
        pushRecent(q.trim());
        setRecent(readRecent());
      }
    } catch (e) {
      setError(t('discover.loadError'));
      if (!append) {
        setResults([]);
        setExpandedTerms([]);
      }
    } finally {
      setLoading(false);
    }
  }, [q, lat, lng, radius, t, limit]);

  useEffect(() => {
    if (!q.trim()) {
      loadPopular();
      setResults([]);
      setExpandedTerms([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    setOffset(0);
    load(0, false);
  }, [q, lat, lng, radius, load, loadPopular]);

  const loadAlerts = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get('/discover/alerts');
      setAlerts(data.alerts || []);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const widenRadius = () => {
    const next = Math.min(150, radius + 25);
    const p = new URLSearchParams(searchParams);
    p.set('radius', String(next));
    setSearchParams(p, { replace: true });
  };

  const saveAlert = async () => {
    if (!user) {
      toast.error(t('discover.signInToSave'));
      return;
    }
    if (!q.trim()) return;
    setSavingAlert(true);
    try {
      await api.post('/discover/alerts', {
        query: q.trim(),
        radius_miles: alertRadius,
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
      });
      toast.success(t('discover.alertSaved'));
      loadAlerts();
    } catch (e) {
      toast.error(e.response?.data?.error || t('discover.alertFailed'));
    } finally {
      setSavingAlert(false);
    }
  };

  const removeAlert = async (id) => {
    try {
      await api.delete(`/discover/alerts/${id}`);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast.success(t('discover.alertRemoved'));
    } catch {
      toast.error(t('discover.alertRemoveFailed'));
    }
  };

  const freshnessLabel = (r) => {
    if (r.freshnessKey === 'today') return t('discover.fresh.today');
    if (r.freshnessKey === 'yesterday') return t('discover.fresh.yesterday');
    if (r.freshnessKey === 'days' && r.freshnessDays != null) {
      return t('discover.fresh.daysAgo', { count: r.freshnessDays });
    }
    if (r.freshnessKey === 'weeks') return t('discover.fresh.thisMonth');
    if (r.freshnessKey === 'older') return t('discover.fresh.older');
    return null;
  };

  return (
    <PageShell>
      <PageMeta title={t('discover.metaTitle')} description={t('discover.metaDesc')} />
      <div className="max-w-3xl mx-auto px-4 py-10 text-gray-100">
        <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <Search className="w-7 h-7 text-orange-400 shrink-0" aria-hidden />
          {t('discover.title')}
        </h1>
        <p className="text-sm text-gray-400 mb-6">{t('discover.subtitle')}</p>

        {!q.trim() && (
          <div className="mb-8 space-y-6">
            <p className="text-sm text-amber-200/90">{t('discover.emptyQuery')}</p>
            {recent.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  {t('discover.recentSearches')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {recent.map((term) => (
                    <Link
                      key={term}
                      to={`/discover?q=${encodeURIComponent(term)}&radius=${radius}${lat && lng ? `&lat=${lat}&lng=${lng}` : ''}`}
                      className="px-3 py-1.5 rounded-full bg-gray-800 border border-gray-600 text-sm text-gray-200 hover:border-orange-500/50"
                    >
                      {term}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" aria-hidden />
                {t('discover.popularNearYou')}
              </h2>
              {popularLoading && <p className="text-gray-500 text-sm">{t('common.loading')}</p>}
              {!popularLoading && popular.length === 0 && (
                <p className="text-sm text-gray-500">{t('discover.popularEmpty')}</p>
              )}
              {!popularLoading && popular.length > 0 && (
                <ul className="space-y-2">
                  {popular.map((r) => {
                    const Icon = TYPE_ICONS[r.type] || Search;
                    return (
                      <li key={`${r.type}-${r.id}`}>
                        <Link
                          to={r.url}
                          className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 hover:border-orange-500/40"
                        >
                          <Icon className="w-4 h-4 text-gray-400 shrink-0" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white truncate">{r.title}</div>
                            {r.subtitle ? (
                              <div className="text-xs text-gray-500 truncate">{r.subtitle}</div>
                            ) : null}
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/post-job" className="sp-btn inline-flex items-center justify-center px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">
                {t('discover.ctaPostJob')}
              </Link>
              <Link to="/tool-rentals" className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-gray-600 text-sm text-gray-200 hover:bg-gray-800">
                {t('discover.ctaListTool')}
              </Link>
              <Link to="/helpers" className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-gray-600 text-sm text-gray-200 hover:bg-gray-800">
                {t('discover.ctaBrowseHelpers')}
              </Link>
            </div>
          </div>
        )}

        {q.trim() ? (
          <p className="text-sm text-gray-300 mb-4">
            {t('discover.showingFor', { query: q, radius })}
            {lat && lng ? ` · ${t('discover.nearCoords')}` : ''}
            {total > 0 ? (
              <span className="text-gray-500"> · {t('discover.resultCount', { shown: results.length, total })}</span>
            ) : null}
          </p>
        ) : null}

        {expandedTerms.length > 0 && q.trim() ? (
          <div className="mb-6 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-500">{t('discover.expandedTerms')}</span>
            {expandedTerms.map((term) => (
              <span
                key={term}
                className="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300"
              >
                {term}
              </span>
            ))}
          </div>
        ) : null}

        {user && q.trim() && (
          <div className="mb-8 p-4 rounded-xl border border-gray-700 bg-gray-900/60">
            <h2 className="text-sm font-semibold text-white mb-2">{t('discover.saveAlertTitle')}</h2>
            <p className="text-xs text-gray-400 mb-3">{t('discover.saveAlertDesc')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-gray-400 flex items-center gap-2">
                {t('discover.alertRadius')}
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={alertRadius}
                  onChange={(e) => setAlertRadius(parseInt(e.target.value, 10))}
                  className="w-32"
                />
                <span className="text-gray-200 tabular-nums">{alertRadius} mi</span>
              </label>
              <button
                type="button"
                onClick={saveAlert}
                disabled={savingAlert}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium disabled:opacity-50"
              >
                {savingAlert ? t('common.saving') : t('discover.saveAlertBtn')}
              </button>
            </div>
            {alerts.length > 0 && (
              <ul className="mt-4 space-y-2 text-xs text-gray-400">
                {alerts.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 items-center border-t border-gray-800 pt-2 first:border-0 first:pt-0">
                    <span>
                      <Link
                        to={`/discover?q=${encodeURIComponent(a.query)}&radius=${a.radius_miles}`}
                        className="text-orange-400 hover:underline"
                      >
                        {a.query}
                      </Link>
                      {' · '}
                      {a.radius_miles} mi
                    </span>
                    <button type="button" onClick={() => removeAlert(a.id)} className="text-red-400 hover:underline shrink-0">
                      {t('common.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {loading && <p className="text-gray-400">{t('common.loading')}</p>}
        {error && <p className="text-red-400">{error}</p>}

        {!loading && !error && q.trim() && results.length === 0 && (
          <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-6 space-y-4">
            <p className="text-gray-300">{t('discover.noResults')}</p>
            <p className="text-sm text-gray-500">{t('discover.noResultsHint')}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={widenRadius}
                disabled={radius >= 150}
                className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm text-white hover:bg-gray-700 disabled:opacity-40"
              >
                {t('discover.widenRadius', { next: Math.min(150, radius + 25) })}
              </button>
              <Link to="/post-job" className="px-4 py-2 rounded-lg bg-orange-500 text-sm text-white font-medium hover:bg-orange-600">
                {t('discover.ctaPostJob')}
              </Link>
              <Link to="/tool-rentals" className="px-4 py-2 rounded-lg border border-gray-600 text-sm text-gray-200 hover:bg-gray-800">
                {t('discover.ctaListTool')}
              </Link>
            </div>
          </div>
        )}

        {!loading && results.length > 0 && (
          <>
            <ul className="space-y-3">
              {results.map((r) => {
                const Icon = TYPE_ICONS[r.type] || Search;
                const actionKey = ACTION_KEYS[r.primaryAction] || ACTION_KEYS.view;
                return (
                  <li key={`${r.type}-${r.id}-${r.title}`}>
                    <Link
                      to={r.url}
                      className="block rounded-xl border border-gray-700 bg-gray-900/50 p-4 hover:border-orange-500/50 hover:bg-gray-900 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center shrink-0 text-orange-300">
                          <Icon className="w-5 h-5" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-800 text-orange-300">
                              {t(TYPE_KEYS[r.type] || 'discover.typeOther')}
                            </span>
                            {r.verified && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-300">
                                {t('discover.badgeVerified')}
                              </span>
                            )}
                            {r.backgroundChecked && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-200">
                                {t('discover.badgeBg')}
                              </span>
                            )}
                            {r.availableToday && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200">
                                {t('discover.badgeAvailable')}
                              </span>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-white">
                            {highlightTerms.length ? highlightText(r.title, highlightTerms) : r.title}
                          </h3>
                          {r.subtitle ? (
                            <p className="text-sm text-gray-400 line-clamp-2 mt-1">
                              {highlightTerms.length ? highlightText(r.subtitle, highlightTerms) : r.subtitle}
                            </p>
                          ) : null}
                          {r.matchReasons && r.matchReasons.length > 0 && (
                            <p className="text-[11px] text-gray-500 mt-1">
                              {t('discover.matches')}{' '}
                              {r.matchReasons.map((m) => t(REASON_KEYS[m] || 'discover.match.other')).join(' · ')}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-500">
                            {r.rating != null && r.rating > 0 && (
                              <span>
                                ★ {Number(r.rating).toFixed(1)}
                                {r.reviewCount ? ` (${r.reviewCount})` : ''}
                              </span>
                            )}
                            {r.meta && <span>{r.meta}</span>}
                            {r.distanceMiles != null && (
                              <span>{t('discover.distanceAway', { miles: Math.round(r.distanceMiles * 10) / 10 })}</span>
                            )}
                            {r.priceHint && <span>{r.priceHint}</span>}
                            {freshnessLabel(r) && <span>{freshnessLabel(r)}</span>}
                          </div>
                          <div className="mt-2">
                            <span className="inline-flex items-center text-xs font-medium text-orange-400">
                              {t(actionKey)} <ChevronRight className="w-3.5 h-3.5 ml-0.5" aria-hidden />
                            </span>
                          </div>
                          {r.related && r.related.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-800">
                              <p className="text-[11px] font-medium text-violet-300 mb-1">{t('discover.relatedHelpers')}</p>
                              <div className="flex flex-wrap gap-2">
                                {r.related.map((rel) => (
                                  <Link
                                    key={rel.url}
                                    to={rel.url}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs text-violet-200 hover:underline"
                                  >
                                    {rel.title}
                                  </Link>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={() => load(offset + limit, true)}
                className="mt-6 w-full py-3 rounded-xl border border-gray-600 text-sm text-gray-200 hover:bg-gray-800"
              >
                {t('discover.loadMore')}
              </button>
            )}
            {!hasMore && total > results.length ? null : null}
            {q.trim() && results.length > 0 && radius < 150 && (
              <button
                type="button"
                onClick={widenRadius}
                className="mt-3 w-full py-2 text-sm text-gray-400 hover:text-white"
              >
                {t('discover.widenRadius', { next: Math.min(150, radius + 25) })}
              </button>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
