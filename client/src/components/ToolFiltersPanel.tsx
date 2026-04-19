import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import './ToolFiltersPanel.css';

interface ToolFiltersPanelProps {
  categories: string[];
  onFilterChange: (filters: FilterState) => void;
  isLoading?: boolean;
}

export interface FilterState {
  category: string;
  city: string;
  sort: 'newest' | 'price-asc' | 'price-desc';
}

const ToolFiltersPanel: React.FC<ToolFiltersPanelProps> = ({ categories, onFilterChange, isLoading = false }) => {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<FilterState>({
    category: '',
    city: '',
    sort: 'newest',
  });

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFilters = { ...filters, category: e.target.value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleCityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFilters = { ...filters, city: e.target.value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFilters = { ...filters, sort: e.target.value as FilterState['sort'] };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleReset = () => {
    const newFilters = {
      category: '',
      city: '',
      sort: 'newest',
    };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const hasActiveFilters = filters.category || filters.city;

  return (
    <div className="tool-filters-panel">
      <div className="tool-filters-header">
        <h3 className="tool-filters-title">{t('toolRentals.filters')}</h3>
        {hasActiveFilters && (
          <button onClick={handleReset} className="tool-filters-reset" disabled={isLoading}>
            <X className="w-4 h-4" />
            {t('common.reset')}
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div className="tool-filter-group">
        <label htmlFor="category-filter" className="tool-filter-label">
          {t('toolRentals.filterCategory')}
        </label>
        <select
          id="category-filter"
          value={filters.category}
          onChange={handleCategoryChange}
          disabled={isLoading}
          className="tool-filter-select"
        >
          <option value="">{t('common.all')}</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* City Filter */}
      <div className="tool-filter-group">
        <label htmlFor="city-filter" className="tool-filter-label">
          {t('toolRentals.filterCity')}
        </label>
        <input
          id="city-filter"
          type="text"
          value={filters.city}
          onChange={handleCityChange}
          disabled={isLoading}
          placeholder={t('toolRentals.cityPlaceholder')}
          className="tool-filter-input"
        />
      </div>

      {/* Sort */}
      <div className="tool-filter-group">
        <label htmlFor="sort-filter" className="tool-filter-label">
          {t('common.sortBy')}
        </label>
        <select
          id="sort-filter"
          value={filters.sort}
          onChange={handleSortChange}
          disabled={isLoading}
          className="tool-filter-select"
        >
          <option value="newest">{t('toolRentals.sortNewest')}</option>
          <option value="price-asc">{t('toolRentals.sortPriceLow')}</option>
          <option value="price-desc">{t('toolRentals.sortPriceHigh')}</option>
        </select>
      </div>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="tool-filters-active">
          <p className="tool-filters-active-label">{t('toolRentals.activeFilters')}:</p>
          <div className="tool-filters-active-chips">
            {filters.category && (
              <div className="tool-filter-chip">
                {filters.category}
                <button
                  onClick={() => setFilters({ ...filters, category: '' })}
                  className="tool-filter-chip-remove"
                  aria-label="Remove category filter"
                >
                  ×
                </button>
              </div>
            )}
            {filters.city && (
              <div className="tool-filter-chip">
                {t('toolRentals.filterCity')}: {filters.city}
                <button
                  onClick={() => setFilters({ ...filters, city: '' })}
                  className="tool-filter-chip-remove"
                  aria-label="Remove city filter"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolFiltersPanel;
