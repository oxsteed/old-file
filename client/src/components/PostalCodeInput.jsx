import {
  hasPostalCode,
  getPostalLabel,
  getPostalExample,
  isValidPostal,
} from '../lib/countries';

/**
 * Country-aware postal code input.
 *
 * - Renders a free-text input.
 * - When the country has no postal-code convention (e.g. HK, HT) the input
 *   shows a permissive label and skips validation.
 * - The `country` prop is consumed only for label/placeholder; validation is
 *   exposed via the static `PostalCodeInput.isValid(country, value)` helper
 *   and the `onValidityChange` callback.
 *
 * Props:
 *   country            – ISO-2 country code
 *   value              – current postal code value
 *   onChange           – (value) => void
 *   id, name           – DOM identifiers
 *   className          – extra classes
 *   required           – HTML required flag
 *   showLabel          – render an inline <label> above the input (default false)
 *   onValidityChange   – (boolean) => void, fires when the validity flips
 */
export default function PostalCodeInput({
  country,
  value,
  onChange,
  id,
  name = 'postal_code',
  className = '',
  required = false,
  showLabel = false,
  onValidityChange = undefined,
  ...rest
}) {
  const label    = getPostalLabel(country);
  const example  = getPostalExample(country);
  const valid    = isValidPostal(country, value);

  const handle = (e) => {
    const v = e.target.value;
    onChange(v);
    if (onValidityChange) onValidityChange(isValidPostal(country, v));
  };

  // Hide entirely when the country is unknown - caller should not render us
  // until a country is selected, but we degrade gracefully if they do.
  if (!country) {
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

  return (
    <>
      {showLabel && (
        <label htmlFor={id} className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
          {label}
        </label>
      )}
      <input
        id={id}
        name={name}
        type="text"
        value={value || ''}
        onChange={handle}
        placeholder={example || label}
        required={required && hasPostalCode(country)}
        className={className}
        autoComplete="postal-code"
        aria-invalid={!valid}
        {...rest}
      />
    </>
  );
}

PostalCodeInput.isValid = isValidPostal;
