import { useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { HelperCardData } from '../types/helperDirectory';
import '../styles/HelperProfilePreview.css';

interface HelperProfilePreviewProps {
  helper: HelperCardData;
  isExpanded: boolean;
  onExpand: (id: string) => void;
  onCollapse: () => void;
  onBookClick: (helperId: string) => void;
  onMessageClick: (helperId: string) => void;
  highlightCategory?: string;
}

export default function HelperProfilePreview({
  helper,
  isExpanded,
  onExpand,
  onCollapse,
  onBookClick,
  onMessageClick,
  highlightCategory,
}: HelperProfilePreviewProps) {
  const expandableRef = useRef<HTMLDivElement>(null);

  // Handle click outside to collapse
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (expandableRef.current && !expandableRef.current.contains(e.target as Node)) {
        onCollapse();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, onCollapse]);

  const handleCardClick = () => {
    if (!isExpanded) {
      onExpand(helper.id);
    }
  };

  const locationStr = `${helper.city}, ${helper.state}`.trim();
  const distanceStr = helper.distanceMiles
    ? `${helper.distanceMiles.toFixed(1)} mi away`
    : null;

  return (
    <div
      ref={expandableRef}
      className={`helper-profile-preview${isExpanded ? ' helper-profile-preview--expanded' : ''}`}
      data-preview-container
    >
      {/* ── Collapsed Card (Always visible) ── */}
      <div className="hpp-card" onClick={handleCardClick} role="button" tabIndex={0}>
        <div className="hpp-header">
          <div className="hpp-avatar" style={{ backgroundImage: `url(${helper.avatar || ''})` }}>
            {!helper.avatar && helper.ownerName?.charAt(0).toUpperCase()}
          </div>
          <div className="hpp-info">
            <h3 className="hpp-name">{helper.ownerName}</h3>
            <div className="hpp-meta">
              <span className="hpp-rating">
                {'★'.repeat(Math.round(helper.rating))}
                <span className="hpp-rating-number">{helper.rating.toFixed(1)}</span>
              </span>
              <span className="hpp-reviews">({helper.reviewCount})</span>
            </div>
            <div className="hpp-location">
              {locationStr}
              {distanceStr && <span className="hpp-distance">{distanceStr}</span>}
            </div>
          </div>
          {helper.requireContactSignup && (
            <span className="hpp-badge hpp-badge--signup" title="Requires signup to contact">
              🔒
            </span>
          )}
        </div>

        <div className="hpp-skills">
          {helper.skills.slice(0, 3).map((skill, i) => (
            <span key={i} className="hpp-skill-tag">
              {skill}
            </span>
          ))}
          {helper.skills.length > 3 && (
            <span className="hpp-skill-tag hpp-skill-tag--more">+{helper.skills.length - 3}</span>
          )}
        </div>

        <div className="hpp-price">
          <span className="hpp-price-label">Starting at</span>
          <span className="hpp-price-value">
            ${helper.startingPrice}
            {helper.startingPriceUnit === '/hr' && <span className="hpp-price-unit">/hr</span>}
          </span>
        </div>

        {!isExpanded && <div className="hpp-expand-hint">Click to see details →</div>}
      </div>

      {/* ── Expanded Content (Slides down below card) ── */}
      <div className="hpp-expanded-content" role="region" aria-label={`${helper.ownerName} details`}>
        {/* Badges: Licenses & Insurance */}
        {(helper.licenses.length > 0 || helper.verified || helper.backgroundChecked) && (
          <div className="hpp-badges">
            {helper.verified && <span className="hpp-badge hpp-badge--verified">✓ ID Verified</span>}
            {helper.backgroundChecked && <span className="hpp-badge hpp-badge--bg-check">✓ Background Checked</span>}
            {helper.licenses.slice(0, 2).map((lic, i) => (
              <span key={i} className="hpp-badge hpp-badge--license">
                ✓ {lic.split('(')[0].trim()}
              </span>
            ))}
            {helper.licenses.length > 2 && (
              <span className="hpp-badge hpp-badge--more">+{helper.licenses.length - 2} more</span>
            )}
          </div>
        )}

        {/* Bio */}
        {helper.shortBio && (
          <div className="hpp-section">
            <p className="hpp-bio">{helper.shortBio}</p>
          </div>
        )}

        {/* Sample Reviews */}
        {helper.reviews && helper.reviews.length > 0 && (
          <div className="hpp-section">
            <h4 className="hpp-section-title">Recent Reviews</h4>
            <div className="hpp-reviews-list">
              {helper.reviews.slice(0, 3).map((review) => (
                <div key={review.id} className="hpp-review-item">
                  <div className="hpp-review-header">
                    <span className="hpp-review-rating">
                      {'★'.repeat(review.rating)}
                      <span className="hpp-review-rating-empty">{'☆'.repeat(5 - review.rating)}</span>
                    </span>
                    <span className="hpp-review-author">{review.authorName}</span>
                  </div>
                  <p className="hpp-review-text">{review.text}</p>
                  {review.date && (
                    <span className="hpp-review-date">
                      {new Date(review.date).toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Availability Snippet */}
        {helper.availabilitySnippet && (
          <div className="hpp-section">
            <h4 className="hpp-section-title">Availability</h4>
            <p className="hpp-availability">{helper.availabilitySnippet.summary}</p>
          </div>
        )}

        {/* Top Services / Categories */}
        {helper.categories.length > 0 && (
          <div className="hpp-section">
            <h4 className="hpp-section-title">Services</h4>
            <div className="hpp-categories">
              {helper.categories.slice(0, 5).map((cat, i) => {
                const isHighlighted = highlightCategory && cat === highlightCategory;
                return (
                  <span
                    key={i}
                    className={`hpp-category-tag${isHighlighted ? ' hpp-category-tag--highlighted' : ''}`}
                  >
                    {cat}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* CTA Buttons */}
        <div className="hpp-cta-section">
          <Link to={`/helpers/${helper.id}`} className="hpp-btn hpp-btn-secondary">
            View Full Profile
          </Link>
          <button
            className="hpp-btn hpp-btn-primary"
            onClick={() => onMessageClick(helper.id)}
          >
            Message
          </button>
          <button
            className="hpp-btn hpp-btn-primary"
            onClick={() => onBookClick(helper.id)}
          >
            Book Now
          </button>
        </div>
      </div>
    </div>
  );
}
