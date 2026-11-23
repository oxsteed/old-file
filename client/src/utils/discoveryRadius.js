// Group 4 Slice B (item 163): seed the /jobs radius filter from the
// helper's saved distance preference.
//
// The preference (opportunity_radius_miles, 1-250, stored on
// helper_profiles) was already honored by the dashboard nearby feed but
// the main /jobs feed always started at its built-in 25 miles. A radius
// the helper already chose in this session (restored navigation state)
// wins over the saved preference; the preference wins over the built-in
// default; anything invalid falls back to the default.
export function isValidRadiusMiles(value) {
  return Number.isInteger(value) && value >= 1 && value <= 250;
}

export function resolveSeededRadius({ savedRadius = null, preference = null, fallback = 25 } = {}) {
  if (isValidRadiusMiles(savedRadius)) return savedRadius;
  if (isValidRadiusMiles(preference)) return preference;
  return fallback;
}
