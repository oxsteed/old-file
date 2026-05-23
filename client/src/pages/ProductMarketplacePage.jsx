/**
 * ProductMarketplacePage
 *
 * Customer-facing browse/search page for discovering OxSteed products.
 * Mirrors the HelpersDirectoryPage layout and design language.
 *
 * Layout:
 *   - Hero section with search + popular category pills
 *   - Browse by Category grid (high-density product categories)
 *   - Desktop: left sidebar with filters, right results grid
 *   - Mobile: filters in slide-up drawer
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, X, ChevronDown, Sparkles, ShoppingCart, Loader } from 'lucide-react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useDebouncedCallback } from 'use-debounce';
import { toast } from 'sonner';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import ProductCard from '../components/ProductCard';
import ProductDetailModal from '../components/ProductDetailModal';

import { marketplaceApi, cartApi } from '../api/marketplaceApi';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import '../styles/ProductMarketplacePage.css';

// Product categories with icons
const PRODUCT_CATEGORIES = [
  { id: 'tools', label: 'Tools', icon: '🔧', emoji: true },
  { id: 'safety', label: 'Safety Gear', icon: '⛑️', emoji: true },
  { id: 'hardware', label: 'Hardware', icon: '🔩', emoji: true },
  { id: 'materials', label: 'Materials', icon: '📦', emoji: true },
  { id: 'power', label: 'Power Tools', icon: '⚡', emoji: true },
  { id: 'hand-tools', label: 'Hand Tools', icon: '🔨', emoji: true },
  { id: 'measuring', label: 'Measuring', icon: '📐', emoji: true },
  { id: 'fasteners', label: 'Fasteners', icon: '🔗', emoji: true },
  { id: 'paint', label: 'Paint & Coatings', icon: '🎨', emoji: true },
  { id: 'lumber', label: 'Lumber', icon: '🪵', emoji: true },
];

const SORT_OPTIONS = {
  best_match: 'marketplace.sort.bestMatch',
  price_asc: 'marketplace.sort.lowestPrice',
  price_desc: 'marketplace.sort.highestPrice',
  rating: 'marketplace.sort.topRated',
  newest: 'marketplace.sort.newest',
  in_carts: 'marketplace.sort.mostPopular',
};

const PAGE_SIZE = 9;

const BROWSE_SORT_MAP = {
  best_match: 'in_carts',
  price_asc: 'price_asc',
  price_desc: 'price_desc',
  rating: 'rating',
  newest: 'newest',
  in_carts: 'in_carts',
};

const normalizeProductsPayload = (payload) => ({
  products: payload?.data || payload?.products || [],
  pagination: payload?.pagination || {},
});

// ── Card skeleton ─────────────────────────────────────────────────────────────
const CardSkeleton = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse">
    <div className="h-40 bg-gray-800" />
    <div className="px-4 pt-4 pb-4 space-y-3">
      <div className="h-4 bg-gray-800 rounded w-3/4" />
      <div className="h-3 bg-gray-800 rounded w-1/2" />
      <div className="flex gap-2 justify-between mt-4">
        <div className="h-3 bg-gray-800 rounded flex-1" />
        <div className="h-3 bg-gray-800 rounded w-16" />
      </div>
      <div className="flex gap-2 pt-2">
        <button className="flex-1 h-9 bg-gray-800 rounded-xl" disabled />
        <button className="flex-1 h-9 bg-gray-800 rounded-xl" disabled />
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
    <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative mt-auto bg-gray-950 rounded-t-2xl flex flex-col max-h-[90vh] shadow-2xl">
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-700" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <h2 className="font-semibold text-white flex items-center gap-2">
            {t('marketplace.filters')}
            {activeCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold">
                {activeCount}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {children}
        </div>
        <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
          >
            {t('marketplace.showResults')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Category tile grid ────────────────────────────────────────────────────────
const CategoryTileGrid = ({ selectedCategory, onSelect }) => {
  const { t } = useTranslation();
  return (
    <section className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          {t('marketplace.browseByCategory')}
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
          {PRODUCT_CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => onSelect(active ? '' : cat.id)}
                aria-pressed={active}
                title={cat.label}
                className={`
                  flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all
                  ${active
                    ? 'bg-orange-500/20 border-orange-500 text-orange-300 shadow-sm shadow-orange-500/20'
                    : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-600 hover:text-gray-200'
                  }
                `}
              >
                <span className="text-xl leading-none" aria-hidden="true">{cat.icon}</span>
                <span className="text-xs font-medium leading-tight">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
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
            <pattern id="hero-dots-products" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-dots-products)" />
        </svg>
      </div>
      <div className="absolute inset-y-0 left-0 w-1 bg-orange-500" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-semibold text-orange-400 uppercase tracking-widest">
              {t('marketplace.browseProducts')}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
            {t('marketplace.title')}
          </h1>
          <p className="text-gray-400 mt-2 text-base leading-relaxed">
            {t('marketplace.subtitle')}
          </p>

          {/* Hero search */}
          <div className="mt-6">
            <div className="relative">
              <input
                type="text"
                placeholder={t('marketplace.searchPlaceholder')}
                value={searchValue}
                onChange={(e) => onSearch(e.target.value)}
                className="w-full px-5 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
              />
            </div>
          </div>

          {/* Popular categories */}
          <div className="mt-4 flex flex-wrap gap-2">
            {PRODUCT_CATEGORIES.slice(0, 6).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSearch(cat.label)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-xs text-gray-300 hover:text-white transition-colors"
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const SkillFilterStrip = ({ skills, selectedSkillId, onSelectSkill, showingRecommended }) => {
  const { t } = useTranslation();

  if (!skills.length) return null;

  return (
    <section className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">
                {t('marketplace.browseBySkill', { defaultValue: 'Browse by Skill' })}
              </p>
              <p className="text-sm text-gray-400">
                {showingRecommended
                  ? t('marketplace.recommendedForYourSkills', { defaultValue: 'Recommended for Your Skills' })
                  : t('marketplace.pickASkillFilter', { defaultValue: 'Pick one of your skills to narrow the catalog.' })}
              </p>
            </div>
            {selectedSkillId && (
              <button
                type="button"
                onClick={() => onSelectSkill('')}
                className="text-sm text-orange-400 hover:text-orange-300 transition-colors"
              >
                {t('marketplace.clearSkillFilter', { defaultValue: 'Clear skill filter' })}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => {
              const active = String(selectedSkillId) === String(skill.skill_id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => onSelectSkill(active ? '' : String(skill.skill_id))}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    active
                      ? 'bg-orange-500/20 border-orange-500 text-orange-200'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {skill.skill_name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

// ── Desktop sidebar filters ───────────────────────────────────────────────────
const FilterPanel = ({ selectedCategory, selectedMinPrice, selectedMaxPrice, onCategoryChange, onMinPriceChange, onMaxPriceChange, categories, sortBy, onSortChange }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Quick Filters */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('marketplace.quickFilters')}
        </h3>
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input type="checkbox" className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-orange-500" />
            <span className="text-sm text-gray-400 group-hover:text-gray-300">{t('marketplace.inStock')}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input type="checkbox" className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-orange-500" />
            <span className="text-sm text-gray-400 group-hover:text-gray-300">{t('marketplace.discounted')}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input type="checkbox" className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-orange-500" />
            <span className="text-sm text-gray-400 group-hover:text-gray-300">{t('marketplace.onSale')}</span>
          </label>
        </div>
      </div>

      {/* Category Checkboxes */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('marketplace.category')}
        </h3>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {PRODUCT_CATEGORIES.map((cat) => (
            <label key={cat.id} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={selectedCategory === cat.id}
                onChange={(e) => onCategoryChange(e.target.checked ? cat.id : '')}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-orange-500"
              />
              <span className="text-sm text-gray-400 group-hover:text-gray-300">{cat.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Price Range */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('marketplace.priceRange')}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('marketplace.minPrice')}</label>
            <input
              type="number"
              placeholder="0"
              value={selectedMinPrice}
              onChange={(e) => onMinPriceChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('marketplace.maxPrice')}</label>
            <input
              type="number"
              placeholder="Any"
              value={selectedMaxPrice}
              onChange={(e) => onMaxPriceChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Sort */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('marketplace.sortBy')}
        </h3>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500 transition-colors"
        >
          {Object.entries(SORT_OPTIONS).map(([key, labelKey]) => (
            <option key={key} value={key}>{t(labelKey)}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyState = ({ onReset }) => {
  const { t } = useTranslation();
  return (
    <div className="text-center py-16">
      <ShoppingCart className="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <h3 className="text-xl font-semibold text-white mb-2">{t('marketplace.noProducts')}</h3>
      <p className="text-gray-400 mb-6">{t('marketplace.tryDifferentFilters')}</p>
      <button
        onClick={onReset}
        className="px-6 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm transition-colors"
      >
        {t('marketplace.clearAll')}
      </button>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProductMarketplacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isHelper } = useAuth();

  // State from URL
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [selectedMinPrice, setSelectedMinPrice] = useState(searchParams.get('minPrice') || '');
  const [selectedMaxPrice, setSelectedMaxPrice] = useState(searchParams.get('maxPrice') || '');
  const [selectedSkillId, setSelectedSkillId] = useState(searchParams.get('skillId') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'best_match');

  // UI state
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showNewCartModal, setShowNewCartModal] = useState(false);
  const [newCartName, setNewCartName] = useState('');
  const [currentCart, setCurrentCart] = useState(() => {
    try {
      const saved = localStorage.getItem('oxs:lastCart');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const debouncedSearch = useDebouncedCallback((query) => {
    setSearchQuery(query);
  }, 300);

  // Update URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    if (selectedMinPrice) params.set('minPrice', selectedMinPrice);
    if (selectedMaxPrice) params.set('maxPrice', selectedMaxPrice);
    if (selectedSkillId) params.set('skillId', selectedSkillId);
    if (sortBy !== 'best_match') params.set('sortBy', sortBy);
    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedCategory, selectedMinPrice, selectedMaxPrice, selectedSkillId, sortBy, setSearchParams]);

  // Persist cart
  useEffect(() => {
    if (currentCart) {
      localStorage.setItem('oxs:lastCart', JSON.stringify(currentCart));
    }
  }, [currentCart]);

  // Fetch categories
  const { data: categoriesData } = useQuery({
    queryKey: ['productCategories'],
    queryFn: () => marketplaceApi.getCategories(),
    staleTime: Infinity,
  });
  const categories = categoriesData?.data?.categories || [];

  const { data: userSkillsData } = useQuery({
    queryKey: ['productMarketplaceUserSkills', user?.id],
    queryFn: async () => {
      const response = await api.get('/user-skills/me');
      return response.data?.skills || [];
    },
    enabled: !!user && isHelper,
    staleTime: 5 * 60 * 1000,
  });
  const userSkills = (userSkillsData || []).filter((skill) => skill.skill_id);
  const trimmedSearchQuery = searchQuery.trim();
  const selectedSkillIds = selectedSkillId ? [Number(selectedSkillId)].filter(Boolean) : [];
  const hasPriceFilters = Boolean(selectedMinPrice || selectedMaxPrice);
  const hasBrowseFilters = Boolean(selectedCategory || hasPriceFilters || selectedSkillIds.length > 0);
  const shouldUseRecommended = Boolean(
    user &&
    isHelper &&
    userSkills.length > 0 &&
    !trimmedSearchQuery &&
    !hasBrowseFilters
  );
  const shouldUseSearch = trimmedSearchQuery.length >= 2;

  // Infinite scroll products
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['products', trimmedSearchQuery, selectedCategory, selectedMinPrice, selectedMaxPrice, selectedSkillId, sortBy, shouldUseRecommended],
    queryFn: async ({ pageParam = 1 }) => {
      const minPrice = selectedMinPrice ? Number(selectedMinPrice) : null;
      const maxPrice = selectedMaxPrice ? Number(selectedMaxPrice) : null;

      if (shouldUseRecommended) {
        const response = await marketplaceApi.getRecommendedProducts(PAGE_SIZE);
        return {
          products: response.data?.data || [],
          pagination: {
            page: 1,
            limit: PAGE_SIZE,
            total: response.data?.data?.length || 0,
            hasMore: false,
          },
        };
      }

      const response = shouldUseSearch
        ? await marketplaceApi.searchProducts(
            trimmedSearchQuery,
            selectedSkillIds,
            minPrice,
            maxPrice,
            pageParam,
            PAGE_SIZE,
            sortBy,
            selectedCategory
          )
        : await marketplaceApi.browseProducts({
            skillIds: selectedSkillIds,
            minPrice,
            maxPrice,
            category: selectedCategory,
            sortBy: BROWSE_SORT_MAP[sortBy] || 'newest',
            page: pageParam,
            limit: PAGE_SIZE,
          });

      return normalizeProductsPayload(response.data);
    },
    getNextPageParam: (lastPage) => {
      const currentPage = lastPage.pagination?.page || 1;
      const totalPages = Math.ceil((lastPage.pagination?.total || 0) / PAGE_SIZE);
      return currentPage < totalPages ? currentPage + 1 : undefined;
    },
    staleTime: 5 * 60 * 1000,
  });

  const allProducts = data?.pages.flatMap((page) => page.products || []) || [];
  const activeFilterCount = [trimmedSearchQuery, selectedCategory, selectedMinPrice, selectedMaxPrice, selectedSkillId].filter(Boolean).length;

  // Handlers
  const handleClearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedMinPrice('');
    setSelectedMaxPrice('');
    setSelectedSkillId('');
    setSortBy('best_match');
  };

  const handleAddToCart = async (productId, quantity = 1) => {
    if (!user) {
      toast.error(t('marketplace.loginRequired'));
      navigate('/login');
      return;
    }

    if (!currentCart) {
      setShowNewCartModal(true);
      return;
    }

    try {
      await cartApi.addItem(currentCart.id, productId, quantity);
      toast.success(t('marketplace.itemAdded'));
    } catch {
      toast.error(t('common.errorUpdating'));
    }
  };

  const handleCreateCart = async () => {
    if (!newCartName.trim()) {
      toast.error(t('marketplace.cartNameRequired'));
      return;
    }

    try {
      const response = await cartApi.createCart(null, newCartName.trim());
      setCurrentCart(response.data);
      setShowNewCartModal(false);
      setNewCartName('');
      toast.success(t('marketplace.cartCreated'));
    } catch {
      toast.error(t('common.errorCreating'));
    }
  };

  // Intersection observer for infinite scroll
  const loadMoreRef = useRef(null);
  useEffect(() => {
    if (!loadMoreRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      <PageMeta
        title={t('marketplace.title')}
        description={t('marketplace.description')}
      />

      <Navbar />

      <DirectoryHero searchValue={searchQuery} onSearch={debouncedSearch} />
      <SkillFilterStrip
        skills={userSkills}
        selectedSkillId={selectedSkillId}
        onSelectSkill={setSelectedSkillId}
        showingRecommended={shouldUseRecommended}
      />

      <CategoryTileGrid selectedCategory={selectedCategory} onSelect={setSelectedCategory} />

      {/* Mobile filter bar */}
      <div className="lg:hidden sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={() => setShowFilterDrawer(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4" />
          {t('marketplace.filters')}
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Page body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-72 flex-shrink-0">
            <div className="sticky top-6">
              <FilterPanel
                selectedCategory={selectedCategory}
                selectedMinPrice={selectedMinPrice}
                selectedMaxPrice={selectedMaxPrice}
                onCategoryChange={setSelectedCategory}
                onMinPriceChange={setSelectedMinPrice}
                onMaxPriceChange={setSelectedMaxPrice}
                categories={categories}
                sortBy={sortBy}
                onSortChange={setSortBy}
              />
            </div>
          </aside>

          {/* Results column */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Grid */}
            {isLoading && allProducts.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" aria-busy="true">
                {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : allProducts.length === 0 ? (
              <EmptyState onReset={handleClearAllFilters} />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" role="list">
                  {allProducts.map((product) => (
                    <div key={product.id} role="listitem">
                      <ProductCard
                        product={product}
                        isRecommended={shouldUseRecommended}
                        onAddToCart={() => handleAddToCart(product.id)}
                        onViewDetails={() => setSelectedProduct(product)}
                        disabled={!user}
                      />
                    </div>
                  ))}
                </div>

                {/* Load more */}
                {(hasNextPage || isFetchingNextPage) && (
                  <div ref={loadMoreRef} className="flex justify-center py-8">
                    {isFetchingNextPage && (
                      <div className="flex items-center gap-2 text-gray-400">
                        <Loader className="w-5 h-5 animate-spin" />
                        <span>{t('common.loading')}</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Create Cart Modal */}
      {showNewCartModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-xl font-bold text-white mb-4">{t('marketplace.createNewCart')}</h2>
            <input
              type="text"
              placeholder={t('marketplace.cartNamePlaceholder')}
              value={newCartName}
              onChange={(e) => setNewCartName(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 mb-6"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowNewCartModal(false)}
                className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateCart}
                className="flex-1 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition-colors font-medium"
              >
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={handleAddToCart}
        />
      )}

      {/* Filter Drawer (Mobile) */}
      <FilterDrawer
        open={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        activeCount={activeFilterCount}
      >
        <FilterPanel
          selectedCategory={selectedCategory}
          selectedMinPrice={selectedMinPrice}
          selectedMaxPrice={selectedMaxPrice}
          onCategoryChange={setSelectedCategory}
          onMinPriceChange={setSelectedMinPrice}
          onMaxPriceChange={setSelectedMaxPrice}
          categories={categories}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </FilterDrawer>

      <Footer />
    </>
  );
}
