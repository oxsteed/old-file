import { ALL_COUNTRIES, COUNTRY_CODES_SORTED } from '../lib/countries';
import { useTranslation } from 'react-i18next';

/**
 * Country dropdown driven by the shared `lib/countries.js` data.
 *
 * Props:
 *   value         – ISO-2 country code (e.g. 'US')
 *   onChange      – (code) => void
 *   id            – DOM id (optional, useful for label htmlFor)
 *   className     – extra classes for the <select>
 *   placeholder   – text for the empty option (default: 'Select a country')
 *   includeBlank  – render the empty option (default true)
 *   disabled      – disable the input
 */
export default function CountrySelect({
  value,
  onChange,
  id,
  className = '',
  placeholder = null,
  includeBlank = true,
  disabled = false,
  required = false,
  name = 'country',
  ...rest
}) {
  const { t } = useTranslation('common');
  const resolvedPlaceholder = placeholder ?? t('forms.country.placeholder');

  return (
    <select
      id={id}
      name={name}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      required={required}
      className={className}
      {...rest}
    >
      {includeBlank && <option value="">{resolvedPlaceholder}</option>}
      {COUNTRY_CODES_SORTED.map(code => (
        <option key={code} value={code}>{ALL_COUNTRIES[code]}</option>
      ))}
    </select>
  );
}
