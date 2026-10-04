import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SuggestDropdown } from '../../components/SuggestDropdown';
import '../lib/suggestDropdownAdmin.css';

export default function OrderFilters({ filters, onFilterChange, suggestItems = [] }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const handleSearch = (value) => {
    setSearch(value);
    onFilterChange({ search: value });
  };

  const handleSelectSuggestion = (item) => {
    handleSearch(item.title || '');
  };

  const handleStatusFilter = (status) => {
    onFilterChange({ status: filters.status === status ? '' : status });
  };

  const handleReset = () => {
    setSearch('');
    onFilterChange({
      status: '',
      search: '',
      skip: 0,
      sortBy: 'created_at',
      sortOrder: 'DESC'
    });
  };

  const statusValues = ['pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded'];
  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    paid: 'bg-blue-100 text-blue-800',
    processing: 'bg-purple-100 text-purple-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    refunded: 'bg-gray-100 text-gray-800',
  };
  const statusLabel = (status) => t(`adminOrderFilters.statuses.${status}`);

  const activeFilters = [
    filters.status && { label: t('adminOrderFilters.activeStatus', { status: statusLabel(filters.status) }), type: 'status' },
    search && { label: t('adminOrderFilters.activeSearch', { search }), type: 'search' },
  ].filter(Boolean);

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 p-4">
      {/* Search Bar */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('adminOrderFilters.searchOrders')}
        </label>
        <SuggestDropdown
          id="order-filters-search"
          items={suggestItems}
          value={search}
          onQueryChange={handleSearch}
          onSelect={handleSelectSuggestion}
          recentsKey="oxsteed_admin_order_filters_search_recents"
          placeholder={t('adminOrderFilters.searchPlaceholder')}
          ariaLabel={t('adminOrderFilters.searchPlaceholder')}
          className="sd-admin-adaptive"
        />
      </div>

      {/* Filter Button */}
      <div className="mb-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          {isOpen ? '▼' : '▶'} {t('adminOrderFilters.filters')}
        </button>
      </div>

      {/* Filter Options */}
      {isOpen && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('adminOrderFilters.status')}
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {statusValues.map((value) => (
                <button
                  key={value}
                  onClick={() => handleStatusFilter(value)}
                  className={`rounded px-3 py-2 text-xs font-medium transition ${
                    filters.status === value
                      ? statusColors[value]
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100 dark:bg-gray-600 dark:text-gray-300 dark:border-gray-500'
                  }`}
                >
                  {statusLabel(value)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Active Filters Display */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map((filter, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            >
              {filter.label}
              <button
                onClick={handleReset}
                aria-label={t('adminOrderFilters.clearFilters')}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
