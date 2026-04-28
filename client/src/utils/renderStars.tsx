/**
 * Render star rating visualization
 * @param rating - Average rating (0-5)
 * @param size - Icon size in pixels (default: 16)
 * @param renderAsSpan - If true, render as span with ★ character; if false, use Icon component
 * @returns Array of React elements or null if rating is 0/falsy
 */

import { Star } from 'lucide-react';

export function renderStarsAsIcons(
  rating: number,
  size: number = 16,
  className?: string
): React.ReactNode[] {
  const stars = [];
  const roundedRating = Math.round(rating * 2) / 2;
  for (let i = 1; i <= 5; i++) {
    const fill = i <= roundedRating ? 'full' : i - roundedRating === 0.5 ? 'half' : 'none';
    stars.push(
      <Star
        key={i}
        size={size}
        className={`${className} ${fill === 'full' ? `${className}-full` : fill === 'half' ? `${className}-half` : `${className}-empty`}`}
      />
    );
  }
  return stars;
}

export function renderStarsAsSpans(rating: number): React.ReactNode[] | null {
  if (!rating) return null;
  const stars = [];
  const roundedRating = Math.round(rating * 2) / 2;
  for (let i = 1; i <= 5; i++) {
    const fill = i <= roundedRating ? 'full' : i - roundedRating === 0.5 ? 'half' : 'none';
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
}
