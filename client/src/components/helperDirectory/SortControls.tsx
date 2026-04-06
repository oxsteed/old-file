import React from 'react';
import { ArrowUpDown } from 'lucide-react';
import type { SortOption } from '../../types/helperDirectory';
import { SORT_LABELS } from '../../types/helperDirectory';

interface SortControlsProps {
  value: SortOption;
  onChange: (v: SortOption) => void;
  resultCount: number;
}

const SortControls: React.FC<SortControlsProps> = ({ value, onChange, resultCount }) => (
  <div className="flex items-center justify-between gap-3">
    <p className="text-sm text-gray-400 flex-shrink-0">
      <span className="font-semibold text-white">{resultCount}</span>{' '}
      helper{resultCount !== 1 ? 's' : ''} found
    </p>
    <div className="relative flex items-center gap-2">
      <ArrowUpDown className="w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden="true" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        className="appearance-none bg-gray-800 border border-gray-700 text-white text-sm rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
        aria-label="Sort helpers by"
      >
        {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
          <option key={opt} value={opt}>
            {SORT_LABELS[opt]}
          </option>
        ))}
      </select>
      {/* Custom caret */}
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

export default SortControls;
