import React from 'react';
import { Link } from 'react-router-dom';
import { SearchX, RotateCcw, ArrowRight, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ADJACENT_SKILLS, SKILL_TILES } from '../../types/jobDirectory';

interface EmptyStateProps {
  query: string;
  hasFilters: boolean;
  onReset: () => void;
  /** The category the user was filtering by (from skill tile selection) */
  selectedCategory?: string;
  /** Active state filter — if set, we suggest clearing it. */
  state?: string;
  onClearState?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  query,
  hasFilters,
  onReset,
  selectedCategory,
  state,
  onClearState,
}) => {
  const { t } = useTranslation();
  const adjacentCategories = selectedCategory ? (ADJACENT_SKILLS[selectedCategory] ?? []) : [];
  const adjacentTiles = adjacentCategories
    .map((cat) => SKILL_TILES.find((tile) => tile.category === cat))
    .filter(Boolean) as (typeof SKILL_TILES)[number][];

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 px-6 text-center col-span-full">
      <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
        <SearchX className="w-7 h-7 text-gray-500" aria-hidden="true" />
      </div>

      <div>
        <p className="text-white font-semibold text-lg">{t('jobsDir.noJobsTitle')}</p>
        <p className="text-gray-400 text-sm mt-1 max-w-sm leading-relaxed">
          {query
            ? t('jobsDir.noResultsQuery', { query })
            : selectedCategory
            ? t('jobsDir.noJobsCat', { category: selectedCategory })
            : t('jobsDir.noJobsFiltered')}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 w-full max-w-xs">

        {/* Clear state */}
        {state && onClearState && (
          <button
            onClick={onClearState}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <MapPin className="w-4 h-4" aria-hidden="true" />
            {t('jobsDir.showAllStates')}
          </button>
        )}

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium rounded-xl transition-colors"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            {t('jobsDir.clearAllFilters')}
          </button>
        )}

        {/* Post a job CTA */}
        <Link
          to="/post-job"
          className="w-full flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm font-medium rounded-xl transition-colors"
        >
          {t('jobsDir.postJobCta')}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Adjacent skill suggestions */}
      {adjacentTiles.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-3">
            {t('jobsDir.trySimilarSkill')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {adjacentTiles.map((tile) => (
              <Link
                key={tile.id}
                to={`/jobs?skill=${tile.id}`}
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
        {t('jobsDir.dontSeeWhat')}{' '}
        <Link to="/post-job" className="text-brand-500 hover:text-brand-400 transition-colors">
          {t('jobsDir.postYourOwn')}
        </Link>{' '}
        {t('jobsDir.postYourOwnTrailing')}
      </p>
    </div>
  );
};

export default EmptyState;
