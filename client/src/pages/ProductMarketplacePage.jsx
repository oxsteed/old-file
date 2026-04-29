import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, Search, Filter, Loader, X, Lightbulb, Menu, ChevronDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useDebouncedCallback } from 'use-debounce';
import PageMeta from '../components/PageMeta';
import ProductDetailModal from '../components/ProductDetailModal';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import FilterDrawer from '../components/FilterDrawer';
import ProductCard from '../components/ProductCard';
import SearchSuggestions from '../components/SearchSuggestions';
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

const PRICE_PRESETS = [
  { label: 'Under $50', min: 0, max: 5000 },
  { label: '$50 - $200', min: 5000, max: 20000 },
  { label: '$200 - $500', min: 20000, max: 50000 },
  { label: '$500+', min: 50000, max: 1000000 },
];

const isProductRecommended = (product, userSkills) => {
  if (!userSkills || userSkills.length === 0) return false;
  if (!product.skills || product.skills.length === 0) return false;

  const userSkillIds = new Set(
    userSkills.map((skill) => (typeof skill === 'object' ? skill.id : skill))
  );

  return product.skills.some((skill) => userSkillIds.has(skill.id));
};

export default function ProductMarketplacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  // Filter state from URL
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [selectedMinPrice, setSelectedMinPrice] = useState(searchParams.get('minPrice') || '');
  const [selectedMaxPrice, setSelectedMaxPrice] = useState(searchParams.get('maxPrice') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'best_match');

  // UI state
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [showNewCartModal, setShowNewCartModal] = useState(false);
  const [newCartName, setNewCartName] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [currentCart, setCurrentCart] = useState(() => {
    try {
      const saved = localStorage.getItem('oxs:lastCart');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Debounced search
  const debouncedSearch = useDebouncedCallback((query) => {
    setSearchQuery(query);
  }, 300);

  // Update URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    if (selectedMinPrice) params.set('minPrice', selectedMinPrice);
    if (selectedMaxPrice) params.set('maxPrice', selectedMaxPrice);
    if (sortBy !== 'best_match') params.set('sortBy', sortBy);
    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedCategory, selectedMinPrice, selectedMaxPrice, sortBy, setSearchParams]);

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

  // Fetch search suggestions
  const { data: suggestionsData } = useQuery({
    queryKey: ['searchSuggestions', searchQuery],
    queryFn: () => marketplaceApi.searchSuggestions(searchQuery),
    enabled: searchQuery.length > 2,
    staleTime: 10 * 60 * 1000,
  });
  const suggestions = suggestionsData?.data?.suggestions || [];

  // Infinite scroll products
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['products', searchQuery, selectedCategory, selectedMinPrice, selectedMaxPrice, sortBy],
    queryFn: async ({ pageParam = 1 }) => {
      const minPrice = selectedMinPrice ? Math.floor(parseFloat(selectedMinPrice) * 100) : null;
      const maxPrice = selectedMaxPrice ? Math.floor(parseFloat(selectedMaxPrice) * 100) : null;

      const response = await marketplaceApi.searchProducts(
        searchQuery,
        null,
        minPrice,
        maxPrice,
        pageParam,
        20,
        sortBy,
        selectedCategory
      );
      return response.data;
    },
    getNextPageParam: (lastPage) => {
      const currentPage = lastPage.pagination?.page || 1;
      const totalPages = Math.ceil((lastPage.pagination?.total || 0) / 20);
      return currentPage < totalPages ? currentPage + 1 : undefined;
    },
    staleTime: 5 * 60 * 1000,
  });

  const allProducts = data?.pages.flatMap((page) => page.products || []) || [];

  // Handlers
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
    } catch (err) {
      toast.error(t('common.errorCreating'));
    }
  };

  const handleClearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedMinPrice('');
    setSelectedMaxPrice('');
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
    } catch (err) {
      toast.error(t('common.errorUpdating'));
    }
  };

  const handleOpenCart = () => {
    if (currentCart) {
      navigate(`/cart/${currentCart.id}`);
    }
  };

  const getSortLabel = (sortKey) => {
    const labelKey = SORT_OPTIONS[sortKey];
    return labelKey ? t(labelKey) : sortKey;
  };

  const hasActiveFilters = searchQuery || selectedCategory || selectedMinPrice || selectedMaxPrice || sortBy !== 'best_match';

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

      <main className="pmp-main">
        <div className="pmp-container">
          {/* Hero Section */}
          <div className="pmp-header">
            <div className="pmp-header-content">
              <h1>{t('marketplace.title')}</h1>
              <p>{t('marketplace.subtitle')}</p>
            </div>

            {/* Cart Button */}
            {currentCart && (
              <button className="pmp-cart-fab" onClick={handleOpenCart} title="Open cart">
                <ShoppingCart size={20} />
                <span className="pmp-cart-count">+</span>
              </button>
            )}
          </div>

          {/* Search Section */}
          <div className="pmp-search-section">
            <div className="pmp-search-wrapper">
              <div className="pmp-search-bar">
                <Search className="pmp-search-icon" size={20} />
                <input
                  type="text"
                  placeholder={t('marketplace.searchPlaceholder')}
                  defaultValue={searchQuery}
                  onChange={(e) => debouncedSearch(e.target.value)}
                  className="pmp-search-input"
                  aria-label="Search products"
                />
              </div>

              {/* Search Suggestions */}
              {searchQuery.length > 2 && suggestions.length > 0 && (
                <SearchSuggestions
                  suggestions={suggestions}
                  onSelect={(suggestion) => debouncedSearch(suggestion)}
                />
              )}

              {/* Mobile Filter Toggle */}
              <button
                className="pmp-filter-toggle-mobile"
                onClick={() => setShowFilterDrawer(true)}
                aria-label="Open filters"
              >
                <Filter size={20} />
              </button>
            </div>

            {/* Desktop Filters */}
            <div className="pmp-filters-desktop">
              <div className="pmp-filter-group">
                <label>{t('marketplace.filterCategory')}</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="pmp-filter-select"
                >
                  <option value="">{t('common.all')}</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pmp-filter-group">
                <label>{t('marketplace.priceRange')}</label>
                <input
                  type="number"
                  placeholder="Min"
                  value={selectedMinPrice}
                  onChange={(e) => setSelectedMinPrice(e.target.value)}
                  className="pmp-filter-input"
                  min="0"
                />
                <input
                  type="number"
                  placeholder="Max"
                  value={selectedMaxPrice}
                  onChange={(e) => setSelectedMaxPrice(e.target.value)}
                  className="pmp-filter-input"
                  min="0"
                />
              </div>

              <div className="pmp-filter-group">
                <label>{t('marketplace.sortBy')}</label>
                <div className="pmp-sort-select-wrapper">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="pmp-filter-select"
                  >
                    {Object.entries(SORT_OPTIONS).map(([key, labelKey]) => (
                      <option key={key} value={key}>
                        {t(labelKey)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="pmp-select-icon" />
                </div>
              </div>
            </div>
          </div>

          {/* Active Filters */}
          {hasActiveFilters && (
            <div className="pmp-active-filters">
              <div className="pmp-filter-pills">
                {searchQuery && (
                  <div className="pmp-filter-pill">
                    <span className="pmp-pill-text">{t('marketplace.search')}: "{searchQuery}"</span>
                    <button
                      className="pmp-pill-remove"
                      onClick={() => setSearchQuery('')}
                      aria-label="Remove search"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {selectedCategory && (
                  <div className="pmp-filter-pill">
                    <span className="pmp-pill-text">{selectedCategory}</span>
                    <button
                      className="pmp-pill-remove"
                      onClick={() => setSelectedCategory('')}
                      aria-label="Remove category"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {(selectedMinPrice || selectedMaxPrice) && (
                  <div className="pmp-filter-pill">
                    <span className="pmp-pill-text">
                      ${selectedMinPrice || '0'} - ${selectedMaxPrice || '∞'}
                    </span>
                    <button
                      className="pmp-pill-remove"
                      onClick={() => {
                        setSelectedMinPrice('');
                        setSelectedMaxPrice('');
                      }}
                      aria-label="Remove price filter"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
              <button className="pmp-clear-all-btn" onClick={handleClearAllFilters}>
                {t('marketplace.clearAll')}
              </button>
            </div>
          )}

          {/* Products Grid */}
          {isLoading && allProducts.length === 0 ? (
            <div className="pmp-loading">
              <Loader className="pmp-spinner" />
              <p>{t('common.loading')}</p>
            </div>
          ) : allProducts.length === 0 ? (
            <div className="pmp-empty">
              <Filter className="pmp-empty-icon" />
              <h3>{t('marketplace.noProducts')}</h3>
              <p>{t('marketplace.tryDifferentFilters')}</p>
              <button className="pmp-clear-all-btn" onClick={handleClearAllFilters}>
                {t('marketplace.clearAll')}
              </button>
            </div>
          ) : (
            <>
              <div className="pmp-grid">
                {allProducts.map((product) => {
                  const isRecommended =
                    user &&
                    user.role &&
                    ['helper', 'helper_pro', 'broker'].includes(user.role) &&
                    isProductRecommended(product, user.skills);

                  return (
                    <ProductCard
                      key={product.id}
                      product={product}
                      isRecommended={isRecommended}
                      onAddToCart={() => handleAddToCart(product.id)}
                      onViewDetails={() => setSelectedProduct(product)}
                      disabled={!user}
                    />
                  );
                })}
              </div>

              {/* Load More Trigger */}
              {(hasNextPage || isFetchingNextPage) && (
                <div ref={loadMoreRef} className="pmp-load-more">
                  {isFetchingNextPage && (
                    <>
                      <Loader className="pmp-spinner" />
                      <p>{t('common.loading')}</p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Filter Drawer (Mobile) */}
      <FilterDrawer
        open={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        selectedMinPrice={selectedMinPrice}
        onMinPriceChange={setSelectedMinPrice}
        selectedMaxPrice={selectedMaxPrice}
        onMaxPriceChange={setSelectedMaxPrice}
        sortBy={sortBy}
        onSortChange={setSortBy}
        sortOptions={SORT_OPTIONS}
      />

      {/* Create Cart Modal */}
      {showNewCartModal && (
        <div className="pmp-modal-overlay" onClick={() => setShowNewCartModal(false)}>
          <div className="pmp-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="pmp-modal-close"
              onClick={() => setShowNewCartModal(false)}
              aria-label="Close"
            >
              <X size={20} />
            </button>
            <h2>{t('marketplace.createNewCart')}</h2>
            <input
              type="text"
              placeholder={t('marketplace.cartNamePlaceholder')}
              value={newCartName}
              onChange={(e) => setNewCartName(e.target.value)}
              className="pmp-modal-input"
              autoFocus
            />
            <div className="pmp-modal-actions">
              <button
                onClick={() => setShowNewCartModal(false)}
                className="pmp-modal-btn-cancel"
              >
                {t('common.cancel')}
              </button>
              <button onClick={handleCreateCart} className="pmp-modal-btn-create">
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

      <Footer />
    </>
  );
}
