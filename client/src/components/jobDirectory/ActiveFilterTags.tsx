import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JobFilters } from '../../types/jobDirectory';
import { translateJobCategory, translateJobSkill } from '../../utils/jobsTaxonomy';

interface TagItem {
  key: string;
  label: string;
  onRemove: () => void;
}

interface ActiveFilterTagsProps {
  filters: JobFilters;
  onChange: (updated: Partial<JobFilters>) => void;
}

const Tag: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-brand-900/40 text-brand-300 border border-brand-800/60 rounded-full text-xs font-medium">
      {label}
      <button
        onClick={onRemove}
        className="w-4 h-4 rounded-full bg-brand-800/60 hover:bg-brand-700 flex items-center justify-center transition-colors flex-shrink-0"
        aria-label={t('jobsDir.removeFilter', { label })}
      >
        <X className="w-2.5 h-2.5" aria-hidden="true" />
      </button>
    </span>
  );
};

const ActiveFilterTags: React.FC<ActiveFilterTagsProps> = ({ filters, onChange }) => {
  const { t } = useTranslation();
  const tags: TagItem[] = [];

  if (filters.urgentOnly) {
    tags.push({
      key: 'urgent',
      label: t('jobsDir.urgentOnly'),
      onRemove: () => onChange({ urgentOnly: false }),
    });
  }
  if (filters.noBidsYet) {
    tags.push({
      key: 'noBids',
      label: t('jobsDir.noBidsYet'),
      onRemove: () => onChange({ noBidsYet: false }),
    });
  }
  if (filters.hasBids) {
    tags.push({
      key: 'hasBids',
      label: t('jobsDir.hasBids'),
      onRemove: () => onChange({ hasBids: false }),
    });
  }
  if (filters.category) {
    tags.push({
      key: `cat-${filters.category}`,
      label: translateJobCategory(t, filters.category),
      onRemove: () => onChange({ category: '' }),
    });
  }
  filters.skills.forEach((sk) =>
    tags.push({
      key: `sk-${sk}`,
      label: translateJobSkill(t, sk),
      onRemove: () => onChange({ skills: filters.skills.filter((s) => s !== sk) }),
    }),
  );
  if (filters.city) {
    tags.push({
      key: 'city',
      label: filters.city,
      onRemove: () => onChange({ city: '' }),
    });
  }
  if (filters.state) {
    tags.push({
      key: 'state',
      label: filters.state,
      onRemove: () => onChange({ state: '' }),
    });
  }
  if (filters.budgetRange) {
    const [min, max] = filters.budgetRange;
    const label = max >= 999999
      ? t('jobsDir.budgetRangeOpenTag', { min })
      : t('jobsDir.budgetRangeTag', { min, max });
    tags.push({
      key: 'budget',
      label,
      onRemove: () => onChange({ budgetRange: null }),
    });
  }
  if (filters.postedWithin && filters.postedWithin !== 'any') {
    tags.push({
      key: `posted-${filters.postedWithin}`,
      label: t(`jobsDir.posted.${filters.postedWithin}`),
      onRemove: () => onChange({ postedWithin: 'any' }),
    });
  }

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label={t('jobsDir.activeFiltersAria')}>
      {tags.map((tag) => (
        <div key={tag.key} role="listitem">
          <Tag label={tag.label} onRemove={tag.onRemove} />
        </div>
      ))}
    </div>
  );
};

export default ActiveFilterTags;
