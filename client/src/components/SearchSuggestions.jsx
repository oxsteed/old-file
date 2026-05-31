import { Search, TrendingUp } from 'lucide-react';
import '../styles/SearchSuggestions.css';
import { useTranslation } from 'react-i18next';

export default function SearchSuggestions({ suggestions, onSelect }) {
  const { t } = useTranslation('common');
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="ss-dropdown">
      <div className="ss-header">
        <TrendingUp size={14} />
        <span>{t('searchSuggestions.popularSearches')}</span>
      </div>

      <ul className="ss-list">
        {suggestions.map((suggestion, idx) => (
          <li key={idx}>
            <button
              className="ss-item"
              onClick={() => onSelect(suggestion)}
              type="button"
            >
              <Search size={14} />
              <span>{suggestion}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
