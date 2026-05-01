import React from 'react';
import { Link } from 'react-router-dom';
import { SearchX, RotateCcw, ArrowRight, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ADJACENT_TOOL_CATEGORIES } from '../../types/toolDirectory';
import type { ToolCategoryTile } from '../../types/toolDirectory';

interface EmptyStateProps {
  query: string;
  hasFilters: boolean;
  onReset: () => void;
  /** The category the user was filtering by (from tile selection) */
  selectedCategory?: string;
  /** Tiles with translated labels */
  translatedTiles: Array<ToolCategoryTile & { label: string; desc: string; subTypes: string[] }>;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  query,
  hasFilters,
  onReset,
  selectedCategory,
  translatedTiles,
}) => {
  const { t } = useTranslation();
  const adjacentCategories = selectedCategory ? (ADJACENT_TOOL_CATEGORIES[selectedCategory] ?? []) : [];
  const adjacentTiles = adjacentCategories
    .map((cat) => translatedTiles.find((tile) => tile.category === cat))
    .filter(Boolean) as typeof translatedTiles;

  const categoryLabel =
    selectedCategory &&
    (translatedTiles.find((x) => x.category === selectedCategory)?.label ?? selectedCategory);

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 px-6 text-center col-span-full">
      <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
        <SearchX className="w-7 h-7 text-gray-500" aria-hidden="true" />
      </div>

      <div>
        <p className="text-white font-semibold text-lg">{t('toolRentalsDir.noToolsFound')}</p>
        <p className="text-gray-400 text-sm mt-1 max-w-sm leading-relaxed">
          {query
            ? t('toolRentalsDir.noResultsQuery', { query })
            : selectedCategory
            ? t('toolRentalsDir.noToolsCat', { category: categoryLabel })
            : t('toolRentalsDir.noToolsFiltered')}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 w-full max-w-xs">

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium rounded-xl transition-colors"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            {t('toolRentalsDir.clearAllFilters')}
          </button>
        )}

        {/* List a tool CTA */}
        <Link
          to="/profile/tool-rentals"
          className="w-full flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm font-medium rounded-xl transition-colors"
        >
          <Wrench className="w-4 h-4" aria-hidden="true" />
          {t('toolRentalsDir.listToolCta')}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Adjacent category suggestions */}
      {adjacentTiles.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-3">
            {t('toolRentalsDir.trySimilarCategory')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {adjacentTiles.map((tile) => (
              <Link
                key={tile.id}
                to={`/tool-rentals?category=${tile.id}`}
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
        {t('toolRentalsDir.dontSeeWhat')}{' '}
        <Link to="/profile/tool-rentals" className="text-brand-500 hover:text-brand-400 transition-colors">
          {t('toolRentalsDir.listForFree')}
        </Link>{' '}
        {t('toolRentalsDir.listForFreeTrailing')}
      </p>
    </div>
  );
};

export default EmptyState;
