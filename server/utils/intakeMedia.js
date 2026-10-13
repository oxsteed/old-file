'use strict';

/**
 * utils/intakeMedia.js
 *
 * Private intake photos for the operations surfaces (beauty, creative,
 * maintenance, trades). Intake photos are stored as `private://<key>`
 * references in the intake row's photo_urls and hydrated to short-lived
 * signed download URLs at read time.
 *
 * Review P3-6-F10: intake photos used to sit under PUBLIC_KEY_PREFIXES and
 * were world-readable by design. They are private now: only the requester,
 * the assigned helper, and business staff who can already read the intake
 * record get a signed URL, minted when the record is read. Rows written
 * before this change hold legacy public URLs; those are resolved back to
 * their storage key and signed the same way, so old rows keep rendering.
 */

const {
  getSignedDownloadUrl,
  knownObjectKeyFromUrl,
  normalizeStorageKey,
} = require('./storage');

const PRIVATE_REF_PREFIX = 'private://';
// Signed URL lifetime for hydrated intake photos. Short on purpose: the
// client re-reads the intake record for a fresh URL when it needs one.
const HYDRATE_EXPIRES_IN = 3600;
// Storage prefixes that used to be public for intakes (removed from
// PUBLIC_KEY_PREFIXES by P3-6-F10). Only used to recognize legacy public
// URLs minted before the change (e.g. through a CDN base URL whose host
// knownObjectKeyFromUrl cannot map back).
const LEGACY_INTAKE_PREFIXES = [
  'beauty-intakes/',
  'creative-intakes/',
  'maintenance-requests/',
  'trades-diagnostics/',
];

function legacyIntakeKeyFromUrl(raw) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(raw).pathname || '');
  } catch {
    return null;
  }
  const key = normalizeStorageKey(pathname.replace(/^\/+/, ''));
  if (key && LEGACY_INTAKE_PREFIXES.some((prefix) => key.startsWith(prefix))) return key;
  return null;
}

function toPrivatePhotoRef(key) {
  const normalized = normalizeStorageKey(key);
  if (!normalized) throw new Error('Invalid storage key for intake photo');
  return `${PRIVATE_REF_PREFIX}${normalized}`;
}

function isPrivatePhotoRef(value) {
  return String(value || '').startsWith(PRIVATE_REF_PREFIX);
}

// Resolve any stored photo reference to its storage key:
//  - `private://<key>` (current format)
//  - a legacy public URL minted before intakes went private
//  - a bare storage key
// Returns null when the value resolves to nothing usable. Never throws.
function resolvePhotoKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith(PRIVATE_REF_PREFIX)) {
    return normalizeStorageKey(raw.slice(PRIVATE_REF_PREFIX.length));
  }
  const fromUrl = knownObjectKeyFromUrl(raw);
  if (fromUrl) return fromUrl;
  const legacy = legacyIntakeKeyFromUrl(raw);
  if (legacy) return legacy;
  // Relative storage URLs (stored when no public base URL is configured).
  const relative = raw.match(/^\/?api\/storage\/(?:public|files)\/([^?#]+)/);
  if (relative) {
    try {
      const key = normalizeStorageKey(decodeURIComponent(relative[1]));
      if (key) return key;
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return null;
  return normalizeStorageKey(raw);
}

async function hydratePhotoUrl(value, expiresIn = HYDRATE_EXPIRES_IN) {
  const key = resolvePhotoKey(value);
  if (!key) return value;
  try {
    return (await getSignedDownloadUrl(key, expiresIn)) || value;
  } catch {
    return value;
  }
}

async function hydratePhotoUrls(values, expiresIn = HYDRATE_EXPIRES_IN) {
  const list = Array.isArray(values) ? values : [];
  return Promise.all(list.map((value) => hydratePhotoUrl(value, expiresIn)));
}

// Return a shallow copy of an intake row with photo_urls hydrated to signed
// download URLs. Rows pass through untouched when they carry no photos.
async function withHydratedPhotos(row, expiresIn = HYDRATE_EXPIRES_IN) {
  if (!row || typeof row !== 'object') return row;
  const photos = row.photo_urls;
  if (!Array.isArray(photos) || photos.length === 0) return row;
  return { ...row, photo_urls: await hydratePhotoUrls(photos, expiresIn) };
}

async function withHydratedPhotosList(rows, expiresIn = HYDRATE_EXPIRES_IN) {
  if (!Array.isArray(rows)) return rows;
  return Promise.all(rows.map((row) => withHydratedPhotos(row, expiresIn)));
}

module.exports = {
  PRIVATE_REF_PREFIX,
  HYDRATE_EXPIRES_IN,
  toPrivatePhotoRef,
  isPrivatePhotoRef,
  resolvePhotoKey,
  hydratePhotoUrl,
  hydratePhotoUrls,
  withHydratedPhotos,
  withHydratedPhotosList,
};
