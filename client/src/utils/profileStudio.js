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

/** Sections that use the sticky Save / Discard bar (core form). */
export const HELPER_STICKY_SECTIONS = new Set(['basics', 'hours']);

/**
 * Sections that persist immediately via per-item CRUD / upload / toggle.
 * Sticky bar stays visible as status-only ("Saved automatically"), not a fake Save.
 */
export const HELPER_AUTO_SAVE_SECTIONS = new Set([
  'cover',
  'services',
  'faqs',
  'policies',
  'gallery',
  'visibility',
]);

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

/** Stable serialization for Helper core dirty detection. */
export function serializeHelperCore(core) {
  return JSON.stringify({
    profile_headline: core?.profile_headline || '',
    bio_long: core?.bio_long || '',
    hourly_rate_min: core?.hourly_rate_min === '' || core?.hourly_rate_min == null ? '' : String(core.hourly_rate_min),
    hourly_rate_max: core?.hourly_rate_max === '' || core?.hourly_rate_max == null ? '' : String(core.hourly_rate_max),
    service_radius_miles: core?.service_radius_miles == null ? '' : String(core.service_radius_miles),
    service_city: core?.service_city || '',
    service_state: core?.service_state || '',
    availability_json: core?.availability_json || {},
    is_available_now: !!core?.is_available_now,
  });
}

export function isHelperCoreDirty(core, baselineSerialized) {
  return serializeHelperCore(core) !== String(baselineSerialized || '');
}

/**
 * Aggregate save-status model for Helper Edit Profile.
 * Incremental toward a future whole-profile draft/publish flow — no backend draft API yet.
 *
 * TODO(profile-studio-draft): When whole-profile draft + publish endpoints land
 * (see docs/superpowers/specs/2026-09-21-profile-studio-design.md), wire dirty /
 * lastSavedAt / publish readiness through this model instead of inventing a
 * parallel client draft store. resolveHelperSaveBar remains the sticky-bar seam.
 */
export function createHelperSaveStatus(overrides = {}) {
  const dirtyIn = overrides.dirty && typeof overrides.dirty === 'object' ? overrides.dirty : {};
  return {
    /** Per sticky area; today core covers basics+hours together. */
    dirty: {
      core: false,
      ...dirtyIn,
    },
    saving: false,
    error: null,
    /** Epoch ms of last successful persist (core or auto CRUD). */
    lastSavedAt: null,
    ...overrides,
    dirty: {
      core: false,
      ...dirtyIn,
    },
  };
}

/**
 * Resolve sticky-bar presentation for the active Helper section.
 * - basics/hours: real dirty + Save/Discard
 * - cover/CRUD/visibility: status-only ("Saved automatically"), never a fake Save
 *
 * @returns {{
 *   mode: 'dirty'|'clean'|'saving'|'error'|'auto',
 *   dirty: boolean,
 *   showActions: boolean,
 *   hideBar: boolean,
 *   statusKey: string,
 *   showShortcutHint: boolean,
 *   lastSavedAt: number|null,
 *   error: string|null,
 * }}
 */
export function resolveHelperSaveBar({
  section,
  coreDirty = false,
  saving = false,
  error = null,
  lastSavedAt = null,
  stickySections = HELPER_STICKY_SECTIONS,
} = {}) {
  const isSticky = stickySections.has(section);

  if (saving && isSticky) {
    return {
      mode: 'saving',
      dirty: !!coreDirty,
      showActions: true,
      hideBar: false,
      statusKey: 'profileStudio.savingStatus',
      showShortcutHint: true,
      lastSavedAt,
      error: null,
    };
  }

  if (error && isSticky) {
    return {
      mode: 'error',
      dirty: true,
      showActions: true,
      hideBar: false,
      statusKey: 'profileStudio.saveError',
      showShortcutHint: true,
      lastSavedAt,
      error: String(error),
    };
  }

  if (isSticky) {
    const dirty = !!coreDirty;
    return {
      mode: dirty ? 'dirty' : 'clean',
      dirty,
      showActions: true,
      hideBar: false,
      statusKey: dirty ? 'profileStudio.unsaved' : 'profileStudio.savedHint',
      showShortcutHint: true,
      lastSavedAt,
      error: null,
    };
  }

  return {
    mode: 'auto',
    dirty: false,
    showActions: false,
    hideBar: false,
    statusKey: 'profileStudio.savedAutomatically',
    showShortcutHint: false,
    lastSavedAt,
    error: null,
  };
}

