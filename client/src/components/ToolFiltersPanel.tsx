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
  name?: string;
  priceMin?: number;
  priceMax?: number;
  sort: 'newest' | 'price-asc' | 'price-desc' | 'distance';
}

const ToolFiltersPanel: React.FC<ToolFiltersPanelProps> = ({ categories, onFilterChange, isLoading = false }) => {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<FilterState>({
    category: '',
    city: '',
    name: '',
    priceMin: undefined,
    priceMax: undefined,
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

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFilters = { ...filters, name: e.target.value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handlePriceMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFilters = { ...filters, priceMin: e.target.value ? parseFloat(e.target.value) : undefined };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handlePriceMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFilters = { ...filters, priceMax: e.target.value ? parseFloat(e.target.value) : undefined };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFilters = { ...filters, sort: e.target.value as FilterState['sort'] };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleReset = () => {
    const newFilters: FilterState = {
      category: '',
      city: '',
      name: '',
      priceMin: undefined,
      priceMax: undefined,
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

      {/* Tool Name Search */}
      <div className="tool-filter-group">
        <label htmlFor="name-filter" className="tool-filter-label">
          {t('toolRentals.search')}
        </label>
        <input
          id="name-filter"
          type="text"
          value={filters.name || ''}
          onChange={handleNameChange}
          disabled={isLoading}
          placeholder={t('toolRentals.search')}
          className="tool-filter-input"
        />
      </div>

      {/* Price Range Filter */}
      <div className="tool-filter-group">
        <label className="tool-filter-label">{t('toolRentals.priceRange')}</label>
        <div className="tool-filter-price-range">
          <input
            type="number"
            value={filters.priceMin || ''}
            onChange={handlePriceMinChange}
            disabled={isLoading}
            placeholder={t('toolRentals.from')}
            min="0"
            className="tool-filter-price-input"
          />
          <span>-</span>
          <input
            type="number"
            value={filters.priceMax || ''}
            onChange={handlePriceMaxChange}
            disabled={isLoading}
            placeholder={t('toolRentals.to')}
            min="0"
            className="tool-filter-price-input"
          />
        </div>
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
          <option value="distance">{t('toolRentals.nearest')}</option>
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
