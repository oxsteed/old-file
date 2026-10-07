/**
 * ToolRentalsBrowse
 *
 * Customer-facing browse/search page for OxSteed tool rentals.
 * Route: /tool-rentals
 *
 * Layout mirrors the Helper Discovery page (`/helpers`):
 *   - Hero with eyebrow + title + search + popular categories
 *   - Tile grid (browse-by-category)
 *   - Sub-type chip strip (shown when a tile is selected)
 *   - Mobile sticky filter bar (drawer-triggered)
 *   - Desktop sidebar FilterPanel + results column
 *   - Sort controls + active filter tags + card grid
 *   - Empty state with adjacent-category recovery suggestions
 *   - Card skeletons during initial load
 *   - Mobile filter drawer (slide-up)
 *
 *   Available in EN / ES / FR / HT via the `toolRentalsDir.*` namespace.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, X, ChevronDown, Sparkles, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';

import SearchBar from '../components/toolDirectory/SearchBar';
import SaveSearchButton from '../components/SaveSearchButton';
import FilterPanel from '../components/toolDirectory/FilterPanel';
import SortControls from '../components/toolDirectory/SortControls';
import ActiveFilterTags from '../components/toolDirectory/ActiveFilterTags';
import EmptyState from '../components/toolDirectory/EmptyState';
import ToolDirectoryCard from '../components/toolDirectory/ToolDirectoryCard';
import ToolDetailModal from '../components/ToolDetailModal';

import {
  TOOL_TILES,
  DEFAULT_TOOL_FILTERS,
  countActiveToolFilters,
} from '../types/toolDirectory';
import { getToolTilesTranslated } from '../utils/toolRentalsTaxonomy';
import { getPublicSiteUrl } from '../utils/seoDescription';
import { toolRentalsApi } from '../api/toolRentals';
import './ToolRentalsBrowse.css';

const PAGE_SIZE = 30;

// ── Card skeleton ─────────────────────────────────────────────────────────────
const CardSkeleton = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse">
    <div className="h-40 bg-gray-800" />
    <div className="px-4 pt-3 pb-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-800 rounded w-3/4" />
          <div className="h-3 bg-gray-800 rounded w-1/2" />
        </div>
        <div className="w-16 h-7 bg-gray-800 rounded" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-5 bg-gray-800 rounded-full w-16" />
        <div className="h-5 bg-gray-800 rounded-full w-20" />
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
    <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true" aria-label={t('toolRentalsDir.filters')}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-auto bg-gray-950 rounded-t-2xl flex flex-col max-h-[90vh] shadow-2xl">
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-700" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <h2 className="font-semibold text-white flex items-center gap-2">
            {t('toolRentalsDir.filters')}
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
            {t('toolRentalsDir.showResults')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Tile grid ────────────────────────────────────────────────────────────────
const ToolTileGrid = ({ tiles, selectedId, onSelect }) => {
  const { t } = useTranslation();
  return (
    <section className="bg-gray-900 border-b border-gray-800" aria-label={t('toolRentalsDir.browseByCategory')}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          {t('toolRentalsDir.browseByCategory')}
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
          {tiles.map((tile) => {
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

// ── Sub-type chips strip ─────────────────────────────────────────────────────
const SubTypeStrip = ({ tile, selectedSubTypes, onToggleSubType, onClearTile }) => {
  const { t } = useTranslation();
  const rawTile = TOOL_TILES.find((tt) => tt.id === tile.id);
  const englishSubTypes = rawTile?.subTypes ?? [];
  return (
    <div className="bg-gray-950 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-brand-400 whitespace-nowrap flex items-center gap-1.5">
          <span aria-hidden="true">{tile.icon}</span>
          {tile.label}
        </span>
        <span className="text-gray-700 text-xs" aria-hidden="true">-</span>
        <p className="text-xs text-gray-500">{t('toolRentalsDir.filterByType')}</p>
        <div className="flex flex-wrap gap-2">
          {englishSubTypes.map((stEn, idx) => {
            const displayLabel = tile.subTypes[idx] ?? stEn;
            const active = selectedSubTypes.includes(stEn);
            return (
              <button
                key={stEn}
                onClick={() => onToggleSubType(stEn)}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-brand-500 border-brand-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }`}
              >
                {displayLabel}
              </button>
            );
          })}
        </div>
        <button
          onClick={onClearTile}
          className="ml-auto text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1 transition-colors whitespace-nowrap"
          aria-label={t('toolRentalsDir.clearFilter')}
        >
          <X className="w-3 h-3" aria-hidden="true" />
          {t('toolRentalsDir.clearFilter')}
        </button>
      </div>
    </div>
  );
};

// ── Hero ────────────────────────────────────────────────────────────────────
const DirectoryHero = ({ searchValue, onSearch, categoryChips, suggestTiles, filters }) => {
  const { t } = useTranslation();
  return (
    <div className="relative bg-gray-900 border-b border-gray-800 overflow-hidden">
      {/* BG texture */}
      <div className="absolute inset-0 opacity-5" aria-hidden="true">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="tools-hero-dots" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#tools-hero-dots)" />
        </svg>
      </div>
      <div className="absolute inset-y-0 left-0 w-1 bg-brand-500" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-brand-400" aria-hidden="true" />
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-widest">
                {t('toolRentalsDir.heroEyebrow')}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
              {t('toolRentalsDir.heroTitle')}
            </h1>
            <p className="text-gray-400 mt-2 text-base leading-relaxed">
              {t('toolRentalsDir.heroSubtitle')}
            </p>

            <div className="mt-6">
              <SearchBar
                value={searchValue}
                onChange={onSearch}
                placeholder={t('toolRentalsDir.heroSearchPlaceholder')}
                tiles={suggestTiles}
                categories={categoryChips}
              />
            </div>

            <div className="mt-3">
              <SaveSearchButton
                searchType="tool"
                query={searchValue}
                filters={filters}
                dark
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {categoryChips.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSearch(key)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-xs text-gray-300 hover:text-white transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* List Your Tool CTA */}
          <div className="lg:flex-shrink-0">
            <Link
              to="/profile/tool-rentals"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/20 transition-all hover:shadow-brand-500/30 hover:-translate-y-0.5"
            >
              <Wrench className="w-4 h-4" aria-hidden="true" />
              {t('toolRentalsDir.listYourTool')}
            </Link>
            <p className="text-xs text-gray-500 mt-2 max-w-[200px]">
              {t('toolRentalsDir.listYourToolSubtitle')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── URL → initial state ──────────────────────────────────────────────────────
function getInitialState() {
  const params = new URLSearchParams(window.location.search);
  const filters = { ...DEFAULT_TOOL_FILTERS };
  let tileId = null;

  const categoryParam = params.get('category');
  if (categoryParam) {
    const tile = TOOL_TILES.find((t) => t.id === categoryParam);
    if (tile) {
      tileId = tile.id;
      filters.categories = [tile.category];
    } else {
      filters.query = categoryParam.replace(/-/g, ' ');
    }
  }

  const qParam = params.get('q');
  if (qParam) filters.query = qParam;

  const cityParam = params.get('city');
  if (cityParam) filters.city = cityParam;

  if (params.get('availableNow') === 'true') filters.availableNow = true;
  if (params.get('delivery') === 'true') filters.deliveryAvailable = true;

  return { filters, tileId };
}

// ── Apply client-side filters that the backend doesn't support ──────────────
function applyClientFilters(tools, f) {
  return tools.filter((tool) => {
    if (f.subTypes.length > 0) {
      const haystack = `${tool.name || ''} ${tool.brand || ''} ${tool.model || ''} ${tool.description || ''}`.toLowerCase();
      const matches = f.subTypes.some((st) => haystack.includes(st.toLowerCase()));
      if (!matches) return false;
    }
    if (f.conditions.length > 0) {
      const c = String(tool.condition || '').toLowerCase();
      const normalized = (c === 'new' || c === 'like new') ? 'excellent' : c;
      if (!f.conditions.includes(normalized)) return false;
    }
    if (f.deliveryAvailable && !tool.delivery_available) return false;
    if (f.availableNow && !tool.is_available) return false;
    if (f.requiresDeposit !== null) {
      const tdRequires = !!tool.requires_deposit;
      if (tdRequires !== f.requiresDeposit) return false;
    }
    return true;
  });
}

function applyClientSort(tools, sort, boostedCategory) {
  const copy = [...tools];
  const baseCompare = (a, b) => {
    switch (sort) {
      case 'price-asc':    return Number(a.daily_rate || 0) - Number(b.daily_rate || 0);
      case 'price-desc':   return Number(b.daily_rate || 0) - Number(a.daily_rate || 0);
      case 'most-popular': return Number(b.review_count || 0) - Number(a.review_count || 0);
      case 'highest-rated':return Number(b.avg_rating || 0) - Number(a.avg_rating || 0);
      case 'newest':
      default: {
        const tA = new Date(a.created_at || 0).getTime() || 0;
        const tB = new Date(b.created_at || 0).getTime() || 0;
        return tB - tA;
      }
    }
  };
  return copy.sort((a, b) => {
    if (boostedCategory) {
      const aMatch = a.category === boostedCategory ? 0 : 1;
      const bMatch = b.category === boostedCategory ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    return baseCompare(a, b);
  });
}

// ── Main page ───────────────────────────────────────────────────────────────
const ToolRentalsBrowse = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { toolId: routeToolId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [{ filters: _initFilters, tileId: _initTileId }] = useState(getInitialState);
  const [filters, setFilters] = useState(_initFilters);
  const [sort, setSort] = useState('newest');
  const [tools, setTools] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadState, setLoadState] = useState('loading'); // 'loading' | 'success' | 'error'
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTileId, setSelectedTileId] = useState(_initTileId);

  // Detail modal
  const [selectedTool, setSelectedTool] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const debounceRef = useRef(null);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    const rentalInvoiceId = searchParams.get('rentalInvoiceId');
    if (!rentalInvoiceId) return;
    api.get(`/tool-rentals/invoices/${rentalInvoiceId}`)
      .then(({ data }) => {
        const number = data?.invoice_number || rentalInvoiceId;
        toast.success(t('toolRentals.invoiceDeepLink', {
          defaultValue: 'Tool rental invoice {{number}} — payment instructions are in your rental booking.',
          number,
        }));
      })
      .catch(() => {
        toast.error(t('toolRentals.invoiceDeepLinkMissing', {
          defaultValue: 'We could not load that rental invoice. Check My Invoices or your booking email.',
        }));
      })
      .finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('rentalInvoiceId');
        setSearchParams(next, { replace: true });
      });
  }, [searchParams, setSearchParams, t]);

  const load = useCallback(async (f, s, offset, append = false) => {
    setLoadState('loading');
    try {
      const params = {
        sort: s,
        limit: PAGE_SIZE,
        offset,
        name: f.query || undefined,
        city: f.city || undefined,
        category: f.categories[0] || undefined,
        priceMin: f.priceRange ? f.priceRange[0] : undefined,
        priceMax: f.priceRange && f.priceRange[1] < 9999 ? f.priceRange[1] : undefined,
      };
      const fetched = await toolRentalsApi.browseTools(params);
      setTools((prev) => append ? [...prev, ...fetched] : fetched);
      setHasMore(fetched.length === PAGE_SIZE);
      setLoadState('success');
    } catch (err) {
      console.error('Failed to load tools:', err);
      setLoadState('error');
    }
  }, []);

  // Single effect: immediate on first render, debounced afterwards
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      load(filters, sort, 0);
      setPage(0);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      load(filters, sort, 0);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters, sort, load]);

  // Deep links: /tool-rentals/:id and /tool-rentals?openTool=123
  useEffect(() => {
    const raw = routeToolId || searchParams.get('openTool');
    if (!raw) return;
    const id = parseInt(raw, 10);
    if (!Number.isInteger(id) || id < 1) return;
    let cancelled = false;
    (async () => {
      try {
        const tool = await toolRentalsApi.getPublicTool(id);
        if (cancelled || !tool) return;
        setSelectedTool(tool);
        setIsModalOpen(true);
        if (!routeToolId) {
          const next = new URLSearchParams(searchParams);
          next.delete('openTool');
          setSearchParams(next, { replace: true });
        }
      } catch {
        /* listing may have been removed */
      }
    })();
    return () => { cancelled = true; };
  }, [routeToolId, searchParams, setSearchParams]);

  const updateFilters = useCallback((partial) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_TOOL_FILTERS);
    setSelectedTileId(null);
  }, []);

  const handleTileSelect = useCallback((tileId) => {
    if (!tileId) {
      setSelectedTileId(null);
      setFilters((f) => ({ ...f, categories: [], subTypes: [] }));
      return;
    }
    const tile = TOOL_TILES.find((t) => t.id === tileId);
    if (!tile) return;
    setSelectedTileId(tileId);
    setFilters((f) => ({ ...f, categories: [tile.category], subTypes: [] }));
  }, []);

  const handleSubTypeToggle = useCallback((subType) => {
    setFilters((f) => {
      const next = f.subTypes.includes(subType)
        ? f.subTypes.filter((s) => s !== subType)
        : [...f.subTypes, subType];
      return { ...f, subTypes: next };
    });
  }, []);

  const translatedTiles = useMemo(() => getToolTilesTranslated(t), [t, i18n.language]);

  const categoryHeroChips = useMemo(
    () => TOOL_TILES.slice(0, 8).map((tile) => ({
      key: tile.category,
      label: translatedTiles.find((tt) => tt.id === tile.id)?.label ?? tile.label,
    })),
    [translatedTiles],
  );

  const selectedTile = selectedTileId
    ? translatedTiles.find((tt) => tt.id === selectedTileId) ?? null
    : null;
  const boostedCategory = selectedTile?.category;

  const filteredTools = useMemo(
    () => applyClientFilters(tools, filters),
    [tools, filters],
  );
  const displayed = useMemo(
    () => applyClientSort(filteredTools, sort, boostedCategory),
    [filteredTools, sort, boostedCategory],
  );

  const totalShown = displayed.length;
  const activeFilterCount = countActiveToolFilters(filters);

  const handleShowMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    load(filters, sort, nextPage * PAGE_SIZE, true);
  }, [filters, sort, page, load]);

  const handleViewDetails = useCallback((tool) => {
    setSelectedTool(tool);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedTool(null);
    if (routeToolId) {
      navigate('/tool-rentals', { replace: true });
    }
  }, [navigate, routeToolId]);

  const handleMessageOwner = useCallback((userId) => {
    handleCloseModal();
    navigate(`/messages?userId=${userId}`);
  }, [handleCloseModal, navigate]);

  const handleViewProfile = useCallback((userId) => {
    handleCloseModal();
    navigate(`/helpers/${userId}`);
  }, [handleCloseModal, navigate]);

  const toolPublicUrl = routeToolId
    ? `${getPublicSiteUrl()}/tool-rentals/${routeToolId}`
    : `${getPublicSiteUrl()}/tool-rentals`;
  const toolMetaDescription = selectedTool?.description
    || (selectedTool
      ? `${selectedTool.name} is available for local rental through OxSteed.`
      : t('toolRentalsDir.metaDescription'));

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PageMeta
        title={selectedTool && routeToolId ? `${selectedTool.name} | OxSteed Tool Rentals` : t('toolRentalsDir.heroTitle')}
        description={toolMetaDescription}
        url={toolPublicUrl}
        noIndex={!routeToolId || Boolean(routeToolId && !selectedTool)}
      />
      <Navbar />

      {/* Hero */}
      <DirectoryHero
        searchValue={filters.query}
        onSearch={(q) => updateFilters({ query: q })}
        categoryChips={categoryHeroChips}
        suggestTiles={translatedTiles}
        filters={filters}
      />

      {/* Tile grid */}
      <ToolTileGrid tiles={translatedTiles} selectedId={selectedTileId} onSelect={handleTileSelect} />

      {/* Sub-type strip */}
      {selectedTile && (
        <SubTypeStrip
          tile={selectedTile}
          selectedSubTypes={filters.subTypes}
          onToggleSubType={handleSubTypeToggle}
          onClearTile={() => handleTileSelect(null)}
        />
      )}

      {/* Mobile filter bar */}
      <div className="lg:hidden sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          aria-label={
            activeFilterCount > 0
              ? t('toolRentalsDir.openFiltersAria', {
                  details: t('toolRentalsDir.openFiltersActiveDetails', { count: activeFilterCount }),
                })
              : t('toolRentalsDir.openFiltersAria', { details: '' })
          }
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          {t('toolRentalsDir.filters')}
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
            resultCount={totalShown}
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
            aria-label={t('toolRentalsDir.filterAsideAria')}
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

            {/* Sort + active tags - desktop */}
            <div className="hidden lg:flex flex-col gap-3">
              <SortControls
                value={sort}
                onChange={setSort}
                resultCount={totalShown}
              />
              <ActiveFilterTags filters={filters} onChange={updateFilters} />
            </div>

            {/* Active tags - mobile */}
            <div className="lg:hidden">
              <ActiveFilterTags filters={filters} onChange={updateFilters} />
            </div>

            {/* Grid */}
            {loadState === 'loading' && displayed.length === 0 ? (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
                aria-busy="true"
                aria-label={t('toolRentalsDir.loadingToolsAria')}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : loadState === 'error' ? (
              <div className="flex flex-col items-center justify-center gap-5 py-16 px-6 text-center">
                <div className="w-16 h-16 rounded-full bg-rose-900/30 border border-rose-800/40 flex items-center justify-center">
                  <Wrench className="w-7 h-7 text-rose-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-white mb-1">{t('errors.generic')}</p>
                  <p className="text-sm text-gray-400 max-w-sm leading-relaxed">{t('toolRentalsDir.loadError')}</p>
                </div>
                <button
                  onClick={() => load(filters, sort, 0)}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition-colors shadow shadow-brand-500/20"
                >
                  {t('common.retry')}
                </button>
                <Link
                  to="/profile/tool-rentals"
                  className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {t('toolRentalsDir.listToolCta')}
                </Link>
              </div>
            ) : displayed.length === 0 ? (
              <EmptyState
                query={filters.query}
                hasFilters={activeFilterCount > 0}
                onReset={resetFilters}
                selectedCategory={selectedTile?.category}
                translatedTiles={translatedTiles}
              />
            ) : (
              <>
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
                  role="list"
                  aria-label={t('toolRentalsDir.toolsFoundAria', { count: totalShown })}
                >
                  {displayed.map((tool) => (
                    <div key={tool.id} role="listitem">
                      <ToolDirectoryCard
                        tool={tool}
                        onViewDetails={handleViewDetails}
                        onMessage={handleMessageOwner}
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
                      aria-label={t('toolRentalsDir.loadMoreToolsAria')}
                    >
                      {loadState === 'loading' ? t('common.loading') : t('toolRentalsDir.showMore')}
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {!hasMore && totalShown > PAGE_SIZE && (
                  <p className="text-center text-xs text-gray-600 pt-2">
                    {t('toolRentalsDir.allShown', { count: totalShown })}
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

      {/* Tool Detail Modal */}
      {selectedTool && (
        <ToolDetailModal
          tool={selectedTool}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onMessage={handleMessageOwner}
          onViewProfile={handleViewProfile}
        />
      )}
    </div>
  );
};

export default ToolRentalsBrowse;
