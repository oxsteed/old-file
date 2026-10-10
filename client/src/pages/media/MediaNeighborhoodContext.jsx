import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, X } from 'lucide-react';
import { suggestLocation } from '../../api/geo';
import { getSharedBrowserLocation } from '../../utils/browserLocation';
import { trapMediaDialogFocus } from './mediaDialogFocus';

const Context = createContext(null);
const KEY = 'oxsteed.media.location';
function initialLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('location') === 'all') return { location_mode: 'all' };
  if (params.get('city')?.trim() && params.get('state')?.trim()) {
    return { location_mode: 'custom', city: params.get('city').slice(0, 120), state: params.get('state').slice(0, 120) };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.location_mode === 'all') return saved;
    if (saved?.location_mode === 'custom' && ((typeof saved.city === 'string' && saved.city.trim() && typeof saved.state === 'string' && saved.state.trim())
      || (Number.isFinite(saved.latitude) && Math.abs(saved.latitude) <= 90 && Number.isFinite(saved.longitude) && Math.abs(saved.longitude) <= 180))) return saved;
  } catch { /* Optional browser persistence. */ }
  return { location_mode: 'profile' };
}

export function MediaNeighborhoodProvider({ children, user }) {
  const { t } = useTranslation();
  const [location, setLocation] = useState(initialLocation);
  const [resolvedLocation, setResolvedLocation] = useState(initialLocation);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [lookupQuery, setLookupQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const dialog = useRef(null);
  const input = useRef(null);
  const hasLocation = Boolean(resolvedLocation.city || Number.isFinite(resolvedLocation.latitude));
  const displayCity = resolvedLocation.city?.replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase());
  const displayState = resolvedLocation.state?.length === 2 ? resolvedLocation.state.toUpperCase() : resolvedLocation.state;
  const label = resolvedLocation.city ? [displayCity, displayState].filter(Boolean).join(', ')
    : t(resolvedLocation.location_mode === 'all' ? 'media.feed.allLocations' : hasLocation ? 'media.feed.nearDevice' : 'media.feed.chooseLocation');
  const chooseLocation = useCallback(choice => {
    request.current += 1;
    setLocation(choice); setResolvedLocation(choice); setOpen(false); setBusy(false); setError(''); setMatches([]);
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* Optional browser persistence. */ }
  }, []);
  const openLocation = useCallback(initialQuery => { if (typeof initialQuery === 'string') { setQuery(initialQuery); setLookupQuery(initialQuery.trim()); } setError(''); setMatches([]); setBusy(false); setOpen(true); }, []);

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
    const coords = await getSharedBrowserLocation(true);
    if (id !== request.current) return;
    if (coords) chooseLocation({ location_mode: 'custom', latitude: Math.round(coords.lat * 1000) / 1000, longitude: Math.round(coords.lng * 1000) / 1000 });
    else { setBusy(false); setError(t('media.feed.locationUnavailable')); }
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
