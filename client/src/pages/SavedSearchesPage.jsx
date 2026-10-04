import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bell, BellOff, BookmarkX, Play, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import EmptyState from '../components/EmptyState';
import api from '../api/axios';

const TYPE_RUN_PATH = {
  job: '/jobs',
  helper: '/helpers',
  tool: '/tool-rentals',
  food: '/food',
};

/**
 * SavedSearchesPage — lists the signed-in user's saved searches with
 * delete, alert toggle, and re-run links. New matching listings (jobs,
 * helpers going live, tool listings) fan out a notification per saved
 * search, deduped per item.
 */
export default function SavedSearchesPage() {
  const { t } = useTranslation();
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/saved-searches');
      setSearches(res.data?.searches || []);
    } catch (_) {
      toast.error(t('savedSearch.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusyId(id);
    try {
      await api.delete(`/saved-searches/${id}`);
      setSearches((prev) => prev.filter((s) => s.id !== id));
      toast.success(t('savedSearch.deletedToast'));
    } catch (_) {
      toast.error(t('savedSearch.deleteFailed'));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const toggleNotify = async (search) => {
    setBusyId(search.id);
    try {
      const res = await api.put(`/saved-searches/${search.id}`, { notify: !search.notify });
      setSearches((prev) => prev.map((s) => (s.id === search.id ? res.data : s)));
    } catch (_) {
      toast.error(t('savedSearch.saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const runUrl = (search) => {
    const base = TYPE_RUN_PATH[search.search_type] || '/jobs';
    const q = search.query || search.keyword;
    return q ? `${base}?q=${encodeURIComponent(q)}` : base;
  };

  const typeLabel = (searchType) => t(`savedSearch.type${String(searchType || 'job').replace(/^./, (c) => c.toUpperCase())}`, searchType || 'job');

  return (
    <PageShell>
      <PageMeta
        title={t('savedSearch.pageTitle')}
        description={t('savedSearch.pageSubtitle')}
        url="https://oxsteed.com/saved-searches"
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('savedSearch.pageTitle')}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 mb-6">
          {t('savedSearch.pageSubtitle')}
        </p>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : searches.length === 0 ? (
          <EmptyState
            icon={BookmarkX}
            title={t('savedSearch.emptyTitle')}
            copy={t('savedSearch.emptyBody')}
            actions={(
              <Link
                to="/jobs"
                className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold"
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                {t('savedSearch.emptyCta')}
              </Link>
            )}
          />
        ) : (
          <ul className="space-y-3">
            {searches.map((search) => (
              <li
                key={search.id}
                className="flex items-center gap-3 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white truncate">
                      {search.name}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                      {typeLabel(search.search_type)}
                    </span>
                    {(search.query || search.keyword) && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        &ldquo;{search.query || search.keyword}&rdquo;
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {search.notify ? t('savedSearch.notifyOn') : t('savedSearch.notifyOff')}
                  </div>
                </div>
                <Link
                  to={runUrl(search)}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-gray-800"
                  aria-label={t('savedSearch.runSearch', { name: search.name })}
                >
                  <Play className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('savedSearch.run')}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => toggleNotify(search)}
                  disabled={busyId === search.id}
                  className="p-2.5 rounded-xl text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                  aria-label={search.notify ? t('savedSearch.muteAlerts') : t('savedSearch.unmuteAlerts')}
                  title={search.notify ? t('savedSearch.muteAlerts') : t('savedSearch.unmuteAlerts')}
                >
                  {search.notify
                    ? <Bell className="w-4 h-4" aria-hidden="true" />
                    : <BellOff className="w-4 h-4" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(search.id)}
                  disabled={busyId === search.id}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-medium disabled:opacity-50 ${
                    confirmId === search.id
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {confirmId === search.id ? t('savedSearch.confirmDelete') : t('savedSearch.delete')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
