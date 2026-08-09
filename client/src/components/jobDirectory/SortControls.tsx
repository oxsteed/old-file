import React from 'react';
import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JobSortOption } from '../../types/jobDirectory';
import { JOB_SORT_OPTIONS } from '../../types/jobDirectory';

interface SortControlsProps {
  value: JobSortOption;
  onChange: (v: JobSortOption) => void;
  resultCount: number;
  /** When true the "Nearest" option is shown. Pass true only when lat/lng are available. */
  hasGeoFilter?: boolean;
}

const SortControls: React.FC<SortControlsProps> = ({ value, onChange, resultCount, hasGeoFilter = false }) => {
  const { t } = useTranslation();

  // Only include 'nearest' when the caller has an active geolocation filter.
  const visibleOptions = JOB_SORT_OPTIONS.filter(
    (opt) => opt !== 'nearest' || hasGeoFilter,
  );

  return (
    <div className="directory-sort-controls flex min-w-0 items-center justify-between gap-3">
      <p className="directory-sort-count text-sm text-gray-400 flex-shrink-0">
        <span className="font-semibold text-white">{resultCount}</span>{' '}
        {t('jobsDir.jobCount', { count: resultCount })}
      </p>
      <div className="directory-sort-field relative flex min-w-0 items-center gap-2">
        <ArrowUpDown className="directory-sort-icon w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as JobSortOption)}
          className="directory-sort-select min-w-0 appearance-none bg-gray-800 border border-gray-700 text-white text-sm rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
          aria-label={t('jobsDir.sortByAria')}
        >
          {visibleOptions.map((opt) => (
            <option key={opt} value={opt}>
              {t(`jobsDir.sort.${opt}`)}
            </option>
          ))}
        </select>
        <svg
          className="absolute right-2.5 w-3.5 h-3.5 text-gray-500 pointer-events-none"
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
