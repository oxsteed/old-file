import { X, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../styles/FilterDrawer.css';

export default function FilterDrawer({
  open,
  onClose,
  categories,
  selectedCategory,
  onCategoryChange,
  selectedMinPrice,
  onMinPriceChange,
  selectedMaxPrice,
  onMaxPriceChange,
  sortBy,
  onSortChange,
  sortOptions,
}) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fd-overlay" onClick={onClose} />

      {/* Drawer */}
      <div className="fd-drawer">
        {/* Header */}
        <div className="fd-header">
          <h2>{t('marketplace.filters')}</h2>
          <button className="fd-close" onClick={onClose} aria-label="Close filters">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="fd-content">
          {/* Category Filter */}
          <div className="fd-filter-group">
            <label className="fd-label">{t('marketplace.filterCategory')}</label>
            <div className="fd-select-wrapper">
              <select
                value={selectedCategory}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="fd-select"
              >
                <option value="">{t('common.all')}</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="fd-select-icon" />
            </div>
          </div>

          {/* Price Range Filter */}
          <div className="fd-filter-group">
            <label className="fd-label">{t('marketplace.priceRange')}</label>
            <div className="fd-price-inputs">
              <input
                type="number"
                placeholder={t('marketplace.minPrice')}
                value={selectedMinPrice}
                onChange={(e) => onMinPriceChange(e.target.value)}
                className="fd-input fd-input-min"
                min="0"
              />
              <span className="fd-separator">-</span>
              <input
                type="number"
                placeholder={t('marketplace.maxPrice')}
                value={selectedMaxPrice}
                onChange={(e) => onMaxPriceChange(e.target.value)}
                className="fd-input fd-input-max"
                min="0"
              />
            </div>
          </div>

          {/* Sort Filter */}
          <div className="fd-filter-group">
            <label className="fd-label">{t('marketplace.sortBy')}</label>
            <div className="fd-select-wrapper">
              <select
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value)}
                className="fd-select"
              >
                {Object.entries(sortOptions).map(([key, labelKey]) => (
                  <option key={key} value={key}>
                    {t(labelKey)}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="fd-select-icon" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="fd-footer">
          <button className="fd-btn-close" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </>
  );
}
