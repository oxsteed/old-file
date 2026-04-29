import { Search, TrendingUp } from 'lucide-react';
import '../styles/SearchSuggestions.css';

export default function SearchSuggestions({ suggestions, onSelect }) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="ss-dropdown">
      <div className="ss-header">
        <TrendingUp size={14} />
        <span>Popular searches</span>
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
