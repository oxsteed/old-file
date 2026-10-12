import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, X } from 'lucide-react';
import { suggestLocation, reverseGeocode } from '../../api/geo';
import { getMediaVerification } from '../../api/media';
import { getSharedBrowserLocationResult } from '../../utils/browserLocation';
import { trapMediaDialogFocus } from './mediaDialogFocus';

const Context = createContext(null);
const KEY = 'oxsteed.media.location';
function locationFromSearch(search) {
  const params = new URLSearchParams(search);
  if (params.get('location') === 'all') return { location_mode: 'all' };
  if (params.get('city')?.trim() && params.get('state')?.trim()) {
    return { location_mode: 'custom', city: params.get('city').trim().slice(0, 120), state: params.get('state').trim().slice(0, 120) };
  }
  return null;
}

function initialLocation(search = window.location.search) {
  const explicit = locationFromSearch(search);
  if (explicit) return explicit;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.location_mode === 'all') return saved;
    if (saved?.location_mode === 'custom' && ((typeof saved.city === 'string' && saved.city.trim() && typeof saved.state === 'string' && saved.state.trim())
      || (Number.isFinite(saved.latitude) && Math.abs(saved.latitude) <= 90 && Number.isFinite(saved.longitude) && Math.abs(saved.longitude) <= 180))) return saved;
  } catch { /* Optional browser persistence. */ }
  return { location_mode: 'profile' };
}

function sameLocation(left, right) {
  return left?.location_mode === right?.location_mode
    && left?.city === right?.city
    && left?.state === right?.state
    && left?.latitude === right?.latitude
    && left?.longitude === right?.longitude;
}

