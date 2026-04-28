import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, Search, Filter, Loader } from 'lucide-react';
import { toast } from 'sonner';
import PageMeta from '../components/PageMeta';
import { marketplaceApi, cartApi } from '../api/marketplaceApi';
import { useAuth } from '../hooks/useAuth';
import '../styles/ProductMarketplacePage.css';

export default function ProductMarketplacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentCart, setCurrentCart] = useState(null);
  const [showNewCartModal, setShowNewCartModal] = useState(false);
  const [newCartName, setNewCartName] = useState('');

  // Fetch products
  const fetchProducts = async (pageNum = 1) => {
    setLoading(true);
    try {
      const response = await marketplaceApi.browseProducts(
        selectedSkill,
        searchQuery,
        selectedCategory,
        pageNum,
        20
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
  }, [selectedSkill, selectedCategory, searchQuery]);

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
          </div>
        </div>

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
              {products.map((product) => (
                <div key={product.id} className="pmp-product-card">
                  {product.product_image_url && (
                    <img
                      src={product.product_image_url}
                      alt={product.name}
                      className="pmp-product-image"
                      loading="lazy"
                    />
                  )}
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
      </div>
    </>
  );
}
