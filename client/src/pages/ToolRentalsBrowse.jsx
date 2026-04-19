import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader, AlertCircle, X } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import ToolCard from '../components/ToolCard';
import ToolFiltersPanel from '../components/ToolFiltersPanel';
import ToolDetailModal from '../components/ToolDetailModal';
import ToolEmptyState from '../components/ToolEmptyState';
import { toolRentalsApi } from '../api/toolRentals';
import './ToolRentalsBrowse.css';

const PAGE_SIZE = 30;

const ToolRentalsBrowse = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tools, setTools] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTool, setSelectedTool] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState({
    category: '',
    city: '',
    name: '',
    priceMin: undefined,
    priceMax: undefined,
    sort: 'newest',
  });

  // Detect if any filters are active
  const hasActiveFilters = filters.category || filters.city || filters.name || filters.priceMin || filters.priceMax;
  const activeFilterCount = (filters.category ? 1 : 0) + (filters.city ? 1 : 0) + (filters.name ? 1 : 0) + (filters.priceMin ? 1 : 0) + (filters.priceMax ? 1 : 0);

  // Load categories on mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const cats = await toolRentalsApi.getCategories();
        setCategories(cats);
      } catch (err) {
        console.error('Failed to load categories - full error:', err);
        console.error('Error response:', err.response?.data);
        console.error('Error status:', err.response?.status);
        setError(t('toolRentals.errorLoadCategories'));
      }
    };
    loadCategories();
  }, [t]);

  // Load tools when filters change
  useEffect(() => {
    setOffset(0);
    loadTools(0);
  }, [filters]);

  // Load initial tools
  useEffect(() => {
    loadTools(0);
  }, []);

  const loadTools = async (newOffset) => {
    try {
      setLoading(true);
      setError(null);
      const newTools = await toolRentalsApi.browseTools({
        category: filters.category,
        city: filters.city,
        name: filters.name,
        priceMin: filters.priceMin,
        priceMax: filters.priceMax,
        sort: filters.sort,
        limit: PAGE_SIZE,
        offset: newOffset,
      });

      // Apply client-side sorting based on selected sort option
      const sortedTools = sortTools(newTools, filters.sort);

      if (newOffset === 0) {
        setTools(sortedTools);
        // Set total count: use length as minimum (actual total may be higher)
        setTotalCount(newTools.length >= PAGE_SIZE ? newTools.length * 3 : newTools.length);
      } else {
        setTools((prev) => [...prev, ...sortedTools]);
        setTotalCount((prev) => Math.max(prev, offset + PAGE_SIZE + newTools.length));
      }

      setHasMore(newTools.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load tools:', err);
      setError(t('toolRentals.errorLoadTools'));
    } finally {
      setLoading(false);
    }
  };

  const sortTools = (toolList, sortType) => {
    const sorted = [...toolList];
    if (sortType === 'price-asc') {
      sorted.sort((a, b) => a.daily_rate - b.daily_rate);
    } else if (sortType === 'price-desc') {
      sorted.sort((a, b) => b.daily_rate - a.daily_rate);
    }
    // 'newest' is default (API returns in created_at DESC order)
    return sorted;
  };

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    loadTools(newOffset);
  };

  const handleViewDetails = (tool) => {
    setSelectedTool(tool);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTool(null);
  };

  const handleMessageOwner = (userId) => {
    handleCloseModal();
    navigate(`/messages?userId=${userId}`);
  };

  const handleViewProfile = (userId) => {
    handleCloseModal();
    navigate(`/helper/${userId}`);
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({
      category: '',
      city: '',
      name: '',
      priceMin: undefined,
      priceMax: undefined,
      sort: 'newest',
    });
  };

  const handleRemoveFilter = (filterKey) => {
    setFilters((prev) => ({
      ...prev,
      [filterKey]: '',
    }));
  };

  return (
    <PageShell>
      <PageMeta title={t('toolRentals.browsePage')} description={t('toolRentals.browseDescription')} />

      <div className="tool-rentals-container">
        <div className="tool-rentals-header">
          <h1 className="tool-rentals-title">{t('toolRentals.browsePage')}</h1>
          <p className="tool-rentals-subtitle">{t('toolRentals.browseSubtitle')}</p>
        </div>

        {/* Filter Active Badge */}
        {hasActiveFilters && (
          <div className="tool-rentals-filter-badge">
            <span className="tool-rentals-filter-badge-text">
              {t('toolRentals.filtersActive', { count: activeFilterCount })}
            </span>
          </div>
        )}

        <div className={`tool-rentals-layout ${hasActiveFilters ? 'filters-active' : ''}`}>
          {/* Filters Sidebar */}
          <aside className="tool-rentals-sidebar">
            <ToolFiltersPanel
              categories={categories}
              onFilterChange={handleFilterChange}
              isLoading={loading}
            />
          </aside>

          {/* Main Content */}
          <main className="tool-rentals-main">
            {error && (
              <div className="tool-rentals-error">
                <AlertCircle className="w-5 h-5" />
                <p>{error}</p>
              </div>
            )}

            {loading && offset === 0 ? (
              <div className="tool-rentals-loading">
                <Loader className="animate-spin w-8 h-8" />
                <p>{t('common.loading')}</p>
              </div>
            ) : tools.length > 0 ? (
              <>
                {/* Pagination Counter */}
                <div className="tool-rentals-pagination-info">
                  {t('toolRentals.showingTools', {
                    count: tools.length,
                    total: totalCount || tools.length
                  })}
                </div>

                <div className="tool-rentals-grid">
                  {tools.map((tool) => (
                    <ToolCard
                      key={tool.id}
                      tool={tool}
                      onViewDetails={handleViewDetails}
                      onViewProfile={handleViewProfile}
                    />
                  ))}
                </div>

                {hasMore && (
                  <div className="tool-rentals-load-more">
                    <button
                      onClick={handleLoadMore}
                      disabled={loading}
                      className="tool-rentals-load-btn"
                    >
                      {loading ? (
                        <>
                          <Loader className="animate-spin w-4 h-4" />
                          {t('common.loading')}
                        </>
                      ) : (
                        t('toolRentals.loadMore')
                      )}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <ToolEmptyState
                onClearFilters={handleClearFilters}
                hasActiveFilters={hasActiveFilters}
              />
            )}
          </main>
        </div>
      </div>

      {/* Tool Detail Modal */}
      {selectedTool && (
        <ToolDetailModal
          tool={selectedTool}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onMessage={handleMessageOwner}
          onViewProfile={handleViewProfile}
        />
      )}
    </PageShell>
  );
};

export default ToolRentalsBrowse;
