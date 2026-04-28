import React, { useState, useEffect } from 'react';
import { Loader, AlertCircle, Grid3X3, List } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import ProductDetailModal from '../components/ProductDetailModal';
import './ProductMarketplacePage.css';

const PAGE_SIZE = 30;

const ProductMarketplacePage = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [filters, setFilters] = useState({
    category: '',
    minPrice: undefined,
    maxPrice: undefined,
    sort: 'newest',
    search: '',
  });

  // Load products on mount and filter changes
  useEffect(() => {
    setOffset(0);
    loadProducts(0);
  }, [filters]);

  const loadProducts = async (newOffset) => {
    try {
      setLoading(true);
      setError(null);

      // Mock API call - replace with real API in implementation
      const mockProducts = generateMockProducts(newOffset);

      if (newOffset === 0) {
        setProducts(mockProducts);
      } else {
        setProducts((prev) => [...prev, ...mockProducts]);
      }

      setHasMore(mockProducts.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load products:', err);
      setError('Failed to load products. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const generateMockProducts = (startIdx) => {
    const categories = ['Electronics', 'Home', 'Fashion', 'Sports', 'Books'];
    const mockProducts = [];

    for (let i = 0; i < PAGE_SIZE; i++) {
      const idx = startIdx + i;
      mockProducts.push({
        id: idx + 1,
        name: `Product ${idx + 1}`,
        price: Math.random() * 200 + 10,
        original_price: Math.random() > 0.7 ? Math.random() * 300 + 50 : null,
        category: categories[idx % categories.length],
        image_url: `https://via.placeholder.com/300x300?text=Product+${idx + 1}`,
        rating: (Math.random() * 2 + 3).toFixed(1),
        reviews_count: Math.floor(Math.random() * 200),
        stock: Math.floor(Math.random() * 50),
        description: `High-quality product ${idx + 1} with excellent features and great value.`,
        features: [
          'Feature 1',
          'Feature 2',
          'Feature 3',
          'Feature 4',
        ],
        seller_name: `Seller ${(idx % 10) + 1}`,
      });
    }

    return mockProducts;
  };

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    loadProducts(newOffset);
  };

  const handleViewDetails = (product) => {
    setSelectedProduct(product);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  };

  const handleAddToCart = async (productId, quantity) => {
    // Implement cart logic here
    console.log(`Added ${quantity} of product ${productId} to cart`);
    handleCloseModal();
  };

  const handleShare = (product) => {
    if (navigator.share) {
      navigator.share({
        title: product.name,
        text: `Check out ${product.name} for $${product.price.toFixed(2)}`,
        url: window.location.href,
      }).catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      });
    }
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  return (
    <PageShell>
      <PageMeta
        title="Product Marketplace"
        description="Browse our curated collection of products"
      />

      <div className="pm-container">
        {/* Header */}
        <div className="pm-header">
          <h1 className="pm-title">Product Marketplace</h1>
          <p className="pm-subtitle">Discover amazing products at great prices</p>
        </div>

        {/* Toolbar */}
        <div className="pm-toolbar">
          {/* Search */}
          <input
            type="text"
            placeholder="Search products..."
            value={filters.search}
            onChange={(e) => handleFilterChange({ ...filters, search: e.target.value })}
            className="pm-search-input"
          />

          {/* Sort */}
          <select
            value={filters.sort}
            onChange={(e) => handleFilterChange({ ...filters, sort: e.target.value })}
            className="pm-sort-select"
          >
            <option value="newest">Newest</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="rating">Top Rated</option>
          </select>

          {/* View Mode Toggle */}
          <div className="pm-view-toggle">
            <button
              className={`pm-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
              aria-label="Grid view"
            >
              <Grid3X3 size={20} />
            </button>
            <button
              className={`pm-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
              aria-label="List view"
            >
              <List size={20} />
            </button>
          </div>
        </div>

        {/* Main Content */}
        {error && (
          <div className="pm-error">
            <AlertCircle size={20} />
            <p>{error}</p>
          </div>
        )}

        {loading && offset === 0 ? (
          <div className="pm-loading">
            <Loader className="animate-spin" size={32} />
            <p>Loading products...</p>
          </div>
        ) : products.length > 0 ? (
          <>
            {/* Product Count */}
            <div className="pm-count">
              Showing {products.length} products
            </div>

            {/* Product Grid/List */}
            <div className={`pm-grid pm-grid-${viewMode}`}>
              {products.map((product) => (
                <div
                  key={product.id}
                  className="pm-product-card"
                  onClick={() => handleViewDetails(product)}
                >
                  {/* Card Image */}
                  <div className="pm-card-image-wrapper">
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="pm-card-image"
                      loading="lazy"
                    />
                    {product.original_price && (
                      <div className="pm-card-badge">
                        Sale
                      </div>
                    )}
                  </div>

                  {/* Card Content */}
                  <div className="pm-card-content">
                    <p className="pm-card-category">{product.category}</p>
                    <h3 className="pm-card-name">{product.name}</h3>

                    {/* Price */}
                    <div className="pm-card-price-group">
                      <span className="pm-card-price">${product.price.toFixed(2)}</span>
                      {product.original_price && (
                        <span className="pm-card-original-price">
                          ${product.original_price.toFixed(2)}
                        </span>
                      )}
                    </div>

                    {/* Rating */}
                    {product.rating && (
                      <div className="pm-card-rating">
                        <span className="pm-card-stars">⭐ {product.rating}</span>
                        <span className="pm-card-reviews">({product.reviews_count})</span>
                      </div>
                    )}

                    {/* Stock Status */}
                    <div className={`pm-card-stock ${product.stock > 0 ? 'available' : 'out'}`}>
                      {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                    </div>
                  </div>

                  {/* Card Footer - Touch-friendly button */}
                  <button
                    className="pm-card-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewDetails(product);
                    }}
                    disabled={product.stock <= 0}
                  >
                    View Details
                  </button>
                </div>
              ))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="pm-load-more">
                <button
                  className="pm-load-btn"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader className="animate-spin" size={18} />
                      Loading...
                    </>
                  ) : (
                    'Load More Products'
                  )}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="pm-empty">
            <p>No products found. Try adjusting your filters.</p>
          </div>
        )}
      </div>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onAddToCart={handleAddToCart}
          onShare={handleShare}
        />
      )}
    </PageShell>
  );
};

export default ProductMarketplacePage;
