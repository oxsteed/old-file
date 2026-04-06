import React from 'react';
import { X } from 'lucide-react';
import type { DirectoryFilters } from '../../types/helperDirectory';

interface TagItem {
  key: string;
  label: string;
  onRemove: () => void;
}

interface ActiveFilterTagsProps {
  filters: DirectoryFilters;
  onChange: (updated: Partial<DirectoryFilters>) => void;
}

const Tag: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-brand-900/40 text-brand-300 border border-brand-800/60 rounded-full text-xs font-medium">
    {label}
    <button
      onClick={onRemove}
      className="w-4 h-4 rounded-full bg-brand-800/60 hover:bg-brand-700 flex items-center justify-center transition-colors flex-shrink-0"
      aria-label={`Remove filter: ${label}`}
    >
      <X className="w-2.5 h-2.5" aria-hidden="true" />
    </button>
  </span>
);

const ActiveFilterTags: React.FC<ActiveFilterTagsProps> = ({ filters, onChange }) => {
  const tags: TagItem[] = [];

  if (filters.availableToday)
    tags.push({ key: 'availableToday', label: 'Available today', onRemove: () => onChange({ availableToday: false }) });

  if (filters.backgroundChecked)
    tags.push({ key: 'bgCheck', label: 'Background checked', onRemove: () => onChange({ backgroundChecked: false }) });

  if (filters.verified)
    tags.push({ key: 'verified', label: 'OxSteed verified', onRemove: () => onChange({ verified: false }) });

  if (filters.minRating > 0)
    tags.push({ key: 'rating', label: `${filters.minRating}+ stars`, onRemove: () => onChange({ minRating: 0 }) });

  if (filters.maxDistance > 0)
    tags.push({ key: 'distance', label: `Within ${filters.maxDistance} mi`, onRemove: () => onChange({ maxDistance: 0 }) });

  if (filters.priceRange)
    tags.push({
      key: 'price',
      label: `$${filters.priceRange[0]}–${filters.priceRange[1] >= 9999 ? '' : `$${filters.priceRange[1]}`}/hr`,
      onRemove: () => onChange({ priceRange: null }),
    });

  filters.categories.forEach((cat) =>
    tags.push({ key: `cat-${cat}`, label: cat, onRemove: () => onChange({ categories: filters.categories.filter((c) => c !== cat) }) })
  );

  filters.skills.forEach((sk) =>
    tags.push({ key: `sk-${sk}`, label: sk, onRemove: () => onChange({ skills: filters.skills.filter((s) => s !== sk) }) })
  );

  filters.licenses.forEach((lic) =>
    tags.push({ key: `lic-${lic}`, label: lic, onRemove: () => onChange({ licenses: filters.licenses.filter((l) => l !== lic) }) })
  );

  filters.insurance.forEach((ins) =>
    tags.push({ key: `ins-${ins}`, label: ins, onRemove: () => onChange({ insurance: filters.insurance.filter((i) => i !== ins) }) })
  );

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Active filters">
      {tags.map((tag) => (
        <div key={tag.key} role="listitem">
          <Tag label={tag.label} onRemove={tag.onRemove} />
        </div>
      ))}
    </div>
  );
};

export default ActiveFilterTags;
