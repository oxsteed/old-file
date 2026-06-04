import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, Wifi } from 'lucide-react';
import type { LocationInfo } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface LocationSectionProps {
  location: LocationInfo;
}

/** Approximate geocode for city/state/zip when lat/lng missing (Nominatim; US-focused). */
async function geocodeCityStateZip(
  city: string,
  state: string,
  zip: string,
  language: string,
): Promise<[number, number] | null> {
  const parts = [city, state, zip, 'USA'].filter(Boolean).join(', ');
  if (!city.trim() && !state.trim()) return null;

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(parts)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': language,
      // Nominatim usage policy: identify application
      'User-Agent': 'OxSteedMarketplace/1.0 (contact: support@oxsteed.com)',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!data?.length) return null;
  const lat = parseFloat(data[0].lat);
  const lon = parseFloat(data[0].lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
  return null;
}

const ServiceAreaMapLazy = React.lazy(() => import('./ServiceAreaMapLeaflet'));

const LocationSection: React.FC<LocationSectionProps> = ({ location }) => {
  const { t, i18n } = useTranslation();
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [loadingMap, setLoadingMap] = useState(true);
  const geocodeLanguage = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];

  const hasCoords =
    location.serviceLat != null &&
    location.serviceLng != null &&
    Number.isFinite(location.serviceLat) &&
    Number.isFinite(location.serviceLng);

  useEffect(() => {
    let cancelled = false;

    async function resolveCenter() {
      setLoadingMap(true);
      setGeoFailed(false);

      if (hasCoords) {
        setCenter([location.serviceLat as number, location.serviceLng as number]);
        setLoadingMap(false);
        return;
      }

      try {
        const resolved = await geocodeCityStateZip(
          location.city,
          location.state,
          location.zip,
          geocodeLanguage,
        );
        if (cancelled) return;
        if (resolved) {
          setCenter(resolved);
        } else {
          setGeoFailed(true);
          setCenter(null);
        }
      } catch {
        if (!cancelled) {
          setGeoFailed(true);
          setCenter(null);
        }
      } finally {
        if (!cancelled) setLoadingMap(false);
      }
    }

    resolveCenter();
    return () => {
      cancelled = true;
    };
  }, [
    hasCoords,
    location.serviceLat,
    location.serviceLng,
    location.city,
    location.state,
    location.zip,
    geocodeLanguage,
  ]);

  const radiusMiles = useMemo(
    () => Math.max(1, Number(location.serviceRadius) || 10),
    [location.serviceRadius],
  );

  const mapAria = t('helperProfile.location.serviceAreaMapAria', {
    city: location.city,
    state: location.state,
  });

  return (
    <SectionCard id="location" title={t('helperProfile.location.title')}>
      <div className="space-y-4">
        {/* Map */}
        <div
          className="relative h-44 rounded-xl overflow-hidden bg-gray-800 border border-gray-700"
          role="region"
          aria-label={mapAria}
        >
          {loadingMap && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-[5]"
              aria-busy="true"
              aria-live="polite"
            >
              <span className="text-xs text-gray-400">{t('helperProfile.location.mapLoading')}</span>
            </div>
          )}

          {!loadingMap && center && !geoFailed && (
            <React.Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <span className="text-xs text-gray-500">{t('helperProfile.location.mapLoading')}</span>
                </div>
              }
            >
              <ServiceAreaMapLazy center={center} radiusMiles={radiusMiles} />
            </React.Suspense>
          )}

          {!loadingMap && (!center || geoFailed) && (
            <div className="relative h-full flex items-center justify-center">
              <svg
                className="absolute inset-0 w-full h-full opacity-10"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <defs>
                  <pattern id="grid-loc-fallback" width="24" height="24" patternUnits="userSpaceOnUse">
                    <path d="M 24 0 L 0 0 0 24" fill="none" stroke="white" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid-loc-fallback)" />
              </svg>
              <div className="relative flex flex-col items-center gap-1">
                <div className="w-20 h-20 rounded-full border-2 border-brand-500/40 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full border-2 border-brand-500/60 flex items-center justify-center">
                    <div className="w-4 h-4 rounded-full bg-brand-500" />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2 px-2 text-center">
                  {geoFailed || !center
                    ? t('helperProfile.location.mapUnavailable')
                    : `${location.city}, ${location.state}`}
                </p>
              </div>
            </div>
          )}

          <p className="absolute bottom-2 left-2 right-2 text-[10px] text-gray-500 z-[10] pointer-events-none bg-gray-950/70 rounded px-2 py-1">
            {t('helperProfile.location.mapDisclaimer')}
          </p>
        </div>

        {/* Details */}
        <div className="space-y-3 pt-2">
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm text-white font-medium">
                {location.city}, {location.state} {location.zip}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{t('helperProfile.location.basedIn')}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Navigation className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm text-white font-medium">
                {t('helperProfile.location.servesUpTo', {
                  radius: location.serviceRadius,
                  unit: location.radiusUnit === 'miles' ? t('helperProfile.location.miles') : t('helperProfile.location.km'),
                })}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{t('helperProfile.location.serviceRadiusNote')}</p>
            </div>
          </div>

          {location.servesRemotely && (
            <div className="flex items-start gap-3">
              <Wifi className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm text-white font-medium">{t('helperProfile.location.remoteAvailable')}</p>
                {location.remoteNote && (
                  <p className="text-xs text-gray-500 mt-0.5">{location.remoteNote}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-600 border-t border-gray-800 pt-3">
          {t('helperProfile.location.outsideArea')}
        </p>
      </div>
    </SectionCard>
  );
};

export default LocationSection;
