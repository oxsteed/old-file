import { hasRegions, getRegionsFor, getRegionLabel } from '../lib/countries';

/**
 * Country-aware region/state input.
 *
 * - When the country has a predefined region list (US, CA, AU, IN, GB, DE, FR)
 *   renders a <select>.
 * - Otherwise renders a free-text <input>, mirroring the consultation-intake
 *   pattern.
 * - When `country` is empty, the field is disabled.
 *
 * Props:
 *   country      – ISO-2 country code that determines the UI mode
 *   value        – current region/state/city value (string)
 *   onChange     – (value) => void
 *   className    – extra classes for the input/select
 *   id, name     – DOM identifiers
 *   placeholder  – override the auto-generated placeholder
 *   required     – HTML required flag
 *   disabled     – disable input regardless of country
 */
export default function RegionInput({
  country,
  value,
  onChange,
  id,
  name = 'state',
  className = '',
  placeholder,
  required = false,
  disabled = false,
  ...rest
}) {
  const isCountrySelected = !!country;
  const regions           = isCountrySelected ? getRegionsFor(country) : null;
  const label             = getRegionLabel(country);
  const handle            = (e) => onChange(e.target.value);

  // No country chosen yet
  if (!isCountrySelected) {
    return (
      <input
        id={id}
        name={name}
        type="text"
        value={value || ''}
        disabled
        placeholder="Select a country first"
        className={className}
        {...rest}
      />
    );
  }

  // Predefined regions → dropdown
  if (regions) {
    return (
      <select
        id={id}
        name={name}
        value={value || ''}
        onChange={handle}
        required={required}
        disabled={disabled}
        className={className}
        autoComplete="address-level1"
        {...rest}
      >
        <option value="">{placeholder || `Select ${label}`}</option>
        {regions.map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    );
  }

  // Free-text fallback (city or region name)
  return (
    <input
      id={id}
      name={name}
      type="text"
      value={value || ''}
      onChange={handle}
      placeholder={placeholder || `${label} (e.g. capital city)`}
      required={required}
      disabled={disabled}
      className={className}
      autoComplete="address-level1"
      {...rest}
    />
  );
}
