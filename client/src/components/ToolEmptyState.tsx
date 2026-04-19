import React from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import './ToolEmptyState.css';

interface ToolEmptyStateProps {
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

const ToolEmptyState: React.FC<ToolEmptyStateProps> = ({ onClearFilters, hasActiveFilters }) => {
  const { t } = useTranslation();

  return (
    <div className="tool-empty-state">
      <div className="tool-empty-state-icon">
        <Package className="w-16 h-16 text-gray-300 dark:text-gray-600" />
      </div>
      <h3 className="tool-empty-state-title">{t('toolRentals.noResults')}</h3>
      <p className="tool-empty-state-description">
        {hasActiveFilters
          ? 'Try broadening your search criteria or filters'
          : 'No tools available for rent at the moment'}
      </p>
      {hasActiveFilters && (
        <button onClick={onClearFilters} className="tool-empty-state-button">
          {t('toolRentals.clearAllFilters')}
        </button>
      )}
    </div>
  );
};

export default React.memo(ToolEmptyState);