/**
 * Normalize fields into the shared PublicProfileSummaryCard view-model.
 * Used by Studio preview and public pages so both surfaces stay aligned.
 */
export function buildPublicProfileSummaryModel({
  variant = 'helper',
  cover = null,
  avatar = null,
  name = '',
  tagline = '',
  typeLabel = '',
  meta = '',
  contact = '',
  about = '',
  availableNow = null,
  ratingLabel = '',
} = {}) {
  return {
    variant: variant === 'business' ? 'business' : 'helper',
    cover: cover || null,
    avatar: avatar || null,
    name: name == null ? '' : String(name),
    tagline: tagline == null ? '' : String(tagline),
    typeLabel: typeLabel == null ? '' : String(typeLabel),
    meta: meta == null ? '' : String(meta),
    contact: contact == null ? '' : String(contact),
    about: about == null ? '' : String(about),
    availableNow: availableNow == null ? null : !!availableNow,
    ratingLabel: ratingLabel == null ? '' : String(ratingLabel),
  };
}

/** Studio/helper form → shared summary model. */
export function buildHelperStudioSummaryModel({
  coverImageUrl = null,
  avatar = null,
  name = '',
  core = {},
  meta = '',
} = {}) {
  return buildPublicProfileSummaryModel({
    variant: 'helper',
    cover: coverImageUrl,
    avatar,
    name,
    tagline: core.profile_headline || '',
    meta,
    about: core.bio_long || '',
    availableNow: !!core.is_available_now,
  });
}

/** Studio/business form → shared summary model. */
export function buildBusinessStudioSummaryModel({
  cover = null,
  avatar = null,
  name = '',
  tagline = '',
  typeLabel = '',
  meta = '',
  contact = '',
  about = '',
} = {}) {
  return buildPublicProfileSummaryModel({
    variant: 'business',
    cover,
    avatar,
    name,
    tagline,
    typeLabel,
    meta,
    contact,
    about,
  });
}

/** Keys always present on buildPublicProfileSummaryModel output. */
export const PUBLIC_PROFILE_SUMMARY_MODEL_KEYS = [
  'variant',
  'cover',
  'avatar',
  'name',
  'tagline',
  'typeLabel',
  'meta',
  'contact',
  'about',
  'availableNow',
  'ratingLabel',
];

/**
 * Class contract for PublicProfileSummaryCard root element.
 * Keep in sync with the JSX component — tests assert this string.
 */
export function publicProfileSummaryCardClassName({
  variant = 'helper',
  surface = 'public',
  className = '',
} = {}) {
  return [
    'ppsc',
    `ppsc-${variant === 'business' ? 'business' : 'helper'}`,
    surface === 'studio' ? 'ppsc--studio' : 'ppsc--public',
    className,
  ].filter(Boolean).join(' ');
}

/**
 * Map BusinessHeader / full guarded profile page helper props → summary card model.
 * Localized strings (ratingLabel, placeFallback, metaExtra) should be built by the caller.
 */
export function buildFullProfileHeaderSummaryModel({
  variant = 'helper',
  coverImage = null,
  avatar = null,
  businessName = '',
  ownerName = '',
  tagline = '',
  city = '',
  state = '',
  placeFallback = '',
  ratingLabel = '',
  metaExtra = '',
  typeLabel = '',
  contact = '',
  about = '',
  availableNow = null,
} = {}) {
  const place = [city, state].filter(Boolean).join(', ') || placeFallback || '';
  const meta = [place, metaExtra].filter(Boolean).join(' · ');
  return buildPublicProfileSummaryModel({
    variant: variant === 'business' ? 'business' : 'helper',
    cover: coverImage,
    avatar,
    name: businessName || ownerName || '',
    tagline,
    typeLabel,
    meta,
    contact,
    about,
    availableNow,
    ratingLabel,
  });
}

