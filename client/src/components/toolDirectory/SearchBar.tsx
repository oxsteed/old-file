import React, { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SuggestDropdown } from '../SuggestDropdown';

export interface ToolSuggestTile {
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
  /** Tool tiles shown as prefix-matched typeahead suggestions */
  tiles?: ToolSuggestTile[];
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
  const resolvedPlaceholder = placeholder ?? t('toolRentalsDir.heroSearchPlaceholder');

  // Typeahead items for the shared SuggestDropdown: tool tiles first, then
  // categories. The dropdown ranks title-prefix matches first and shows
  // localStorage recent searches when the input is focused and empty.
  const suggestItems = useMemo(() => {
    const items: { id: string; title: string; icon?: React.ReactNode }[] = [];
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
    return items;
  }, [tiles, categories]);

  return (
    <div className="relative flex items-center">
      <Search
        className="absolute start-3.5 w-4 h-4 text-gray-500 pointer-events-none z-10"
        aria-hidden="true"
      />
      <div className="w-full">
        <SuggestDropdown
          id="tools-search"
          className="sd-theme-dark"
          items={suggestItems}
          value={value}
          onQueryChange={onChange}
          onSelect={(item) => onChange(item.title)}
          recentsKey="oxsteed_tool_recent_searches"
          placeholder={resolvedPlaceholder}
          ariaLabel={t('toolRentalsDir.searchAria')}
        />
      </div>
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute end-3 p-1 rounded-full text-gray-500 hover:text-white transition-colors"
          aria-label={t('toolRentalsDir.clearSearch')}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
