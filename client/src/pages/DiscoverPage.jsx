import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const TYPE_KEYS = {
  helper: 'discover.typeHelper',
  job: 'discover.typeJob',
  business: 'discover.typeBusiness',
  tool: 'discover.typeTool',
  product: 'discover.typeProduct',
};

export default function DiscoverPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const radiusParam = searchParams.get('radius');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [expandedTerms, setExpandedTerms] = useState([]);
  const [alertRadius, setAlertRadius] = useState(25);
  const [savingAlert, setSavingAlert] = useState(false);
  const [alerts, setAlerts] = useState([]);

  const radius = Math.min(150, Math.max(5, parseInt(radiusParam || '60', 10) || 60));

  const load = useCallback(async () => {
    if (!q.trim()) {
      setResults([]);
      setExpandedTerms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = { q: q.trim(), radius };
      if (lat && lng) {
        params.lat = lat;
        params.lng = lng;
      }
      const { data } = await api.get('/discover', { params });
      setResults(data.results || []);
      setExpandedTerms(data.expandedTerms || []);
    } catch (e) {
      setError(t('discover.loadError'));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [q, lat, lng, radius, t]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <PageShell>
      <PageMeta title={t('discover.metaTitle')} description={t('discover.metaDesc')} />
      <div className="max-w-3xl mx-auto px-4 py-10 text-gray-100">
        <h1 className="text-2xl font-bold text-white mb-2">{t('discover.title')}</h1>
        <p className="text-sm text-gray-400 mb-6">{t('discover.subtitle')}</p>

        {q.trim() ? (
          <p className="text-sm text-gray-300 mb-4">
            {t('discover.showingFor', { query: q, radius })}
            {lat && lng ? ` · ${t('discover.nearCoords')}` : ''}
          </p>
        ) : (
          <p className="text-sm text-amber-200/90 mb-6">{t('discover.emptyQuery')}</p>
        )}

        {expandedTerms.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-500">{t('discover.expandedTerms')}</span>
            {expandedTerms.map((term) => (
              <span key={term} className="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
                {term}
              </span>
            ))}
          </div>
        )}

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
                      <Link to={`/discover?q=${encodeURIComponent(a.query)}&radius=${a.radius_miles}`} className="text-orange-400 hover:underline">
                        {a.query}
                      </Link>
                      {' · '}{a.radius_miles} mi
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
          <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-6 text-center">
            <p className="text-gray-300 mb-2">{t('discover.noResults')}</p>
            <p className="text-sm text-gray-500">{t('discover.noResultsHint')}</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <ul className="space-y-3">
            {results.map((r) => (
              <li key={`${r.type}-${r.id}`}>
                <Link
                  to={r.url}
                  className="block rounded-xl border border-gray-700 bg-gray-900/50 p-4 hover:border-orange-500/50 hover:bg-gray-900 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-800 text-orange-300 mb-1">
                        {t(TYPE_KEYS[r.type] || 'discover.typeOther')}
                      </span>
                      <h3 className="text-base font-semibold text-white truncate">{r.title}</h3>
                      {r.subtitle ? <p className="text-sm text-gray-400 line-clamp-2 mt-1">{r.subtitle}</p> : null}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-500">
                        {r.meta && <span>{r.meta}</span>}
                        {r.distanceMiles != null && (
                          <span>{t('discover.distanceAway', { miles: Math.round(r.distanceMiles * 10) / 10 })}</span>
                        )}
                        {r.priceHint && <span>{r.priceHint}</span>}
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
                    <span className="text-gray-500 shrink-0" aria-hidden>→</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
