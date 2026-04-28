import React, { useState } from 'react';
import { X, ShoppingCart, Heart, Share2, Loader } from 'lucide-react';
import './ProductDetailModal.css';

const ProductDetailModal = ({ product, isOpen, onClose, onAddToCart, onShare }) => {
  const [quantity, setQuantity] = useState(1);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen || !product) return null;

  const handleAddToCart = async () => {
    setIsLoading(true);
    try {
      await onAddToCart(product.id, quantity);
      setQuantity(1);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShare = () => {
    if (onShare) {
      onShare(product);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div className="pm-modal-overlay" onClick={onClose} />

      {/* Modal Container */}
      <div className="pm-modal-wrapper">
        <div className="pm-modal">
          {/* Modal Header with Close Button */}
          <div className="pm-modal-header">
            <h2 className="pm-modal-title">{product.name}</h2>
            <button
              className="pm-modal-close-btn"
              onClick={onClose}
              aria-label="Close modal"
              title="Close"
            >
              <X size={24} />
            </button>
          </div>

          {/* Modal Content */}
          <div className="pm-modal-content">
            {/* Image Section */}
            <div className="pm-modal-image-section">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="pm-modal-image"
                  loading="lazy"
                />
              ) : (
                <div className="pm-modal-image-placeholder">
                  No Image
                </div>
              )}
            </div>

            {/* Details Section */}
            <div className="pm-modal-details-section">
              {/* Price */}
              <div className="pm-modal-price-group">
                <span className="pm-modal-price">${product.price.toFixed(2)}</span>
                {product.original_price && product.original_price > product.price && (
                  <span className="pm-modal-original-price">
                    ${product.original_price.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Rating and Stock */}
              <div className="pm-modal-meta">
                {product.rating && (
                  <span className="pm-modal-rating">
                    ⭐ {product.rating.toFixed(1)} ({product.reviews_count || 0} reviews)
                  </span>
                )}
                <span className={`pm-modal-stock ${product.stock <= 5 ? 'low' : 'available'}`}>
                  {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                </span>
              </div>

              {/* Description */}
              {product.description && (
                <div className="pm-modal-description">
                  <p>{product.description}</p>
                </div>
              )}

              {/* Features */}
              {product.features && product.features.length > 0 && (
                <div className="pm-modal-features">
                  <h3>Features</h3>
                  <ul>
                    {product.features.map((feature, idx) => (
                      <li key={idx}>{feature}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Quantity Selector */}
              {product.stock > 0 && (
                <div className="pm-modal-quantity">
                  <label htmlFor="quantity">Quantity:</label>
                  <div className="pm-modal-quantity-controls">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="pm-modal-quantity-btn"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <input
                      id="quantity"
                      type="number"
                      min="1"
                      max={product.stock}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="pm-modal-quantity-input"
                    />
                    <button
                      onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                      className="pm-modal-quantity-btn"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pm-modal-actions">
                <button
                  className="pm-modal-btn pm-modal-btn-primary"
                  onClick={handleAddToCart}
                  disabled={product.stock <= 0 || isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader size={18} className="animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <ShoppingCart size={18} />
                      Add to Cart
                    </>
                  )}
                </button>

                <button
                  className={`pm-modal-btn pm-modal-btn-secondary ${isWishlisted ? 'active' : ''}`}
                  onClick={() => setIsWishlisted(!isWishlisted)}
                  title="Add to Wishlist"
                >
                  <Heart size={18} fill={isWishlisted ? 'currentColor' : 'none'} />
                </button>

                <button
                  className="pm-modal-btn pm-modal-btn-secondary"
                  onClick={handleShare}
                  title="Share Product"
                >
                  <Share2 size={18} />
                </button>
              </div>

              {/* Additional Info */}
              {product.seller_name && (
                <div className="pm-modal-seller">
                  <span className="pm-modal-label">Seller:</span>
                  <span className="pm-modal-value">{product.seller_name}</span>
                </div>
              )}

              {product.category && (
                <div className="pm-modal-category">
                  <span className="pm-modal-label">Category:</span>
                  <span className="pm-modal-value">{product.category}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ProductDetailModal;
