/**
 * HelpersDirectoryPage
 *
 * Customer-facing browse/search page for discovering OxSteed helpers.
 * Route: /helpers
 *
 * Layout:
 *   Desktop (lg+) — left sidebar with FilterPanel, right 3/4 with results grid
 *   Mobile        — FilterPanel in a slide-up drawer, triggered by a sticky bar
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, X, ChevronDown, Sparkles, MapPin } from 'lucide-react';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

import SearchBar from '../components/helperDirectory/SearchBar';
import FilterPanel from '../components/helperDirectory/FilterPanel';
import SortControls from '../components/helperDirectory/SortControls';
import ActiveFilterTags from '../components/helperDirectory/ActiveFilterTags';
import EmptyState from '../components/helperDirectory/EmptyState';
import HelperCard from '../components/helperDirectory/HelperCard';

import type { HelperCardData, DirectoryFilters, SortOption } from '../types/helperDirectory';
import { DEFAULT_FILTERS, countActiveFilters, SKILL_TILES } from '../types/helperDirectory';
import { fetchHelpers } from '../api/helpers';
import PageMeta from '../components/PageMeta';

const PAGE_SIZE = 9;

// ── Filter + sort engine ──────────────────────────────────────────────────────

function applyFilters(helpers: HelperCardData[], f: DirectoryFilters): HelperCardData[] {
  return helpers.filter((h) => {
    // Text search: matches business name, owner name, bio, categories, skills
    if (f.query) {
      const q = f.query.toLowerCase();
      const searchable = [
        h.businessName,
        h.ownerName,
        h.shortBio,
        ...h.categories,
        ...h.skills,
        ...h.licenses,
        ...h.topServices.map((s) => s.name),
      ]
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    // Category (any-of)
    if (f.categories.length > 0) {
      if (!f.categories.some((cat) => h.categories.includes(cat))) return false;
    }

    // Skills (all-of — every selected skill must exist on helper)
    if (f.skills.length > 0) {
      if (!f.skills.every((sk) => h.skills.includes(sk))) return false;
    }

    // Licenses (any-of)
    if (f.licenses.length > 0) {
      if (!f.licenses.some((lic) => h.licenses.includes(lic as any))) return false;
    }

    // Insurance (any-of)
    if (f.insurance.length > 0) {
      if (!f.insurance.some((ins) => h.insurance.includes(ins as any))) return false;
    }

    // Rating
    if (f.minRating > 0 && h.rating < f.minRating) return false;

    // Price range (against startingPrice)
    if (f.priceRange) {
      const [min, max] = f.priceRange;
      if (h.startingPrice < min || h.startingPrice > max) return false;
    }

    // Distance (mock: we don't have real geo so skip if no zip)
    // In production this is computed server-side or via haversine
    if (f.maxDistance > 0 && h.distanceMiles !== undefined) {
      if (h.distanceMiles > f.maxDistance) return false;
    }

    // Quick toggles
    if (f.availableToday && !h.availableToday) return false;
    if (f.backgroundChecked && !h.backgroundChecked) return false;
    if (f.verified && !h.verified) return false;

    return true;
  });
}

function applySort(helpers: HelperCardData[], sort: SortOption, boostedCategory?: string): HelperCardData[] {
  const copy = [...helpers];

  const baseCompare = (a: HelperCardData, b: HelperCardData): number => {
    switch (sort) {
      case 'highest_rated':   return b.rating - a.rating || b.reviewCount - a.reviewCount;
      case 'most_reviews':    return b.reviewCount - a.reviewCount;
      case 'lowest_price':    return a.startingPrice - b.startingPrice;
      case 'fastest_response':return a.responseMinutes - b.responseMinutes;
      case 'newest':          return new Date(b.memberSince).getTime() - new Date(a.memberSince).getTime();
      case 'best_match':
      default: {
        // Blend rating × log(reviews) for Wilson-score-like ranking
        const scoreA = a.rating * Math.log1p(a.reviewCount);
        const scoreB = b.rating * Math.log1p(b.reviewCount);
        return scoreB - scoreA;
      }
    }
  };

  return copy.sort((a, b) => {
    // When a skill tile is selected, exact-category matches float to the top
    if (boostedCategory) {
      const aMatch = a.categories.includes(boostedCategory) ? 0 : 1;
      const bMatch = b.categories.includes(boostedCategory) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    return baseCompare(a, b);
  });
}

// ── Card skeleton ─────────────────────────────────────────────────────────────
const CardSkeleton: React.FC = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse">
    <div className="h-20 bg-gray-800" />
    <div className="px-4 pt-2 pb-4 space-y-3">
      <div className="flex items-end justify-between -mt-6">
        <div className="w-16 h-16 rounded-2xl bg-gray-700 border-4 border-gray-900" />
        <div className="w-20 h-6 bg-gray-800 rounded" />
      </div>
      <div className="space-y-2">
        <div className="h-4 bg-gray-800 rounded w-3/4" />
        <div className="h-3 bg-gray-800 rounded w-1/2" />
      </div>
      <div className="h-3 bg-gray-800 rounded w-full" />
      <div className="h-3 bg-gray-800 rounded w-5/6" />
      <div className="flex gap-2 mt-2">
        <div className="h-8 bg-gray-800 rounded-xl flex-1" />
        <div className="h-8 bg-gray-800 rounded-xl flex-[2]" />
      </div>
    </div>
  </div>
);

// ── Mobile filter drawer ──────────────────────────────────────────────────────
const FilterDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  activeCount: number;
}> = ({ open, onClose, children, activeCount }) => {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true" aria-label="Filters">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-auto bg-gray-950 rounded-t-2xl flex flex-col max-h-[90vh] shadow-2xl">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-700" aria-hidden="true" />
        </div>
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <h2 className="font-semibold text-white flex items-center gap-2">
            Filters
            {activeCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">
                {activeCount}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label="Close filters"
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
            Show results
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Skill tile grid ───────────────────────────────────────────────────────────
const SkillTileGrid: React.FC<{
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}> = ({ selectedId, onSelect }) => (
  <section className="bg-gray-900 border-b border-gray-800" aria-label="Browse by skill">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
        Browse by skill
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
              className={`
                flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all
                ${active
                  ? 'bg-brand-500/20 border-brand-500 text-brand-300 shadow-sm shadow-brand-500/20'
                  : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-600 hover:text-gray-200'
                }
              `}
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

// ── Sub-skill chips strip (shown when a skill tile is selected) ────────────────
const SubSkillStrip: React.FC<{
  tile: (typeof SKILL_TILES)[number];
  selectedSkills: string[];
  onToggleSkill: (skill: string) => void;
  onClearTile: () => void;
}> = ({ tile, selectedSkills, onToggleSkill, onClearTile }) => (
  <div className="bg-gray-950 border-b border-gray-800">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-xs font-semibold text-brand-400 whitespace-nowrap flex items-center gap-1.5">
        <span aria-hidden="true">{tile.icon}</span>
        {tile.label}
      </span>
      <span className="text-gray-700 text-xs" aria-hidden="true">—</span>
      <p className="text-xs text-gray-500">Filter by specific job:</p>
      <div className="flex flex-wrap gap-2">
        {tile.subSkills.map((sk) => {
          const active = selectedSkills.includes(sk);
          return (
            <button
              key={sk}
              onClick={() => onToggleSkill(sk)}
              aria-pressed={active}
              className={`
                px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
                ${active
                  ? 'bg-brand-500 border-brand-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }
              `}
            >
              {sk}
            </button>
          );
        })}
      </div>
      <button
        onClick={onClearTile}
        className="ml-auto text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1 transition-colors whitespace-nowrap"
        aria-label="Clear skill filter"
      >
        <X className="w-3 h-3" aria-hidden="true" />
        Clear
      </button>
    </div>
  </div>
);

// ── Hero banner ───────────────────────────────────────────────────────────────
const DirectoryHero: React.FC<{ searchValue: string; onSearch: (v: string) => void }> = ({
  searchValue,
  onSearch,
}) => (
  <div className="relative bg-gray-900 border-b border-gray-800 overflow-hidden">
    {/* BG texture */}
    <div className="absolute inset-0 opacity-5" aria-hidden="true">
      <svg width="100%" height="100%">
        <defs>
          <pattern id="hero-dots" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hero-dots)" />
      </svg>
    </div>
    <div className="absolute inset-y-0 left-0 w-1 bg-brand-500" aria-hidden="true" />

    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="max-w-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-brand-400" aria-hidden="true" />
          <span className="text-xs font-semibold text-brand-400 uppercase tracking-widest">
            OxSteed Helpers
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
          Find a trusted local helper
        </h1>
        <p className="text-gray-400 mt-2 text-base leading-relaxed">
          Browse background-checked, licensed, and insured helpers in your area.
          Book in minutes — satisfaction guaranteed.
        </p>

        {/* Hero search */}
        <div className="mt-6">
          <SearchBar
            value={searchValue}
            onChange={onSearch}
            placeholder="Try 'lawn mowing', 'electrician', or 'deep clean'…"
          />
        </div>

        {/* Popular categories */}
        <div className="mt-4 flex flex-wrap gap-2">
          {['Landscaping', 'Cleaning', 'Electrical', 'Plumbing', 'HVAC', 'Moving', 'Painting'].map(
            (cat) => (
              <button
                key={cat}
                onClick={() => onSearch(cat)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-xs text-gray-300 hover:text-white transition-colors"
              >
                {cat}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  </div>
);

// ── Main page ─────────────────────────────────────────────────────────────────
const HelpersDirectoryPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [filters, setFilters]           = useState<DirectoryFilters>(DEFAULT_FILTERS);
  const [sort, setSort]                 = useState<SortOption>('best_match');
  const [helpers, setHelpers]           = useState<HelperCardData[]>([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [loadState, setLoadState]       = useState<'loading' | 'success' | 'error'>('loading');
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);

  // Debounce filter/sort changes so we don't fire on every keystroke
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (f: DirectoryFilters, s: SortOption, p: number, append = false) => {
    setLoadState('loading');
    try {
      const res = await fetchHelpers(f, s, p, PAGE_SIZE);
      setHelpers((prev) => append ? [...prev, ...res.helpers] : res.helpers);
      setTotal(res.total);
      setLoadState('success');
    } catch {
      setLoadState('error');
    }
  }, []);

  // Read ?skill=X URL param on first mount and pre-select the matching tile
  useEffect(() => {
    const skillParam = searchParams.get('skill');
    if (skillParam) {
      const tile = SKILL_TILES.find((t) => t.id === skillParam);
      if (tile) {
        setSelectedTileId(tile.id);
        setFilters((f) => ({ ...f, categories: [tile.category] }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial load
  useEffect(() => {
    load(filters, sort, 1);
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload on filter / sort change (debounced 300 ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      load(filters, sort, 1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters, sort, load]);

  const updateFilters = useCallback((partial: Partial<DirectoryFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSelectedTileId(null);
  }, []);

  const handleTileSelect = useCallback((tileId: string | null) => {
    if (!tileId) {
      setSelectedTileId(null);
      setFilters((f) => ({ ...f, categories: [], skills: [] }));
      return;
    }
    const tile = SKILL_TILES.find((t) => t.id === tileId);
    if (!tile) return;
    setSelectedTileId(tileId);
    setFilters((f) => ({ ...f, categories: [tile.category], skills: [] }));
  }, []);

  const handleSubSkillToggle = useCallback((skill: string) => {
    setFilters((f) => {
      const next = f.skills.includes(skill)
        ? f.skills.filter((s) => s !== skill)
        : [...f.skills, skill];
      return { ...f, skills: next };
    });
  }, []);

  const selectedTile    = selectedTileId ? SKILL_TILES.find((t) => t.id === selectedTileId) ?? null : null;
  const boostedCategory = selectedTile?.category;

  // Client-side: float exact-category matches to the top when a skill tile is active
  const displayed = boostedCategory ? applySort(helpers, sort, boostedCategory) : helpers;
  const hasMore          = helpers.length < total;
  const activeFilterCount = countActiveFilters(filters);

  const handleShowMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    load(filters, sort, nextPage, true);
  }, [filters, sort, page, load]);

  const handleMessage = useCallback((id: string) => {
    window.location.href = `/helpers/${id}`;
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PageMeta
        title="Find Local Helpers Near You"
        description="Browse verified local helpers for electrical, plumbing, landscaping, handyman work and more. Compare bids and hire with confidence."
        url="https://oxsteed.com/helpers"
      />
      <Navbar />

      {/* Hero + search */}
      <DirectoryHero
        searchValue={filters.query}
        onSearch={(q) => updateFilters({ query: q })}
      />

      {/* Skill tile grid */}
      <SkillTileGrid selectedId={selectedTileId} onSelect={handleTileSelect} />

      {/* Sub-skill chips — shown when a tile is selected */}
      {selectedTile && (
        <SubSkillStrip
          tile={selectedTile}
          selectedSkills={filters.skills}
          onToggleSkill={handleSubSkillToggle}
          onClearTile={() => handleTileSelect(null)}
        />
      )}

      {/* ZIP notice — shown when a skill is selected but no zip is entered */}
      {selectedTile && !filters.zipCode && (
        <div className="bg-gray-900/60 border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-2 text-xs text-gray-500">
            <MapPin className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" aria-hidden="true" />
            Add your ZIP code in the sidebar to sort helpers by distance from you.
          </div>
        </div>
      )}

      {/* Mobile filter bar */}
      <div className="lg:hidden sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          aria-label={`Open filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}`}
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          Filters
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
            resultCount={total}
          />
        </div>
      </div>

      {/* Page body */}
      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        id="main-content"
      >
        <div className="flex gap-8">

          {/* ── Desktop sidebar ──────────────────────────────── */}
          <aside
            className="hidden lg:block w-72 flex-shrink-0"
            aria-label="Filter helpers"
          >
            <div className="sticky top-6">
              <FilterPanel
                filters={filters}
                onChange={updateFilters}
                onReset={resetFilters}
              />
            </div>
          </aside>

          {/* ── Results column ───────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Sort + active tags — desktop */}
            <div className="hidden lg:flex flex-col gap-3">
              <SortControls
                value={sort}
                onChange={setSort}
                resultCount={total}
              />
              <ActiveFilterTags filters={filters} onChange={updateFilters} />
            </div>

            {/* Active tags — mobile */}
            <div className="lg:hidden">
              <ActiveFilterTags filters={filters} onChange={updateFilters} />
            </div>

            {/* Grid */}
            {loadState === 'loading' && displayed.length === 0 ? (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
                aria-busy="true"
                aria-label="Loading helpers"
              >
                {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : loadState === 'error' ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-lg font-medium text-white mb-2">Something went wrong</p>
                <p className="text-sm mb-4">We couldn't load helpers right now. Please try again.</p>
                <button
                  onClick={() => load(filters, sort, 1)}
                  className="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : displayed.length === 0 ? (
              <EmptyState
                query={filters.query}
                hasFilters={activeFilterCount > 0}
                onReset={resetFilters}
                selectedCategory={selectedTile?.category}
                maxDistance={filters.maxDistance}
                onExpandRadius={() => updateFilters({ maxDistance: Math.min((filters.maxDistance || 25) * 2, 100) })}
              />
            ) : (
              <>
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
                  role="list"
                  aria-label={`${total} helpers found`}
                >
                  {displayed.map((helper) => (
                    <div key={helper.id} role="listitem">
                      <HelperCard
                        helper={helper}
                        onMessage={handleMessage}
                        highlightCategory={boostedCategory}
                      />
                    </div>
                  ))}
                </div>

                {/* Load more */}
                {hasMore && (
                  <div className="flex justify-center pt-4">
                    <button
                      onClick={handleShowMore}
                      disabled={loadState === 'loading'}
                      className="flex items-center gap-2 px-8 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-sm font-medium disabled:opacity-50"
                      aria-label={`Load more helpers (${total - displayed.length} remaining)`}
                    >
                      {loadState === 'loading' ? 'Loading…' : 'Show more helpers'}
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                      <span className="text-gray-500 text-xs">
                        ({total - displayed.length} more)
                      </span>
                    </button>
                  </div>
                )}

                {/* All loaded indicator */}
                {!hasMore && displayed.length > PAGE_SIZE && (
                  <p className="text-center text-xs text-gray-600 pt-2">
                    All {displayed.length} helpers shown
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />

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
    </div>
  );
};

export default HelpersDirectoryPage;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * API INTEGRATION NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. SEARCH & FILTER  GET /api/helpers?query=&categories=&skills=&licenses=
 *                     &insurance=&minRating=&minPrice=&maxPrice=&zip=
 *                     &maxDistance=&availableToday=&verified=&sort=&page=&limit=
 *    Replace: applyFilters() + applySort() with server response
 *    Server returns: { helpers: HelperCardData[], total: number, page: number }
 *
 * 2. PAGINATION        Use cursor-based or offset pagination from server.
 *    Replace: local slice with loading next page from API on "Show more" click.
 *    Add debounce (~300ms) to filter changes before firing API calls.
 *
 * 3. GEO DISTANCE      Server computes haversine distance from zip code centroid.
 *    Returns: distanceMiles on each HelperCardData.
 *    Client just displays it — no geo logic needed in the browser.
 *
 * 4. SKILLS / LICENSE / INSURANCE options: GET /api/helpers/filter-options
 *    Returns dynamic lists so new skills / licenses appear without frontend deploys.
 *
 * 5. SEARCH ANALYTICS  POST /api/analytics/search { query, filters, resultCount }
 *    Fire after each search to power relevance improvements.
 *
 * 6. POPULAR CATEGORIES  GET /api/helpers/popular-categories
 *    Returns top-N categories for the hero quick-filter buttons.
 * ─────────────────────────────────────────────────────────────────────────────
 */
