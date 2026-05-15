/**
 * Product Catalog Component
 * Display products with filtering, search, and inventory status
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import './ProductCatalog.css';

export default function ProductCatalog({ businessId, isAdmin = false }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({
    search: '',
    category: 'all',
    minPrice: 0,
    maxPrice: 10000,
    inStock: false,
    page: 0,
    limit: 20,
    sortBy: 'created_at',
  });
  const [categories, setCategories] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState(null);

  // Load products
  useEffect(() => {
    loadProducts();
  }, [filter]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const params = {
        ...filter,
        category: filter.category === 'all' ? null : filter.category,
      };
      const response = await axios.get(`/api/businesses/${businessId}/products`, {
        params,
      });
      setProducts(response.data.data);
      setTotal(response.data.total);

      // Extract unique categories from loaded products
      const cats = [...new Set(response.data.data.map(p => p.category).filter(Boolean))];
      setCategories(cats);
    } catch (error) {
      console.error('Failed to load products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (name, value) => {
    setFilter(prev => ({
      ...prev,
      [name]: value,
      page: 0, // Reset to first page on filter change
    }));
  };

  const handlePagination = (newPage) => {
    setFilter(prev => ({ ...prev, page: newPage }));
  };

  return (
    <div className="product-catalog">
      {/* Filters Sidebar */}
      <div className="pc-filters">
        <h3>{t('marketplace.filters')}</h3>

        {/* Search */}
        <div className="pc-filter-group">
          <label>{t('common.search')}</label>
          <input
            type="text"
            placeholder={t('marketplace.searchProducts')}
            value={filter.search}
            onChange={e => handleFilterChange('search', e.target.value)}
          />
        </div>

        {/* Category */}
        <div className="pc-filter-group">
          <label>{t('marketplace.category')}</label>
          <select
            value={filter.category}
            onChange={e => handleFilterChange('category', e.target.value)}
          >
            <option value="all">{t('common.all')}</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Price Range */}
        <div className="pc-filter-group">
          <label>{t('marketplace.priceRange')}</label>
          <div className="pc-price-inputs">
            <input
              type="number"
              placeholder="Min"
              value={filter.minPrice}
              onChange={e => handleFilterChange('minPrice', e.target.value)}
            />
            <span>-</span>
            <input
              type="number"
              placeholder="Max"
              value={filter.maxPrice}
              onChange={e => handleFilterChange('maxPrice', e.target.value)}
            />
          </div>
        </div>

        {/* In Stock */}
        <div className="pc-filter-group">
          <label>
            <input
              type="checkbox"
              checked={filter.inStock}
              onChange={e => handleFilterChange('inStock', e.target.checked)}
            />
            {t('marketplace.inStock')}
          </label>
        </div>

        {/* Sort */}
        <div className="pc-filter-group">
          <label>{t('marketplace.sortBy')}</label>
          <select
            value={filter.sortBy}
            onChange={e => handleFilterChange('sortBy', e.target.value)}
          >
            <option value="created_at">{t('common.newest')}</option>
            <option value="price">{t('common.priceLow')}</option>
            <option value="name">{t('common.name')}</option>
            <option value="bestselling">{t('marketplace.bestselling')}</option>
          </select>
        </div>
      </div>

      {/* Products Grid */}
      <div className="pc-main">
        {loading ? (
          <div className="pc-loading">{t('common.loading')}</div>
        ) : products.length === 0 ? (
          <div className="pc-empty">{t('marketplace.noProducts')}</div>
        ) : (
          <>
            <div className="pc-results-info">
              {t('marketplace.showing')} {filter.page * filter.limit + 1}-
              {Math.min((filter.page + 1) * filter.limit, total)} {t('common.of')} {total}
            </div>

            <div className="pc-grid">
              {products.map(product => (
                <div
                  key={product.id}
                  className="pc-card"
                  onClick={() => setSelectedProduct(product)}
                >
                  <div className="pc-image">
                    {product.thumbnailUrl ? (
                      <img src={product.thumbnailUrl} alt={product.name} />
                    ) : (
                      <div className="pc-image-placeholder">
                        {product.name.charAt(0)}
                      </div>
                    )}
                    {product.totalStock === 0 && <div className="pc-out-of-stock">Out of Stock</div>}
                  </div>

                  <div className="pc-info">
                    <h4>{product.name}</h4>
                    <div className="pc-category">{product.category}</div>

                    <div className="pc-rating">
                      {product.avgRating ? (
                        <>
                          <span className="pc-stars">★ {product.avgRating}</span>
                          <span className="pc-review-count">({product.reviewCount})</span>
                        </>
                      ) : (
                        <span className="pc-no-rating">{t('common.noReviews')}</span>
                      )}
                    </div>

                    <div className="pc-footer">
                      <div className="pc-price">${product.price.toFixed(2)}</div>
                      {product.totalStock > 0 ? (
                        <div className="pc-stock">
                          {product.totalStock} {t('inventory.inStock')}
                        </div>
                      ) : (
                        <div className="pc-stock-warning">{t('inventory.outOfStock')}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="pc-pagination">
              <button
                disabled={filter.page === 0}
                onClick={() => handlePagination(filter.page - 1)}
              >
                ← {t('common.previous')}
              </button>
              <span>
                {t('common.page')} {filter.page + 1}
              </span>
              <button
                disabled={(filter.page + 1) * filter.limit >= total}
                onClick={() => handlePagination(filter.page + 1)}
              >
                {t('common.next')} →
              </button>
            </div>
          </>
        )}
      </div>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div className="pc-modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="pc-modal" onClick={e => e.stopPropagation()}>
            <button className="pc-modal-close" onClick={() => setSelectedProduct(null)}>
              ✕
            </button>

            <div className="pc-modal-content">
              <div className="pc-modal-image">
                {selectedProduct.thumbnailUrl && (
                  <img src={selectedProduct.thumbnailUrl} alt={selectedProduct.name} />
                )}
              </div>

              <div className="pc-modal-info">
                <h2>{selectedProduct.name}</h2>
                <p className="pc-modal-category">{selectedProduct.category}</p>

                {selectedProduct.description && (
                  <p className="pc-modal-desc">{selectedProduct.description}</p>
                )}

                <div className="pc-modal-price">
                  <span className="pc-modal-price-value">
                    ${selectedProduct.price.toFixed(2)}
                  </span>
                </div>

                {selectedProduct.variants && selectedProduct.variants.length > 0 && (
                  <div className="pc-modal-variants">
                    <label>{t('products.selectVariant')}</label>
                    <select>
                      {selectedProduct.variants.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.name} {v.stock > 0 ? `(${v.stock} available)` : '(Out of Stock)'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button className="pc-modal-btn-add">
                  {selectedProduct.totalStock > 0
                    ? t('common.addToCart')
                    : t('inventory.outOfStock')}
                </button>

                {selectedProduct.reviews && selectedProduct.reviews.length > 0 && (
                  <div className="pc-modal-reviews">
                    <h4>{t('products.reviews')}</h4>
                    {selectedProduct.reviews.map(review => (
                      <div key={review.id} className="pc-review-item">
                        <div className="pc-review-header">
                          <strong>{review.customerName}</strong>
                          <span className="pc-review-rating">★ {review.rating}</span>
                        </div>
                        <p>{review.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
