import { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';
import { getSharedBrowserLocation } from '../utils/browserLocation';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from './useAccessProjection';

function validCoordinates(candidate) {
  const lat = Number(candidate?.lat);
  const lng = Number(candidate?.lng);
  return Number.isFinite(lat) && Math.abs(lat) <= 90
    && Number.isFinite(lng) && Math.abs(lng) <= 180;
}

async function profileLocation(city, state) {
  if (!city?.trim()) return null;
  try {
    const { data } = await api.get('/geo/suggest', { params: { q: [city, state].filter(Boolean).join(', ') } });
    const candidates = Array.isArray(data) ? data : [];
    const match = candidates.find((candidate) => validCoordinates(candidate)
      && (!state || String(candidate.state || '').toLowerCase() === state.toLowerCase()));
    return match ? { lat: Number(match.lat), lng: Number(match.lng), city: match.city || city, state: match.state || state } : null;
  } catch {
    return null;
  }
}

async function reverseLocation(coordinates) {
  try {
    const { data } = await api.get('/geo/reverse', { params: { lat: coordinates.lat, lng: coordinates.lng } });
    return { city: data?.city || '', state: data?.state || '' };
  } catch {
    return { city: '', state: '' };
  }
}

/** Use a distance radius, with a same-city fallback for jobs lacking coordinates. */
export default function useNearbyJobs({ enabled, city, state, accountId }) {
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState(enabled ? 'loading' : 'setup');
  const [locationSource, setLocationSource] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const retry = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    const refresh = () => { setJobs([]); setRefreshToken(value => value + 1); };
    window.addEventListener('oxsteed:discovery-changed', refresh);
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => { window.removeEventListener('oxsteed:discovery-changed', refresh); window.removeEventListener(ACCESS_CHANGED_EVENT, refresh); };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setJobs([]);
      setStatus('setup');
      return undefined;
    }

    let active = true;
    const epoch = currentAuthEpoch();
    const current = () => active && isCurrentAuthEpoch(epoch);
    setStatus('loading');
    setJobs([]);

    (async () => {
      let radius;
      try {
        const { data } = await api.get('/helpers/me/discovery');
        radius = data?.preferences?.opportunity_radius_miles;
        if (!Number.isInteger(radius) || radius < 1 || radius > 250) throw new Error('Invalid distance preference');
      } catch { if (current()) setStatus('error'); return; }
      if (!current()) return;
      const browser = await getSharedBrowserLocation(refreshToken > 0);
      const fromBrowser = validCoordinates(browser);
      const coordinates = fromBrowser ? browser : await profileLocation(city, state);
      const profileCity = typeof city === 'string' ? city.trim() : '';
      const profileState = typeof state === 'string' ? state.trim() : '';
      if (!current()) return;
      if (!coordinates && !profileCity) {
        setLocationSource(null);
        setStatus('location-unavailable');
        return;
      }

      setLocationSource(fromBrowser ? 'browser' : 'profile');
      try {
        const namedLocation = fromBrowser ? await reverseLocation(coordinates) : coordinates;
        if (!current()) return;
        const { data } = await api.get('/jobs', {
          params: coordinates
            ? {
                lat: coordinates.lat, lng: coordinates.lng, radius, sort: 'nearest', limit: 5,
                ...(namedLocation.city && namedLocation.state
                  ? { fallback_city: namedLocation.city, fallback_state: namedLocation.state }
                  : {}),
              }
            : { city: profileCity, ...(profileState ? { state: profileState } : {}), sort: 'newest', limit: 5 },
        });
        if (!current()) return;
        setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
        setStatus('ready');
      } catch {
        if (current()) setStatus('error');
      }
    })();

    return () => { active = false; };
  }, [enabled, city, state, accountId, refreshToken]);

  return { jobs, status, locationSource, retry };
}
