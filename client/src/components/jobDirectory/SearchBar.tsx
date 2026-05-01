import React, { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({ value, onChange, placeholder }) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedPlaceholder = placeholder ?? t('jobsDir.heroSearchPlaceholder');

  return (
    <div className="relative flex items-center">
      <Search
        className="absolute left-3.5 w-4 h-4 text-gray-500 pointer-events-none"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
        aria-label={t('jobsDir.searchAria')}
        className="w-full bg-gray-800 border border-gray-700 rounded-2xl pl-10 pr-10 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
      />
      {value && (
        <button
          onClick={() => { onChange(''); inputRef.current?.focus(); }}
          className="absolute right-3 p-1 rounded-full text-gray-500 hover:text-white transition-colors"
          aria-label={t('jobsDir.clearSearch')}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
