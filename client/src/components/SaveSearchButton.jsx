import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BookmarkPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/**
 * SaveSearchButton — "Save this search" action for the discovery surfaces
 * (helpers, jobs, tools, food). Opens a small inline dialog to name the
 * search, then persists it via POST /api/saved-searches. Saved searches
 * trigger match alerts when new matching listings go live.
 *
 * Props:
 *   searchType: 'job' | 'helper' | 'tool' | 'food'
 *   query:      current free-text query
 *   filters:    plain object snapshot of the active filters
 *   dark:       render the button for dark hero backgrounds
 */
export default function SaveSearchButton({ searchType, query, filters, dark = false }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName((query || '').trim().slice(0, 80));
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  const handleOpen = () => {
    if (!user) {
      toast.error(t('savedSearch.signInRequired'));
      return;
    }
    setOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      let safeFilters = {};
      try {
        safeFilters = JSON.parse(JSON.stringify(filters || {})) || {};
      } catch (_) { safeFilters = {}; }
      await api.post('/saved-searches', {
        name: trimmed,
        search_type: searchType,
        query: (query || '').trim() || null,
        filters: safeFilters,
        notify: true,
      });
      toast.success(t('savedSearch.savedToast'));
      setOpen(false);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('savedSearch.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={dark
          ? 'inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-full border border-gray-600 bg-gray-800/80 hover:bg-gray-700 text-sm font-medium text-gray-200 hover:text-white transition-colors'
          : 'inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-full border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors'}
        aria-haspopup="dialog"
      >
        <BookmarkPlus className="w-4 h-4" aria-hidden="true" />
        {t('savedSearch.saveThisSearch')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-label={t('savedSearch.dialogTitle')}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t('savedSearch.dialogTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label={t('savedSearch.cancel')}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t('savedSearch.dialogSubtitle')}
            </p>
            <form onSubmit={handleSave}>
              <label
                htmlFor="save-search-name"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                {t('savedSearch.nameLabel')}
              </label>
              <input
                id="save-search-name"
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('savedSearch.namePlaceholder')}
                maxLength={80}
                className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <div className="flex items-center justify-between gap-3 mt-5">
                <Link
                  to="/saved-searches"
                  className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                  onClick={() => setOpen(false)}
                >
                  {t('savedSearch.manage')}
                </Link>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t('savedSearch.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={!name.trim() || saving}
                    className="min-h-[44px] px-5 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? t('savedSearch.saving') : t('savedSearch.save')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
