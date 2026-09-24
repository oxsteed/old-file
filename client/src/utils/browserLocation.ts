export type BrowserCoordinates = {
  lat: number;
  lng: number;
};

let locationPromise: Promise<BrowserCoordinates | null> | null = null;

/** Share one browser permission request between homepage widgets. */
export function getSharedBrowserLocation(refresh = false): Promise<BrowserCoordinates | null> {
  if (refresh) locationPromise = null;
  if (locationPromise) return locationPromise;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    locationPromise = Promise.resolve(null);
    return locationPromise;
  }

  locationPromise = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 600000, enableHighAccuracy: false },
    );
  });

  return locationPromise;
}
