import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolDirectoryFilters, ToolCondition } from '../../types/toolDirectory';
import {
  translateToolDirectoryCategory,
  translateToolDirectorySubType,
} from '../../utils/toolRentalsTaxonomy';

interface TagItem {
  key: string;
  label: string;
  onRemove: () => void;
}

interface ActiveFilterTagsProps {
  filters: ToolDirectoryFilters;
  onChange: (updated: Partial<ToolDirectoryFilters>) => void;
}

const Tag: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 ps-3 pe-1.5 py-1 bg-brand-900/40 text-brand-300 border border-brand-800/60 rounded-full text-xs font-medium">
      {label}
      <button
        onClick={onRemove}
        className="w-4 h-4 rounded-full bg-brand-800/60 hover:bg-brand-700 flex items-center justify-center transition-colors flex-shrink-0"
        aria-label={t('toolRentalsDir.removeFilter', { label })}
      >
        <X className="w-2.5 h-2.5" aria-hidden="true" />
      </button>
    </span>
  );
};

const ActiveFilterTags: React.FC<ActiveFilterTagsProps> = ({ filters, onChange }) => {
  const { t } = useTranslation();
  const tags: TagItem[] = [];

  if (filters.availableNow)
    tags.push({ key: 'availableNow', label: t('toolRentalsDir.availableNow'), onRemove: () => onChange({ availableNow: false }) });

  if (filters.deliveryAvailable)
    tags.push({ key: 'delivery', label: t('toolRentalsDir.deliveryAvailable'), onRemove: () => onChange({ deliveryAvailable: false }) });

  if (filters.requiresDeposit !== null) {
    const label = filters.requiresDeposit
      ? t('toolRentalsDir.depositRequired')
      : t('toolRentalsDir.noDeposit');
    tags.push({ key: 'deposit', label, onRemove: () => onChange({ requiresDeposit: null }) });
  }

  if (filters.city)
    tags.push({ key: 'city', label: t('toolRentalsDir.cityTag', { city: filters.city }), onRemove: () => onChange({ city: '' }) });

  if (filters.radius !== null)
    tags.push({ key: 'radius', label: t('toolRentalsDir.radiusMi', { miles: filters.radius }), onRemove: () => onChange({ radius: null }) });

  if (filters.priceRange) {
    const [min, max] = filters.priceRange;
    const label = max >= 9999
      ? t('toolRentalsDir.priceRangeOpenTag', { min })
      : t('toolRentalsDir.priceRangeTag', { min, max });
    tags.push({ key: 'price', label, onRemove: () => onChange({ priceRange: null }) });
  }

  filters.categories.forEach((cat) =>
    tags.push({
      key: `cat-${cat}`,
      label: translateToolDirectoryCategory(t, cat),
      onRemove: () => onChange({ categories: filters.categories.filter((c) => c !== cat) }),
    }),
  );

  filters.subTypes.forEach((st) =>
    tags.push({
      key: `st-${st}`,
      label: translateToolDirectorySubType(t, st),
      onRemove: () => onChange({ subTypes: filters.subTypes.filter((s) => s !== st) }),
    }),
  );

  filters.conditions.forEach((cond) =>
    tags.push({
      key: `cond-${cond}`,
      label: t(`toolRentalsDir.condition.${cond}`),
      onRemove: () => onChange({ conditions: filters.conditions.filter((c) => c !== cond) }),
    }),
  );

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label={t('toolRentalsDir.activeFiltersAria')}>
      {tags.map((tag) => (
        <div key={tag.key} role="listitem">
          <Tag label={tag.label} onRemove={tag.onRemove} />
        </div>
      ))}
    </div>
  );
};

export default ActiveFilterTags;
