import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SuggestDropdown } from '../SuggestDropdown';
import api from '../../api/axios';

export interface SkillSuggestTile {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface CategorySuggestItem {
  key: string;
  label: string;
}

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Skill tiles shown as prefix-matched typeahead suggestions */
  tiles?: SkillSuggestTile[];
  /** Categories shown as prefix-matched typeahead suggestions */
  categories?: CategorySuggestItem[];
}

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder,
  tiles,
  categories,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('helpersDir.heroSearchPlaceholder');

  // Typeahead items for the shared SuggestDropdown: skill tiles first, then
  // categories. The dropdown ranks title-prefix matches first and shows
  // localStorage recent searches when the input is focused and empty.
  // Review P1-223: live skill suggestions from the server typeahead, merged
  // after the local tiles/categories.
  const [remoteSkills, setRemoteSkills] = useState<{ name: string; category?: string }[]>([]);
  useEffect(() => {
    const term = (value || '').trim();
    if (term.length < 2) { setRemoteSkills([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get('/helpers/skills', { params: { q: term, limit: 8 } })
        .then(({ data }) => { if (!cancelled) setRemoteSkills(Array.isArray(data?.skills) ? data.skills : []); })
        .catch(() => { if (!cancelled) setRemoteSkills([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value]);

  const suggestItems = useMemo(() => {
    const items: { id: string; title: string; meta?: string; icon?: React.ReactNode }[] = [];
    for (const tile of tiles || []) {
      items.push({
        id: `tile:${tile.id}`,
        title: tile.label,
        icon: tile.icon ? <span aria-hidden="true">{tile.icon}</span> : undefined,
      });
    }
    for (const cat of categories || []) {
      items.push({ id: `category:${cat.key}`, title: cat.label });
    }
    const seen = new Set(items.map((i) => i.title.toLowerCase()));
    for (const skill of remoteSkills) {
      const name = String(skill?.name || '');
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      items.push({
        id: `skill:${name}`,
        title: name,
        // Review P1-7-F02: surface the skill category so same-named skills
        // across categories stay distinguishable in the typeahead.
        meta: skill?.category ? String(skill.category) : undefined,
      });
    }
    return items;
  }, [tiles, categories, remoteSkills]);

  return (
    <div className="relative flex items-center">
      <Search
        className="absolute start-3.5 w-4 h-4 text-gray-500 pointer-events-none z-10"
        aria-hidden="true"
      />
      <div className="w-full">
        <SuggestDropdown
          id="helpers-search"
          className="sd-theme-dark"
          items={suggestItems}
          value={value}
          onQueryChange={onChange}
          onSelect={(item) => onChange(item.title)}
          recentsKey="oxsteed_helper_recent_searches"
          placeholder={resolvedPlaceholder}
          ariaLabel={t('helpersDir.searchAria')}
          // Review P1-7-F02: room for the live server suggestions alongside
          // the local tiles/categories (the dropdown default is 6).
          maxResults={8}
        />
      </div>
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute end-3 p-1 rounded-full text-gray-500 hover:text-white transition-colors"
          aria-label={t('helpersDir.clearSearch')}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
