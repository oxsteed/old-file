import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Star, Loader, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { marketplaceApi } from '../api/marketplaceApi';
import ProductImageGallery from './ProductImageGallery';
import RelatedProductsSection from './RelatedProductsSection';
import ProductReviewsSection from './ProductReviewsSection';
import '../styles/ProductDetailModal.css';

export default function ProductDetailModal({ product, onClose, onAddToCart }) {
  const { t } = useTranslation();
  const [fullProduct, setFullProduct] = useState(product);
  const [loading, setLoading] = useState(!product || !product.description);
  const [error, setError] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedRelatedProduct, setSelectedRelatedProduct] = useState(null);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);

  useEffect(() => {
    // Fetch full product details if not already loaded
    if (!product || !product.description) {
      const fetchProductDetail = async () => {
        try {
          setLoading(true);
          const response = await marketplaceApi.getProduct(product?.id);
          setFullProduct(response.data);
          setError(null);
        } catch (err) {
          console.error('Failed to fetch product details:', err);
          setError(t('common.errorLoading'));
        } finally {
          setLoading(false);
        }
      };

      if (product?.id) {
        fetchProductDetail();
      }
    }
  }, [product, t]);

  const handleAddToCart = () => {
    if (onAddToCart && fullProduct) {
      onAddToCart(fullProduct.id, quantity);
      // Optionally close modal after adding to cart
      setTimeout(() => {
        onClose();
      }, 500);
    }
  };

  const handleQuantityChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (value > 0) {
      setQuantity(value);
    }
  };

  const handleAddRelatedToCart = (productId, quantity) => {
    if (onAddToCart) {
      onAddToCart(productId, quantity);
    }
  };

  const handleOpenRelatedProduct = (relatedProduct) => {
    setSelectedRelatedProduct(relatedProduct);
  };

  const handleCloseRelatedProduct = () => {
    setSelectedRelatedProduct(null);
  };

  const handleReviewSubmitted = () => {
    // Refresh product details to update rating and review count
    if (fullProduct?.id) {
      marketplaceApi.getProduct(fullProduct.id).then((response) => {
        setFullProduct(response.data);
      });
    }
    // Force reviews section to refresh
    setReviewRefreshKey((prev) => prev + 1);
  };

  const renderStars = (rating) => {
    const stars = [];
    const roundedRating = Math.round(rating * 2) / 2;
    for (let i = 1; i <= 5; i++) {
      const fill = i <= roundedRating ? 'full' : i - roundedRating === 0.5 ? 'half' : 'none';
      stars.push(
        <Star
          key={i}
          size={16}
          className={`pdm-star ${fill === 'full' ? 'pdm-star-full' : fill === 'half' ? 'pdm-star-half' : 'pdm-star-empty'}`}
        />
      );
    }
    return stars;
  };

  if (loading) {
    return (
      <div className="pdm-overlay" onClick={onClose}>
        <div className="pdm-modal" onClick={(e) => e.stopPropagation()}>
          <div className="pdm-loading">
            <Loader className="pdm-spinner" />
            <p>{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !fullProduct) {
    return (
      <div className="pdm-overlay" onClick={onClose}>
        <div className="pdm-modal" onClick={(e) => e.stopPropagation()}>
          <button onClick={onClose} className="pdm-close-btn" aria-label={t('common.close')}>
            <X size={24} />
          </button>
          <div className="pdm-error">
            <p>{error || t('common.errorLoading')}</p>
            <button onClick={onClose} className="pdm-error-close-btn">
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rating = fullProduct.average_rating || 0;
  const reviewCount = fullProduct.review_count || 0;
  const cartsCount = fullProduct.in_carts_count || 0;
  const hasAffiliateLink = !!fullProduct.external_id;

  // If a related product is selected, show its detail modal instead
  if (selectedRelatedProduct) {
    return (
      <>
        <ProductDetailModal
          product={selectedRelatedProduct}
          onClose={handleCloseRelatedProduct}
          onAddToCart={handleAddRelatedToCart}
        />
      </>
    );
  }

  return (
    <div className="pdm-overlay" onClick={onClose}>
      <div className="pdm-modal" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="pdm-close-btn" aria-label={t('common.close')}>
          <X size={24} />
        </button>

        <div className="pdm-content">
          {/* Image Gallery section */}
          <div className="pdm-image-section">
            <ProductImageGallery
              images={fullProduct.product_images || (fullProduct.product_image_url ? [fullProduct.product_image_url] : [])}
              productName={fullProduct.name}
            />
          </div>

          {/* Details section */}
          <div className="pdm-details-section">
            {/* Header */}
            <div className="pdm-header">
              <h2 className="pdm-title">{fullProduct.name}</h2>
              {fullProduct.category && (
                <p className="pdm-category">{fullProduct.category}</p>
              )}
            </div>

            {/* Price */}
            <p className="pdm-price">
              ${(fullProduct.price_cents / 100).toFixed(2)}
            </p>

            {/* Rating and carts */}
            <div className="pdm-rating-row">
              <div className="pdm-rating">
                <div className="pdm-stars">
                  {renderStars(rating)}
                </div>
                <span className="pdm-rating-text">
                  {rating.toFixed(1)} ({reviewCount} {t('marketplace.reviews')})
                </span>
              </div>
              {cartsCount > 0 && (
                <div className="pdm-carts-count">
                  {t('marketplace.addedToCarts', { count: cartsCount })}
                </div>
              )}
            </div>

            {/* Description */}
            {fullProduct.description && (
              <div className="pdm-description">
                <h3 className="pdm-section-title">{t('marketplace.description')}</h3>
                <p className="pdm-description-text">{fullProduct.description}</p>
              </div>
            )}

            {/* Skills tags */}
            {fullProduct.skills && fullProduct.skills.length > 0 && (
              <div className="pdm-skills">
                <h3 className="pdm-section-title">{t('marketplace.skills')}</h3>
                <div className="pdm-skills-list">
                  {fullProduct.skills.map((skill) => (
                    <span key={skill.id} className="pdm-skill-badge">
                      {skill.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Product details */}
            <div className="pdm-product-details">
              <h3 className="pdm-section-title">{t('marketplace.productDetails')}</h3>
              <div className="pdm-details-grid">
                {fullProduct.sku && (
                  <div className="pdm-detail-item">
                    <span className="pdm-detail-label">{t('marketplace.sku')}</span>
                    <span className="pdm-detail-value">{fullProduct.sku}</span>
                  </div>
                )}
                {fullProduct.upc && (
                  <div className="pdm-detail-item">
                    <span className="pdm-detail-label">{t('marketplace.upc')}</span>
                    <span className="pdm-detail-value">{fullProduct.upc}</span>
                  </div>
                )}
                {fullProduct.source && (
                  <div className="pdm-detail-item">
                    <span className="pdm-detail-label">{t('marketplace.source')}</span>
                    <span className="pdm-detail-value">
                      {fullProduct.source === 'home_depot'
                        ? 'Home Depot'
                        : fullProduct.source === 'internal'
                          ? 'OxSteed'
                          : fullProduct.source}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Affiliate link */}
            {hasAffiliateLink && (
              <div className="pdm-affiliate-section">
                <a
                  href={fullProduct.external_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pdm-affiliate-link"
                >
                  <ExternalLink size={16} />
                  {t('marketplace.buyOnHomeDepot')}
                </a>
              </div>
            )}

            {/* Add to cart section */}
            <div className="pdm-cart-section">
              <div className="pdm-quantity-selector">
                <label htmlFor="pdm-quantity" className="pdm-quantity-label">
                  {t('marketplace.quantity')}
                </label>
                <input
                  id="pdm-quantity"
                  type="number"
                  min="1"
                  max="999"
                  value={quantity}
                  onChange={handleQuantityChange}
                  className="pdm-quantity-input"
                />
              </div>
              <button onClick={handleAddToCart} className="pdm-add-to-cart-btn">
                {t('marketplace.addToCart')}
              </button>
            </div>

            {/* Related Products Section */}
            {fullProduct.id && (
              <RelatedProductsSection
                productId={fullProduct.id}
                onAddToCart={handleAddRelatedToCart}
                onOpenDetail={handleOpenRelatedProduct}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
