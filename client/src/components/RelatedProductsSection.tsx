import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { marketplaceApi } from '../api/marketplaceApi';
import '../styles/RelatedProductsSection.css';

interface RelatedProduct {
  id: string;
  name: string;
  price_cents: number;
  product_image_url?: string;
  average_rating?: number;
  review_count?: number;
  category?: string;
}

interface RelatedProductsSectionProps {
  productId: string;
  onAddToCart: (productId: string, quantity: number) => void;
  onOpenDetail?: (product: RelatedProduct) => void;
}

export default function RelatedProductsSection({
  productId,
  onAddToCart,
  onOpenDetail,
}: RelatedProductsSectionProps) {
  const { t } = useTranslation();
  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([]);
  const [frequentlyBought, setFrequentlyBought] = useState<RelatedProduct[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const [loadingFrequent, setLoadingFrequent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;

    const fetchRelatedProducts = async () => {
      try {
        setLoadingRelated(true);
        // Fetch products by skill - related products
        const response = await marketplaceApi.getProductsBySkill(productId, 6);
        setRelatedProducts(response.data?.products || []);
      } catch (err) {
        console.error('Failed to fetch related products:', err);
        setError(t('common.errorLoading'));
      } finally {
        setLoadingRelated(false);
      }
    };

    fetchRelatedProducts();
  }, [productId, t]);

  // Simulate frequently bought together - in a real app, this would be a separate API call
  useEffect(() => {
    if (!productId) return;

    const fetchFrequentlyBought = async () => {
      try {
        setLoadingFrequent(true);
        // This would be a dedicated endpoint in production
        // For now, we'll fetch related products as a placeholder
        const response = await marketplaceApi.searchProducts('', '', null, null, 1, 6);
        setFrequentlyBought(response.data?.products?.slice(0, 6) || []);
      } catch (err) {
        console.error('Failed to fetch frequently bought products:', err);
        // Don't set error for this section - it's supplementary
      } finally {
        setLoadingFrequent(false);
      }
    };

    fetchFrequentlyBought();
  }, [productId]);

  const handleAddToCart = (product: RelatedProduct, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAddToCart) {
      onAddToCart(product.id, 1);
      toast.success(t('marketplace.addedToCart') || 'Added to cart');
    }
  };

  const handleProductClick = (product: RelatedProduct) => {
    if (onOpenDetail) {
      onOpenDetail(product);
    }
  };

  const renderStars = (rating: number) => {
    if (!rating) return null;
    const stars = [];
    const roundedRating = Math.round(rating * 2) / 2;
    for (let i = 1; i <= 5; i++) {
      const fill =
        i <= roundedRating ? 'full' : i - roundedRating === 0.5 ? 'half' : 'none';
      stars.push(
        <span
          key={i}
          className={`rps-star ${fill === 'full' ? 'rps-star-full' : fill === 'half' ? 'rps-star-half' : 'rps-star-empty'}`}
        >
          ★
        </span>
      );
    }
    return stars;
  };

  const ProductCard = ({ product }: { product: RelatedProduct }) => (
    <div className="rps-product-card" onClick={() => handleProductClick(product)}>
      <div className="rps-card-image">
        {product.product_image_url ? (
          <img
            src={product.product_image_url}
            alt={product.name}
            className="rps-image"
            loading="lazy"
          />
        ) : (
          <div className="rps-image-placeholder">
            {t('marketplace.noImage') || 'No Image'}
          </div>
        )}
      </div>

      <div className="rps-card-content">
        <h4 className="rps-product-name">{product.name}</h4>

        {product.average_rating && product.review_count ? (
          <div className="rps-rating">
            <div className="rps-stars">{renderStars(product.average_rating)}</div>
            <span className="rps-rating-text">
              ({product.review_count})
            </span>
          </div>
        ) : null}

        <p className="rps-product-price">
          ${(product.price_cents / 100).toFixed(2)}
        </p>

        <button
          className="rps-add-btn"
          onClick={(e) => handleAddToCart(product, e)}
          aria-label={t('marketplace.addToCart') || 'Add to cart'}
        >
          <ShoppingCart size={16} />
          <span>{t('marketplace.addToCart') || 'Add'}</span>
        </button>
      </div>
    </div>
  );

  const SkeletonCard = () => (
    <div className="rps-product-card rps-skeleton">
      <div className="rps-card-image rps-skeleton-image" />
      <div className="rps-card-content">
        <div className="rps-skeleton-text rps-skeleton-title" />
        <div className="rps-skeleton-text rps-skeleton-rating" />
        <div className="rps-skeleton-text rps-skeleton-price" />
      </div>
    </div>
  );

  if (error && !relatedProducts.length && !frequentlyBought.length) {
    return null; // Silently fail for this supplementary section
  }

  return (
    <div className="rps-container">
      {/* Related Products Section */}
      {(loadingRelated || relatedProducts.length > 0) && (
        <div className="rps-section">
          <h3 className="rps-section-title">{t('marketplace.relatedProducts') || 'Related Products'}</h3>

          {loadingRelated ? (
            <div className="rps-loading">
              <Loader className="rps-spinner" />
            </div>
          ) : relatedProducts.length > 0 ? (
            <div className="rps-scroll-container">
              <div className="rps-products-grid">
                {relatedProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Frequently Bought Together Section */}
      {(loadingFrequent || frequentlyBought.length > 0) && (
        <div className="rps-section">
          <h3 className="rps-section-title">
            {t('marketplace.frequentlyBoughtTogether') || 'Frequently Bought Together'}
          </h3>

          {loadingFrequent ? (
            <div className="rps-loading">
              <Loader className="rps-spinner" />
            </div>
          ) : frequentlyBought.length > 0 ? (
            <div className="rps-scroll-container">
              <div className="rps-products-grid">
                {frequentlyBought.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
