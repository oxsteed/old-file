import { ShoppingCart, Lightbulb, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../styles/ProductCard.css';

export default function ProductCard({
  product,
  isRecommended,
  onAddToCart,
  onViewDetails,
  disabled,
}) {
  const { t } = useTranslation();

  const rating = product.avg_rating ?? product.average_rating ?? product.rating ?? 0;
  const reviewCount = product.rating_count ?? product.review_count ?? 0;
  const inStock = typeof product.stock_count === 'number'
    ? product.stock_count > 0
    : product.is_available !== false;
  const savings = product.original_price_cents && product.original_price_cents > product.price_cents;
  const savingsPercent = savings
    ? Math.round(((product.original_price_cents - product.price_cents) / product.original_price_cents) * 100)
    : 0;

  return (
    <div className="pcard" onClick={onViewDetails} role="button" tabIndex="0">
      {/* Image Section */}
      <div className="pcard-image-wrapper">
        {product.product_image_url ? (
          <img
            src={product.product_image_url}
            alt={product.name}
            className="pcard-image"
            loading="lazy"
          />
        ) : (
          <div className="pcard-image-placeholder">{t('marketplace.noImage')}</div>
        )}

        {/* Badges */}
        <div className="pcard-badges">
          {isRecommended && (
            <div className="pcard-badge pcard-badge-recommended">
              <Lightbulb size={12} />
              <span>{t('marketplace.recommendedForYou')}</span>
            </div>
          )}

          {savings && (
            <div className="pcard-badge pcard-badge-sale">
              {t('marketplace.save')} {savingsPercent}%
            </div>
          )}

          {!inStock && (
            <div className="pcard-badge pcard-badge-out-of-stock">
              {t('marketplace.outOfStock')}
            </div>
          )}

          {inStock && product.stock_count <= 5 && (
            <div className="pcard-badge pcard-badge-low-stock">
              {t('marketplace.onlyXLeft', { count: product.stock_count })}
            </div>
          )}
        </div>
      </div>

      {/* Content Section */}
      <div className="pcard-content">
        {/* Category */}
        {product.category && (
          <p className="pcard-category">{product.category}</p>
        )}

        {/* Name */}
        <h3 className="pcard-name">{product.name}</h3>

        {/* Rating */}
        {rating > 0 && (
          <div className="pcard-rating">
            <div className="pcard-stars">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={12}
                  className={i < Math.round(rating) ? 'pcard-star-filled' : 'pcard-star-empty'}
                />
              ))}
            </div>
            <span className="pcard-rating-text">
              {rating.toFixed(1)} ({reviewCount} {t('marketplace.reviews')})
            </span>
          </div>
        )}

        {/* Price */}
        <div className="pcard-price">
          <span className="pcard-price-current">
            ${(product.price_cents / 100).toFixed(2)}
          </span>
          {savings && (
            <span className="pcard-price-original">
              ${(product.original_price_cents / 100).toFixed(2)}
            </span>
          )}
        </div>

        {/* Skills */}
        {product.skills && product.skills.length > 0 && (
          <div className="pcard-skills">
            {product.skills.slice(0, 3).map((skill) => (
              <span key={skill.id} className="pcard-skill-badge">
                {skill.name}
              </span>
            ))}
            {product.skills.length > 3 && (
              <span className="pcard-skill-badge pcard-skill-more">
                +{product.skills.length - 3}
              </span>
            )}
          </div>
        )}

        {/* CTA Button */}
        <button
          className="pcard-btn-cart"
          onClick={(e) => {
            e.stopPropagation();
            onAddToCart();
          }}
          disabled={disabled || !inStock}
          aria-label={`Add ${product.name} to cart`}
        >
          <ShoppingCart size={16} />
          {inStock ? t('marketplace.addToCart') : t('marketplace.outOfStock')}
        </button>
      </div>
    </div>
  );
}
