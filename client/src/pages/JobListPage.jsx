/**
 * JobListPage
 *
 * Customer + helper-facing browse/search page for discovering open OxSteed jobs.
 * Route: /jobs
 *
 * Mirrors the design of HelpersDirectoryPage:
 *   Hero with search bar
 *   Skill-tile grid (browse by category)
 *   Sub-skill chip strip when a tile is selected
 *   Sidebar filter panel (desktop) / slide-up drawer (mobile)
 *   Sort controls + active filter tags
 *   Card grid with skeleton loaders, empty state, show-more pagination
 *
 * Backed by `/api/jobs` via `useJobs.fetchJobs`.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SlidersHorizontal,
  X,
  ChevronDown,
  Sparkles,
  Briefcase,
} from 'lucide-react';

import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import { detectCountryFromLocale } from '../lib/countries';

import SearchBar from '../components/jobDirectory/SearchBar';
import FilterPanel from '../components/jobDirectory/FilterPanel';
import SortControls from '../components/jobDirectory/SortControls';
import ActiveFilterTags from '../components/jobDirectory/ActiveFilterTags';
import EmptyState from '../components/jobDirectory/EmptyState';
import JobCard from '../components/jobDirectory/JobCard';

import {
  DEFAULT_JOB_FILTERS,
  CATEGORIES,
  SKILL_TILES,
  SERVER_SORT,
  countActiveJobFilters,
  toJobCardData,
} from '../types/jobDirectory';

const PAGE_SIZE = 12;

/**
 * Read URL params at component init so we don't fire an extra request with
 * defaults before the params are applied (matches the helper directory pattern).
 */
function getInitialState(defaultCountry, defaultState) {
  const params = new URLSearchParams(window.location.search);

  const filters = { ...DEFAULT_JOB_FILTERS, country: defaultCountry, state: defaultState };
  let tileId = null;

  const skillParam = params.get('skill');
  if (skillParam) {
    const tile = SKILL_TILES.find((tt) => tt.id === skillParam);
    if (tile) {
      tileId = tile.id;
      filters.category = tile.category;
    } else {
      filters.query = skillParam.replace(/-/g, ' ');
    }
  }

  const qParam = params.get('q');
  if (qParam) filters.query = qParam;

  const cityParam = params.get('city');
  if (cityParam) filters.city = cityParam;
  const stateParam = params.get('state');
  if (stateParam) filters.state = stateParam;

  const urgentParam = params.get('urgent');
  if (urgentParam === 'true') filters.urgentOnly = true;

  return { filters, tileId };
}

// ── Card skeleton ─────────────────────────────────────────────────────────────
const CardSkeleton = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse">
    <div className="px-4 pt-4 pb-2 flex items-center justify-between">
      <div className="h-6 w-24 bg-gray-800 rounded-lg" />
      <div className="h-5 w-12 bg-gray-800 rounded-md" />
    </div>
    <div className="px-4 pt-1 pb-3 space-y-2">
      <div className="h-4 bg-gray-800 rounded w-3/4" />
      <div className="h-3 bg-gray-800 rounded w-full" />
      <div className="h-3 bg-gray-800 rounded w-5/6" />
    </div>
    <div className="px-4 pb-3 flex gap-2">
      <div className="h-3 w-16 bg-gray-800 rounded" />
      <div className="h-3 w-12 bg-gray-800 rounded" />
      <div className="h-3 w-20 bg-gray-800 rounded" />
    </div>
    <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between bg-gray-900/40">
      <div className="space-y-2">
        <div className="h-2 w-12 bg-gray-800 rounded" />
        <div className="h-4 w-20 bg-gray-800 rounded" />
      </div>
      <div className="h-8 w-24 bg-gray-800 rounded-xl" />
    </div>
  </div>
);

