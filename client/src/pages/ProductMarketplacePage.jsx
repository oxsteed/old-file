import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, Search, Filter, Loader, X, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import PageMeta from '../components/PageMeta';
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


/**
 * Checks if a product is recommended for a user based on skill matches
 */
const isProductRecommended = (product, userSkills) => {
  if (!userSkills || userSkills.length === 0) return false;
  if (!product.skills || product.skills.length === 0) return false;

  // Extract user skill IDs into a set for efficient lookup
  const userSkillIds = new Set(
    userSkills.map((skill) => {
      // Handle both skill object with id property and plain skill IDs
      return typeof skill === 'object' ? skill.id : skill;
    })
  );

  // Check if any product skill ID is in the user's skills
  return product.skills.some((skill) => userSkillIds.has(skill.id));
};

/**
 * RecommendedBadge component
 */
function RecommendedBadge() {
  return (
    <div className="pmp-recommended-badge">
      <Lightbulb size={14} />
      <span>Recommended for You</span>
    </div>
  );
}

export default function ProductMarketplacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  // Initialize state from URL params
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [selectedSkill, setSelectedSkill] = useState(searchParams.get('skill') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [selectedMinPrice, setSelectedMinPrice] = useState(searchParams.get('minPrice') || '');
  const [selectedMaxPrice, setSelectedMaxPrice] = useState(searchParams.get('maxPrice') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'best_match');
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentCart, setCurrentCart] = useState(null);
  const [showNewCartModal, setShowNewCartModal] = useState(false);
  const [newCartName, setNewCartName] = useState('');
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);

  // Update URL params whenever filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (selectedSkill) params.set('skill', selectedSkill);
    if (selectedCategory) params.set('category', selectedCategory);
    if (selectedMinPrice) params.set('minPrice', selectedMinPrice);
    if (selectedMaxPrice) params.set('maxPrice', selectedMaxPrice);
    if (sortBy !== 'best_match') params.set('sortBy', sortBy);

    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedSkill, selectedCategory, selectedMinPrice, selectedMaxPrice, sortBy, setSearchParams]);

  // Fetch products
  const fetchProducts = async (pageNum = 1) => {
    setLoading(true);
    try {
      let minPrice = null;
      let maxPrice = null;

      // Convert prices to cents if provided
      if (selectedMinPrice) {
        minPrice = Math.floor(parseFloat(selectedMinPrice) * 100);
      }
      if (selectedMaxPrice) {
        maxPrice = Math.floor(parseFloat(selectedMaxPrice) * 100);
      }

      const response = await marketplaceApi.searchProducts(
        searchQuery,
        selectedSkill,
        minPrice,
        maxPrice,
        pageNum,
        20,
        sortBy
      );
      setProducts(response.data.products || []);
      setPage(pageNum);
      setTotalPages(Math.ceil(response.data.pagination.total / 20));
    } catch (err) {
      toast.error(t('common.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  // Fetch categories
  const fetchCategories = async () => {
    try {
      const response = await marketplaceApi.getCategories();
      setCategories(response.data.categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchProducts(1);
  }, [selectedSkill, selectedCategory, searchQuery, selectedMinPrice, selectedMaxPrice, sortBy]);

  // Create new cart
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
      navigate(`/cart/${response.data.id}`);
    } catch (err) {
      toast.error(t('common.errorCreating'));
    }
  };

  // Clear all filters
  const handleClearAllFilters = () => {
    setSearchQuery('');
    setSelectedSkill('');
    setSelectedCategory('');
    setSelectedMinPrice('');
    setSelectedMaxPrice('');
    setSortBy('best_match');
  };

  // Get active filters count
  const hasActiveFilters = searchQuery || selectedSkill || selectedCategory || selectedMinPrice || selectedMaxPrice;

  // Helper to translate sort option labels
  const getSortLabel = (sortKey) => {
    const labelKey = SORT_OPTIONS[sortKey];
    return labelKey ? t(labelKey) : sortKey;
  };

  // Add product to cart
  const handleAddToCart = async (productId) => {
    if (!currentCart) {
      setShowNewCartModal(true);
      return;
    }

    try {
      await cartApi.addItem(currentCart.id, productId, 1);
      toast.success(t('marketplace.itemAdded'));
    } catch (err) {
      toast.error(t('common.errorUpdating'));
    }
  };

  return (
    <>
      <PageMeta
        title={t('marketplace.title')}
        description={t('marketplace.description')}
      />

      <div className="pmp-container">
        <div className="pmp-header">
          <h1>{t('marketplace.title')}</h1>
          <p>{t('marketplace.subtitle')}</p>
        </div>

        {/* Search & Filters */}
        <div className="pmp-search-section">
          <div className="pmp-search-bar">
            <Search className="pmp-search-icon" />
            <input
              type="text"
              placeholder={t('marketplace.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pmp-search-input"
            />
          </div>

          <div className="pmp-filters">
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
              <label>{t('marketplace.minPrice')}</label>
              <input
                type="number"
                placeholder="0"
                value={selectedMinPrice}
                onChange={(e) => setSelectedMinPrice(e.target.value)}
                className="pmp-filter-input"
                min="0"
              />
            </div>

            <div className="pmp-filter-group">
              <label>{t('marketplace.maxPrice')}</label>
              <input
                type="number"
                placeholder="1000"
                value={selectedMaxPrice}
                onChange={(e) => setSelectedMaxPrice(e.target.value)}
                className="pmp-filter-input"
                min="0"
              />
            </div>

            <div className="pmp-filter-group">
              <label>{t('marketplace.sortBy')}</label>
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
            </div>
          </div>
        </div>

        {/* Active Filter Pills */}
        {hasActiveFilters && (
          <div className="pmp-active-filters">
            <div className="pmp-filter-pills">
              {selectedMinPrice && selectedMaxPrice && (
                <div className="pmp-filter-pill">
                  <span className="pmp-pill-text">
                    {t('marketplace.priceRange', { min: selectedMinPrice, max: selectedMaxPrice })}
                  </span>
                  <button
                    className="pmp-pill-remove"
                    onClick={() => {
                      setSelectedMinPrice('');
                      setSelectedMaxPrice('');
                    }}
                    aria-label={t('common.remove')}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              {selectedCategory && (
                <div className="pmp-filter-pill">
                  <span className="pmp-pill-text">
                    {t('marketplace.categoryPill', { category: selectedCategory })}
                  </span>
                  <button
                    className="pmp-pill-remove"
                    onClick={() => setSelectedCategory('')}
                    aria-label={t('common.remove')}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              {sortBy !== 'best_match' && (
                <div className="pmp-filter-pill pmp-pill-info">
                  <span className="pmp-pill-text">
                    {t('marketplace.sortPill', { sort: getSortLabel(sortBy) })}
                  </span>
                </div>
              )}
            </div>
            {hasActiveFilters && (
              <button className="pmp-clear-all-btn" onClick={handleClearAllFilters}>
                {t('marketplace.clearAll')}
              </button>
            )}
          </div>
        )}

        {/* Products Grid */}
        {loading ? (
          <div className="pmp-loading">
            <Loader className="pmp-spinner" />
            <p>{t('common.loading')}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="pmp-empty">
            <Filter className="pmp-empty-icon" />
            <p>{t('marketplace.noProducts')}</p>
          </div>
        ) : (
          <>
            <div className="pmp-grid">
              {products.map((product) => {
                const isRecommended = user && user.role && ['helper', 'helper_pro', 'broker'].includes(user.role)
                  && isProductRecommended(product, user.skills);

                return (
                <div key={product.id} className="pmp-product-card">
                  <div className="pmp-product-image-wrapper">
                    {product.product_image_url && (
                      <img
                        src={product.product_image_url}
                        alt={product.name}
                        className="pmp-product-image"
                        loading="lazy"
                      />
                    )}
                    {isRecommended && <RecommendedBadge />}
                  </div>
                  <div className="pmp-product-info">
                    <h3 className="pmp-product-name">{product.name}</h3>
                    {product.category && (
                      <p className="pmp-product-category">{product.category}</p>
                    )}
                    <p className="pmp-product-price">
                      ${(product.price_cents / 100).toFixed(2)}
                    </p>
                    <div className="pmp-product-skills">
                      {product.skills?.map((skill) => (
                        <span key={skill.id} className="pmp-skill-badge">
                          {skill.name}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => handleAddToCart(product.id)}
                      className="pmp-add-to-cart-btn"
                      disabled={!user}
                    >
                      <ShoppingCart size={16} />
                      {t('marketplace.addToCart')}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pmp-pagination">
                <button
                  onClick={() => fetchProducts(page - 1)}
                  disabled={page === 1}
                  className="pmp-pagination-btn"
                >
                  {t('common.previous')}
                </button>
                <span className="pmp-pagination-info">
                  {t('marketplace.pageInfo', { page, totalPages })}
                </span>
                <button
                  onClick={() => fetchProducts(page + 1)}
                  disabled={page === totalPages}
                  className="pmp-pagination-btn"
                >
                  {t('common.next')}
                </button>
              </div>
            )}
          </>
        )}

        {/* New Cart Modal */}
        {showNewCartModal && (
          <div className="pmp-modal-overlay" onClick={() => setShowNewCartModal(false)}>
            <div className="pmp-modal" onClick={(e) => e.stopPropagation()}>
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
                <button
                  onClick={handleCreateCart}
                  className="pmp-modal-btn-create"
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
      </div>
    </>
  );
}
