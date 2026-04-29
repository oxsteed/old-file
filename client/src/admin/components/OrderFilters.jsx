import React, { useState } from 'react';

export default function OrderFilters({ filters, onFilterChange }) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearch(value);
    onFilterChange({ search: value });
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

  const statusOptions = [
    { value: 'pending', label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'paid', label: 'Paid', color: 'bg-blue-100 text-blue-800' },
    { value: 'processing', label: 'Processing', color: 'bg-purple-100 text-purple-800' },
    { value: 'completed', label: 'Completed', color: 'bg-green-100 text-green-800' },
    { value: 'cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-800' },
    { value: 'refunded', label: 'Refunded', color: 'bg-gray-100 text-gray-800' },
  ];

  const activeFilters = [
    filters.status && { label: `Status: ${filters.status}`, type: 'status' },
    search && { label: `Search: ${search}`, type: 'search' },
  ].filter(Boolean);

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 p-4">
      {/* Search Bar */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Search Orders
        </label>
        <input
          type="text"
          placeholder="Search by order ID, customer email, or name..."
          value={search}
          onChange={handleSearch}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
        />
      </div>

      {/* Filter Button */}
      <div className="mb-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          {isOpen ? '▼' : '▶'} Filters
        </button>
      </div>

      {/* Filter Options */}
      {isOpen && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Status
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleStatusFilter(option.value)}
                  className={`rounded px-3 py-2 text-xs font-medium transition ${
                    filters.status === option.value
                      ? option.color
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100 dark:bg-gray-600 dark:text-gray-300 dark:border-gray-500'
                  }`}
                >
                  {option.label}
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