export function MediaNeighborhoodProvider({ children, user }) {
  const { t } = useTranslation();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const [location, setLocation] = useState(() => initialLocation(search));
  const [resolvedLocation, setResolvedLocation] = useState(() => initialLocation(search));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [lookupQuery, setLookupQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const dialog = useRef(null);
  const input = useRef(null);
  const previousSearch = useRef(search);
  const profileCity = typeof user?.city === 'string' ? user.city.trim() : '';
  const profileState = typeof user?.state === 'string' ? user.state.trim() : '';
  const displayLocation = resolvedLocation.location_mode === 'profile' && !resolvedLocation.city && profileCity
    ? { ...resolvedLocation, city: profileCity, ...(profileState ? { state: profileState } : {}) }
    : resolvedLocation;
  const hasLocation = Boolean(displayLocation.city || Number.isFinite(displayLocation.latitude));
  const displayCity = displayLocation.city?.replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase());
  const displayState = displayLocation.state?.length === 2 ? displayLocation.state.toUpperCase() : displayLocation.state;
  const label = displayLocation.city ? [displayCity, displayState].filter(Boolean).join(', ')
    : t(displayLocation.location_mode === 'all' ? 'media.feed.allLocations' : hasLocation ? 'media.feed.nearDevice' : 'media.feed.chooseLocation');
  const chooseLocation = useCallback(choice => {
    request.current += 1;
    setLocation(choice); setResolvedLocation(choice); setOpen(false); setBusy(false); setError(''); setMatches([]);
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* Optional browser persistence. */ }
    const params = new URLSearchParams(search);
    params.delete('location'); params.delete('city'); params.delete('state');
    if (choice.location_mode === 'all') params.set('location', 'all');
    else if (choice.location_mode === 'custom' && choice.city && choice.state) {
      params.set('city', choice.city); params.set('state', choice.state);
    }
    const nextSearch = params.toString();
    if (nextSearch !== search.replace(/^\?/, '')) navigate({ pathname, search: nextSearch ? `?${nextSearch}` : '', hash }, { replace: true });
  }, [pathname, search, hash, navigate]);
  const chooseLocationRef = useRef(chooseLocation);
  chooseLocationRef.current = chooseLocation;
  const openLocation = useCallback(initialQuery => { request.current += 1; if (typeof initialQuery === 'string') { setQuery(initialQuery); setLookupQuery(initialQuery.trim()); } setError(''); setMatches([]); setBusy(false); setOpen(true); }, []);

  // Location links can be opened or changed without remounting the Media
  // shell. Treat explicit URL parameters as authoritative in that case.
  useEffect(() => {
    if (previousSearch.current === search) return;
    const previousExplicit = locationFromSearch(previousSearch.current);
    previousSearch.current = search;
    const explicit = locationFromSearch(search);
    if (!explicit || sameLocation(previousExplicit, explicit)) return;
    request.current += 1;
    setBusy(false); setError(''); setMatches([]);
    // City URLs cannot encode approximate device coordinates. Updating the
    // URL for our current city must not discard those coordinates or trigger
    // another feed request for the same user choice.
    if (sameLocation(location, explicit) || (
      location.location_mode === 'custom' && explicit.location_mode === 'custom'
      && location.city === explicit.city && location.state === explicit.state
    )) return;
    setLocation(explicit);
    setResolvedLocation(explicit);
    try { localStorage.setItem(KEY, JSON.stringify(explicit)); } catch { /* Optional browser persistence. */ }
  }, [search, location]);

  // Profile mode is a valid location choice even when it has not been
  // persisted with a city snapshot yet. Resolve it from the signed-in user's
  // approximate profile location so desktop and mobile headers display the
  // same useful label without using precise device coordinates.
  useEffect(() => {
    if (!user || location.location_mode !== 'profile') return;
    const city = profileCity;
    const state = profileState;
    if (!city || !state) return;
    setResolvedLocation(current => (
      current.location_mode === 'profile' && current.city === city && current.state === state
        ? current
        : { location_mode: 'profile', city, state }
    ));
  }, [location.location_mode, profileCity, profileState]);

  // Some older authenticated sessions do not include the profile address in
  // /auth/me even though Media has the same authoritative location on the
  // publisher record. Resolve that fallback once so desktop and mobile use a
  // real city label instead of the generic nearby placeholder.
  useEffect(() => {
    if (!user || location.location_mode !== 'profile' || (profileCity && profileState)) return undefined;
    let cancelled = false;
    getMediaVerification().then(data => {
      if (cancelled) return;
      const personal = (data.publishers || []).find(publisher => publisher.actor_type === 'user');
      const city = typeof personal?.location?.city === 'string' ? personal.location.city.trim() : '';
      const state = typeof personal?.location?.region === 'string' ? personal.location.region.trim() : '';
      if (!city || !state) return;
      setResolvedLocation(current => current.location_mode === 'profile' ? { location_mode: 'profile', city, state } : current);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [location.location_mode, profileCity, profileState, user?.id]);

  // Silently use device location on first visit only if the browser permission
  // was already granted (no prompt). The permission dialog itself must only
  // ever appear from a user gesture (header location button).
  useEffect(() => {
    const loc = initialLocation();
    if (loc.location_mode === 'all' || loc.location_mode === 'custom') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const query = navigator.permissions?.query?.bind(navigator.permissions);
    if (!query) return;
    let cancelled = false;
    const id = request.current;
    query({ name: 'geolocation' }).then(status => {
      if (cancelled || id !== request.current || status.state !== 'granted') return;
      return getSharedBrowserLocationResult().then(async result => {
        if (cancelled || id !== request.current || !result.coords) return;
        const lat = Math.round(result.coords.lat * 1000) / 1000;
        const lng = Math.round(result.coords.lng * 1000) / 1000;
        let city = '', state = '';
        try {
          const geo = await reverseGeocode(lat, lng);
          city = geo.city || ''; state = geo.state || '';
        } catch { /* Keep coordinates; label falls back to generic. */ }
        if (cancelled || id !== request.current) return;
        const choice = {
          location_mode: 'custom',
          latitude: lat,
          longitude: lng,
          ...(city ? { city, state } : {}),
        };
        chooseLocationRef.current(choice);
      });
    }).catch(() => { /* Permissions API unavailable; leave it to user action. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') setOpen(false);
      else trapMediaDialogFocus(event, dialog.current);
    };
    document.addEventListener('keydown', onKey);
    return () => { request.current += 1; document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); trigger?.focus?.(); };
  }, [open]);

  const lookupLocation = useCallback(async value => {
    const id = ++request.current;
    setBusy(true); setError(''); setMatches([]);
    try {
      const results = (await suggestLocation(value.trim())).filter(place => place.city && place.state);
      if (id !== request.current) return;
      if (results.length === 1) chooseLocation({ location_mode: 'custom', city: results[0].city, state: results[0].state });
      else if (results.length) setMatches(results);
      else setError(t('media.landing.locationNoMatch'));
    } catch { if (id === request.current) setError(t('media.landing.locationFailed')); }
    finally { if (id === request.current) setBusy(false); }
  }, [chooseLocation, t]);
  const findLocation = event => { event.preventDefault(); void lookupLocation(query); };
  useEffect(() => {
    if (open && lookupQuery) { setLookupQuery(''); void lookupLocation(lookupQuery); }
  }, [open, lookupQuery, lookupLocation]);
  const deviceLocation = async () => {
    const id = ++request.current;
    setBusy(true); setError('');
    const result = await getSharedBrowserLocationResult(true);
    if (id !== request.current) return;
    if (result.coords) {
      const lat = Math.round(result.coords.lat * 1000) / 1000;
      const lng = Math.round(result.coords.lng * 1000) / 1000;
      let city = '', state = '';
      try {
        const geo = await reverseGeocode(lat, lng);
        if (id !== request.current) return;
        city = geo.city || ''; state = geo.state || '';
      } catch { /* Keep coordinates; label falls back to generic. */ }
      if (id !== request.current) return;
      chooseLocation({ location_mode: 'custom', latitude: lat, longitude: lng, ...(city ? { city, state } : {}) });
    }
    else {
      setBusy(false);
      const messageKey = {
        permission_denied: 'media.feed.locationPermissionDenied',
        position_unavailable: 'media.feed.locationPositionUnavailable',
        timeout: 'media.feed.locationTimeout',
        unsupported: 'media.feed.locationUnsupported',
      }[result.error] || 'media.feed.locationUnavailable';
      setError(t(messageKey));
    }
  };

  return <Context.Provider value={{ location, resolvedLocation, setResolvedLocation, chooseLocation, openLocation, isLocationOpen: open, hasLocation, label }}>
    {children}
    {open && <div className="media-location-overlay media-reference-shell" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialog} className="media-location-dialog" role="dialog" aria-modal="true" aria-labelledby="media-location-title">
        <button className="media-location-close" type="button" onClick={() => setOpen(false)} aria-label={t('common.close', { defaultValue: 'Close' })}><X size={22} /></button>
        <MapPin size={28} aria-hidden="true" />
        <h2 id="media-location-title">{t('media.feed.chooseLocation')}</h2>
        <p>{t('media.landing.locationDescription')}</p>
        <form onSubmit={findLocation}>
          <label htmlFor="media-location-query">{t('media.landing.cityOrZip')}</label>
          <input ref={input} id="media-location-query" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('media.landing.cityOrZip')} required minLength={2} maxLength={160} />
          <button className="media-primary-button" disabled={busy} type="submit">{t(busy ? 'media.feed.locating' : 'media.feed.chooseLocation')}</button>
        </form>
        {matches.length > 0 && <ul className="media-location-matches">{matches.map((place, index) => <li key={index}><button type="button" onClick={() => chooseLocation({ location_mode: 'custom', city: place.city, state: place.state })}>{place.display || `${place.city}, ${place.state}`}</button></li>)}</ul>}
        {error && <p role="alert" className="media-location-error">{error}</p>}
        <div className="media-location-options">
          <button type="button" disabled={busy} onClick={deviceLocation}>{t('media.feed.useDeviceLocation')}</button>
          {user && <button type="button" onClick={() => chooseLocation({ location_mode: 'profile' })}>{t('media.feed.profileLocation')}</button>}
          <button type="button" onClick={() => chooseLocation({ location_mode: 'all' })}>{t('media.feed.allLocations')}</button>
        </div>
      </section>
    </div>}
  </Context.Provider>;
}

export const useMediaNeighborhood = () => useContext(Context);
