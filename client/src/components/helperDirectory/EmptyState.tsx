import React from 'react';
import { Link } from 'react-router-dom';
import { SearchX, RotateCcw, MapPin, ArrowRight } from 'lucide-react';
import { ADJACENT_SKILLS, SKILL_TILES } from '../../types/helperDirectory';

interface EmptyStateProps {
  query: string;
  hasFilters: boolean;
  onReset: () => void;
  /** The category the user was filtering by (from skill tile selection) */
  selectedCategory?: string;
  /** Current max distance filter value */
  maxDistance?: number;
  /** Called when user wants to expand the search radius */
  onExpandRadius?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  query,
  hasFilters,
  onReset,
  selectedCategory,
  maxDistance,
  onExpandRadius,
}) => {
  const adjacentCategories = selectedCategory ? (ADJACENT_SKILLS[selectedCategory] ?? []) : [];
  const adjacentTiles = adjacentCategories
    .map((cat) => SKILL_TILES.find((t) => t.category === cat))
    .filter(Boolean) as (typeof SKILL_TILES)[number][];

  const canExpandRadius = onExpandRadius && maxDistance && maxDistance < 100;
  const nextRadius = maxDistance ? Math.min(maxDistance * 2, 100) : null;

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 px-6 text-center col-span-full">
      <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
        <SearchX className="w-7 h-7 text-gray-500" aria-hidden="true" />
      </div>

      <div>
        <p className="text-white font-semibold text-lg">No helpers found nearby</p>
        <p className="text-gray-400 text-sm mt-1 max-w-sm leading-relaxed">
          {query
            ? `No results for "${query}".`
            : selectedCategory
            ? `No ${selectedCategory} helpers match your current filters.`
            : 'No helpers match your current filters.'}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 w-full max-w-xs">

        {/* Expand radius */}
        {canExpandRadius && (
          <button
            onClick={onExpandRadius}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <MapPin className="w-4 h-4" aria-hidden="true" />
            Expand to {nextRadius} miles
          </button>
        )}

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium rounded-xl transition-colors"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            Clear all filters
          </button>
        )}

        {/* Post a job CTA */}
        <Link
          to="/register/customer"
          className="w-full flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm font-medium rounded-xl transition-colors"
        >
          Post a job — let helpers come to you
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Adjacent skill suggestions */}
      {adjacentTiles.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-3">
            Try a similar skill:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {adjacentTiles.map((tile) => (
              <Link
                key={tile.id}
                to={`/helpers?skill=${tile.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-xs text-gray-300 hover:text-white transition-colors"
              >
                <span aria-hidden="true">{tile.icon}</span>
                {tile.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-600 max-w-xs">
        Don't see what you need?{' '}
        <Link to="/register/customer" className="text-brand-500 hover:text-brand-400 transition-colors">
          Post a job for free
        </Link>{' '}
        and qualified helpers will reach out to you.
      </p>
    </div>
  );
};

export default EmptyState;
