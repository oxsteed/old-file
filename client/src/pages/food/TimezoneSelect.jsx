import React from 'react';

// F-01: a restaurant's timezone drives opening hours, daily queue numbers,
// and reporting. The browser-detected IANA zone is the default everywhere a
// timezone is chosen; owners can confirm or change it.
export const DETECTED_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

const TIMEZONE_OPTIONS = (() => {
  try {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return zones.includes(DETECTED_TIMEZONE) ? zones : [DETECTED_TIMEZONE, ...zones];
  } catch {
    return [DETECTED_TIMEZONE];
  }
})();

export default function TimezoneSelect({ id, value, onChange, disabled }) {
  const current = value || DETECTED_TIMEZONE;
  const options = TIMEZONE_OPTIONS.includes(current) ? TIMEZONE_OPTIONS : [current, ...TIMEZONE_OPTIONS];
  if (!options.length) {
    return <input id={id} value={current} onChange={(event) => onChange(event.target.value)} disabled={disabled} />;
  }
  return (
    <select id={id} value={current} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      {options.map((zone) => (
        <option key={zone} value={zone}>{zone}</option>
      ))}
    </select>
  );
}
