import React from 'react';
import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SortOption } from '../../types/helperDirectory';

const SORT_OPTIONS: SortOption[] = [
  'best_match',
  'highest_rated',
  'most_reviews',
  'lowest_price',
  'fastest_response',
  'newest',
];

interface SortControlsProps {
  value: SortOption;
  onChange: (v: SortOption) => void;
  resultCount: number;
}

const SortControls: React.FC<SortControlsProps> = ({ value, onChange, resultCount }) => {
  const { t } = useTranslation();

  return (
    <div className="directory-sort-controls flex min-w-0 items-center justify-between gap-3">
      <p className="directory-sort-count text-sm text-gray-400 flex-shrink-0">
        {t('helpersDir.helperCount', { count: resultCount })}
      </p>
      <div className="directory-sort-field relative flex min-w-0 items-center gap-2">
        <ArrowUpDown className="directory-sort-icon w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as SortOption)}
          className="directory-sort-select min-w-0 appearance-none bg-gray-800 border border-gray-700 text-white text-sm rounded-xl ps-3 pe-8 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
          aria-label={t('helpersDir.sortByAria')}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {t(`helpersDir.sort.${opt}`)}
            </option>
          ))}
        </select>
        {/* Custom caret */}
        <svg
          className="absolute end-2.5 w-3.5 h-3.5 text-gray-500 pointer-events-none"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  );
};

export default SortControls;
