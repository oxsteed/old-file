import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Clock } from 'lucide-react';
import './SuggestDropdown.css';

const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_QUERY = 2;
const MAX_RECENTS = 5;

function normalize(str) {
  return (str ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function readRecents(key) {
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => id != null) : [];
  } catch {
    return [];
  }
}

/**
 * SuggestDropdown: reusable typeahead combobox.
 *
 * Props:
 *   items          – array of { id, title, meta, icon? } (icon is a renderable
 *                    element or component; falls back to a search glyph)
 *   onSelect       – (item) => void, called when an option is picked
 *   recentsKey     – localStorage key for recent selections (optional);
 *                    recents show when the query is empty and the list is open
 *   placeholder    – input placeholder text
 *   ariaLabel      – accessible label for the input
 *   id             – base id for the listbox (defaults to 'sd')
 *   maxResults     – max suggestions shown (default 6)
 *   minQueryLength – chars needed before matching starts (default 2)
 *   className      – extra classes for the wrapper
 *   inputClassName – extra classes for the input
 *   value          – controlled query (optional); when provided the parent owns
 *                    the input text and receives every keystroke via onQueryChange
 *   onQueryChange  – (query) => void, called on every input change (optional)
 */
export function SuggestDropdown({
  items = [],
  onSelect,
  onQueryChange,
  value,
  recentsKey,
  placeholder = '',
  ariaLabel,
  id = 'sd',
  maxResults = DEFAULT_MAX_RESULTS,
  minQueryLength = DEFAULT_MIN_QUERY,
  className = '',
  inputClassName = '',
}) {
  const { t } = useTranslation();
  const [internalQuery, setInternalQuery] = useState('');
  // Controlled mode: when `value` is provided the parent owns the input text.
  const controlled = value !== undefined;
  const query = controlled ? value : internalQuery;
  const setQuery = (q) => {
    if (!controlled) setInternalQuery(q);
    if (onQueryChange) onQueryChange(q);
  };
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentIds, setRecentIds] = useState(() => readRecents(recentsKey));
  const wrapRef = useRef(null);
  const listId = `${id}-suggest-list`;

  // Prefix-ranked matching: title prefix first, then title substring, then meta.
  const suggestions = useMemo(() => {
    const q = normalize(query).trim();
    if (q.length < minQueryLength) return [];
    const scored = [];
    for (const item of items) {
      const title = normalize(item.title);
      let score = -1;
      if (title.startsWith(q)) score = 0;
      else if (title.includes(q)) score = 1;
      else if (normalize(item.meta).includes(q)) score = 2;
      if (score >= 0) scored.push({ item, score });
    }
    return scored
      .sort(
        (a, b) =>
          a.score - b.score ||
          String(a.item.title).localeCompare(String(b.item.title))
      )
      .slice(0, maxResults)
      .map((s) => s.item);
  }, [query, items, maxResults, minQueryLength]);

  const recentItems = useMemo(() => {
    if (!recentsKey) return [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const resolved = [];
    for (const rid of recentIds) {
      const item = byId.get(rid);
      if (item) resolved.push(item);
      if (resolved.length >= MAX_RECENTS) break;
    }
    return resolved;
  }, [items, recentIds, recentsKey]);

  const typedEnough = normalize(query).trim().length >= minQueryLength;
  const visible = open && (typedEnough ? suggestions.length > 0 : recentItems.length > 0);
  const options = typedEnough ? suggestions : recentItems;

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, items]);

  const recordRecent = (item) => {
    if (!recentsKey) return;
    const next = [item.id, ...recentIds.filter((rid) => rid !== item.id)].slice(
      0,
      MAX_RECENTS
    );
    setRecentIds(next);
    try {
      localStorage.setItem(recentsKey, JSON.stringify(next));
    } catch {
      /* storage full or blocked; recents just stay in memory */
    }
  };

  const selectItem = (item) => {
    if (!item) return;
    recordRecent(item);
    setQuery(item.title ?? '');
    setOpen(false);
    setActiveIndex(-1);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (onSelect) onSelect(item);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!visible) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((prev) => {
        if (prev < 0) return delta > 0 ? 0 : options.length - 1;
        return (prev + delta + options.length) % options.length;
      });
    } else if (e.key === 'Enter') {
      if (visible && activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        selectItem(options[activeIndex]);
      } else if (visible && typedEnough && options.length > 0) {
        e.preventDefault();
        selectItem(options[0]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleBlur = (e) => {
    if (wrapRef.current && e.relatedTarget && wrapRef.current.contains(e.relatedTarget)) {
      return;
    }
    setOpen(false);
    setActiveIndex(-1);
  };

  const renderIcon = (item, isRecent) => {
    if (isRecent) return <Clock size={14} aria-hidden="true" />;
    const { icon } = item;
    if (icon) return icon;
    return <Search size={14} className="sd-item-glyph" aria-hidden="true" />;
  };

  return (
    <div ref={wrapRef} className={`sd-wrap ${className}`.trim()}>
      <input
        type="search"
        className={`sd-input ${inputClassName}`.trim()}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={
          activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
        }
      />
      {visible && (
        <div className="sd-popover">
          {!typedEnough && (
            <div className="sd-group-label">{t('suggestDropdown.recents')}</div>
          )}
          <ul className="sd-list" id={listId} role="listbox" aria-label={ariaLabel ?? placeholder}>
            {options.map((item, i) => (
              <li
                key={item.id}
                id={`${listId}-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={`sd-item${i === activeIndex ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => selectItem(item)}
                >
                  <span className="sd-item-icon" aria-hidden="true">
                    {renderIcon(item, !typedEnough)}
                  </span>
                  <span className="sd-item-text">
                    <strong>{item.title}</strong>
                    {item.meta && <span className="sd-item-meta">{item.meta}</span>}
                  </span>
                  {!typedEnough ? null : (
                    <Search size={14} className="sd-item-glyph" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