// ── Mobile filter drawer ──────────────────────────────────────────────────────
const FilterDrawer = ({ open, onClose, children, activeCount }) => {
  const { t } = useTranslation();

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true" aria-label={t('jobsDir.filters')}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-auto bg-gray-950 rounded-t-2xl flex flex-col max-h-[90vh] shadow-2xl">
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-700" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <h2 className="font-semibold text-white flex items-center gap-2">
            {t('jobsDir.filters')}
            {activeCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">
                {activeCount}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {children}
        </div>
        <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl transition-colors"
          >
            {t('jobsDir.showResults')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Skill tile grid ───────────────────────────────────────────────────────────
const SkillTileGrid = ({ selectedId, onSelect }) => {
  const { t } = useTranslation();
  return (
    <section className="bg-gray-900 border-b border-gray-800" aria-label={t('jobsDir.browseByCategory')}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          {t('jobsDir.browseByCategory')}
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
          {SKILL_TILES.map((tile) => {
            const active = selectedId === tile.id;
            return (
              <button
                key={tile.id}
                onClick={() => onSelect(active ? null : tile.id)}
                aria-pressed={active}
                title={tile.desc}
                className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all ${
                  active
                    ? 'bg-brand-500/20 border-brand-500 text-brand-300 shadow-sm shadow-brand-500/20'
                    : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                <span className="text-xl leading-none" aria-hidden="true">{tile.icon}</span>
                <span className="text-xs font-medium leading-tight">{tile.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ── Sub-skill chip strip ──────────────────────────────────────────────────────
const SubSkillStrip = ({ tile, selectedSkills, onToggleSkill, onClearTile }) => {
  const { t } = useTranslation();
  return (
    <div className="bg-gray-950 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-brand-400 whitespace-nowrap flex items-center gap-1.5">
          <span aria-hidden="true">{tile.icon}</span>
          {tile.label}
        </span>
        <span className="text-gray-700 text-xs" aria-hidden="true">-</span>
        <p className="text-xs text-gray-500">{t('jobsDir.filterByJobType')}</p>
        <div className="flex flex-wrap gap-2">
          {tile.subSkills.map((sk) => {
            const active = selectedSkills.includes(sk);
            return (
              <button
                key={sk}
                onClick={() => onToggleSkill(sk)}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-brand-500 border-brand-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }`}
              >
                {sk}
              </button>
            );
          })}
        </div>
        <button
          onClick={onClearTile}
          className="ml-auto text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1 transition-colors whitespace-nowrap"
          aria-label={t('jobsDir.clearFilter')}
        >
          <X className="w-3 h-3" aria-hidden="true" />
          {t('jobsDir.clearFilter')}
        </button>
      </div>
    </div>
  );
};

// ── Hero banner ───────────────────────────────────────────────────────────────
const DirectoryHero = ({ searchValue, onSearch }) => {
  const { t } = useTranslation();
  return (
    <div className="relative bg-gray-900 border-b border-gray-800 overflow-hidden">
      <div className="absolute inset-0 opacity-5" aria-hidden="true">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="jobs-hero-dots" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#jobs-hero-dots)" />
        </svg>
      </div>
      <div className="absolute inset-y-0 left-0 w-1 bg-brand-500" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-brand-400" aria-hidden="true" />
            <span className="text-xs font-semibold text-brand-400 uppercase tracking-widest">
              {t('jobsDir.heroEyebrow')}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
            {t('jobsDir.heroTitle')}
          </h1>
          <p className="text-gray-400 mt-2 text-base leading-relaxed">
            {t('jobsDir.heroSubtitle')}
          </p>

          <div className="mt-6">
            <SearchBar
              value={searchValue}
              onChange={onSearch}
              placeholder={t('jobsDir.heroSearchPlaceholder')}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.slice(0, 8).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => onSearch(cat)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-xs text-gray-300 hover:text-white transition-colors"
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function JobListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { jobs, loading, error, pagination, fetchJobs } = useJobs();
  const [, setSearchParams] = useSearchParams();

  const defaultState = user?.role === 'helper' && user?.state
    ? user.state
    : (typeof window !== 'undefined' ? (localStorage.getItem('jlp_state_filter') || '') : '');
  const defaultCountry = user?.country
    || (typeof window !== 'undefined' ? localStorage.getItem('jlp_country_filter') : null)
    || detectCountryFromLocale('US');

  const [{ filters: _initFilters, tileId: _initTileId }] = useState(() =>
    getInitialState(defaultCountry, defaultState),
  );

  const [filters, setFilters] = useState(_initFilters);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTileId, setSelectedTileId] = useState(_initTileId);

  const debounceRef = useRef(null);
  const isFirstLoad = useRef(true);

  // Build server-side params from current filters + sort + page.
  const buildServerParams = useCallback((f, s, p) => {
    // Server `q` accepts a free-text needle - we fold sub-skills into it so the
    // existing backend doesn't need a new column. Skill names match against
    // title/description/category_name (ILIKE).
    const qParts = [f.query, ...f.skills].filter(Boolean);
    const params = {
      q: qParts.join(' '),
      category: f.category || '',
      city: f.city || '',
      state: f.state || '',
      country: f.country || '',
      sort: SERVER_SORT[s] || 'newest',
      page: p,
      limit: PAGE_SIZE,
    };
    if (f.budgetRange) {
      params.min_budget = f.budgetRange[0];
      params.max_budget = f.budgetRange[1];
    }
    // Strip empty values so the URL stays tidy and the server treats them as absent.
    Object.keys(params).forEach((k) => {
      if (params[k] === '' || params[k] == null) delete params[k];
    });
    return params;
  }, []);

  // Single effect: immediate on first render, debounced on subsequent changes.
  useEffect(() => {
    const runFetch = (p = 1) => {
      const params = buildServerParams(filters, sort, p);
      fetchJobs(params);
      setPage(p);
    };
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      runFetch(1);
      return undefined;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runFetch(1), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters, sort, fetchJobs, buildServerParams]);

  // Keep URL in sync with the few "shareable" params (q, category, skill, state).
  useEffect(() => {
    const next = new URLSearchParams();
    if (filters.query) next.set('q', filters.query);
    if (selectedTileId) next.set('skill', selectedTileId);
    if (filters.city) next.set('city', filters.city);
    if (filters.state) next.set('state', filters.state);
    if (filters.urgentOnly) next.set('urgent', 'true');
    setSearchParams(next, { replace: true });
  }, [filters.query, selectedTileId, filters.city, filters.state, filters.urgentOnly, setSearchParams]);

  // Persist state + country across sessions (matches old behaviour).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (filters.state) localStorage.setItem('jlp_state_filter', filters.state);
    if (filters.country) localStorage.setItem('jlp_country_filter', filters.country);
  }, [filters.state, filters.country]);

  const updateFilters = useCallback((partial) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_JOB_FILTERS, country: defaultCountry });
    setSelectedTileId(null);
  }, [defaultCountry]);

  const handleTileSelect = useCallback((tileId) => {
    if (!tileId) {
      setSelectedTileId(null);
      setFilters((f) => ({ ...f, category: '', skills: [] }));
      return;
    }
    const tile = SKILL_TILES.find((tt) => tt.id === tileId);
    if (!tile) return;
    setSelectedTileId(tileId);
    setFilters((f) => ({ ...f, category: tile.category, skills: [] }));
  }, []);

  const handleSubSkillToggle = useCallback((skill) => {
    setFilters((f) => {
      const next = f.skills.includes(skill)
        ? f.skills.filter((s) => s !== skill)
        : [...f.skills, skill];
      return { ...f, skills: next };
    });
  }, []);

  const selectedTile = selectedTileId ? SKILL_TILES.find((tt) => tt.id === selectedTileId) : null;

  // Client-side post-filtering for things the backend doesn't yet support
  // (urgent flag, has-bids vs no-bids, posted-within window).
  const filteredJobs = useMemo(() => {
    let list = (jobs || []).map(toJobCardData);
    if (filters.urgentOnly) list = list.filter((j) => j.isUrgent);
    if (filters.hasBids) list = list.filter((j) => j.bidCount > 0);
    if (filters.noBidsYet) list = list.filter((j) => j.bidCount === 0);
    if (filters.postedWithin && filters.postedWithin !== 'any') {
      const now = Date.now();
      const windowMs = {
        today: 1 * 24 * 60 * 60 * 1000,
        three_days: 3 * 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
      }[filters.postedWithin];
      if (windowMs) {
        list = list.filter((j) => {
          const ts = new Date(j.createdAt).getTime();
          return !Number.isNaN(ts) && now - ts <= windowMs;
        });
      }
    }

    // Bid-count sorts: applied client-side (the backend doesn't support them).
    if (sort === 'most_bids') {
      list = [...list].sort((a, b) => b.bidCount - a.bidCount);
    } else if (sort === 'fewest_bids') {
      list = [...list].sort((a, b) => a.bidCount - b.bidCount);
    }
    return list;
  }, [jobs, filters.urgentOnly, filters.hasBids, filters.noBidsYet, filters.postedWithin, sort]);

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / (pagination.limit || PAGE_SIZE)));
  const hasMore = page < totalPages;
  const activeFilterCount = countActiveJobFilters(filters);

  const handleShowMore = useCallback(() => {
    if (!hasMore) return;
    const nextPage = page + 1;
    const params = buildServerParams(filters, sort, nextPage);
    fetchJobs(params);
    setPage(nextPage);
  }, [hasMore, page, filters, sort, fetchJobs, buildServerParams]);

  const showSkeletons = loading && filteredJobs.length === 0;

  return (
    <PageShell>
      <PageMeta
        title={t('jobsDir.metaTitle')}
        description={t('jobsDir.metaDescription')}
        url="https://oxsteed.com/jobs"
      />

      {/* Hero + search */}
      <DirectoryHero
        searchValue={filters.query}
        onSearch={(q) => updateFilters({ query: q })}
      />

      {/* Skill tile grid */}
      <SkillTileGrid selectedId={selectedTileId} onSelect={handleTileSelect} />

      {/* Sub-skill chips - shown when a tile is selected */}
      {selectedTile && (
        <SubSkillStrip
          tile={selectedTile}
          selectedSkills={filters.skills}
          onToggleSkill={handleSubSkillToggle}
          onClearTile={() => handleTileSelect(null)}
        />
      )}

      {/* State indicator (carried over from old design) */}
      {filters.state && (
        <div className="bg-gray-900/60 border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-2 text-xs text-gray-400">
            <Briefcase className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" aria-hidden="true" />
            {t('jobsDir.showingInState', { state: filters.state })}
            <button
              type="button"
              onClick={() => updateFilters({ state: '' })}
              className="ml-auto text-brand-400 hover:text-brand-300"
            >
              {t('jobsDir.showAllStates')}
            </button>
          </div>
        </div>
      )}

      {/* Mobile filter bar */}
      <div className="lg:hidden sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          aria-label={`${t('jobsDir.filters')}${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          {t('jobsDir.filters')}
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
        <div className="flex-1">
          <SortControls
            value={sort}
            onChange={setSort}
            resultCount={pagination.total || filteredJobs.length}
          />
        </div>
      </div>

      {/* Page body */}
      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        id="main-content"
      >
        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <aside
            className="hidden lg:block w-72 flex-shrink-0"
            aria-label={t('jobsDir.filterAria')}
          >
            <div className="sticky top-6">
              <FilterPanel
                filters={filters}
                onChange={updateFilters}
                onReset={resetFilters}
              />
            </div>
          </aside>

          {/* Results column */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Sort + active tags - desktop */}
            <div className="hidden lg:flex flex-col gap-3">
              <SortControls
                value={sort}
                onChange={setSort}
                resultCount={pagination.total || filteredJobs.length}
              />
              <ActiveFilterTags filters={filters} onChange={updateFilters} />
            </div>

            {/* Active tags - mobile */}
            <div className="lg:hidden">
              <ActiveFilterTags filters={filters} onChange={updateFilters} />
            </div>

            {/* Grid */}
            {showSkeletons ? (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
                aria-busy="true"
                aria-label={t('jobsDir.loadingAria')}
              >
                {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-lg font-medium text-white mb-2">{t('errors.generic')}</p>
                <p className="text-sm mb-4">{t('jobsDir.loadError')}</p>
                <button
                  onClick={() => fetchJobs(buildServerParams(filters, sort, 1))}
                  className="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm transition-colors"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : filteredJobs.length === 0 ? (
              <EmptyState
                query={filters.query}
                hasFilters={activeFilterCount > 0}
                onReset={resetFilters}
                selectedCategory={selectedTile?.category}
                state={filters.state}
                onClearState={() => updateFilters({ state: '' })}
              />
            ) : (
              <>
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
                  role="list"
                  aria-label={t('jobsDir.resultsAria', { count: pagination.total || filteredJobs.length })}
                >
                  {filteredJobs.map((job) => (
                    <div key={job.id} role="listitem">
                      <JobCard
                        job={job}
                        highlightCategory={selectedTile?.category}
                      />
                    </div>
                  ))}
                </div>

                {/* Show more */}
                {hasMore && (
                  <div className="flex justify-center pt-4">
                    <button
                      onClick={handleShowMore}
                      disabled={loading}
                      className="flex items-center gap-2 px-8 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      {loading ? t('common.loading') : t('jobsDir.showMore')}
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {!hasMore && filteredJobs.length > PAGE_SIZE && (
                  <p className="text-center text-xs text-gray-600 pt-2">
                    {t('jobsDir.allShown', { count: filteredJobs.length })}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Mobile filter drawer */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeCount={activeFilterCount}
      >
        <FilterPanel
          filters={filters}
          onChange={updateFilters}
          onReset={resetFilters}
        />
      </FilterDrawer>
    </PageShell>
  );
}
