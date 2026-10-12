export type BrowserCoordinates = {
  lat: number;
  lng: number;
};

export type BrowserLocationErrorCode = 'permission_denied' | 'position_unavailable' | 'timeout' | 'unsupported' | 'unknown';

export type BrowserLocationResult = {
  coords: BrowserCoordinates | null;
  error: BrowserLocationErrorCode | null;
};

let pendingLocation: Promise<BrowserLocationResult> | null = null;
let cachedLocation: BrowserCoordinates | null = null;
let cachedAt = 0;
const MAXIMUM_AGE_MS = 600000;

function errorCode(error: GeolocationPositionError): BrowserLocationErrorCode {
  if (error.code === 1) return 'permission_denied';
  if (error.code === 2) return 'position_unavailable';
  if (error.code === 3) return 'timeout';
  return 'unknown';
}

/** Resolve one browser permission request with a useful failure reason. */
export function getSharedBrowserLocationResult(refresh = false): Promise<BrowserLocationResult> {
  // Never overlap browser permission requests. A manual retry that happens
  // while a prior request is still pending should share that request; once it
  // settles, a later retry can start a fresh one.
  if (pendingLocation) return pendingLocation;
  if (!refresh && cachedLocation && Date.now() - cachedAt < MAXIMUM_AGE_MS) {
    return Promise.resolve({ coords: cachedLocation, error: null });
  }
  cachedLocation = null;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ coords: null, error: 'unsupported' });
  }

  const request = new Promise<BrowserLocationResult>((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ coords: { lat: coords.latitude, lng: coords.longitude }, error: null }),
        error => resolve({ coords: null, error: errorCode(error) }),
        { timeout: 15000, maximumAge: MAXIMUM_AGE_MS, enableHighAccuracy: false },
      );
    } catch {
      resolve({ coords: null, error: 'unknown' });
    }
  });

  // Do not retain a failed request forever. A later user-initiated attempt can
  // retry after the browser or operating system permission has changed.
  pendingLocation = request.then(result => {
    cachedLocation = result.coords;
    cachedAt = Date.now();
    return result;
  }).finally(() => { pendingLocation = null; });
  return pendingLocation;
}

/** Share one browser permission request between homepage widgets. */
export function getSharedBrowserLocation(refresh = false): Promise<BrowserCoordinates | null> {
  return getSharedBrowserLocationResult(refresh).then(result => result.coords);
}
