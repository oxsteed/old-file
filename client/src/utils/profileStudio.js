/** Pure helpers for Profile Studio (Helper + shared shell/preview). */

export const HELPER_SECTION_IDS = [
  'cover',
  'basics',
  'hours',
  'services',
  'faqs',
  'policies',
  'gallery',
  'visibility',
];

export const HELPER_STICKY_SECTIONS = new Set(['basics', 'hours']);

/**
 * Completeness flags for Helper Edit Profile nav / chips.
 * Mirrors the logic used to build ProfileStudioShell `sections[].complete`.
 */
export function buildHelperSectionCompleteness({
  coverImageUrl,
  core = {},
  servicesCount = 0,
  faqsCount = 0,
  policiesCount = 0,
  galleryCount = 0,
} = {}) {
  const availability = core.availability_json && typeof core.availability_json === 'object'
    ? core.availability_json
    : {};
  const hoursOpen = Object.values(availability).some((day) => day && !day.closed);

  return {
    cover: !!coverImageUrl,
    basics: !!(core.profile_headline && core.bio_long && core.hourly_rate_min),
    hours: hoursOpen,
    services: Number(servicesCount) > 0,
    faqs: Number(faqsCount) > 0,
    policies: Number(policiesCount) > 0,
    gallery: Number(galleryCount) > 0,
    visibility: true,
  };
}

/** Map completeness flags onto shell section descriptors (preserves labels). */
export function applySectionCompleteness(sections, flags) {
  const map = flags && typeof flags === 'object' ? flags : {};
  return (Array.isArray(sections) ? sections : []).map((s) => ({
    ...s,
    complete: Object.prototype.hasOwnProperty.call(map, s.id) ? !!map[s.id] : s.complete,
  }));
}

export function formatHelperPlace(core = {}) {
  const city = String(core.service_city || '').trim();
  const region = String(core.service_state || '').trim();
  return [city, region].filter(Boolean).join(', ');
}

/** Raw "$min – $max" bits for ratesMeta i18n interpolation. */
export function formatHelperRateBits(core = {}) {
  const bits = [];
  if (core.hourly_rate_min !== '' && core.hourly_rate_min != null) {
    bits.push(`$${core.hourly_rate_min}`);
  }
  if (core.hourly_rate_max !== '' && core.hourly_rate_max != null) {
    bits.push(`$${core.hourly_rate_max}`);
  }
  return bits;
}

/**
 * Build preview meta line: place · rates · radius.
 * `ratesLine` / `radiusLine` should already be localized (or plain fallbacks).
 */
export function formatHelperPreviewMeta({ place = '', ratesLine = '', radiusLine = '' } = {}) {
  return [place, ratesLine, radiusLine].filter(Boolean).join(' · ');
}

/** Empty-state placeholders for ProfilePreviewCard fields. */
export function resolvePreviewField(value, emptyFallback) {
  const v = value == null ? '' : String(value);
  return v || emptyFallback || '';
}

/**
 * Prompt when leaving Basics/Hours while core is dirty for a list/CRUD section.
 * Switching between basics ↔ hours does not prompt (shared core form).
 */
export function shouldPromptLeaveStickySection(fromSection, toSection, coreDirty, sticky = HELPER_STICKY_SECTIONS) {
  if (!coreDirty) return false;
  if (!sticky.has(fromSection)) return false;
  if (sticky.has(toSection)) return false;
  return fromSection !== toSection;
}
