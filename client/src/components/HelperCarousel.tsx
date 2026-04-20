import { useRef, useEffect, useState } from 'react';
import type { HelperCardData } from '../types/helperDirectory';
import HelperProfilePreview from './HelperProfilePreview';
import '../styles/HelperCarousel.css';

interface HelperCarouselProps {
  helpers: HelperCardData[];
  onBookClick: (helperId: string) => void;
  onMessageClick: (helperId: string) => void;
}

export default function HelperCarousel({
  helpers,
  onBookClick,
  onMessageClick,
}: HelperCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedHelperId, setExpandedHelperId] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Check scroll position to enable/disable arrows
  const checkScroll = () => {
    const container = scrollRef.current;
    if (!container) return;

    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(
      container.scrollLeft < container.scrollWidth - container.clientWidth - 10
    );
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollRef.current;
    if (!container) return;

    const scrollAmount = 340; // card width + gap
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });

    setTimeout(checkScroll, 300);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scroll('left');
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        scroll('right');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (helpers.length === 0) {
    return (
      <div className="carousel-empty">
        <p>No helpers available. Try adjusting your filters.</p>
      </div>
    );
  }

  return (
    <div className="carousel-wrapper">
      {/* Scroll buttons */}
      {canScrollLeft && (
        <button
          className="carousel-btn carousel-btn--left"
          onClick={() => scroll('left')}
          aria-label="Scroll left"
          title="Previous helpers"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {canScrollRight && (
        <button
          className="carousel-btn carousel-btn--right"
          onClick={() => scroll('right')}
          aria-label="Scroll right"
          title="Next helpers"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Carousel container */}
      <div
        ref={scrollRef}
        className="carousel-container"
        onScroll={checkScroll}
        role="region"
        aria-label="Helper carousel"
      >
        {helpers.map((helper) => (
          <div key={helper.id} className="carousel-card-wrapper">
            <HelperProfilePreview
              helper={helper}
              isExpanded={expandedHelperId === helper.id}
              onExpand={setExpandedHelperId}
              onCollapse={() => setExpandedHelperId(null)}
              onBookClick={onBookClick}
              onMessageClick={onMessageClick}
            />
          </div>
        ))}
      </div>

      {/* Mobile hint */}
      <div className="carousel-hint">
        ← Swipe or use arrow keys to browse →
      </div>
    </div>
  );
}
