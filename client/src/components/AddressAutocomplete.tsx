import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { suggestLocation } from '../api/geo';
import './AddressAutocomplete.css';

export interface AddressSuggestion {
  display: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  lat?: number | null;
  lng?: number | null;
  provider?: string;
  placeId?: string | null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (place: AddressSuggestion) => void;
  onBlur?: () => void;
  id?: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  autoComplete?: string;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  wrapperClassName?: string;
  leading?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  maxLength?: number;
  minChars?: number;
  querySuffix?: string;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onBlur,
  id,
  name,
  placeholder,
  ariaLabel,
  autoComplete = 'street-address',
  inputClassName = '',
  inputStyle,
  wrapperClassName = '',
  leading,
  disabled = false,
  required = false,
  maxLength,
  minChars = 2,
  querySuffix = '',
}: Props) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t('common.addressPlaceholder', { defaultValue: 'Start typing an address' });
  const generatedId = useId();
  const listId = `${id || generatedId}-address-suggestions`;
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const closeTimer = useRef<number | null>(null);
  const skipNextQuery = useRef(false);

  useEffect(() => {
    const query = [value.trim(), querySuffix.trim()].filter(Boolean).join(', ');
    if (skipNextQuery.current) {
      skipNextQuery.current = false;
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }
    if (query.length < minChars || disabled) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return undefined;
    }

    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const results = await suggestLocation(query);
        if (currentRequest !== requestId.current) return;
        setSuggestions(results.filter((place) => place?.display));
        setActiveIndex(-1);
        setOpen(results.length > 0);
      } catch {
        if (currentRequest === requestId.current) {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [disabled, minChars, querySuffix, value]);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const selectSuggestion = (place: AddressSuggestion) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    skipNextQuery.current = true;
    onChange(place.addressLine1 || place.city || place.display);
    onSelect?.(place);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleBlur = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
    onBlur?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (event.key === 'Escape') setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`address-autocomplete ${wrapperClassName}`}>
      {leading && <span className="address-autocomplete__leading" aria-hidden="true">{leading}</span>}
      <input
        id={id}
        name={name}
        value={value}
        onChange={(event) => {
          skipNextQuery.current = false;
          onChange(event.target.value);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={resolvedPlaceholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        maxLength={maxLength}
        style={inputStyle}
        className={`address-autocomplete__input ${inputClassName}`}
      />
      {open && suggestions.length > 0 && (
        <ul id={listId} className="address-autocomplete__menu" role="listbox">
          {suggestions.map((place, index) => (
            <li key={`${place.placeId || place.display}-${index}`} role="option" aria-selected={index === activeIndex}>
              <button
                id={`${listId}-${index}`}
                type="button"
                className={`address-autocomplete__option${index === activeIndex ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(place)}
              >
                <span className="address-autocomplete__option-title">{place.display}</span>
                {(place.city || place.state || place.zip) && (
                  <span className="address-autocomplete__option-meta">
                    {[place.city, place.state, place.zip].filter(Boolean).join(', ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && <span className="address-autocomplete__loading" aria-live="polite">{t('common.searching', { defaultValue: 'Searching…' })}</span>}
    </div>
  );
}
