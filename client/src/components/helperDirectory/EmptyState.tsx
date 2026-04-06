import React from 'react';
import { SearchX, RotateCcw } from 'lucide-react';

interface EmptyStateProps {
  query: string;
  hasFilters: boolean;
  onReset: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ query, hasFilters, onReset }) => (
  <div className="flex flex-col items-center justify-center gap-4 py-20 px-6 text-center col-span-full">
    <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
      <SearchX className="w-7 h-7 text-gray-500" aria-hidden="true" />
    </div>
    <div>
      <p className="text-white font-semibold text-lg">No helpers found</p>
      <p className="text-gray-400 text-sm mt-1 max-w-sm leading-relaxed">
        {query
          ? `No results for "${query}".`
          : 'No helpers match your current filters.'}{' '}
        {hasFilters ? 'Try adjusting or removing some filters.' : 'Try a different search term.'}
      </p>
    </div>
    {hasFilters && (
      <button
        onClick={onReset}
        className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
      >
        <RotateCcw className="w-4 h-4" aria-hidden="true" />
        Clear all filters
      </button>
    )}
  </div>
);

export default EmptyState;
