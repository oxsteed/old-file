/**
 * Pure helpers for the Public Profile Messenger Dock.
 * Open/guest-phase logic lives here so unit tests stay free of React.
 */

export const MESSENGER_MOBILE_BREAKPOINT = 1024;

/**
 * Profile messenger defaults to the provider (helper/business), not OxSteed AI.
 * @returns {'helper'}
 */
export function defaultProfileChatDestination() {
  return 'helper';
}

/**
 * Guests who may contact without an account see an in-dock gate until
 * name+email are saved. Authenticated users and blocked-guest profiles skip it.
 */
export function shouldShowGuestGate({
  isAuthenticated = false,
  guestContactSaved = false,
  allowGuestContact = true,
} = {}) {
  if (isAuthenticated) return false;
  if (!allowGuestContact) return false;
  return !guestContactSaved;
}

/**
 * @returns {'closed' | 'guest_gate' | 'thread'}
 */
export function getMessengerPhase({
  dockOpen = false,
  isAuthenticated = false,
  guestContactSaved = false,
  allowGuestContact = true,
} = {}) {
  if (!dockOpen) return 'closed';
  if (
    shouldShowGuestGate({
      isAuthenticated,
      guestContactSaved,
      allowGuestContact,
    })
  ) {
    return 'guest_gate';
  }
  return 'thread';
}

export function shouldShowLauncher({ dockOpen = false } = {}) {
  return !dockOpen;
}

/**
 * @returns {'sheet' | 'panel'}
 */
export function resolveDockLayout(
  viewportWidth,
  mobileBreakpoint = MESSENGER_MOBILE_BREAKPOINT,
) {
  return viewportWidth < mobileBreakpoint ? 'sheet' : 'panel';
}

/** At most one attention pulse per session while the dock stays closed. */
export function shouldPulseLauncher({
  dockOpen = false,
  hasPulsedThisSession = false,
} = {}) {
  return !dockOpen && !hasPulsedThisSession;
}

/** Same key shape ChatPanel uses for guest name/email restore. */
export function guestContactStorageKey(helperId, businessId) {
  return `oxs:guest-contact:${helperId}:${businessId ?? 'personal'}`;
}

export function isValidGuestEmail(email) {
  const value = String(email || '').trim();
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function canContinueAsGuest({ name = '', email = '' } = {}) {
  return Boolean(String(name).trim()) && isValidGuestEmail(email);
}

export function readGuestContact(helperId, businessId, storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem?.(guestContactStorageKey(helperId, businessId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const name = String(parsed?.name || '').trim();
    const email = String(parsed?.email || '').trim();
    if (!name || !isValidGuestEmail(email)) return null;
    return { name, email };
  } catch {
    return null;
  }
}

export function writeGuestContact(
  helperId,
  businessId,
  { name, email },
  storage = globalThis.sessionStorage,
) {
  const payload = {
    name: String(name || '').trim(),
    email: String(email || '').trim(),
  };
  if (!canContinueAsGuest(payload)) return false;
  try {
    storage?.setItem?.(
      guestContactStorageKey(helperId, businessId),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    return false;
  }
}


/** Session key for verified guest token bound to a helper/business profile. */
export function guestVerifiedStorageKey(helperId, businessId) {
  return `oxs:guest-verified:${helperId}:${businessId ?? 'personal'}`;
}

export function readGuestVerifiedSession(
  helperId,
  businessId,
  storage = globalThis.sessionStorage,
) {
  try {
    const raw = storage?.getItem?.(guestVerifiedStorageKey(helperId, businessId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const guestToken = String(parsed?.guestToken || '').trim();
    const sessionId = String(parsed?.sessionId || '').trim();
    const email = String(parsed?.email || '').trim();
    const name = String(parsed?.name || '').trim();
    const expiresAt = Number(parsed?.expiresAt || 0);
    if (!guestToken || !sessionId) return null;
    if (expiresAt && Date.now() > expiresAt) {
      storage?.removeItem?.(guestVerifiedStorageKey(helperId, businessId));
      return null;
    }
    return {
      guestToken,
      sessionId,
      email,
      name,
      helperId: parsed?.helperId || helperId,
      businessId: parsed?.businessId ?? businessId ?? null,
      providerOnline: Boolean(parsed?.providerOnline),
      expiresAt: expiresAt || null,
    };
  } catch {
    return null;
  }
}

export function writeGuestVerifiedSession(
  helperId,
  businessId,
  payload,
  storage = globalThis.sessionStorage,
) {
  const guestToken = String(payload?.guestToken || '').trim();
  const sessionId = String(payload?.sessionId || '').trim();
  if (!guestToken || !sessionId) return false;
  const expiresInSeconds = Number(payload?.expiresInSeconds || 24 * 3600);
  const record = {
    guestToken,
    sessionId,
    email: String(payload?.email || '').trim(),
    name: String(payload?.name || '').trim(),
    helperId: payload?.helperId || helperId,
    businessId: payload?.businessId ?? businessId ?? null,
    providerOnline: Boolean(payload?.providerOnline),
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
  try {
    storage?.setItem?.(
      guestVerifiedStorageKey(helperId, businessId),
      JSON.stringify(record),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearGuestVerifiedSession(
  helperId,
  businessId,
  storage = globalThis.sessionStorage,
) {
  try {
    storage?.removeItem?.(guestVerifiedStorageKey(helperId, businessId));
  } catch {
    /* ignore */
  }
}

/**
 * Gate until guest is email-verified for this profile.
 * @returns {'closed' | 'guest_gate' | 'guest_otp' | 'thread'}
 */
export function getMessengerPhaseWithVerification({
  dockOpen = false,
  isAuthenticated = false,
  guestContactSaved = false,
  guestVerified = false,
  allowGuestContact = true,
  otpPending = false,
} = {}) {
  if (!dockOpen) return 'closed';
  if (isAuthenticated) return 'thread';
  if (!allowGuestContact) return 'thread';
  if (guestVerified) return 'thread';
  if (otpPending || guestContactSaved) return 'guest_otp';
  return 'guest_gate';
}
