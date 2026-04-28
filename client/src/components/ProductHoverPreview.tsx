import { Star, ShoppingCart } from 'lucide-react';
import '../styles/ProductHoverPreview.css';

interface Product {
  id: string | number;
  name: string;
  price_cents: number;
  rating?: number;
  rating_count?: number;
  in_carts_count?: number;
  skills?: Array<{ id: string | number; name: string }>;
  is_available?: boolean;
}

interface ProductHoverPreviewProps {
  product: Product;
  position?: 'top-right' | 'bottom-right';
}

export default function ProductHoverPreview({
  product,
  position = 'bottom-right'
}: ProductHoverPreviewProps) {
  const rating = product.rating || 0;
  const ratingCount = product.rating_count || 0;
  const inCartsCount = product.in_carts_count || 0;
  const skills = product.skills || [];
  const displaySkills = skills.slice(0, 3);

  const renderStars = (rate: number) => {
    return (
      <div className="php-stars">
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            size={14}
            className={i < Math.round(rate) ? 'php-star-filled' : 'php-star-empty'}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={`php-preview php-${position}`}>
      {/* Price Section */}
      <div className="php-price-section">
        <div className="php-price">
          ${(product.price_cents / 100).toFixed(2)}
        </div>
      </div>

      {/* Rating Section */}
      <div className="php-rating-section">
        {renderStars(rating)}
        <span className="php-rating-text">
          {rating > 0 ? `${rating.toFixed(1)} (${ratingCount})` : 'No ratings'}
        </span>
      </div>

      {/* In Carts Section */}
      {inCartsCount > 0 && (
        <div className="php-carts-section">
          <ShoppingCart size={14} />
          <span className="php-carts-text">
            {inCartsCount} {inCartsCount === 1 ? 'cart' : 'carts'}
          </span>
        </div>
      )}

      {/* Skills Tags */}
      {displaySkills.length > 0 && (
        <div className="php-skills-section">
          {displaySkills.map((skill) => (
            <span key={skill.id} className="php-skill-tag">
              {skill.name}
            </span>
          ))}
        </div>
      )}

      {/* Availability Status */}
      {product.is_available !== undefined && (
        <div className={`php-availability ${product.is_available ? 'php-available' : 'php-unavailable'}`}>
          {product.is_available ? 'Available' : 'Unavailable'}
        </div>
      )}
    </div>
  );
}
