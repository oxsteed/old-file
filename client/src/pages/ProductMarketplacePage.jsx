/**
 * ProductMarketplacePage — Advanced Product Discovery
 *
 * Amazon-scale marketplace with:
 * - 100+ hierarchical product categories
 * - Skill-based product discovery (click "Electrician" → electrical products)
 * - Advanced search with synonyms and ranking
 * - Product-skill mapping for intelligent browsing
 *
 * Layout:
 *   - Hero with search + popular category/skill pills
 *   - Category grid (dynamic from API)
 *   - Skill grid for trade-specific discovery
 *   - Desktop sidebar: filters by category, skill, price, rating
 *   - Mobile: filters in bottom drawer
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, X, ChevronDown, Zap, ShoppingCart, Loader } from 'lucide-react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useDebouncedCallback } from 'use-debounce';
import { toast } from 'sonner';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import ProductCard from '../components/ProductCard';
import ProductDetailModal from '../components/ProductDetailModal';

import { marketplaceApi, cartApi } from '../api/marketplaceApi';
import { useAuth } from '../hooks/useAuth';
import '../styles/ProductMarketplacePage.css';

const SORT_OPTIONS = {
  best_match: 'marketplace.sortOptions.bestMatch',
  price_asc: 'marketplace.sortOptions.lowestPrice',
  price_desc: 'marketplace.sortOptions.highestPrice',
  rating: 'marketplace.sortOptions.topRated',
  newest: 'marketplace.sortOptions.newest',
  in_carts: 'marketplace.sortOptions.mostPopular',
};

const PAGE_SIZE = 9;

// ── Card skeleton ──────────────────────────────────────────────────────────────
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

// ── Mobile filter drawer ───────────────────────────────────────────────────────
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

// ── Category tile grid ──────────────────────────────────────────────────────────
const CategoryTileGrid = ({ categories, selectedCategory, onSelect, loading }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <section className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="h-6 bg-gray-800 rounded w-40 mb-4 animate-pulse" />
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
            {Array(10).fill(null).map((_, i) => (
              <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const rootCats = categories.filter(c => !c.parent_category_id).slice(0, 10);

  return (
    <section className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          {t('marketplace.browseByCategory')}
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
          {rootCats.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => onSelect(active ? '' : cat.id)}
                aria-pressed={active}
                className={`p-2 rounded-lg text-center transition-all duration-200 ${
                  active
                    ? 'bg-orange-500 text-white ring-2 ring-orange-400'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700'
                }`}
              >
                <div className="text-lg mb-1">{cat.icon_emoji || '📦'}</div>
                <div className="text-xs font-medium leading-tight line-clamp-2">{cat.name}</div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ── Skill tile grid (Trade-specific discovery) ──────────────────────────────────
const SkillTileGrid = ({ skills, selectedSkill, onSelect, loading }) => {
  const { t } = useTranslation();

  if (loading || !skills || skills.length === 0) return null;

  const topSkills = skills.slice(0, 12);

  return (
    <section className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          {t('marketplace.browseBySkill')}
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-2">
          {topSkills.map((skill) => {
            const active = selectedSkill === skill.id;
            return (
              <button
                key={skill.id}
                onClick={() => onSelect(active ? '' : skill.id)}
                aria-pressed={active}
                className={`p-2 rounded-lg text-center transition-all duration-200 ${
                  active
                    ? 'bg-orange-500 text-white ring-2 ring-orange-400'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700'
                }`}
                title={`${skill.product_count} ${t('common.products')}`}
              >
                <div className="text-lg mb-1"><Zap className="w-5 h-5 inline-block" /></div>
                <div className="text-xs font-medium leading-tight line-clamp-2">{skill.name}</div>
                <div className="text-xs text-gray-500 mt-1">{skill.product_count}</div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ── Desktop sidebar filters ────────────────────────────────────────────────────
const FilterPanel = ({
  selectedCategory,
  selectedSkill,
  selectedMinPrice,
  selectedMaxPrice,
  onCategoryChange,
  onSkillChange,
  onMinPriceChange,
  onMaxPriceChange,
  categories,
  skills,
  sortBy,
  onSortChange,
}) => {
  const { t } = useTranslation();
  const rootCats = categories.filter(c => !c.parent_category_id);

  return (
    <div className="space-y-6">
      {/* Sort By */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('marketplace.sortBy')}
        </h3>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500 transition-colors"
        >
          {Object.entries(SORT_OPTIONS).map(([key, label]) => (
            <option key={key} value={key}>{t(label)}</option>
          ))}
        </select>
      </div>

      {/* Category Checkboxes */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('marketplace.category')}
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {rootCats.slice(0, 15).map((cat) => (
            <label key={cat.id} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={selectedCategory === cat.id}
                onChange={(e) => onCategoryChange(e.target.checked ? cat.id : '')}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-orange-500"
              />
              <span className="text-sm text-gray-400 group-hover:text-gray-300">{cat.name}</span>
              {cat.product_count > 0 && (
                <span className="text-xs text-gray-600">({cat.product_count})</span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Skills */}
      {skills && skills.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {t('marketplace.skills')}
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {skills.slice(0, 10).map((skill) => (
              <label key={skill.id} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedSkill === skill.id}
                  onChange={(e) => onSkillChange(e.target.checked ? skill.id : '')}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-orange-500"
                />
                <span className="text-sm text-gray-400 group-hover:text-gray-300">{skill.name}</span>
                {skill.product_count > 0 && (
                  <span className="text-xs text-gray-600">({skill.product_count})</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

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
              placeholder="10000"
              value={selectedMaxPrice}
              onChange={(e) => onMaxPriceChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Hero section ───────────────────────────────────────────────────────────────
const DirectoryHero = ({ searchValue, onSearch, categories, skills, topProducts }) => {
  const { t } = useTranslation();
  const rootCats = categories.filter(c => !c.parent_category_id).slice(0, 6);

  return (
    <div className="bg-gradient-to-b from-gray-800 to-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
          {t('marketplace.title')}
        </h1>
        <p className="text-gray-400 text-sm sm:text-base mb-6">
          {t('marketplace.subtitle')}
        </p>

        <div className="mt-6">
          <input
            type="text"
            placeholder={t('marketplace.searchPlaceholder')}
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full px-5 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
          />
        </div>

        {/* Popular suggestions */}
        <div className="mt-4 flex flex-wrap gap-2">
          {rootCats.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSearch(cat.name)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-xs text-gray-300 hover:text-white transition-colors"
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Empty state ────────────────────────────────────────────────────────────────
const EmptyState = ({ searchTerm }) => {
  const { t } = useTranslation();
  return (
    <div className="col-span-full py-12 text-center">
      <div className="text-4xl mb-4">🔍</div>
      <h3 className="text-lg font-semibold text-white mb-2">{t('marketplace.noResults')}</h3>
      <p className="text-gray-400 text-sm">
        {searchTerm
          ? t('marketplace.noResultsFor', { term: searchTerm })
          : t('marketplace.tryBrowsing')}
      </p>
    </div>
  );
};

// ── Main component ──────────────────────────────────────────────────────────────
export default function ProductMarketplacePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const observerTarget = useRef(null);

  // State
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [selectedSkill, setSelectedSkill] = useState(searchParams.get('skill') || '');
  const [selectedMinPrice, setSelectedMinPrice] = useState(searchParams.get('minPrice') || '');
  const [selectedMaxPrice, setSelectedMaxPrice] = useState(searchParams.get('maxPrice') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'best_match');
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  // API Queries
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const res = await marketplaceApi.get('/categories/hierarchy');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 30,
  });

  const { data: skillsData, isLoading: skillsLoading } = useQuery({
    queryKey: ['product-skills'],
    queryFn: async () => {
      const res = await marketplaceApi.get('/skills/all');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 30,
  });

  // Debounced search + filter
  const debouncedSearch = useDebouncedCallback((value) => {
    const params = new URLSearchParams();
    if (value) params.set('q', value);
    if (selectedCategory) params.set('category', selectedCategory);
    if (selectedSkill) params.set('skill', selectedSkill);
    if (selectedMinPrice) params.set('minPrice', selectedMinPrice);
    if (selectedMaxPrice) params.set('maxPrice', selectedMaxPrice);
    if (sortBy !== 'best_match') params.set('sort', sortBy);
    setSearchParams(params, { replace: true });
  }, 300);

  useEffect(() => {
    debouncedSearch(searchValue);
  }, [searchValue, selectedCategory, selectedSkill, selectedMinPrice, selectedMaxPrice, sortBy, debouncedSearch]);

  // Products infinite query
  const {
    data: productsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: productsLoading,
    refetch: refetchProducts,
  } = useInfiniteQuery({
    queryKey: ['marketplace-products', { searchValue, selectedCategory, selectedSkill, selectedMinPrice, selectedMaxPrice, sortBy }],
    queryFn: async ({ pageParam = 1 }) => {
      const params = {
        page: pageParam,
        limit: PAGE_SIZE,
        sortBy,
      };
      if (searchValue.trim()) params.q = searchValue.trim();
      if (selectedCategory) params.category = selectedCategory;
      if (selectedSkill) params.skillIds = selectedSkill;
      if (selectedMinPrice) params.minPrice = parseFloat(selectedMinPrice);
      if (selectedMaxPrice) params.maxPrice = parseFloat(selectedMaxPrice);

      const endpoint = searchValue.trim() ? '/search' : '/browse';
      const res = await marketplaceApi.get(endpoint, { params });
      return res.data.data;
    },
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length >= PAGE_SIZE ? allPages.length + 1 : undefined;
    },
    staleTime: 1000 * 60 * 5,
  });

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Handlers
  const handleSearch = (value) => {
    setSearchValue(value);
    setShowFiltersMobile(false);
  };

  const handleCategoryChange = (catId) => {
    setSelectedCategory(catId);
    setSearchValue('');
  };

  const handleSkillChange = (skillId) => {
    setSelectedSkill(skillId);
    setSearchValue('');
  };

  const handleMinPriceChange = (value) => setSelectedMinPrice(value);
  const handleMaxPriceChange = (value) => setSelectedMaxPrice(value);
  const handleSortChange = (newSort) => setSortBy(newSort);

  const products = productsData?.pages.flat() || [];
  const categories = categoriesData || [];
  const skills = skillsData || [];

  const activeFilterCount = [selectedCategory, selectedSkill, selectedMinPrice, selectedMaxPrice].filter(Boolean).length;

  return (
    <>
      <PageMeta title={t('marketplace.title')} />
      <Navbar />

      <DirectoryHero
        searchValue={searchValue}
        onSearch={handleSearch}
        categories={categories}
        skills={skills}
      />

      <CategoryTileGrid
        categories={categories}
        selectedCategory={selectedCategory}
        onSelect={handleCategoryChange}
        loading={categoriesLoading}
      />

      <SkillTileGrid
        skills={skills}
        selectedSkill={selectedSkill}
        onSelect={handleSkillChange}
        loading={skillsLoading}
      />

      <div className="bg-gray-950 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              {productsLoading ? t('common.loading') : `${products.length} ${t('common.results')}`}
            </p>
            <button
              onClick={() => setShowFiltersMobile(true)}
              className="lg:hidden flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {t('marketplace.filters')}
              {activeFilterCount > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-orange-500 rounded-full text-xs font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-gray-950 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid lg:grid-cols-[280px_1fr] gap-8">
            {/* Desktop sidebar */}
            <div className="hidden lg:block">
              <FilterPanel
                selectedCategory={selectedCategory}
                selectedSkill={selectedSkill}
                selectedMinPrice={selectedMinPrice}
                selectedMaxPrice={selectedMaxPrice}
                onCategoryChange={handleCategoryChange}
                onSkillChange={handleSkillChange}
                onMinPriceChange={handleMinPriceChange}
                onMaxPriceChange={handleMaxPriceChange}
                categories={categories}
                skills={skills}
                sortBy={sortBy}
                onSortChange={handleSortChange}
              />
            </div>

            {/* Mobile filter drawer */}
            <FilterDrawer
              open={showFiltersMobile}
              onClose={() => setShowFiltersMobile(false)}
              activeCount={activeFilterCount}
            >
              <FilterPanel
                selectedCategory={selectedCategory}
                selectedSkill={selectedSkill}
                selectedMinPrice={selectedMinPrice}
                selectedMaxPrice={selectedMaxPrice}
                onCategoryChange={handleCategoryChange}
                onSkillChange={handleSkillChange}
                onMinPriceChange={handleMinPriceChange}
                onMaxPriceChange={handleMaxPriceChange}
                categories={categories}
                skills={skills}
                sortBy={sortBy}
                onSortChange={handleSortChange}
              />
            </FilterDrawer>

            {/* Products grid */}
            <div>
              {productsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {Array(PAGE_SIZE).fill(null).map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
                </div>
              ) : products.length === 0 ? (
                <EmptyState searchTerm={searchValue} />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onDetail={() => setSelectedProduct(product)}
                      />
                    ))}
                  </div>

                  {/* Infinite scroll trigger */}
                  <div ref={observerTarget} className="mt-12 text-center">
                    {isFetchingNextPage && (
                      <div className="flex items-center justify-center gap-2 text-gray-400">
                        <Loader className="w-5 h-5 animate-spin" />
                        {t('common.loading')}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Product detail modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      <Footer />
    </>
  );
}
